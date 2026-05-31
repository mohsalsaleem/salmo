package session

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Test payload types to confirm the generic Store[T] contract works
// for both scalar and struct shapes.
type userID string

type sessionData struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
	Admin  bool   `json:"admin"`
}

// testSecret is 32 bytes — the minimum for HMAC-SHA256.
var testSecret = []byte("0123456789abcdef0123456789abcdef")

func newTestStore[T any](t *testing.T) *CookieStore[T] {
	t.Helper()
	opts := DefaultCookieOptions()
	opts.Name = "test_session"
	opts.Secure = false // tests run over plain HTTP
	store, err := NewCookieStore[T](testSecret, opts)
	if err != nil {
		t.Fatalf("NewCookieStore: %v", err)
	}
	return store
}

// --- interface satisfaction ------------------------------------------------

// Compile-time assertion: CookieStore implements Store for any T.
var _ Store[sessionData] = (*CookieStore[sessionData])(nil)
var _ Store[userID] = (*CookieStore[userID])(nil)

// --- constructor validation ------------------------------------------------

func TestNewCookieStore_RejectsShortSecret(t *testing.T) {
	opts := DefaultCookieOptions()
	opts.Name = "x"
	_, err := NewCookieStore[sessionData]([]byte("too-short"), opts)
	if err == nil {
		t.Fatal("expected error for short secret, got nil")
	}
	if !strings.Contains(err.Error(), "32 bytes") {
		t.Errorf("error should mention minimum length, got: %v", err)
	}
}

func TestNewCookieStore_RejectsEmptyName(t *testing.T) {
	_, err := NewCookieStore[sessionData](testSecret, CookieOptions{})
	if err == nil {
		t.Fatal("expected error for empty Name, got nil")
	}
	if !strings.Contains(err.Error(), "Name") {
		t.Errorf("error should mention Name, got: %v", err)
	}
}

func TestNewCookieStore_DefensiveSecretCopy(t *testing.T) {
	// Mutating the caller's secret after construction must not affect
	// the store's signing key.
	secret := make([]byte, 32)
	copy(secret, testSecret)
	opts := DefaultCookieOptions()
	opts.Name = "x"
	store, err := NewCookieStore[userID](secret, opts)
	if err != nil {
		t.Fatalf("NewCookieStore: %v", err)
	}

	w := httptest.NewRecorder()
	_ = store.Set(w, userID("u1"))
	cookieBefore := w.Header().Get("Set-Cookie")

	// Zero the caller's buffer and re-issue with a fresh store
	// built from the same (now-zeroed) buffer.
	for i := range secret {
		secret[i] = 0
	}

	w2 := httptest.NewRecorder()
	_ = store.Set(w2, userID("u1"))
	cookieAfter := w2.Header().Get("Set-Cookie")

	if cookieBefore != cookieAfter {
		t.Errorf("mutating original secret changed signed output\n before: %s\n after:  %s", cookieBefore, cookieAfter)
	}
}

// --- round-trip ------------------------------------------------------------

func TestCookieStore_RoundTrip_ScalarPayload(t *testing.T) {
	store := newTestStore[userID](t)

	w := httptest.NewRecorder()
	if err := store.Set(w, userID("alice")); err != nil {
		t.Fatalf("Set: %v", err)
	}

	r := requestWithCookies(t, w)
	got, err := store.Get(r)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != "alice" {
		t.Errorf("Get returned %q, want %q", got, "alice")
	}
}

func TestCookieStore_RoundTrip_StructPayload(t *testing.T) {
	store := newTestStore[sessionData](t)
	want := sessionData{UserID: "u123", Role: "admin", Admin: true}

	w := httptest.NewRecorder()
	if err := store.Set(w, want); err != nil {
		t.Fatalf("Set: %v", err)
	}

	r := requestWithCookies(t, w)
	got, err := store.Get(r)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != want {
		t.Errorf("Get returned %+v, want %+v", got, want)
	}
}

// --- error paths -----------------------------------------------------------

func TestCookieStore_Get_NoCookie_ReturnsErrNoSession(t *testing.T) {
	store := newTestStore[userID](t)
	r := httptest.NewRequest("GET", "/", nil)

	_, err := store.Get(r)
	if !errors.Is(err, ErrNoSession) {
		t.Errorf("expected ErrNoSession, got: %v", err)
	}
}

func TestCookieStore_Get_MalformedCookie_ReturnsErrInvalidSession(t *testing.T) {
	store := newTestStore[userID](t)
	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: "test_session", Value: "no-dot-here"})

	_, err := store.Get(r)
	if !errors.Is(err, ErrInvalidSession) {
		t.Errorf("expected ErrInvalidSession, got: %v", err)
	}
}

func TestCookieStore_Get_TamperedPayload_ReturnsErrInvalidSession(t *testing.T) {
	store := newTestStore[userID](t)

	w := httptest.NewRecorder()
	_ = store.Set(w, userID("alice"))

	r := requestWithCookies(t, w)
	cookie, _ := r.Cookie("test_session")
	// Flip a byte in the payload portion (before the dot).
	dot := strings.Index(cookie.Value, ".")
	if dot <= 0 {
		t.Fatalf("malformed test setup, no dot in: %s", cookie.Value)
	}
	tampered := flipChar(cookie.Value[:dot]) + cookie.Value[dot:]

	r2 := httptest.NewRequest("GET", "/", nil)
	r2.AddCookie(&http.Cookie{Name: "test_session", Value: tampered})

	_, err := store.Get(r2)
	if !errors.Is(err, ErrInvalidSession) {
		t.Errorf("expected ErrInvalidSession for tampered payload, got: %v", err)
	}
}

func TestCookieStore_Get_TamperedSignature_ReturnsErrInvalidSession(t *testing.T) {
	store := newTestStore[userID](t)

	w := httptest.NewRecorder()
	_ = store.Set(w, userID("alice"))

	r := requestWithCookies(t, w)
	cookie, _ := r.Cookie("test_session")
	dot := strings.Index(cookie.Value, ".")
	tampered := cookie.Value[:dot+1] + flipChar(cookie.Value[dot+1:])

	r2 := httptest.NewRequest("GET", "/", nil)
	r2.AddCookie(&http.Cookie{Name: "test_session", Value: tampered})

	_, err := store.Get(r2)
	if !errors.Is(err, ErrInvalidSession) {
		t.Errorf("expected ErrInvalidSession for tampered signature, got: %v", err)
	}
}

func TestCookieStore_Get_DifferentSecret_ReturnsErrInvalidSession(t *testing.T) {
	// Same cookie format, different secret — must fail verification.
	opts := DefaultCookieOptions()
	opts.Name = "test_session"
	opts.Secure = false

	storeA, _ := NewCookieStore[userID](testSecret, opts)
	otherSecret := []byte("ffffffffffffffffffffffffffffffff")
	storeB, _ := NewCookieStore[userID](otherSecret, opts)

	w := httptest.NewRecorder()
	_ = storeA.Set(w, userID("alice"))

	r := requestWithCookies(t, w)
	_, err := storeB.Get(r)
	if !errors.Is(err, ErrInvalidSession) {
		t.Errorf("expected ErrInvalidSession across secret rotation, got: %v", err)
	}
}

// --- expiry ----------------------------------------------------------------

func TestCookieStore_Get_Expired_ReturnsErrInvalidSession(t *testing.T) {
	opts := DefaultCookieOptions()
	opts.Name = "test_session"
	opts.Secure = false
	opts.MaxAge = 1 * time.Hour

	store, err := NewCookieStore[userID](testSecret, opts)
	if err != nil {
		t.Fatalf("NewCookieStore: %v", err)
	}

	// Freeze "now" to issue a cookie at t=0, then advance past expiry.
	t0 := time.Unix(1_700_000_000, 0)
	store.now = func() time.Time { return t0 }

	w := httptest.NewRecorder()
	_ = store.Set(w, userID("alice"))
	r := requestWithCookies(t, w)

	store.now = func() time.Time { return t0.Add(2 * time.Hour) }

	_, err = store.Get(r)
	if !errors.Is(err, ErrInvalidSession) {
		t.Errorf("expected ErrInvalidSession for expired session, got: %v", err)
	}
}

func TestCookieStore_Get_ZeroMaxAge_NoExpiryCheck(t *testing.T) {
	// MaxAge=0 means "session cookie" — no server-side expiry check
	// either. The envelope's E field stays 0 and Get always accepts.
	opts := DefaultCookieOptions()
	opts.Name = "test_session"
	opts.Secure = false
	opts.MaxAge = 0

	store, err := NewCookieStore[userID](testSecret, opts)
	if err != nil {
		t.Fatalf("NewCookieStore: %v", err)
	}

	w := httptest.NewRecorder()
	_ = store.Set(w, userID("alice"))
	r := requestWithCookies(t, w)

	// Even "in the far future", a zero-MaxAge cookie is still valid.
	store.now = func() time.Time { return time.Unix(9_999_999_999, 0) }

	got, err := store.Get(r)
	if err != nil {
		t.Errorf("zero-MaxAge cookie should not expire server-side, got: %v", err)
	}
	if got != "alice" {
		t.Errorf("Get returned %q, want %q", got, "alice")
	}
}

// --- Destroy ---------------------------------------------------------------

func TestCookieStore_Destroy_SetsExpiringCookie(t *testing.T) {
	store := newTestStore[userID](t)

	w := httptest.NewRecorder()
	if err := store.Destroy(w); err != nil {
		t.Fatalf("Destroy: %v", err)
	}

	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies))
	}
	c := cookies[0]
	if c.Name != "test_session" {
		t.Errorf("cookie name = %q, want test_session", c.Name)
	}
	if c.MaxAge >= 0 {
		t.Errorf("Destroy cookie MaxAge = %d, want negative (immediate expiry)", c.MaxAge)
	}
	if c.Value != "" {
		t.Errorf("Destroy cookie value = %q, want empty", c.Value)
	}
}

// --- cookie attributes -----------------------------------------------------

func TestCookieStore_Set_AppliesDefaultSecurityAttrs(t *testing.T) {
	opts := DefaultCookieOptions()
	opts.Name = "test_session"
	// Leave Secure=true (the production default). HttpOnly=true,
	// SameSite=Lax also apply.
	store, err := NewCookieStore[userID](testSecret, opts)
	if err != nil {
		t.Fatalf("NewCookieStore: %v", err)
	}

	w := httptest.NewRecorder()
	_ = store.Set(w, userID("alice"))

	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected 1 cookie, got %d", len(cookies))
	}
	c := cookies[0]
	if !c.HttpOnly {
		t.Error("HttpOnly should default true")
	}
	if !c.Secure {
		t.Error("Secure should default true")
	}
	if c.SameSite != http.SameSiteLaxMode {
		t.Errorf("SameSite = %v, want Lax", c.SameSite)
	}
	if c.Path != "/" {
		t.Errorf("Path = %q, want /", c.Path)
	}
}

// --- helpers ---------------------------------------------------------------

// requestWithCookies builds a fresh GET request and replays the
// cookies that w just set, so the next Get sees them.
func requestWithCookies(t *testing.T, w *httptest.ResponseRecorder) *http.Request {
	t.Helper()
	r := httptest.NewRequest("GET", "/", nil)
	for _, c := range w.Result().Cookies() {
		r.AddCookie(c)
	}
	return r
}

// flipChar swaps the first character of s for a different one so
// base64url decoding still succeeds but bytes differ.
func flipChar(s string) string {
	if s == "" {
		return s
	}
	first := s[0]
	var next byte
	if first == 'A' {
		next = 'B'
	} else {
		next = 'A'
	}
	return string(next) + s[1:]
}
