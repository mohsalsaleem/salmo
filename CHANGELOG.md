# Changelog

All notable changes to salmo. Pre-1.0, so the public surface may shift; everything listed below is in service of stabilising it.

## [0.1.0] — Initial public release

Everything that exists today, in the order the design landed.

### Reactive core
- `Signal.State`, `Signal.Computed`, `Signal.subtle.Watcher` — TC39 Signals proposal, **70/70 conformant** against the reference polyfill's test suite (`framework/conformance/`)
- `Signal.subtle.untrack`, `currentComputed`, `introspectSources`, `introspectSinks`, `hasSinks`, `watched`, `unwatched` — the proposal's introspection layer
- `Signal.isState`, `Signal.isComputed` — guard predicates
- Custom equality (`{ equals }`), lazy validation with 3-state propagation, cached errors in Computed, equal-value bailout, prohibited-context check inside watcher notify
- `effect(fn, { signal? })` built on `Watcher` + `Computed`; disposal via the standard `AbortSignal`
- `withScope`, `getCurrentScope` — ambient `AbortSignal` for lifecycle scoping

### Templates
- Built on `lit-html` (vendored under `framework/vendor/lit-html/`, BSD-3-Clause)
- Re-exports: `html`, `render`, `svg`, `nothing`, `repeat`, `when`, `classMap`, `styleMap`, `ref`, `unsafeHTML`

### Components
- `defineComponent({ tag, setup, props?, shadow?, onError? })`
- Reactive `props: ['name', ...]` declarations — each becomes a JS property AND attribute on the host, with sync via `observedAttributes`/`attributeChangedCallback`
- `setup(host, props, emit)` — `emit(type, detail)` dispatches a bubbling `CustomEvent`; the sanctioned outbound channel
- Error boundary (`onError`) for setup and render throws
- SSR hydration via setup-before-clear semantics; no-JS fallback children survive until `setup()` returns a view

### Federation
- `lazyComponent({ tag, src, as, fallback?, onerror?, timeout?, integrity?, allowedOrigins? })`
- `reloadRemote(src)` — clears in-flight cache, retries every live placeholder; documented limit re Custom Elements registry being write-once
- `loadFromManifest(url, { allowedOrigins?, timeout?, accept?, onVersionMismatch? })` — fetch + schema-validate + register-as-lazy
- Manifest version enforcement against `VERSION`
- Per-component error results: `{ tag, status: 'registered' | 'skipped' | 'error', reason? }` instead of all-or-nothing
- `configure({ singletonViolation: 'warn' | 'throw' | 'silent' })`
- `<framework-devtools>` overlay: list federated components, sources, live instance counts, highlight-on-click

### SSR
- `setupDOM()` — installs happy-dom globals (lazy import)
- `renderToString(tag, props?)` — server-side outerHTML
- `__salmo_ssr__` flag so `lazyComponent` skips its dynamic import in SSR (client hydrates)
- Per-render cleanup verified: `connectedCallback` → `disconnectedCallback` cycle aborts effects, no leak across requests

### Security
- `unsafe()` opt-in marker (now superseded by lit-html's `unsafeHTML` directive)
- Trusted Types: lit-html's `"lit-html"` policy registered on first use; works under strict CSP
- `lazyComponent({ integrity })` — SHA-256/384/512 hash check via `fetch` + `crypto.subtle.digest` + blob-URL import
- `lazyComponent({ allowedOrigins })` — origin allowlist enforced before any network request

### Documentation
- `README.md`, `FEDERATION.md`, `SECURITY.md`, `AUTH.md`, `STATE.md`, `API.md`, `COOKBOOK.md`, `llms.txt`

### Examples
- `todomvc`, `dashboard`, `federation`, `manifest`, `ssr`, `notes`, `router`, `security`, `styling`, `auth-provider`

### Tooling
- 80 unit tests (vitest, happy-dom)
- 70/70 TC39 Signals conformance tests (vendored from proposal-signals/signal-polyfill, Apache-2.0)
- TypeScript types via JSDoc → `tsc --emitDeclarationOnly`
- Singleton enforcement on module load

[0.1.0]: https://github.com/mohsalsaleem/salmo/releases/tag/v0.1.0
