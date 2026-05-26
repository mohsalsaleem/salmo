# API reference

Every public export from `framework/src/index.js`, with type signature and one-line description. Source-linked to where it lives.

```js
import {
  // ---- Reactive core ----
  Signal,                                                    // namespace
  effect,                                                    // function

  // ---- Lifecycle ----
  withScope, getCurrentScope, configure,

  // ---- Templates (re-exported from lit-html) ----
  html, render, svg, nothing,
  repeat, when, classMap, styleMap, ref, unsafeHTML,

  // ---- Components ----
  defineComponent,

  // ---- Federation ----
  lazyComponent, reloadRemote, loadFromManifest,

  // ---- Metadata ----
  VERSION,
} from '/framework/src/index.js';

// Separate entry points:
import { setupDOM, renderToString } from '/framework/src/ssr.js';
import '/framework/src/devtools.js';        // registers <framework-devtools>
```

---

## Reactive core

### `Signal.State<T>(initial, options?)` — `src/signal.js`

A writable reactive cell. TC39 Signals proposal shape.

```ts
new Signal.State<T>(
  initial: T,
  options?: {
    equals?: (a: T, b: T) => boolean;       // default Object.is
    [Signal.subtle.watched]?: () => void;   // fired when first live observer attaches
    [Signal.subtle.unwatched]?: () => void; // fired when last live observer detaches
  }
): Signal.State<T>

.get(): T          // tracks if called inside an observer
.set(value: T): void
```

### `Signal.Computed<T>(fn, options?)` — `src/signal.js`

A lazy-validated derived value. Re-evaluates only when dependencies' versions change; results are memoised via `equals`. Throws cached errors until deps change.

```ts
new Signal.Computed<T>(
  fn: () => T,
  options?: { equals?: (a: T, b: T) => boolean }
): Signal.Computed<T>

.get(): T          // recomputes if dirty, returns cached otherwise
```

### `Signal.subtle.Watcher(notify)` — `src/signal.js`

Low-level subscription primitive the proposal exposes for framework authors. `effect()` is built on top.

```ts
new Signal.subtle.Watcher(notify: () => void)

.watch(...signals): void
.unwatch(...signals): void
.getPending(): Signal[]
```

### `Signal.subtle.{watched, unwatched}` — symbols

Option keys used in `new Signal.State(value, { [Signal.subtle.watched]: fn })`. Lifecycle callbacks: `watched` fires when the first live downstream observer attaches; `unwatched` when the last detaches.

### `Signal.subtle.untrack(fn)`

Run `fn` outside any observer — reads inside don't track.

### `Signal.subtle.currentComputed()`

The Computed currently re-evaluating, or `undefined`.

### `Signal.subtle.introspectSources(sub)` / `introspectSinks(source)` / `hasSinks(source)`

Read the dependency graph. Throws `TypeError` on the wrong argument shape.

### `Signal.isState(x)` / `Signal.isComputed(x)`

Type guards.

### `effect(fn, options?)` — `src/effect.js`

Run `fn` once now, then re-run whenever any signal it reads changes. Returns a dispose function. Pass `{ signal }` to also dispose on abort.

```ts
effect(
  fn: () => void,
  options?: { signal?: AbortSignal },
): () => void
```

---

## Lifecycle / scopes

### `withScope(scope, fn)` — `src/scope.js`

Run `fn` with `scope` set as ambient. Effects and event listeners created inside pick up `scope.signal` for disposal.

```ts
withScope<T>(scope: { signal?: AbortSignal }, fn: () => T): T
```

### `getCurrentScope()`

Returns the ambient scope, or `null`.

### `configure(options)` — `src/index.js`

Tune framework-level behaviour.

```ts
configure(options: {
  singletonViolation?: 'warn' | 'throw' | 'silent';
}): void
```

---

## Templates (re-exported from lit-html, vendored)

Author syntax is lit-html's:
- `${value}` — text or child (escaped)
- `.prop=${value}` — DOM property binding (e.g. `.checked=${bool}`)
- `attr=${value}` — attribute binding (string-coerced)
- `?attr=${bool}` — boolean attribute (toggle presence)
- `@event=${fn}` — event listener

| Export | One-liner |
|---|---|
| `html` | Tagged template literal that returns a TemplateResult. |
| `render(template, container)` | Mount or update a template in a container. |
| `svg` | Same as `html` but for SVG element trees. |
| `nothing` | Sentinel that removes a binding (clears the attr / hides the child). |
| `repeat(items, keyFn, renderFn)` | Keyed list reconciliation. |
| `when(condition, trueFn, falseFn?)` | Conditional rendering. |
| `classMap({ foo: bool, … })` | Bind to `class=`. |
| `styleMap({ color: 'red', … })` | Bind to `style=`. |
| `ref(refOrCallback)` | Get a reference to the rendered DOM element. |
| `unsafeHTML(htmlString)` | Inject pre-sanitised HTML (the opt-in escape hatch). |

See the [lit-html docs](https://lit.dev/docs/templates/overview/) for full details.

---

## Components

### `defineComponent(spec)` — `src/component.js`

Register a Custom Element backed by `setup`.

```ts
defineComponent(spec: {
  tag: string;
  setup: (
    host: HTMLElement,
    props: Record<string, Signal.State<unknown>>,
    emit: (type: string, detail?: unknown) => void,
  ) => (() => TemplateResult) | TemplateResult | null | undefined;
  props?: readonly string[];
  shadow?: boolean;
  onError?: (err: Error, host: HTMLElement) => TemplateResult | Node | null;
}): CustomElementConstructor
```

Return shapes from `setup`:
- **`() => TemplateResult`** — reactive. Wrapped in an effect; signal reads inside drive re-renders.
- **`TemplateResult`** — static. Rendered once.
- **`null` / `undefined`** — enhance mode. Don't replace existing children; only attach listeners / set up effects.

Each name in `props` becomes:
- A JS property on the host element backed by a per-instance `Signal.State`.
- An entry in `observedAttributes` — attribute mutations sync to the signal (for SSR-rendered markup).
- Accessible via `props.name` inside `setup`.

`emit(type, detail)` dispatches a bubbling `CustomEvent` on the host. Parent listens with `@type=${fn}`.

---

## Federation

### `lazyComponent(spec)` — `src/lazy.js`

Define a Custom Element that, on first connect, dynamic-imports the remote and mounts the real component inside.

```ts
lazyComponent(spec: {
  tag: string;                                // placeholder tag
  src: string;                                // module URL
  as: string;                                 // real tag the remote registers
  fallback?: () => Node | TemplateResult;     // placeholder while loading
  onerror?: (d: {
    src: string;
    error: Error;
    retry: () => void;
  }) => Node | TemplateResult;
  timeout?: number;                           // default 30000; 0 disables
  integrity?: string;                         // SRI hash
  allowedOrigins?: string[];                  // refuse other origins
}): CustomElementConstructor
```

Element method:
- `.retry()` — clears in-flight cache, re-runs `#mount` on this instance.

Element event:
- `lazy-error` — `{ src, error }`. Bubbles.

### `reloadRemote(src)` — `src/lazy.js`

Call `.retry()` on every connected placeholder for `src`. Returns the count.

```ts
reloadRemote(src: string): number
```

### `loadFromManifest(url, options?)` — `src/manifest.js`

Fetch a manifest, validate the schema, register every component via `lazyComponent`.

```ts
loadFromManifest(
  url: string,
  options?: {
    allowedOrigins?: string[];
    timeout?: number;
    accept?: (component: ManifestComponent, manifest: Manifest) => boolean;
    onVersionMismatch?: 'warn' | 'throw' | 'silent';
  },
): Promise<{
  manifest: Manifest;
  results: Array<{
    tag: string;
    status: 'registered' | 'skipped' | 'error';
    reason?: string;
  }>;
}>
```

Manifest schema:

```ts
{
  name: string;
  version: string;
  framework?: { name: string; minVersion?: string };
  components: Array<{
    tag: string;                   // must contain a hyphen
    src: string;                   // resolved relative to manifest URL
    integrity?: string;
    props?: Array<{ name: string; type?: string }>;
    events?: Array<{ name: string; detail?: any }>;
  }>;
}
```

Each registered component gets the placeholder tag `${tag}-lazy`.

---

## SSR (`src/ssr.js`)

### `setupDOM()`

Install `document`, `window`, `customElements`, etc. as globals using `happy-dom`. Idempotent. Sets `globalThis.__mohsal_ssr__` so `lazyComponent` skips its import on the server.

```ts
setupDOM(): Promise<Window>
```

### `renderToString(tag, props?)`

Create the element, run `connectedCallback`, capture `outerHTML`, remove. The disconnect aborts the component's `AbortController` and disposes scoped effects.

```ts
renderToString(
  tag: string,
  props?: Record<string, unknown>,
): string
```

---

## Devtools (`src/devtools.js`)

Side-effect import: registers a Custom Element.

```html
<framework-devtools></framework-devtools>
```

Renders a corner panel listing every component registered via `lazyComponent` / `loadFromManifest`, its source URL, and the count of live instances. Click a row to outline its instances.

Polls every 500 ms to pick up newly-registered components. Renders in shadow DOM; doesn't affect host page styling.

---

## Metadata

### `VERSION` — `src/version.js`

Semver-ish string. Compared against `manifest.framework.minVersion` by `loadFromManifest`.

---

## Internal symbols (NOT part of the public API)

These exist in `src/` but are not re-exported and may change without notice:
- `Signal.subtle.Watcher` private methods (`_addSub`, `_removeSub`, `_version`, `_isLive`, `_validate`, `_isPending`, `_addDep`, `_trackDep`, `_subsArray`, `_sourcesArray`, `_depsArray`, `_hasSubs`, `_incrementLive`, `_decrementLive`)
- `_getRegistry()` from `src/lazy.js` (used only by `devtools.js`)

If you're writing code that touches these, you're outside the contract.
