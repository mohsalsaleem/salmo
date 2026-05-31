// Package session is the server-side counterpart to AUTH.md. It
// defines the [Store] contract that any session backend implements,
// plus a [CookieStore] default that signs an HMAC-SHA256 envelope and
// stores it in a cookie.
//
// What this package owns:
//   - the Store[T] contract (Get / Set / Destroy)
//   - a cookie+HMAC default safe to use without an external store
//
// What this package does NOT own (per AUTH.md):
//   - login / signup UI
//   - OAuth / OIDC flows
//   - refresh strategies
//   - role / permission checks at render time
//   - the choice between cookie / token / hybrid
//
// CookieStore is suitable for stateless sessions with small payloads
// (a user ID, a role, an expiry — typically <1KB). For server-side
// invalidation or larger payloads, implement Store[T] over Redis,
// Postgres, Valkey, or any backend that fits.
//
// Security note: the cookie payload is base64url(json(value)) +
// HMAC-SHA256(secret, that). The HMAC provides *integrity*
// (tampering is detected), not confidentiality (the value is
// readable by anyone with the cookie). Do not put secrets in the
// payload. If you need confidentiality, use an opaque server-side ID
// referenced by the cookie value and look up the rest in a
// Store[T] backed by a real datastore.
package session

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Store is the server-side session contract. T is the application's
// session payload type — a user ID, a struct with claims, anything
// that round-trips through encoding/json.
//
// Get returns [ErrNoSession] if no session is present on the request,
// [ErrInvalidSession] if a session is present but malformed,
// signature-invalid, or expired, or another error from the underlying
// store.
//
// Set issues a new session, replacing any existing one. Destroy
// clears the session on the client (and, for server-stateful stores,
// invalidates the server-side record).
type Store[T any] interface {
	Get(r *http.Request) (T, error)
	Set(w http.ResponseWriter, value T) error
	Destroy(w http.ResponseWriter) error
}

// Sentinel errors returned by Store implementations. Use errors.Is
// to distinguish "no session" from "invalid session" from other
// backend errors.
var (
	ErrNoSession      = errors.New("session: no session present")
	ErrInvalidSession = errors.New("session: invalid session")
)

// CookieOptions configures the cookie used by [CookieStore]. Use
// [DefaultCookieOptions] as a starting point and mutate the fields
// you care about.
type CookieOptions struct {
	// Name of the cookie. Required (no default — apps should pick a
	// name that namespaces the session, e.g. "myapp_session").
	Name string

	// Path scope for the cookie. Defaults via DefaultCookieOptions to "/".
	Path string

	// Domain scope. Empty = host-only cookie (recommended unless
	// explicitly sharing across subdomains).
	Domain string

	// MaxAge sets both the cookie's MaxAge attribute and the
	// server-side expiry stamp baked into the signed payload. Zero
	// means "session cookie" (no expiry on either side).
	MaxAge time.Duration

	// HttpOnly hides the cookie from document.cookie. Default true.
	HttpOnly bool

	// Secure restricts the cookie to HTTPS connections. Default true.
	// Flip to false for local HTTP development only.
	Secure bool

	// SameSite controls the cross-site cookie policy. Default
	// http.SameSiteLaxMode (sent on top-level navigations from
	// other origins, not on cross-site subresource requests).
	SameSite http.SameSite
}

// DefaultCookieOptions returns production-safe defaults: HttpOnly,
// Secure (HTTPS only), SameSite=Lax, 24h MaxAge, Path=/. The Name
// field is left empty — the caller must set it so cookie names stay
// app-specific.
func DefaultCookieOptions() CookieOptions {
	return CookieOptions{
		Path:     "/",
		MaxAge:   24 * time.Hour,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	}
}

// CookieStore stores sessions in an HMAC-SHA256-signed cookie. See
// the package doc for the integrity-vs-confidentiality trade-off.
type CookieStore[T any] struct {
	secret  []byte
	options CookieOptions
	now     func() time.Time // overridable for tests
}

// minSecretLen is HMAC-SHA256's baseline: at least the hash output
// length (32 bytes) per NIST SP 800-107. Shorter keys reduce
// security margin.
const minSecretLen = 32

// NewCookieStore returns a CookieStore signing with the given secret.
// The secret must be at least 32 bytes (HMAC-SHA256 baseline) and is
// defensively copied — callers may zero their original buffer
// afterwards.
func NewCookieStore[T any](secret []byte, options CookieOptions) (*CookieStore[T], error) {
	if len(secret) < minSecretLen {
		return nil, fmt.Errorf("session: secret must be at least %d bytes, got %d", minSecretLen, len(secret))
	}
	if options.Name == "" {
		return nil, errors.New("session: CookieOptions.Name must be set")
	}
	s := make([]byte, len(secret))
	copy(s, secret)
	return &CookieStore[T]{
		secret:  s,
		options: options,
		now:     time.Now,
	}, nil
}

// envelope wraps the user value with an expiry stamp. The stamp is
// the source of truth for expiration — the cookie MaxAge is a
// transport hint to the browser, but a server that sees an expired
// envelope rejects regardless of MaxAge.
type envelope[T any] struct {
	V T     `json:"v"`
	E int64 `json:"e"` // unix seconds; 0 = no server-side expiry check
}

// Get reads and verifies the session cookie.
func (c *CookieStore[T]) Get(r *http.Request) (T, error) {
	var zero T
	cookie, err := r.Cookie(c.options.Name)
	if err != nil {
		return zero, ErrNoSession
	}
	parts := strings.SplitN(cookie.Value, ".", 2)
	if len(parts) != 2 {
		return zero, ErrInvalidSession
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return zero, ErrInvalidSession
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return zero, ErrInvalidSession
	}
	if !hmac.Equal(sig, c.sign(payload)) {
		return zero, ErrInvalidSession
	}
	var env envelope[T]
	if err := json.Unmarshal(payload, &env); err != nil {
		return zero, ErrInvalidSession
	}
	if env.E != 0 && c.now().Unix() > env.E {
		return zero, ErrInvalidSession
	}
	return env.V, nil
}

// Set issues a session cookie containing the given value. The cookie
// is signed and expires per the store's MaxAge.
func (c *CookieStore[T]) Set(w http.ResponseWriter, value T) error {
	var expUnix int64
	if c.options.MaxAge > 0 {
		expUnix = c.now().Add(c.options.MaxAge).Unix()
	}
	payload, err := json.Marshal(envelope[T]{V: value, E: expUnix})
	if err != nil {
		return fmt.Errorf("session: marshal: %w", err)
	}
	sig := c.sign(payload)
	value64 := base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(sig)
	http.SetCookie(w, &http.Cookie{
		Name:     c.options.Name,
		Value:    value64,
		Path:     c.options.Path,
		Domain:   c.options.Domain,
		MaxAge:   int(c.options.MaxAge.Seconds()),
		HttpOnly: c.options.HttpOnly,
		Secure:   c.options.Secure,
		SameSite: c.options.SameSite,
	})
	return nil
}

// Destroy clears the session cookie by issuing one with MaxAge=-1.
// Browsers interpret that as "delete immediately". For server-stateful
// stores, an implementation should also remove the server-side record.
func (c *CookieStore[T]) Destroy(w http.ResponseWriter) error {
	http.SetCookie(w, &http.Cookie{
		Name:     c.options.Name,
		Value:    "",
		Path:     c.options.Path,
		Domain:   c.options.Domain,
		MaxAge:   -1,
		HttpOnly: c.options.HttpOnly,
		Secure:   c.options.Secure,
		SameSite: c.options.SameSite,
	})
	return nil
}

func (c *CookieStore[T]) sign(payload []byte) []byte {
	h := hmac.New(sha256.New, c.secret)
	h.Write(payload)
	return h.Sum(nil)
}
