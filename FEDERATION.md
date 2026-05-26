# Federation

How salmo approaches module federation, what makes it "first-class" rather than bolted-on, and what's portable to / from other frameworks.

## What we mean by "first-class federation"

A federation story is first-class when it provides all six of these out of the box:

1. **Independent authorship and deploy.** Different teams, different repos, different release cadences, different origins.
2. **Live reference flow across the boundary.** Not just markup — actual JS object references (signals, callbacks) can cross from host to remote and back. No serialization round-trip.
3. **Loading is a typed lifecycle.** `pending` / `loaded` / `error` are explicit states the framework owns. Not a `try` around `await import()`.
4. **Supply-chain integrity built in.** SRI hash check + origin allowlist as core options, not user-land.
5. **Discovery is structural.** A remote declares what it offers via a manifest the host can fetch and introspect.
6. **No build step on either side.** Native ESM + import maps + vendored runtime.

Most existing systems do *some* of these:

| | Independent | Live refs | Typed loading | SRI | Manifest | No build |
|---|---|---|---|---|---|---|
| Webpack Module Federation | ✅ | partial | ❌ | ❌ | ❌ | needs bundler |
| single-spa / qiankun | ✅ | ❌ | ❌ | ❌ | partial | needs bundler |
| iframe orchestration | ✅ | ❌ (postMessage only) | partial | ❌ | ❌ | ✅ |
| Custom Elements directly | ✅ | ❌ (no shared state) | ❌ | ❌ | ❌ | ✅ |
| **salmo** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

The asset is (2). Everyone else either fights the boundary (Module Federation, single-spa) or chooses isolation over composition (iframes). We choose composition and accept the trust model — see `SECURITY.md`.

## How the six pieces fit together

```js
// Host page
import { lazyComponent, loadFromManifest } from '/framework/src/index.js';

// Option A: direct
lazyComponent({
  tag: 'acme-foo-lazy',
  src: 'https://acme.example.com/foo.js',
  as: 'acme-foo',
  integrity: 'sha384-...',
  allowedOrigins: ['https://acme.example.com'],
  timeout: 30_000,
  onerror: ({ error, retry }) => html`<button @click=${retry}>retry</button>`,
});

// Option B: manifest-driven (every component in one declaration)
const { manifest, results } = await loadFromManifest(
  'https://acme.example.com/manifest.json',
  { allowedOrigins: ['https://acme.example.com'], timeout: 30_000 }
);
// results: [{ tag, status: 'registered'|'skipped'|'error', reason? }]

// Then use anywhere on the page:
//   <acme-foo-lazy .item=${signal}></acme-foo-lazy>
```

The signal interpolated in `.item=${signal}` is the **same JS object** the remote sees when it reads `props.item.get()`. That's (2) — no serialization, live reference flow.

## Extensibility: who can compose with what

| Direction | Status | Notes |
|---|---|---|
| **salmo host loads a vanilla Custom Element** | ✅ works today | The DOM is the contract. `lazyComponent` doesn't care what registered the tag — Lit, vanilla, Stencil, Solid-Element, whoever. |
| **salmo host loads a Lit component** | ✅ works today | LitElements are Custom Elements. Properties / events flow normally. |
| **A non-salmo host loads a salmo component** | ✅ works today | Our components are Custom Elements. Any browser page that can do `<x-foo></x-foo>` works. |
| **Signal sharing between salmo and non-salmo** | ⚠️ limited | Signals are JS object references; they don't survive into a framework that doesn't import our Signal class. Communication degrades to events + attributes. |
| **Both sides import our `Signal` class** | ✅ works today | Even if the rest of the app is React or Vue, if both sides happen to share our `Signal` via import map, they share reactive state. |

The asymmetry is worth seeing clearly: **the DOM is universal; signals are our extension**. Federation works for markup and events with anyone. Live reactive sharing requires both sides to agree on a Signal implementation.

## What happens when TC39 Signals lands

The proposal we already pass 70/70 of is the same one Lit, Solid, Preact, and Vue are converging on. When `Signal.State` ships natively in browsers:

- Our `signal.js` becomes optional (we'd thin it down to a polyfill check).
- Cross-framework state sharing stops being our private extension and becomes a **property of the platform**: any framework that uses `Signal.State` from the browser shares reactive state with any other.
- Our `lazyComponent` + manifest + security layer remain useful — they're the bits the platform doesn't provide.

We're betting on the platform. The framework's value migrates from "owns the reactive core" to "knows how to federate things that use the core."

## Sharing state with remotes

A federated remote runs **inside the host's page realm** — `import(src)` brings its bytes into your origin. There's no iframe, no `postMessage` round-trip, no separate JS context. That fact decides everything about state sharing:

1. **Browser-provided state** (cookies, `localStorage`, `sessionStorage`, the URL) — already shared. The browser doesn't know which `fetch` came from the host code vs the remote; both get the cookies.
2. **App state in signals** — share via one of three patterns:
   - **Prop binding** — `<acme-foo-lazy .session=${signal.get()}>`. Most explicit. Verbose if many components need it.
   - **Context provider** — `<x-auth-provider>` (or `x-theme-provider`, `x-locale-provider`, …) wraps the tree; consumers find it via `host.closest('x-auth-provider')` and read instance state directly. The platform's ancestor-lookup is the whole mechanism — no framework primitive needed beyond signals. See `examples/auth-provider/` for a worked example, `AUTH.md` for the long-form pattern.
   - **Module-level signal** — a singleton exported from a module both bundles import. Works because the framework is pinned to one URL via the vendor tree, so identity holds. Use for app-wide invariants (current locale, the global router) where one provider doesn't make sense.

The principle: the framework provides the reactive primitive (`Signal.State`), the loading lifecycle (`lazyComponent`), and the security boundary (SRI + origin). How state crosses the boundary is the app's choice — and the choice is the same one any non-federated app makes for sharing state between sibling components.

## Trust model (summary; see SECURITY.md for full)

Federation gives the remote your origin's privileges. We close the **supply-chain** gap (SRI + origin allowlist) but do **not** sandbox runtime behaviour — there is no path that preserves shared signals across an iframe and Realms is not here. Treat `lazyComponent({ src })` like an `npm install`: vet, pin with SRI, restrict origin, audit.

## What's missing (honest gaps)

### Closed

1. **Version enforcement.** `loadFromManifest` now compares the manifest's `framework.minVersion` against the running framework version and reacts per `onVersionMismatch: 'warn' | 'throw' | 'silent'` (default `warn`). Production code can opt the check into `throw` so a misconfigured federation fails loudly at boot.

2. **DevTools overlay.** Drop `<framework-devtools>` on any page (loaded from `/framework/src/devtools.js`); it auto-discovers every component registered via `lazyComponent` / `loadFromManifest`, lists each with its remote source and live-instance count, and highlights instances on the page on click. Renders in shadow DOM so it doesn't fight the host page's styles.

3. **Hot reload primitive.** `reloadRemote(src)` clears the in-flight import cache and calls `.retry()` on every connected placeholder for that src — useful when the original load failed (network blip, integrity mismatch, timeout) and the remote has since become healthy.

   **What it cannot do:** swap a working component's class definition. The browser's Custom Elements registry is write-once per tag — once `customElements.define('acme-foo', ...)` succeeds, that class is `acme-foo` forever, regardless of how many times you re-import. True HMR works around this by registering each iteration under a fresh tag and updating the placeholders to use the new tag, which is a real but larger project; we explicitly defer it. For everyday "the remote is back online" recovery, `reloadRemote` is enough.

### Still open

4. **Streaming SSR across remotes.** Server-render the shell + inline remote outputs, stream chunks as they arrive. We have happy-dom SSR for components and `lazyComponent` for client-side composition, but no server-side stitching layer that fetches remote-rendered HTML and weaves it into the response stream. This needs a server framework we don't currently have — it isn't a small follow-up so much as a separate project.
