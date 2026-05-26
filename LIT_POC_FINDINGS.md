# Lit POC findings

Spike branch: `claude/built-on-lit`. Swaps our hand-rolled templating layer for `lit-html`, keeps our Signal / effect / scope / defineComponent / lazyComponent / SSR layers. TodoMVC ported end-to-end; verified in chromium with zero errors.

## Numbers

| | Before (own everything) | After (built on Lit) | Δ |
|---|---:|---:|---:|
| Framework `src/` lines | 1506 | 910 | **−596 (−40%)** |
| Files we maintain | 12 | 7 | −5 (`html.js`, `repeat.js`, `when.js`, `trusted-types.js`, `unsafe.js`) |
| TodoMVC app.js lines | 174 | 167 | −7 |
| Runtime dependencies | 0 | 1 (`lit-html`, ~7KB) | +1 |

The 596-line drop is the value of the lit-html migration. Files removed wholesale:

- `html.js` (358 lines) — the template parser + reactive binding engine
- `repeat.js` (74 lines) — keyed list reconciliation
- `when.js` (18 lines) — conditional helper
- `trusted-types.js` (73 lines) — covered by Lit's own TT integration
- `unsafe.js` (37 lines) — replaced by Lit's `unsafeHTML` directive

What we kept (everything that's unique to mohsal-framework):

- `signal.js` (454 lines) — TC39 Signals proposal implementation, 70/70 conformant
- `effect.js`, `scope.js` — the reactive scaffolding around signals
- `component.js` (rewritten, 111 lines) — defineComponent on top of `lit-html`'s `render()`
- `lazy.js` — federation primitive
- `ssr.js` — our happy-dom-based renderToString
- New: singleton enforcement in `index.js`

## API changes (real, user-facing)

| Before | After (Lit) | Notes |
|---|---|---|
| `onclick=${fn}` | `@click=${fn}` | Lit's event syntax. Every example needs s/on/@/. |
| `${signal}` interpolation | `${signal.get()}` inside `() => html\`…\`` | setup returns a render fn, not a TemplateResult |
| `${() => expr}` reactive hole | Just read inside the render fn | Whole-template re-renders on signal change; Lit diffs |
| `class:foo=${signal}` | `classMap({ foo: signal.get() })` | More verbose, but standard Lit |
| `:value=${signal}` (two-way) | `.value=${s.get()} @input=${e => s.set(e.target.value)}` | We'd add a directive to recover the sugar |
| `ref=${cb}` | `${ref(cb)}` | Lit's ref directive — slightly different shape |
| `unsafe(html)` | `unsafeHTML(html)` | Lit name, same idea |
| `repeat(items, key, render)` | Same — we re-export Lit's | Our API was modeled on Lit's |
| `when(cond, render)` | Same — we re-export Lit's | Same |

## What still works (kept end-to-end)

- TodoMVC: full feature parity (add, toggle, filter, edit-in-place, delete, clear-completed, localStorage persistence). Verified with playwright.
- Signal core: 26/26 unit tests + 70/70 TC39 conformance, untouched.
- `defineComponent({ props })`: reactive properties via the `attributeChangedCallback` mechanism we built. Still works.
- Custom event flow: `emit` arg + `@event=${fn}` on parent — works through Lit.

## What's not yet ported (would be follow-up if we go down this road)

- **Federation demo** (`examples/federation/`): not touched. lazyComponent works unchanged; remote/host both just need the import-map entry for `lit-html`.
- **SSR demo** (`examples/ssr/`): not touched. Should work; ssr.js is unchanged.
- **Security demo** (`examples/security/`): TT integration changes. Lit has its own TT policy named `lit-html`. The user-facing `unsafe()` wrapper migrates to `unsafeHTML`. Our `unsafe()` semantics (refuse non-wrapped innerHTML writes, sanitize URL schemes) would need to be reimplemented as Lit directives — that's real work.
- **Router demo**: not affected by the substrate change.
- **Homepage**: same.

## Architectural notes

### Where Lit's model is cleaner

- **Template caching.** Lit caches parsed templates per template-strings identity. Re-renders are diffs against a Part tree, not re-parses. Material perf win for high-frequency updates.
- **`.prop=${}` case preservation.** Lit parses the author-written strings before the HTML parser sees them, so `.innerHTML` stays cased. Our case-preservation hack goes away.
- **`<template>.content` upgrade quirk.** Lit handles this internally; our `document.importNode` workaround goes away.
- **Directive system.** A coherent extension mechanism instead of one-off `repeat`/`when`.

### Where the swap costs us

- **Security defaults live at a different layer.** Our `.innerHTML=${rawString}` would throw; Lit's lets it through (the assumption is you'll wrap in `unsafeHTML` if you mean it). Same for `javascript:` URLs. To preserve the safe-by-default story we built in Phase 1, we'd write custom directives or a sanitizing wrapper. Not free.
- **`${signal}` interpolation gone.** Reactivity is at the component level (the render fn is the reactive boundary), not at the hole level. For TodoMVC scale this is fine — Lit's diff makes it cheap. For very-frequent fine-grained updates (the high-frequency dashboard we tabled earlier), we'd want `watch()`-style per-hole directives.
- **Coherence as a learning artifact.** The "you can read the whole framework in one sitting" property weakens; now reading means understanding Lit + our 910 lines.

### Federation impact: zero

Federation is entirely orthogonal to templating. `lazyComponent`, the singleton check, SRI, allowedOrigins, the host/remote bundle pattern — all work the same on either substrate. **Lit doesn't help here and isn't in the way.**

## Recommendation

Go down this road **if** the goal is "production framework someone might depend on" — the 40% line drop, the Lit polish, and the directive ecosystem are real assets. **Stay self-built if** the goal is "the depth of having built every layer" — the artifact is more impressive intact, and the maintenance burden is bounded now that we've found the main classes of templating bug.

Either way, the unique thing we shipped — first-class federation primitives on top of TC39-Signals reactivity — is preserved by either choice. That's the right framing: the framework's value isn't in the templating layer; it's in the bus that runs across it.
