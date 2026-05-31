package render

import (
	"context"
	"errors"
	"html/template"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// --- test fixtures ---------------------------------------------------------

type greeting struct{ name string }

func (greeting) Tag() string { return "x-greeting" }
func (g greeting) Render(_ context.Context) (template.HTML, error) {
	return template.HTML(`<p>Hello, ` + template.HTMLEscapeString(g.name) + `</p>`), nil
}

type failing struct{}

var errBoom = errors.New("boom")

func (failing) Tag() string                              { return "x-fail" }
func (failing) Render(_ context.Context) (template.HTML, error) { return "", errBoom }

// --- Fragment --------------------------------------------------------------

func TestFragment_WritesComponentHTML(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)

	if err := Fragment(w, r, greeting{name: "Mo"}); err != nil {
		t.Fatalf("Fragment returned error: %v", err)
	}
	want := `<x-greeting><p>Hello, Mo</p></x-greeting>`
	if got := w.Body.String(); got != want {
		t.Errorf("body mismatch\n got:  %s\n want: %s", got, want)
	}
}

func TestFragment_SetsContentType(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)
	_ = Fragment(w, r, greeting{name: "x"})

	got := w.Header().Get("Content-Type")
	want := "text/html; charset=utf-8"
	if got != want {
		t.Errorf("Content-Type %q, want %q", got, want)
	}
}

func TestFragment_RenderError_LeavesResponseUntouched(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)

	err := Fragment(w, r, failing{})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, errBoom) {
		t.Errorf("error should wrap component error, got: %v", err)
	}
	if w.Body.Len() != 0 {
		t.Errorf("body should be empty on error, got: %s", w.Body.String())
	}
	if w.Header().Get("Content-Type") != "" {
		t.Errorf("Content-Type should not be set on error, got: %q", w.Header().Get("Content-Type"))
	}
}

// --- Page ------------------------------------------------------------------

func TestPage_DefaultsToMinimalValidHTML5(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)

	if err := Page(w, r, PageOpts{}, greeting{name: "Mo"}); err != nil {
		t.Fatalf("Page returned error: %v", err)
	}
	body := w.Body.String()

	mustContain(t, body, "<!DOCTYPE html>")
	mustContain(t, body, `<html lang="en">`)
	mustContain(t, body, `<meta charset="utf-8">`)
	mustContain(t, body, `<x-greeting><p>Hello, Mo</p></x-greeting>`)
	mustNotContain(t, body, "<title>")
}

func TestPage_RespectsCustomLangCharsetTitle(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)

	opts := PageOpts{
		Title:   "My Blog",
		Lang:    "zh-Hans",
		Charset: "utf-8",
	}
	_ = Page(w, r, opts, greeting{name: "x"})
	body := w.Body.String()

	mustContain(t, body, `<html lang="zh-Hans">`)
	mustContain(t, body, `<title>My Blog</title>`)
}

func TestPage_EscapesTitleAndLang(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)

	opts := PageOpts{
		Title: `<script>alert(1)</script>`,
		Lang:  `en" onload="alert(1)`,
	}
	_ = Page(w, r, opts, greeting{name: "x"})
	body := w.Body.String()

	if strings.Contains(body, "<script>alert(1)</script>") {
		t.Error("title should be HTML-escaped, raw <script> found in document")
	}
	if strings.Contains(body, `onload="alert(1)`) {
		t.Error("lang attribute should be HTML-escaped, raw onload found")
	}
}

func TestPage_EmitsScriptModulesInOrder(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)

	opts := PageOpts{
		Scripts: []string{
			"https://cdn.jsdelivr.net/gh/mohsalsaleem/salmo@v0.1.0/src/index.js",
			"/static/app.js",
		},
	}
	_ = Page(w, r, opts, greeting{name: "x"})
	body := w.Body.String()

	first := strings.Index(body, `<script type="module" src="https://cdn.jsdelivr.net/gh/mohsalsaleem/salmo@v0.1.0/src/index.js"></script>`)
	second := strings.Index(body, `<script type="module" src="/static/app.js"></script>`)
	if first < 0 || second < 0 {
		t.Fatalf("expected both script tags in body, got: %s", body)
	}
	if first >= second {
		t.Error("scripts should appear in the order given by PageOpts.Scripts")
	}
}

func TestPage_HeadIsInjectedVerbatim(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)

	// Head is template.HTML — written without escaping. Lets users
	// inject SRI-bearing <script> tags and arbitrary <meta>/<link>.
	opts := PageOpts{
		Head: `<link rel="canonical" href="https://example.com">`,
	}
	_ = Page(w, r, opts, greeting{name: "x"})
	body := w.Body.String()

	mustContain(t, body, `<link rel="canonical" href="https://example.com">`)
}

func TestPage_HeadAppearsAfterDefaultsAndScripts(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)

	opts := PageOpts{
		Scripts: []string{"/app.js"},
		Head:    `<meta name="custom" content="x">`,
	}
	_ = Page(w, r, opts, greeting{name: "x"})
	body := w.Body.String()

	charset := strings.Index(body, `<meta charset="utf-8">`)
	script := strings.Index(body, `<script type="module" src="/app.js">`)
	custom := strings.Index(body, `<meta name="custom"`)

	if !(charset < script && script < custom) {
		t.Errorf("expected head ordering: charset < script < custom, got %d < %d < %d", charset, script, custom)
	}
}

func TestPage_BodyComponentIsRoot(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)
	_ = Page(w, r, PageOpts{}, greeting{name: "world"})
	body := w.Body.String()

	// Locate the <body>…</body> region and confirm the component sits inside.
	bodyOpen := strings.Index(body, "<body>")
	bodyClose := strings.Index(body, "</body>")
	if bodyOpen < 0 || bodyClose < 0 {
		t.Fatalf("missing <body> markers, got: %s", body)
	}
	inner := body[bodyOpen+len("<body>") : bodyClose]
	if !strings.Contains(inner, "<x-greeting>") {
		t.Errorf("component should be inside <body>, got inner: %s", inner)
	}
}

func TestPage_RenderError_LeavesResponseUntouched(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)

	err := Page(w, r, PageOpts{Title: "x"}, failing{})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, errBoom) {
		t.Errorf("error should wrap component error, got: %v", err)
	}
	if w.Body.Len() != 0 {
		t.Errorf("body should be empty on error, got: %s", w.Body.String())
	}
	if w.Header().Get("Content-Type") != "" {
		t.Errorf("Content-Type should not be set on error, got: %q", w.Header().Get("Content-Type"))
	}
}

func TestPage_SetsContentType(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)
	_ = Page(w, r, PageOpts{}, greeting{name: "x"})

	got := w.Header().Get("Content-Type")
	want := "text/html; charset=utf-8"
	if got != want {
		t.Errorf("Content-Type %q, want %q", got, want)
	}
}

// --- integration with a real http.ServeMux ---------------------------------

func TestPage_WorksAsHandler(t *testing.T) {
	// Confirms the canonical usage shape from the godoc: a handler
	// calls Page and returns; the standard library handles transport.
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		opts := PageOpts{
			Title:   "Demo",
			Scripts: []string{"/runtime.js"},
		}
		if err := Page(w, r, opts, greeting{name: "world"}); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	res, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatalf("GET failed: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", res.StatusCode)
	}
	var buf strings.Builder
	if _, err := io.Copy(&buf, res.Body); err != nil {
		t.Fatalf("read body: %v", err)
	}
	body := buf.String()
	mustContain(t, body, `<title>Demo</title>`)
	mustContain(t, body, `<script type="module" src="/runtime.js"></script>`)
	mustContain(t, body, `<x-greeting><p>Hello, world</p></x-greeting>`)
}

// --- helpers ---------------------------------------------------------------

func mustContain(t *testing.T, haystack, needle string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Errorf("expected %q in:\n%s", needle, haystack)
	}
}

func mustNotContain(t *testing.T, haystack, needle string) {
	t.Helper()
	if strings.Contains(haystack, needle) {
		t.Errorf("did NOT expect %q in:\n%s", needle, haystack)
	}
}

