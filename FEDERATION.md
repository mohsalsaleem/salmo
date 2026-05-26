# Federation

How mohsal-framework approaches module federation, what makes it "first-class" rather than bolted-on, and what's portable to / from other frameworks.

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
| **mohsal-framework** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

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
| **mohsal host loads a vanilla Custom Element** | ✅ works today | The DOM is the contract. `lazyComponent` doesn't care what registered the tag — Lit, vanilla, Stencil, Solid-Element, whoever. |
| **mohsal host loads a Lit component** | ✅ works today | LitElements are Custom Elements. Properties / events flow normally. |
| **A non-mohsal host loads a mohsal component** | ✅ works today | Our components are Custom Elements. Any browser page that can do `<x-foo></x-foo>` works. |
| **Signal sharing between mohsal and non-mohsal** | ⚠️ limited | Signals are JS object references; they don't survive into a framework that doesn't import our Signal class. Communication degrades to events + attributes. |
| **Both sides import our `Signal` class** | ✅ works today | Even if the rest of the app is React or Vue, if both sides happen to share our `Signal` via import map, they share reactive state. |

The asymmetry is worth seeing clearly: **the DOM is universal; signals are our extension**. Federation works for markup and events with anyone. Live reactive sharing requires both sides to agree on a Signal implementation.

## What happens when TC39 Signals lands

The proposal we already pass 70/70 of is the same one Lit, Solid, Preact, and Vue are converging on. When `Signal.State` ships natively in browsers:

- Our `signal.js` becomes optional (we'd thin it down to a polyfill check).
- Cross-framework state sharing stops being our private extension and becomes a **property of the platform**: any framework that uses `Signal.State` from the browser shares reactive state with any other.
- Our `lazyComponent` + manifest + security layer remain useful — they're the bits the platform doesn't provide.

We're betting on the platform. The framework's value migrates from "owns the reactive core" to "knows how to federate things that use the core."

## Trust model (summary; see SECURITY.md for full)

Federation gives the remote your origin's privileges. We close the **supply-chain** gap (SRI + origin allowlist) but do **not** sandbox runtime behaviour — there is no path that preserves shared signals across an iframe and Realms is not here. Treat `lazyComponent({ src })` like an `npm install`: vet, pin with SRI, restrict origin, audit.

## What's missing (honest gaps)

1. **Hot reload across the federation boundary.** A change in a remote requires a manual retry today; no automatic detection.
2. **Versioning negotiation.** The manifest has a `framework.minVersion` field but `loadFromManifest` doesn't enforce it yet; it's documentary.
3. **DevTools story.** "Which bundle does this `<x-foo>` come from?" — currently invisible unless the user looks at network. A small element-inspector overlay would help.
4. **Streaming SSR across remotes.** Server-render the shell + inline remote outputs, stream chunks as they arrive. We have happy-dom SSR but not the streaming-stitching layer.

Each is a follow-up; none is fundamental.
