# salmo

A small, browser-native UI framework with **first-class module federation**, **TC39 Signals**, and **zero build step**.

```
~900 lines we own (signals + components + federation + ssr + devtools)
+ ~7 KB of vendored lit-html for templating
= a framework that fits in your head and federates remotes for real
```

## What you get

- **`Signal.State` / `Signal.Computed` / `Signal.subtle.*`** — TC39 Signals proposal, **70/70 conformant** against the reference polyfill's tests
- **`defineComponent`** — Custom Elements with reactive props, scoped lifecycles, and an `emit` callback for typed child→parent events
- **`lazyComponent` + `loadFromManifest`** — federated remote components with SRI hash, origin allowlist, timeout, and a typed loading lifecycle
- **`renderToString` + `setupDOM`** — SSR via happy-dom; same components run unchanged on Node
- **`<framework-devtools>`** — drop-in overlay that lists every federated component, its remote source, and live instances
- **Re-exports of lit-html primitives** — `html`, `render`, `repeat`, `when`, `classMap`, `styleMap`, `ref`, `unsafeHTML`, `nothing`

## Quickstart

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="/framework/src/index.js"></script>
</head>
<body>
  <x-counter></x-counter>
  <script type="module">
    import { defineComponent, html, Signal } from '/framework/src/index.js';

    defineComponent({
      tag: 'x-counter',
      setup() {
        const count = new Signal.State(0);
        return () => html`
          <button @click=${() => count.set(count.get() - 1)}>−</button>
          <strong>${count.get()}</strong>
          <button @click=${() => count.set(count.get() + 1)}>+</button>
        `;
      },
    });
  </script>
</body>
</html>
```

No bundler. No build step. No node_modules in production. Open the file with a static server and it works.

## Examples (every feature, end-to-end)

| Example | What it shows |
|---|---|
| [`examples/todomvc/`](examples/todomvc/) | Full TodoMVC — list reconciliation, edit-in-place, localStorage, parent/child events |
| [`examples/dashboard/`](examples/dashboard/) | 100 federated cells, 60 FPS at 5×, perf stress with devtools overlay |
| [`examples/federation/`](examples/federation/) | Host + remote bundles sharing a signal across the boundary |
| [`examples/manifest/`](examples/manifest/) | Federation manifest explorer — paste a URL, see components, live-preview |
| [`examples/ssr/`](examples/ssr/) | Server-render in Node, hydrate in browser, same component module |
| [`examples/notes/`](examples/notes/) | Fullstack — auth, SQLite, signed cookies, SSR, federated rich editor |
| [`examples/router/`](examples/router/) | Routing as user-land signal — no framework primitive |
| [`examples/security/`](examples/security/) | Trusted Types CSP enforcement in real chromium |
| [`examples/styling/`](examples/styling/) | Light DOM + Shadow DOM + reactive `classMap` / `styleMap` |
| [`examples/auth-provider/`](examples/auth-provider/) | Context-provider pattern — host shares auth + fetchAuthed with federated remote |

Run any of them:

```sh
cd framework
npx http-server -p 8080
# then open http://localhost:8080/examples/<demo>/
```

The notes demo needs its server:

```sh
node examples/notes/server.mjs    # then open http://localhost:8081
node examples/notes/e2e.mjs       # end-to-end test
```

## Reading order

| If you want to… | Read |
|---|---|
| Build something today | [`COOKBOOK.md`](COOKBOOK.md) (recipe-indexed) |
| See every export's signature | [`API.md`](API.md) |
| Understand the federation model | [`FEDERATION.md`](FEDERATION.md) |
| Handle auth in your app | [`AUTH.md`](AUTH.md) |
| Manage global state | [`STATE.md`](STATE.md) |
| Audit the security posture | [`SECURITY.md`](SECURITY.md) |
| LLM-friendly project summary | [`llms.txt`](llms.txt) |

## Why does this exist

The bet: when **TC39 Signals** ships natively, the framework value migrates from "owns the reactive core" to "knows how to federate things that use the core." This project pre-builds the federation layer (lazy loading, SRI, allowedOrigins, manifest, devtools) on top of a TC39-conformant signal implementation, so federated apps using TC39 signals will be production-ready the day signals land.

## Tests

```sh
npm test                      # 80 unit tests
npm run test:conformance      # 70/70 TC39 Signals conformance
npm run typecheck             # JSDoc → .d.ts via tsc, strict
```

## Stability

Pre-1.0. Public API surface is `framework/src/index.js`. JSDoc + `.d.ts` are stable; everything in `src/` not re-exported is internal and may change.

## License

MIT — see [`LICENSE`](LICENSE).

Vendored [`lit-html`](https://lit.dev) (`framework/vendor/lit-html/`) is BSD-3-Clause; see its `LICENSE` file.
