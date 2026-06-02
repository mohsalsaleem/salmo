// Package dsd renders Salmo components to the Declarative Shadow DOM
// wire format defined in SSR.md (protocol rules 1-4). It is one
// implementation of the protocol; Salmo's Node renderer in src/ssr.js
// is the reference implementation. Output from either should hydrate
// identically on the client.
//
// Authors define components as Go structs that satisfy [Component].
// Optional interfaces [Shadower] and [Attributer] opt into shadow DOM
// and host attributes respectively. Component content is built with
// html/template (or any source that produces escaped HTML) and returned
// as template.HTML.
//
// See FULLSTACK.md for how this package fits into the broader Go
// server story.
package dsd

import (
	"context"
	"errors"
	"fmt"
	"html/template"
	"regexp"
	"sort"
	"strings"
)

// Component is anything that can be rendered to DSD. Implementations
// return the rendered *content* of the host element; the host tag
// itself (and the <template shadowrootmode="open"> wrapper for shadow
// components) is added by [Render].
//
// The returned template.HTML is treated as already-escaped output —
// implementations are responsible for escaping untrusted data within
// it, typically by building content through html/template.
type Component interface {
	Tag() string
	Render(ctx context.Context) (template.HTML, error)
}

// Shadower is an optional interface a component implements to opt into
// declarative shadow DOM (protocol rule 2). If Shadow returns true,
// [Render] wraps the content in <template shadowrootmode="open">…</template>.
// Components that do not implement Shadower default to light DOM
// (protocol rule 3).
type Shadower interface {
	Shadow() bool
}

// Attributer is an optional interface a component implements to emit
// attributes on the host element (protocol rule 1). Names must match
// [AttrNamePattern]; values are HTML-escaped per protocol rule 4.
// Iteration order is sorted lexicographically so output is byte-stable
// across runs — required for the cross-implementation parity story.
type Attributer interface {
	Attrs() map[string]string
}

// TagPattern is the conservative subset of valid custom-element tags
// accepted by Salmo's client registration: lowercase ASCII letters and
// digits, at least one hyphen, starting with a letter. The HTML spec
// is more permissive, but this matches what defineComponent expects.
var TagPattern = regexp.MustCompile(`^[a-z][a-z0-9]*-[a-z0-9-]+$`)

// AttrNamePattern restricts attribute names to characters that need no
// escaping in HTML attribute name position. Matches the subset
// html/template's attribute context accepts.
var AttrNamePattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_:.-]*$`)

// Render produces the DSD wire format for a single component:
//
//	<host attr="v">…content…</host>                                                       (light DOM)
//	<host attr="v"><template shadowrootmode="open">…content…</template></host>             (shadow DOM)
//
// Errors are returned (rather than producing partial output) when the
// component is nil, the tag name is invalid, an attribute name is
// invalid, or the component's own Render returns an error.
func Render(ctx context.Context, c Component) (template.HTML, error) {
	if c == nil {
		return "", errors.New("dsd.Render: nil component")
	}
	tag := c.Tag()
	if !TagPattern.MatchString(tag) {
		return "", fmt.Errorf("dsd.Render: invalid custom element tag %q (must match %s)", tag, TagPattern)
	}

	var b strings.Builder
	b.WriteByte('<')
	b.WriteString(tag)

	if ac, ok := c.(Attributer); ok {
		attrs := ac.Attrs()
		names := make([]string, 0, len(attrs))
		for k := range attrs {
			names = append(names, k)
		}
		sort.Strings(names)
		for _, k := range names {
			if !AttrNamePattern.MatchString(k) {
				return "", fmt.Errorf("dsd.Render: invalid attribute name %q on %s", k, tag)
			}
			b.WriteByte(' ')
			b.WriteString(k)
			b.WriteString(`="`)
			b.WriteString(escapeAttr(attrs[k]))
			b.WriteByte('"')
		}
	}
	b.WriteByte('>')

	content, err := c.Render(ctx)
	if err != nil {
		return "", fmt.Errorf("dsd.Render: %s: %w", tag, err)
	}

	if sh, ok := c.(Shadower); ok && sh.Shadow() {
		b.WriteString(`<template shadowrootmode="open">`)
		b.WriteString(string(content))
		b.WriteString(`</template>`)
	} else {
		b.WriteString(string(content))
	}

	b.WriteString("</")
	b.WriteString(tag)
	b.WriteByte('>')
	return template.HTML(b.String()), nil
}

// escapeAttr escapes the two characters that MUST be escaped inside a
// double-quoted HTML5 attribute value per WHATWG's serialization
// algorithm: & (to disambiguate from entity refs) and " (which would
// otherwise close the attribute). Left raw: <, >, ' — all spec-valid
// inside a quoted attribute value, and matching the bytes Salmo's
// Node renderer produces. Centralised here so the choice is one
// edit if the canonical form ever changes.
func escapeAttr(s string) string {
	return strings.NewReplacer(
		"&", "&amp;",
		`"`, "&quot;",
	).Replace(s)
}
