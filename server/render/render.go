// Package render is the http.Handler glue between a Salmo component
// and a Go HTTP server. It owns Content-Type, the surrounding HTML
// document scaffold, and the ordering of script tags in <head>; it
// does not own routing, sessions, or any other backend concern — see
// ../../FULLSTACK.md for what Salmo deliberately stays out of.
//
// Two entry points:
//
//   - [Fragment] writes a single component as the response body.
//     Suitable for HTMX-style partial updates and for handlers that
//     return component HTML to be inserted into an existing page.
//
//   - [Page] writes a full HTML document with the component as body
//     content. Takes a [PageOpts] for the <head> scaffold (title,
//     charset, lang, raw head injection, script-module URLs).
//
// Both buffer the rendered HTML before touching the [http.ResponseWriter],
// so a render error leaves w untouched and the caller is free to write
// a custom error response.
package render

import (
	"html/template"
	"io"
	"net/http"
	"strings"

	"github.com/mohsalsaleem/salmo/server/dsd"
)

// PageOpts configures the HTML document scaffold built by [Page]. All
// fields are optional; zero values yield a minimal valid HTML5 document.
type PageOpts struct {
	// Title is rendered as <title>…</title>. Omitted when empty.
	Title string

	// Lang sets the <html lang="…"> attribute. Defaults to "en".
	Lang string

	// Charset sets <meta charset="…">. Defaults to "utf-8". Emitted
	// as the first child of <head> per HTML5 (must be in the first
	// 1024 bytes of the document).
	Charset string

	// Scripts are emitted as <script type="module" src="…"></script>
	// in <head>, in order. Use this for the Salmo runtime URL (CDN
	// or local) and any other ES modules needed before body parse.
	// If you need SRI hashes, write raw <script integrity="…"> tags
	// into Head instead.
	Scripts []string

	// Head is raw HTML injected into <head> after the defaults and
	// Scripts. Use template.HTML semantics: it is written verbatim,
	// so any untrusted data must already be escaped.
	Head template.HTML
}

const (
	defaultLang    = "en"
	defaultCharset = "utf-8"
	contentTypeKey = "Content-Type"
	contentTypeVal = "text/html; charset=utf-8"
)

// Fragment writes a single rendered component as the response body
// with Content-Type set to text/html. If the component fails to
// render, the error is returned and w is not touched — the caller can
// write a custom error response (typically [http.Error] with the
// status code that fits their handler).
func Fragment(w http.ResponseWriter, r *http.Request, c dsd.Component) error {
	body, err := dsd.Render(r.Context(), c)
	if err != nil {
		return err
	}
	w.Header().Set(contentTypeKey, contentTypeVal)
	_, err = io.WriteString(w, string(body))
	return err
}

// Page writes a full HTML5 document with the given component as the
// sole child of <body>. Content-Type is set to text/html. On render
// error, w is not touched.
//
// To compose multiple visual regions (header, main, footer), build a
// layout component that contains them and pass it as body.
func Page(w http.ResponseWriter, r *http.Request, opts PageOpts, body dsd.Component) error {
	bodyHTML, err := dsd.Render(r.Context(), body)
	if err != nil {
		return err
	}
	doc := buildDocument(opts, bodyHTML)
	w.Header().Set(contentTypeKey, contentTypeVal)
	_, err = io.WriteString(w, doc)
	return err
}

func buildDocument(opts PageOpts, body template.HTML) string {
	lang := opts.Lang
	if lang == "" {
		lang = defaultLang
	}
	charset := opts.Charset
	if charset == "" {
		charset = defaultCharset
	}

	var b strings.Builder
	// Rough sizing hint: doctype + scaffold + body + a few hundred
	// bytes of head. Grows as needed.
	b.Grow(256 + len(body))

	b.WriteString("<!DOCTYPE html>\n")
	b.WriteString(`<html lang="`)
	b.WriteString(template.HTMLEscapeString(lang))
	b.WriteString(`">`)
	b.WriteByte('\n')

	b.WriteString("<head>\n")
	b.WriteString(`<meta charset="`)
	b.WriteString(template.HTMLEscapeString(charset))
	b.WriteString(`">`)
	b.WriteByte('\n')

	if opts.Title != "" {
		b.WriteString("<title>")
		b.WriteString(template.HTMLEscapeString(opts.Title))
		b.WriteString("</title>\n")
	}

	for _, src := range opts.Scripts {
		b.WriteString(`<script type="module" src="`)
		b.WriteString(template.HTMLEscapeString(src))
		b.WriteString(`"></script>`)
		b.WriteByte('\n')
	}

	if opts.Head != "" {
		b.WriteString(string(opts.Head))
		b.WriteByte('\n')
	}

	b.WriteString("</head>\n<body>\n")
	b.WriteString(string(body))
	b.WriteString("\n</body>\n</html>\n")

	return b.String()
}
