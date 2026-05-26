# Cookbook

Task-indexed recipes. Each one is the canonical answer for "how do I X with mohsal-framework?" — short code, a link to a complete example.

---

## Reactivity

### A counter

```js
defineComponent({
  tag: 'x-counter',
  setup() {
    const n = new Signal.State(0);
    return () => html`
      <button @click=${() => n.set(n.get() + 1)}>${n.get()}</button>
    `;
  },
});
```

### A derived value

```js
const items = new Signal.State([]);
const itemCount = new Signal.Computed(() => items.get().length);
```

`Computed` is lazy; nobody runs until `.get()` is called somewhere, and downstream consumers re-run only when the value actually changes (by `equals`, default `Object.is`).

### A side effect (subscribe + cleanup)

```js
setup() {
  const id = setInterval(() => {/* … */}, 1000);
  effect(() => {
    // anything signal-tracked here re-runs on change
  });
  // for non-signal cleanups, use the scope's signal directly:
  getCurrentScope()?.signal?.addEventListener('abort',
    () => clearInterval(id), { once: true });
}
```

### Untracked reads inside a Computed

```js
const a = new Signal.State(1);
const b = new Signal.State(2);
const c = new Signal.Computed(() =>
  a.get() + Signal.subtle.untrack(() => b.get()));
// c re-runs when a changes, but NOT when b changes.
```

---

## Templates

### List rendering with keyed reuse

```js
${repeat(items.get(), (item) => item.id, (item) => html`
  <li>${item.text}</li>
`)}
```

Use `repeat` instead of `.map()` when the list mutates — it reuses DOM for unchanged keys (preserves focus, scroll, half-typed inputs).

### Conditional rendering

```js
${when(loggedIn.get(),
  () => html`<x-app></x-app>`,
  () => html`<x-login></x-login>`)}
```

Both branches optional; `when(cond, trueFn)` is the common case.

### Reactive class toggles

```js
${html`<li class=${classMap({
  active: selectedId.get() === id,
  done: item.done,
})}>...</li>`}
```

### Reactive inline styles

```js
${html`<div style=${styleMap({
  backgroundColor: `hsl(${hue.get()}, 70%, 92%)`,
  fontSize: `${size.get()}px`,
})}>...</div>`}
```

### A reference to the rendered element

```js
import { createRef } from '/framework/vendor/lit-html/directives/ref.js';
// …setup:
const inputRef = createRef();
return () => html`<input ${ref(inputRef)}>`;
// later:
inputRef.value?.focus();
```

### Inline raw HTML (escape hatch)

```js
${unsafeHTML(serverRenderedMarkup)}
```

Only after you've sanitised. The escape-hatch name is the warning. See [`SECURITY.md`](SECURITY.md).

---

## Components

### A component with reactive props

```js
defineComponent({
  tag: 'x-greeting',
  props: ['name'],
  setup(host, props) {
    return () => html`<p>Hello, ${props.name.get() ?? 'stranger'}!</p>`;
  },
});

// Use:
//   <x-greeting name="alice"></x-greeting>      (attribute)
//   document.querySelector('x-greeting').name = 'bob';   (property)
```

Both attribute and property set the same underlying signal — your `setup` reads either way.

### Child → parent events

```js
// Child
defineComponent({
  tag: 'x-toggle',
  setup(host, props, emit) {
    const on = new Signal.State(false);
    const flip = () => {
      on.set(!on.get());
      emit('toggled', { on: on.get() });
    };
    return () => html`<button @click=${flip}>${on.get() ? 'On' : 'Off'}</button>`;
  },
});

// Parent
html`<x-toggle @toggled=${(e) => console.log(e.detail.on)}></x-toggle>`
```

### Error boundary for a component

```js
defineComponent({
  tag: 'x-thing',
  onError: (err) => html`<div role="alert">Couldn't render: ${err.message}</div>`,
  setup() {
    // …throws? Boundary catches and renders the alert.
  },
});
```

### A child that reads ancestor state (context provider)

```js
// Provider — hosts state on its instance
defineComponent({
  tag: 'x-theme-provider',
  setup(host) {
    const theme = new Signal.State('light');
    host.theme = theme;
    host.toggleTheme = () => theme.set(theme.get() === 'light' ? 'dark' : 'light');
    return null;   // enhance mode; don't replace children
  },
});

// Consumer — finds provider by tag name
defineComponent({
  tag: 'x-themed-thing',
  setup(host) {
    const provider = host.closest('x-theme-provider');
    return () => html`<div class=${provider.theme.get()}>...</div>`;
  },
});
```

This same pattern is the answer for auth (see [`AUTH.md`](AUTH.md)) and global state (see [`STATE.md`](STATE.md)).

---

## Federation

### Load a remote component lazily

```js
lazyComponent({
  tag: 'acme-calendar-lazy',
  src: 'https://acme.example.com/widgets/calendar.js',
  as: 'acme-calendar',
});

// then anywhere:
html`<acme-calendar-lazy></acme-calendar-lazy>`
```

### Production federation (with supply-chain checks)

```js
lazyComponent({
  tag: 'acme-calendar-lazy',
  src: 'https://acme.example.com/widgets/calendar.js',
  as: 'acme-calendar',
  integrity: 'sha384-AbCdEfGh…',
  allowedOrigins: ['https://acme.example.com'],
  timeout: 10_000,
  onerror: ({ src, error, retry }) => html`
    <div role="alert">${src} failed: ${error.message}
      <button @click=${retry}>Retry</button>
    </div>
  `,
});
```

### Manifest-driven loading

```js
const { manifest, results } = await loadFromManifest(
  'https://acme.example.com/manifest.json',
  { allowedOrigins: ['https://acme.example.com'], onVersionMismatch: 'throw' },
);

console.log(`loaded ${results.filter(r => r.status === 'registered').length} components`);
```

### Share state with a remote

The cleanest pattern is the context provider above. For app-wide state, just `export const foo = new Signal.State(...)` from a module both bundles import — they get the same instance because the framework is singleton-pinned. See [`FEDERATION.md`](FEDERATION.md) for why.

### Show what's federated on the page

```html
<framework-devtools></framework-devtools>
<script type="module" src="/framework/src/devtools.js"></script>
```

Floating panel lists every federated tag, its source URL, and live instance count. Click a row to outline its instances.

---

## Forms

### Two-way input (manual; intentional)

```js
const value = new Signal.State('');
return () => html`
  <input
    .value=${value.get()}
    @input=${(e) => value.set(e.target.value)}
  >
`;
```

No `:value` sugar — the explicitness is on purpose. Both halves of the binding are visible at the call site.

### A checkbox bound to a boolean signal

```js
const checked = new Signal.State(false);
html`<input type="checkbox"
  .checked=${checked.get()}
  @change=${(e) => checked.set(e.target.checked)}>`;
```

### Form submit with async + busy state

```js
const busy = new Signal.State(false);
const error = new Signal.State(null);

const submit = async (e) => {
  e.preventDefault();
  error.set(null);
  busy.set(true);
  try { await api('/save', { method: 'POST', body: …}); }
  catch (err) { error.set(err.message); }
  finally { busy.set(false); }
};

return () => html`
  <form @submit=${submit}>
    <button ?disabled=${busy.get()}>${busy.get() ? '…' : 'Save'}</button>
    ${error.get() ? html`<p style="color:red">${error.get()}</p>` : ''}
  </form>
`;
```

---

## Auth

### HttpOnly cookie (the zero-plumbing path)

Backend sets `Set-Cookie: nsess=…; HttpOnly; SameSite=Strict; Path=/`. Browser auto-attaches to any same-origin `fetch`. Nothing in the framework or your component code is auth-aware. See [`examples/notes/`](examples/notes/).

### Token auth via context provider

Wrap your tree in `<x-auth-provider>` (or a similar name). Provider hosts `session`, `login`, `logout`, `fetchAuthed` on its instance. Children read via `closest()`. See [`examples/auth-provider/`](examples/auth-provider/) and [`AUTH.md`](AUTH.md).

---

## State management

### Module-level singleton (start here)

```js
// store/cart.js
import { Signal } from '/framework/src/index.js';
export const cartItems = new Signal.State([]);
export const cartCount = new Signal.Computed(() => cartItems.get().length);

// any component:
import { cartCount } from '/store/cart.js';
return () => html`<span>${cartCount.get()}</span>`;
```

Federated remotes get the same instance because the framework is singleton-pinned. See [`STATE.md`](STATE.md) for the four-pattern escalation.

---

## SSR

### Render a component to an HTML string on Node

```js
import { setupDOM, renderToString } from '/framework/src/ssr.js';

await setupDOM();
await import('./app.js');                            // defines components
const body = renderToString('x-page', { user: 'alice' });
res.end(`<!DOCTYPE html><html><body>${body}<script type="module" src="/app.js"></script></body></html>`);
```

The client picks up the same `app.js` and hydrates each `<x-tag>` independently. No tree-wide diff; per-component hydration.

### Pass server-rendered data to a component for hydration

```js
// Server
const initial = JSON.stringify({ session, notes: dbRows });
renderToString('x-notes-app', { initial });

// Client component
defineComponent({
  tag: 'x-notes-app',
  props: ['initial'],
  setup(host, props) {
    const { session, notes } = JSON.parse(props.initial.get());
    // …
  },
});
```

See [`examples/notes/`](examples/notes/) for the working version.

---

## Routing

### Router in 10 lines (no framework primitive needed)

```js
const path = new Signal.State(location.pathname);
window.addEventListener('popstate', () => path.set(location.pathname));
const navigate = (to) => { history.pushState(null, '', to); path.set(to); };

// click delegation for internal links
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || e.metaKey || e.ctrlKey || e.button) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});

// in components:
${when(path.get() === '/', () => html`<x-home></x-home>`)}
${when(path.get() === '/about', () => html`<x-about></x-about>`)}
```

See [`examples/router/`](examples/router/).

---

## Security

### Block dangerous innerHTML writes

Use `unsafeHTML` deliberately:

```js
${unsafeHTML(sanitisedString)}      // explicit opt-in
```

Plain text is auto-escaped:

```js
${userInput}                         // safe — produces a text node
```

### Enable Trusted Types in production

CSP header:

```
require-trusted-types-for 'script';
trusted-types lit-html;
```

The framework's vendored `lit-html` registers its own `lit-html` policy. See [`examples/security/`](examples/security/) for the working CSP demo.

### Federation with full supply-chain protection

```js
lazyComponent({
  src: 'https://vendor.example.com/v1/widget.js',
  integrity: 'sha384-…',
  allowedOrigins: ['https://vendor.example.com'],
  /* … */
});
```

The remote runs in your origin's privileges. Treat it like an `npm install`. Pin, allowlist, audit. See [`SECURITY.md`](SECURITY.md).
