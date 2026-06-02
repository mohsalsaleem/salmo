package federation

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

// Compile-time assertion: RegisteredClaims is Verifiable, and a
// struct that embeds it inherits the satisfaction. Catches a regression
// where the GetExpiresAt receiver moves off RegisteredClaims.
var (
	_ Verifiable = RegisteredClaims{}
	_ Verifiable = appClaims{}
)

// appClaims is the canonical example of a custom claims type that
// embeds RegisteredClaims to inherit Verifiable.
type appClaims struct {
	RegisteredClaims
	UserID string `json:"user_id"`
	Role   string `json:"role,omitempty"`
}

var testSecret = []byte("0123456789abcdef0123456789abcdef") // 32 bytes, HS256 minimum

func freshClaims(t *testing.T) appClaims {
	t.Helper()
	now := time.Now().Unix()
	return appClaims{
		RegisteredClaims: RegisteredClaims{
			Issuer:    "host.example.com",
			Audience:  "remote.example.com",
			IssuedAt:  now,
			ExpiresAt: now + 300, // 5 minutes
		},
		UserID: "u123",
		Role:   "admin",
	}
}

// --- round-trip ------------------------------------------------------------

func TestSignVerify_RoundTrip(t *testing.T) {
	want := freshClaims(t)
	token, err := SignHS256(want, testSecret)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	got, err := VerifyHS256[appClaims](token, testSecret)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if got != want {
		t.Errorf("round-trip mismatch\n got:  %+v\n want: %+v", got, want)
	}
}

func TestVerify_PreservesCustomFields(t *testing.T) {
	original := freshClaims(t)
	token, _ := SignHS256(original, testSecret)
	got, _ := VerifyHS256[appClaims](token, testSecret)

	if got.UserID != "u123" || got.Role != "admin" {
		t.Errorf("custom fields lost: %+v", got)
	}
	if got.Issuer != "host.example.com" || got.Audience != "remote.example.com" {
		t.Errorf("standard fields lost: %+v", got)
	}
}

// --- Sign errors -----------------------------------------------------------

func TestSign_RejectsShortSecret(t *testing.T) {
	_, err := SignHS256(freshClaims(t), []byte("short"))
	if err == nil {
		t.Fatal("expected error for short secret, got nil")
	}
	if !strings.Contains(err.Error(), "32 bytes") {
		t.Errorf("error should mention minimum length, got: %v", err)
	}
}

func TestSign_RejectsNilClaims(t *testing.T) {
	_, err := SignHS256(nil, testSecret)
	if err == nil {
		t.Fatal("expected error for nil claims, got nil")
	}
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("expected ErrInvalidToken, got: %v", err)
	}
}

func TestSign_RejectsMissingExpiry(t *testing.T) {
	c := freshClaims(t)
	c.ExpiresAt = 0
	_, err := SignHS256(c, testSecret)
	if err == nil {
		t.Fatal("expected error for missing ExpiresAt, got nil")
	}
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("expected ErrInvalidToken, got: %v", err)
	}
}

func TestSign_RejectsPastExpiry(t *testing.T) {
	c := freshClaims(t)
	c.ExpiresAt = -1
	_, err := SignHS256(c, testSecret)
	if err == nil {
		t.Fatal("expected error for negative ExpiresAt, got nil")
	}
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("expected ErrInvalidToken, got: %v", err)
	}
}

// --- Verify errors ---------------------------------------------------------

func TestVerify_RejectsShortSecret(t *testing.T) {
	token, _ := SignHS256(freshClaims(t), testSecret)
	_, err := VerifyHS256[appClaims](token, []byte("short"))
	if err == nil {
		t.Fatal("expected error for short secret, got nil")
	}
}

func TestVerify_RejectsMalformed_WrongPartCount(t *testing.T) {
	cases := []string{
		"a",
		"a.b",
		"a.b.c.d",
		"",
	}
	for _, token := range cases {
		_, err := VerifyHS256[appClaims](token, testSecret)
		if !errors.Is(err, ErrInvalidToken) {
			t.Errorf("token %q: expected ErrInvalidToken, got: %v", token, err)
		}
	}
}

func TestVerify_RejectsMalformed_BadBase64(t *testing.T) {
	// Three parts but the signature isn't base64url.
	token := jwtHeader + "." + base64.RawURLEncoding.EncodeToString([]byte(`{"exp":99999999999}`)) + ".!!!not-b64!!!"
	_, err := VerifyHS256[appClaims](token, testSecret)
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("expected ErrInvalidToken, got: %v", err)
	}
}

func TestVerify_RejectsExpired(t *testing.T) {
	c := freshClaims(t)
	c.ExpiresAt = time.Now().Unix() - 1 // already expired
	// Sign rejects past expiry — we have to forge the token directly
	// to hit the verify-side check.
	token := forgeToken(t, c, testSecret)
	_, err := VerifyHS256[appClaims](token, testSecret)
	if !errors.Is(err, ErrExpired) {
		t.Errorf("expected ErrExpired, got: %v", err)
	}
}

func TestVerify_RejectsBadSignature(t *testing.T) {
	token, _ := SignHS256(freshClaims(t), testSecret)
	// Re-sign with a different key. The verifier (using testSecret)
	// must reject it.
	wrongSecret := []byte("ffffffffffffffffffffffffffffffff")
	_, err := VerifyHS256[appClaims](token, wrongSecret)
	if !errors.Is(err, ErrInvalidSignature) {
		t.Errorf("expected ErrInvalidSignature, got: %v", err)
	}
}

func TestVerify_RejectsTamperedPayload(t *testing.T) {
	token, _ := SignHS256(freshClaims(t), testSecret)
	parts := strings.Split(token, ".")
	// Flip a character in the payload.
	parts[1] = "X" + parts[1][1:]
	tampered := strings.Join(parts, ".")
	_, err := VerifyHS256[appClaims](tampered, testSecret)
	if !errors.Is(err, ErrInvalidSignature) {
		t.Errorf("expected ErrInvalidSignature, got: %v", err)
	}
}

// --- alg=none attack defense -----------------------------------------------

func TestVerify_RejectsAlgNone(t *testing.T) {
	// Build a token with alg=none. Signature is empty. A naive
	// verifier that trusts the header would accept this; ours rejects.
	noneHeader := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"exp":99999999999}`))
	// Empty signature still has to base64-decode correctly.
	token := noneHeader + "." + payload + "."

	_, err := VerifyHS256[appClaims](token, testSecret)
	if err == nil {
		t.Fatal("expected error for alg=none, got nil")
	}
	// Either ErrInvalidSignature (signature didn't match HS256) or
	// ErrUnsupportedAlg (header check) — both are valid defenses.
	if !errors.Is(err, ErrInvalidSignature) && !errors.Is(err, ErrUnsupportedAlg) {
		t.Errorf("expected signature/alg rejection, got: %v", err)
	}
}

func TestVerify_RejectsHeaderWithSmuggledSecondAlg(t *testing.T) {
	// Defensive: a header with two "alg" fields is malformed in a
	// way standard JSON parsers might accept but smuggles intent.
	weirdHeader := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","alg":"none","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"exp":99999999999}`))
	// Sign with HS256 so the signature check passes — the header
	// check is the line of defense we're testing here.
	signingInput := weirdHeader + "." + payload
	sig := signHS256Bytes(testSecret, []byte(signingInput))
	token := signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)

	_, err := VerifyHS256[appClaims](token, testSecret)
	if !errors.Is(err, ErrUnsupportedAlg) {
		t.Errorf("expected ErrUnsupportedAlg, got: %v", err)
	}
}

// --- NotBefore -------------------------------------------------------------

func TestVerify_EnforcesNotBefore(t *testing.T) {
	c := freshClaims(t)
	c.NotBefore = time.Now().Unix() + 600 // valid in 10 minutes
	token := forgeToken(t, c, testSecret)
	_, err := VerifyHS256[appClaims](token, testSecret)
	if !errors.Is(err, ErrNotYetValid) {
		t.Errorf("expected ErrNotYetValid, got: %v", err)
	}
}

func TestVerify_IgnoresZeroNotBefore(t *testing.T) {
	c := freshClaims(t)
	c.NotBefore = 0 // unset
	token, err := SignHS256(c, testSecret)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if _, err := VerifyHS256[appClaims](token, testSecret); err != nil {
		t.Errorf("zero NotBefore should be ignored, got error: %v", err)
	}
}

// --- forging helper --------------------------------------------------------

// forgeToken builds a JWT bypassing SignHS256's claim validation, so
// tests can construct expired-but-signed tokens that exercise the
// verify-side checks.
func forgeToken(t *testing.T, claims any, secret []byte) string {
	t.Helper()
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	signingInput := jwtHeader + "." + base64.RawURLEncoding.EncodeToString(payload)
	sig := signHS256Bytes(secret, []byte(signingInput))
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
}
