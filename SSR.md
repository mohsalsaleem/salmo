# DSD hydration protocol — and the Node reference implementation

This doc is the **protocol spec** for how a server (any server, in any language) tells Salmo's client runtime to hydrate a server-rendered component. Salmo's Node renderer (`src/ssr.js`) is the **reference implementation** of the protocol; nothing in the spec itself is Node-specific. A Go server, a Ruby gem, a Python package, or a PHP composer package can implement the same wire format and Salmo's client runtime will hydrate the output without changes.

This positioning matters because Salmo's three drop-in modes (see `FULLSTACK.md`) include "widget on someone else's page" and "federation host across stacks" — both of which need non-Salmo backends to be able to emit hydration-ready HTML if they want SSR. The protocol is the contract that makes that possible without coupling those backends to Salmo's Node code.

The rest of this doc is structured as: (1) the **TL;DR** of what works today vs is planned; (2) the **wire format an implementation must emit** — the normative spec; (3) how the Node reference implementation does it; (4) the path to full hydration in v0.2.0; (5) costs and trade-offs.

## TL;DR — what to expect today

| Component kind | SSR output | Client first paint | Client takes over |
|---|---|---|---|
| `shadow: true` | Host + `<template shadowrootmode="open">…</template>` (declarative shadow DOM) | Styled shadow content rendered by the browser **before any JS runs** | Framework reuses the same shadow root; first reactive `render()` replaces SSR'd content in place |
| Default (light DOM) | Host + light-DOM children | Browser paints the SSR'd children | Framework clears the children and re-renders fresh (no hydration) |

## Wire format — what an implementation must emit

An implementation of this protocol — Node, Go, Ruby, Python, anything — must emit HTML that conforms to the following rules. Salmo's client runtime relies only on these rules; the implementation language and the rendering pipeline are otherwise free.

### Required, today (v0.1.0)

1. **Host element.** A custom-element tag whose name matches a `defineComponent({ tag })` registration on the client. Attributes set on the host are visible to the client as `host.attributes`; they MUST be safely HTML-escaped. Properties (those set via `host.foo = …` on the server) are NOT serialized — only attributes survive.

2. **Shadow content for `shadow: true` components.** If the component is registered with `shadow: true`, the implementation MUST emit a single direct child:

   ```html
   <template shadowrootmode="open">…shadow tree…</template>
   ```

   The browser parser attaches the template's content as the host's open shadow root before any JS runs. Closed shadow roots are not serializable per the DSD spec; do not attempt to emit them. The client runtime checks `this.shadowRoot` in `connectedCallback` and reuses it if present.

3. **Light-DOM children for default components.** If the component is not shadow-using, the implementation MAY emit the rendered children directly inside the host. The client runtime will replace them on first reactive render (today this is "re-render", not "hydration" — see below). Emitting children still wins on first-paint perceived performance.

4. **HTML escaping.** All text and attribute values MUST be escaped per the HTML5 spec. The reference implementation uses happy-dom's serializer, which gets this right; a custom implementation must handle `&`, `<`, `>`, `"`, `'` (in attributes) and surrogate-pair safety.

### Required, post-v0.2.0 (full hydration)

When light-DOM hydration ships, the wire format gains two requirements:

5. **lit-html structural markers.** The serialized HTML MUST contain `<!--lit-part HASH-->` and `<!--/lit-part-->` markers at the positions lit-html's `render` would have placed them. This is what lets the client `hydrate()` walk existing DOM and attach the part tree without recreating nodes. Implementations that aren't built on lit-html must reproduce the same marker shape; see the lit-html source for the exact algorithm.

6. **Hydration state script.** For components whose `setup()` reads non-deterministic data (timestamps, fetched data, random IDs), the implementation MUST emit a sibling script with the data:

   ```html
   <script type="application/json" data-salmo-state="<host-id>">{"count":5,…}</script>
   ```

   Where `<host-id>` matches a stable identifier the implementation places on the host (the `id` attribute, or a `data-salmo-host` attribute). The client runtime parses this on `connectedCallback` and passes the object to `setup` as a fourth argument.

### Not required, but recommended

- **Stable host ID.** Either `id="…"` or `data-salmo-host="…"` to disambiguate when multiple instances of the same component appear on a page. Required if (6) is used.
- **`hidden` attribute during initial paint** for components whose first render is significantly different from the SSR output, to avoid layout thrash. Removed once the client runtime takes over.

### Out of scope for the wire format

- The implementation's *internal* template language (JSX, ERB, Jinja, `html/template`, lit-html). The protocol only specifies the bytes that reach the browser.
- How the implementation runs `setup()`. The Node reference uses happy-dom to actually instantiate the component; a Go implementation might transcribe a subset of the component's render contract to `html/template` and skip `setup()` entirely. Either is valid as long as the emitted HTML matches (1)–(6).
- Streaming. The wire format is per-component; how an implementation streams multiple components into a single response (Suspense-style boundaries, server components, etc.) is not specified here. See `FEDERATION.md` — "Streaming SSR across remotes" is still open.

## Reference implementation: Node (v0.1.0)

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

- v0.1.0 (this release): protocol rules (1)–(4) above. DSD for shadow-DOM components, custom serializer in `src/ssr.js`. Light-DOM SSR works (HTML is delivered, content is visible) but the client re-renders rather than hydrating.
- v0.2.0 (planned): protocol rules (5)–(6) above. Full lit-html-based hydration per the four pieces in the previous section, with an `examples/hydration/` demo proving DOM nodes are not replaced during client takeover.

If you depend on lit-html's marker-based diff updating SSR'd DOM in place today, you'll need to wait for v0.2.0 or stay on light-DOM with full re-render.

## For implementers

If you're porting this protocol to a non-Node ecosystem (Go server, Ruby gem, Python package, PHP composer package), the contract surface is small enough to fit on one page:

- **You owe the browser:** HTML matching the wire format above. Rules (1)–(4) today; (5)–(6) once v0.2.0 ships.
- **You owe Salmo's client runtime:** nothing beyond the HTML. The client runtime does not call back into your server during hydration.
- **You don't owe a `setup()` runner.** The reference implementation uses happy-dom to run components on Node so the same module works both sides. A non-JS implementation can transcribe a subset of the component's render to its native template engine (`html/template`, ERB, Jinja) and skip `setup()` entirely — as long as the bytes match.

The wire format is intentionally narrow so this stays true. If you find yourself needing to call into Salmo's JS to produce output, file an issue — the protocol probably has a gap that should be closed in the spec, not papered over in your port.
