# Server-side rendering — what works in v0.1.0, what's coming in v0.2.0

Salmo's SSR story has two layers: a **happy-dom shim** that lets the same component module run unchanged on Node, and a **rendering pipeline** that produces the HTML the browser receives. v0.1.0 ships the first plus a first-paint win for shadow-DOM components (declarative shadow DOM). True hydration of light-DOM components — keeping the SSR'd nodes in place and attaching reactivity to them — is planned for v0.2.0.

## TL;DR — what to expect today

| Component kind | SSR output | Client first paint | Client takes over |
|---|---|---|---|
| `shadow: true` | Host + `<template shadowrootmode="open">…</template>` (declarative shadow DOM) | Styled shadow content rendered by the browser **before any JS runs** | Framework reuses the same shadow root; first reactive `render()` replaces SSR'd content in place |
| Default (light DOM) | Host + light-DOM children | Browser paints the SSR'd children | Framework clears the children and re-renders fresh (no hydration) |

## How it works under the hood (v0.1.0)

`setupDOM()` installs `document`, `customElements`, `HTMLElement`, etc. as globals via happy-dom. `defineComponent(...)` then registers the element exactly as it would in a browser. `renderToString(tag, props)` creates a host, appends it to `document.body` (which fires `connectedCallback` and runs `setup`), then walks the live tree with a small custom serializer.

The serializer is straightforward — element, text, comment, document-fragment — but with one branch worth calling out: an open shadow root is emitted as

```html
<template shadowrootmode="open">…shadow tree…</template>
```

A browser parser that supports DSD (Chrome 90+, Safari 16.4+, Firefox 123+) attaches that template's content as the host's shadow root automatically, before any JS executes. The user sees the styled, scoped shadow content as soon as the bytes arrive. Closed shadow roots are not serializable per the DSD spec, so we skip them; that matches browser behaviour.

On the client, `connectedCallback` checks `this.shadowRoot` first — if a shadow root is already present (the browser attached it via DSD), the framework uses it; otherwise it calls `attachShadow({mode: 'open'})`. Calling `attachShadow` twice would throw.

## What's still missing (and why we're calling it "re-render" not "hydration")

For light-DOM components, the framework today wipes the host's children before its first reactive render:

```js
// component.js
if (view != null) {
  while (root.firstChild) root.removeChild(root.firstChild);
}
```

Even for shadow-DOM components, the *content inside* the shadow root is replaced by the first reactive render. There's no flicker if the SSR'd shadow content matches what the client renders (it should, since the same `setup` runs both sides), but DOM nodes are being recreated — not adopted.

The reason: **lit-html's diff engine indexes parts by structural marker comments** (`<!--lit-part HASH-->`, `<!--/lit-part-->`). When `render()` runs in a browser, those markers are part of the internal Template state, not the serialized HTML. The bytes happy-dom serializes have already passed through `render()`, so the markers are gone. Without those markers in the SSR'd output, lit-html has no way to know which existing text node corresponds to `${count}` in a template, and `hydrate()` won't work.

## The path to true hydration (v0.2.0)

Four pieces:

### 1. Server renderer that emits hydration markers

Replace happy-dom for the templating layer with `@lit-labs/ssr`'s `render` (BSD-3, same license family as lit-html). It returns an async iterable of strings *with* the marker comments embedded. happy-dom can stay for the custom-elements registry and other browser globals; the change is to pipe lit templates through the SSR renderer instead of the DOM `render()` path.

```js
// roughly:
import { render } from '@lit-labs/ssr/lib/render-lit-html.js';
const ssrIter = render(template);
let html = '';
for (const chunk of ssrIter) html += chunk;
```

Cost: ~150 KB of additional vendored code in `vendor/lit-labs-ssr/` (or as a peer dep for SSR users only).

### 2. Client `hydrate()` on first render

lit ships `lit-html/experimental-hydrate.js` (~50 LOC). Vendor it under `vendor/lit-html/`. In `component.js`'s `connectedCallback`:

```js
const ssrMarkers = isSSRHydrated(root); // first child is <!--lit-part …-->?
if (ssrMarkers) {
  hydrate(view(), root);  // walks existing DOM, attaches part tree
} else {
  render(view(), root);   // fresh render as today
}
// then start the reactive effect; subsequent updates use render()
```

`hydrate` walks the existing nodes, matches them against the template structure via the marker comments, and attaches lit's part tree. No nodes are created or removed. Subsequent reactive updates call `render()`, which now has live part bindings and updates in place.

### 3. State parity between server and client

`setup()` runs on both sides. Anything non-deterministic (`Date.now()`, random IDs, `fetch()`'d data) produces a mismatched first render. The standard fix is to serialize hydration-critical state at SSR time and read it on the client before `setup` initialises signals.

Proposed API:

```js
// server
renderToString(tag, props, { state: { count: 5, user: {…} } });
// → emits the host element PLUS:
//   <script type="application/json" data-salmo-state="<host-id>">{"count":5,…}</script>

// component definition — new optional 4th arg to setup
defineComponent({
  tag, setup: (host, props, emit, state) => {
    const count = new Signal.State(state?.count ?? 0);
    // …
  },
});
```

On the client, `connectedCallback` looks for a matching `<script data-salmo-state="…">` adjacent to the host, parses it, and passes the resulting object to `setup`. Open design question: should the framework auto-locate the state script, or should the consumer pass a state-resolver function? Auto-location is friendlier; explicit resolver is more flexible (e.g. for SPAs that hydrate from a window-global state blob).

### 4. Effect-loop ordering

Today, `effect()` does `c.get()` immediately, which calls `renderFn()` synchronously. For hydration we want `hydrate(renderFn(), root)` first and then start the watch loop — without the watch loop re-rendering before hydrate finishes. Two-line change in `component.js`'s setup branch, but easy to get wrong (a signal mutated during `setup` must not trigger a re-render before hydrate completes).

## Costs and trade-offs

| | Today (DSD only) | v0.2.0 (full hydration) |
|---|---|---|
| Bundle size (browser) | ~7 KB vendored lit-html | ~7 KB lit-html + ~3 KB experimental-hydrate, only loaded when SSR markers are detected |
| Bundle size (server-only) | happy-dom (dev dep) | happy-dom + `@lit-labs/ssr` (~150-200 KB vendored or peer dep) |
| API surface | unchanged | one new optional `state` arg to `setup` / `renderToString` |
| Risk | low — narrow serializer scope | medium — lit's hydration is officially "experimental" though used in production at Google; state-serialization API is a real design surface |

The biggest open question is whether `@lit-labs/ssr` should be vendored (preserves "zero npm deps in production") or pulled as a peer dep (smaller repo, but a SSR consumer needs to install it). Vendor is the spirit of the project; ~150 KB is non-trivial but it's a single addition that unlocks the SSR story.

## Status

- v0.1.0 (this release): DSD for shadow-DOM components, custom serializer in `src/ssr.js`. Light-DOM SSR works (HTML is delivered, content is visible) but the client re-renders rather than hydrating.
- v0.2.0 (planned): full lit-html-based hydration per the four pieces above, with an `examples/hydration/` demo proving DOM nodes are not replaced during client takeover.

If you depend on lit-html's marker-based diff updating SSR'd DOM in place today, you'll need to wait for v0.2.0 or stay on light-DOM with full re-render.
