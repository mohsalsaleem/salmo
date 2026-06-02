package federation

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Verifiable is the contract a claims type must satisfy to be
// verifiable by [VerifyHS256]. The minimum the verifier requires is
// an expiry stamp — tokens without one cannot be safely accepted,
// because they never expire.
//
// The standard way to satisfy Verifiable is to embed [RegisteredClaims]
// in your application's claims type; GetExpiresAt is promoted and the
// caller never sees the boilerplate.
type Verifiable interface {
	GetExpiresAt() int64 // unix seconds; required, must be > now at verify time
}

// RegisteredClaims contains the standard JWT claims (RFC 7519). Embed
// it in your application claims type to satisfy [Verifiable] and to
// get the canonical "iss", "sub", "aud", "exp", "nbf", "iat", "jti"
// JSON field names.
//
// Example:
//
//	type AppClaims struct {
//	    federation.RegisteredClaims
//	    UserID string `json:"user_id"`
//	    Role   string `json:"role"`
//	}
type RegisteredClaims struct {
	Issuer    string `json:"iss,omitempty"`
	Subject   string `json:"sub,omitempty"`
	Audience  string `json:"aud,omitempty"`
	ExpiresAt int64  `json:"exp,omitempty"`
	NotBefore int64  `json:"nbf,omitempty"`
	IssuedAt  int64  `json:"iat,omitempty"`
	ID        string `json:"jti,omitempty"`
}

// GetExpiresAt satisfies [Verifiable].
func (c RegisteredClaims) GetExpiresAt() int64 { return c.ExpiresAt }

// GetNotBefore is checked by [VerifyHS256] if present on the claims
// type. Returning 0 disables the nbf check for this claims type.
func (c RegisteredClaims) GetNotBefore() int64 { return c.NotBefore }

// Sentinel errors. Use errors.Is to distinguish.
var (
	ErrInvalidToken     = errors.New("federation: invalid token")
	ErrInvalidSignature = errors.New("federation: invalid signature")
	ErrUnsupportedAlg   = errors.New("federation: unsupported alg")
	ErrExpired          = errors.New("federation: token expired")
	ErrNotYetValid      = errors.New("federation: token not yet valid")
)

// JWTSecretMinLen is the HMAC-SHA256 baseline per NIST SP 800-107:
// at least the hash output length (32 bytes). Shorter keys reduce
// security margin.
const JWTSecretMinLen = 32

// jwtHeader is the only header we emit and the only one we accept.
// Pre-encoded so signing is one HMAC, no JSON marshal of the header
// per token. Equivalent to base64url({"alg":"HS256","typ":"JWT"}).
const jwtHeader = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"

// SignHS256 issues a JWT signed with HMAC-SHA256. The claims value
// is JSON-marshaled as the payload. The expiry on claims is required
// and must be strictly positive — issuing forever-tokens is an
// anti-pattern that the package refuses by construction.
func SignHS256(claims Verifiable, secret []byte) (string, error) {
	if claims == nil {
		return "", fmt.Errorf("%w: nil claims", ErrInvalidToken)
	}
	if len(secret) < JWTSecretMinLen {
		return "", fmt.Errorf("federation: secret must be at least %d bytes, got %d", JWTSecretMinLen, len(secret))
	}
	if claims.GetExpiresAt() <= 0 {
		return "", fmt.Errorf("%w: missing or non-positive ExpiresAt", ErrInvalidToken)
	}

	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("federation: marshal claims: %w", err)
	}
	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadBytes)

	signingInput := jwtHeader + "." + payloadB64
	sig := signHS256Bytes(secret, []byte(signingInput))
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// VerifyHS256 validates token's signature and standard claims, then
// returns the decoded claims of type T. T must satisfy [Verifiable]
// (typically by embedding [RegisteredClaims]).
//
// The verifier checks, in order:
//
//  1. token has three dot-separated parts
//  2. signature equals HMAC-SHA256(secret, header.payload) — constant-time
//  3. header alg is "HS256" (rejects alg=none and any other algorithm)
//  4. payload decodes into T
//  5. GetExpiresAt() is strictly greater than time.Now().Unix()
//  6. if T also implements GetNotBefore() int64 with a positive value,
//     time.Now().Unix() must be greater than or equal to it
//
// All other claim checks (iss, sub, aud) are the caller's: read them
// from the returned T and reject what doesn't match your policy.
func VerifyHS256[T Verifiable](token string, secret []byte) (T, error) {
	var zero T
	if len(secret) < JWTSecretMinLen {
		return zero, fmt.Errorf("federation: secret must be at least %d bytes, got %d", JWTSecretMinLen, len(secret))
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return zero, ErrInvalidToken
	}
	headerB64, payloadB64, sigB64 := parts[0], parts[1], parts[2]

	sig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return zero, ErrInvalidToken
	}
	expected := signHS256Bytes(secret, []byte(headerB64+"."+payloadB64))
	if !hmac.Equal(sig, expected) {
		return zero, ErrInvalidSignature
	}

	// Header check. Skipping this would let an attacker swap
	// alg=none and bypass verification.
	header, err := base64.RawURLEncoding.DecodeString(headerB64)
	if err != nil {
		return zero, ErrInvalidToken
	}
	if !isHS256Header(header) {
		return zero, ErrUnsupportedAlg
	}

	payload, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return zero, ErrInvalidToken
	}
	var claims T
	if err := json.Unmarshal(payload, &claims); err != nil {
		return zero, ErrInvalidToken
	}

	now := time.Now().Unix()
	if claims.GetExpiresAt() <= now {
		return zero, ErrExpired
	}
	if nbf, ok := any(claims).(interface{ GetNotBefore() int64 }); ok {
		if at := nbf.GetNotBefore(); at > 0 && now < at {
			return zero, ErrNotYetValid
		}
	}
	return claims, nil
}

func signHS256Bytes(secret, data []byte) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write(data)
	return h.Sum(nil)
}

// isHS256Header accepts only {"alg":"HS256","typ":"JWT"} (and the
// permutation that omits typ, since RFC 7519 makes it optional).
// Decoding is by minimal JSON match to avoid pulling in encoding/json
// for header parsing — keeps the signing hot path allocation-free.
func isHS256Header(header []byte) bool {
	s := string(header)
	// quick reject: must contain alg=HS256
	if !strings.Contains(s, `"alg":"HS256"`) && !strings.Contains(s, `"alg": "HS256"`) {
		return false
	}
	// must not contain any other alg claim (defends against header
	// extension attacks that smuggle a second alg field)
	if strings.Count(s, `"alg"`) != 1 {
		return false
	}
	return true
}

