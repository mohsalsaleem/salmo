package dsd

import (
	"context"
	"html/template"
	"regexp"
	"testing"
)

// These tests pin the cross-implementation parity claim made in
// SSR.md: Salmo's Node renderer and this Go renderer produce
// semantically equivalent output for the same component shape.
//
// "Semantically equivalent" per SSR.md means: the same DOM tree
// after browser parse, ignoring HTML comments. Implementations may
// emit additional comments for internal bookkeeping (lit-html's
// <!----> markers, for example) without breaking parity, because the
// browser parses comments away before any framework code runs.
//
// The wantNormalized strings below are the Node renderer's output
// after comment stripping. To regenerate or verify them, run:
//
//	node server/dsd/testdata/regen-parity.mjs
//
// from the repo root and diff its output against these constants. If
// they drift, either:
//
//  1. the Go renderer changed in a way that breaks the spec — fix dsd.go
//  2. Node renderer / lit-html / happy-dom changed — update the
//     constants here and check whether SSR.md needs a spec amendment
//
// New parity cases should be added in BOTH places (here and the
// regen script) in the same commit.

var commentPattern = regexp.MustCompile(`<!--[\s\S]*?-->`)

func stripComments(s string) string { return commentPattern.ReplaceAllString(s, "") }

// --- parity fixtures (Go side) ---------------------------------------------

type pLight struct{}

func (pLight) Tag() string                              { return "p-light" }
func (pLight) Render(_ context.Context) (template.HTML, error) { return "<p>hi</p>", nil }

type pShadow struct{}

func (pShadow) Tag() string  { return "p-shadow" }
func (pShadow) Shadow() bool { return true }
func (pShadow) Render(_ context.Context) (template.HTML, error) {
	return "<style>p{color:red}</style><p>scoped</p>", nil
}

type pAttr struct{ cls string }

func (pAttr) Tag() string                              { return "p-attr" }
func (a pAttr) Attrs() map[string]string               { return map[string]string{"class": a.cls} }
func (pAttr) Render(_ context.Context) (template.HTML, error) { return "<p>hi</p>", nil }

// --- parity cases ----------------------------------------------------------

func TestParity_LightDOM(t *testing.T) {
	const wantNormalized = `<p-light><p>hi</p></p-light>`
	checkParity(t, pLight{}, wantNormalized)
}

func TestParity_ShadowDOM(t *testing.T) {
	const wantNormalized = `<p-shadow><template shadowrootmode="open"><style>p{color:red}</style><p>scoped</p></template></p-shadow>`
	checkParity(t, pShadow{}, wantNormalized)
}

func TestParity_AttributeAmpAndLT_Raw(t *testing.T) {
	// WHATWG: < stays raw inside double-quoted attrs; & escapes to &amp;.
	// Captured from Node verbatim.
	const wantNormalized = `<p-attr class="foo<bar&amp;baz"><p>hi</p></p-attr>`
	checkParity(t, pAttr{cls: `foo<bar&baz`}, wantNormalized)
}

func TestParity_AttributeQuoteEscape(t *testing.T) {
	// WHATWG: " escapes to &quot; (not &#34;). Captured from Node.
	const wantNormalized = `<p-attr class="say &quot;hi&quot;"><p>hi</p></p-attr>`
	checkParity(t, pAttr{cls: `say "hi"`}, wantNormalized)
}

// --- helpers ---------------------------------------------------------------

func checkParity(t *testing.T, c Component, wantNormalized string) {
	t.Helper()
	got, err := Render(context.Background(), c)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if n := stripComments(string(got)); n != wantNormalized {
		t.Errorf("parity drift\n got:  %s\n want: %s", n, wantNormalized)
	}
}
