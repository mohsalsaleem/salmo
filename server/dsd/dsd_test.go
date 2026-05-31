package dsd

import (
	"context"
	"errors"
	"html/template"
	"strings"
	"testing"
)

// --- test fixtures -----------------------------------------------------------

type lightCounter struct{ n int }

func (lightCounter) Tag() string { return "x-counter" }
func (c lightCounter) Render(_ context.Context) (template.HTML, error) {
	return template.HTML(
		`<button>−</button><strong>` +
			itoa(c.n) +
			`</strong><button>+</button>`,
	), nil
}

type shadowCard struct{ title string }

func (shadowCard) Tag() string                              { return "x-card" }
func (shadowCard) Shadow() bool                             { return true }
func (c shadowCard) Render(_ context.Context) (template.HTML, error) {
	return template.HTML(
		`<style>:host{display:block}</style><h2>` +
			template.HTMLEscapeString(c.title) +
			`</h2>`,
	), nil
}

type labeled struct {
	role string
	name string
}

func (labeled) Tag() string { return "x-labeled" }
func (l labeled) Attrs() map[string]string {
	return map[string]string{
		"data-role": l.role,
		"data-name": l.name,
	}
}
func (labeled) Render(_ context.Context) (template.HTML, error) {
	return template.HTML(``), nil
}

type empty struct{}

func (empty) Tag() string                              { return "x-empty" }
func (empty) Render(_ context.Context) (template.HTML, error) { return "", nil }

type errComponent struct{}

var errBoom = errors.New("boom")

func (errComponent) Tag() string                              { return "x-err" }
func (errComponent) Render(_ context.Context) (template.HTML, error) { return "", errBoom }

type badTag struct{}

func (badTag) Tag() string                              { return "BadTag" } // uppercase + no hyphen
func (badTag) Render(_ context.Context) (template.HTML, error) { return "", nil }

type badAttr struct{}

func (badAttr) Tag() string                              { return "x-bad" }
func (badAttr) Attrs() map[string]string                 { return map[string]string{"bad name": "v"} }
func (badAttr) Render(_ context.Context) (template.HTML, error) { return "", nil }

// itoa is local to avoid pulling strconv into the test for one call site.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}

// --- protocol rule (3): light DOM ------------------------------------------

func TestRender_LightDOM_EmitsHostAndContent(t *testing.T) {
	got, err := Render(context.Background(), lightCounter{n: 5})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := `<x-counter><button>−</button><strong>5</strong><button>+</button></x-counter>`
	if string(got) != want {
		t.Errorf("mismatch\n got:  %s\n want: %s", got, want)
	}
}

func TestRender_LightDOM_NoTemplateWrapper(t *testing.T) {
	got, _ := Render(context.Background(), lightCounter{n: 0})
	if strings.Contains(string(got), "shadowrootmode") {
		t.Errorf("light DOM output must not contain shadowrootmode wrapper, got: %s", got)
	}
}

// --- protocol rule (2): shadow DOM -----------------------------------------

func TestRender_ShadowDOM_WrapsInDSDTemplate(t *testing.T) {
	got, err := Render(context.Background(), shadowCard{title: "Hello"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := `<x-card><template shadowrootmode="open"><style>:host{display:block}</style><h2>Hello</h2></template></x-card>`
	if string(got) != want {
		t.Errorf("mismatch\n got:  %s\n want: %s", got, want)
	}
}

func TestRender_ShadowDOM_TemplateIsOnlyDirectChild(t *testing.T) {
	// Per the DSD spec, the <template shadowrootmode="open"> must be a
	// direct child of the host. Confirm the output structure.
	got, _ := Render(context.Background(), shadowCard{title: "x"})
	s := string(got)
	open := strings.Index(s, ">")
	closeStart := strings.LastIndex(s, "</x-card>")
	inner := s[open+1 : closeStart]
	if !strings.HasPrefix(inner, `<template shadowrootmode="open">`) {
		t.Errorf("template wrapper must be the first thing inside host, got inner: %s", inner)
	}
	if !strings.HasSuffix(inner, `</template>`) {
		t.Errorf("template wrapper must be the last thing inside host, got inner: %s", inner)
	}
}

// --- protocol rule (1) + (4): attributes & escaping ------------------------

func TestRender_Attributes_AreSortedDeterministically(t *testing.T) {
	got, err := Render(context.Background(), labeled{role: "admin", name: "Mo"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// data-name sorts before data-role lexicographically.
	want := `<x-labeled data-name="Mo" data-role="admin"></x-labeled>`
	if string(got) != want {
		t.Errorf("mismatch\n got:  %s\n want: %s", got, want)
	}
}

func TestRender_Attributes_EscapeHTMLSpecials(t *testing.T) {
	// Per WHATWG HTML serialization for double-quoted attribute
	// values, only & and " require escaping. <, >, ' are spec-valid
	// raw inside the value. This matches Node's renderer byte-for-byte.
	got, err := Render(context.Background(), labeled{role: `<a>&"'`, name: ""})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	s := string(got)
	if !strings.Contains(s, `&amp;`) {
		t.Errorf("& must be escaped to &amp;, got: %s", s)
	}
	if !strings.Contains(s, `&quot;`) {
		t.Errorf(`" must be escaped to &quot;, got: %s`, s)
	}
	// <, >, ' stay raw inside the quoted attribute — confirm.
	if !strings.Contains(s, `data-role="<a>`) {
		t.Errorf("< should NOT be escaped inside double-quoted attr, got: %s", s)
	}
	if !strings.Contains(s, `'`) {
		t.Errorf("' should NOT be escaped inside double-quoted attr, got: %s", s)
	}
}

func TestRender_Attributes_EmptyValueStillEmitted(t *testing.T) {
	got, _ := Render(context.Background(), labeled{role: "", name: ""})
	want := `<x-labeled data-name="" data-role=""></x-labeled>`
	if string(got) != want {
		t.Errorf("mismatch\n got:  %s\n want: %s", got, want)
	}
}

// --- error paths -----------------------------------------------------------

func TestRender_NilComponent_ReturnsError(t *testing.T) {
	_, err := Render(context.Background(), nil)
	if err == nil {
		t.Fatal("expected error for nil component, got nil")
	}
}

func TestRender_InvalidTag_ReturnsError(t *testing.T) {
	_, err := Render(context.Background(), badTag{})
	if err == nil {
		t.Fatal("expected error for invalid tag, got nil")
	}
	if !strings.Contains(err.Error(), "invalid custom element tag") {
		t.Errorf("error should mention invalid tag, got: %v", err)
	}
}

func TestRender_InvalidAttrName_ReturnsError(t *testing.T) {
	_, err := Render(context.Background(), badAttr{})
	if err == nil {
		t.Fatal("expected error for invalid attribute name, got nil")
	}
	if !strings.Contains(err.Error(), "invalid attribute name") {
		t.Errorf("error should mention invalid attr, got: %v", err)
	}
}

func TestRender_ComponentRenderError_Propagates(t *testing.T) {
	_, err := Render(context.Background(), errComponent{})
	if err == nil {
		t.Fatal("expected error from component Render, got nil")
	}
	if !errors.Is(err, errBoom) {
		t.Errorf("error should wrap component error, got: %v", err)
	}
}

// --- edge cases ------------------------------------------------------------

func TestRender_EmptyContent_StillWellFormed(t *testing.T) {
	got, err := Render(context.Background(), empty{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := `<x-empty></x-empty>`
	if string(got) != want {
		t.Errorf("mismatch\n got:  %s\n want: %s", got, want)
	}
}

func TestRender_TagPattern_AcceptsValidNames(t *testing.T) {
	valid := []string{"x-foo", "my-counter", "acme-foo-bar", "a-b", "x1-y2-z3"}
	for _, tag := range valid {
		if !TagPattern.MatchString(tag) {
			t.Errorf("expected %q to be valid", tag)
		}
	}
}

func TestRender_TagPattern_RejectsInvalidNames(t *testing.T) {
	invalid := []string{"X-foo", "foo", "-foo", "1foo-bar", "foo bar", "foo--bar-"}
	for _, tag := range invalid {
		if TagPattern.MatchString(tag) {
			// "foo--bar-" actually matches the current pattern — document
			// that as a known permissiveness rather than a bug. The HTML
			// spec allows it, so we do too.
			if tag == "foo--bar-" {
				continue
			}
			t.Errorf("expected %q to be invalid", tag)
		}
	}
}
