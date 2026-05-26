# State management — what we ship, what we don't

There is no state-management module in `framework/src/`. State management is too app-shaped to bundle. What we provide is the primitive (`Signal.State`) and the federation guarantee that a module-level signal is **the same instance across host and remote bundles**. Pick the pattern that fits your app.

## TL;DR — who owns what

The principle (same as `AUTH.md`): **framework owns the primitive, app owns the shape.**

| Concern | Owner |
|---|---|
| Reactive cell | Framework (`Signal.State`) |
| Derived/memoised value | Framework (`Signal.Computed`) |
| Subscription / side effect | Framework (`effect`) |
| Singleton identity across bundles | Framework (singleton-pinned core) |
| Where state lives in your code | App |
| Mutation surface (free-form / actions / reducers) | App |
| Persistence (localStorage / IndexedDB / server) | App |
| Devtools / time-travel | App (or third-party) |

## Four patterns, in order of escalation

### 1. Module-level signal (start here)

```js
// store/cart.js
import { Signal } from 'salmo';
export const cartItems = new Signal.State([]);
export const cartCount = new Signal.Computed(() => cartItems.get().length);
```

```js
// any component, including federated remotes
import { cartItems, cartCount } from '/store/cart.js';

defineComponent({
  tag: 'x-cart-badge',
  setup: () => () => html`<span>${cartCount.get()}</span>`,
});
```

This is the entire pattern. Multiple modules can export multiple signals; nothing else is required. **Federated bundles get the same `cartItems` instance** because the framework is singleton-pinned via the import map — a remote in `cdn.acme.com/widget.js` reads exactly what the host writes.

Use this until you have a reason not to.

### 2. Atom registry (when there are many signals)

Same as #1 but conventionalised: one file becomes the catalog so consumers find atoms by name. No new primitive.

```js
// store/index.js
export const cart   = new Signal.State([]);
export const user   = new Signal.State(null);
export const search = new Signal.State('');
```

`import { cart } from '/store/index.js'`. The "store" is just the file.

Promote to this when bare module exports start sprawling.

### 3. Store object (when mutations need a surface)

For state where the mutations are non-trivial — domain rules, async actions, batched updates — encapsulate the signals + their mutators in a factory:

```js
// store/cart.js
export function createCart() {
  const items = new Signal.State([]);
  const total = new Signal.Computed(() =>
    items.get().reduce((s, i) => s + i.price * i.qty, 0));

  return {
    items, total,
    add(product) {
      const existing = items.get().find((i) => i.id === product.id);
      items.set(existing
        ? items.get().map((i) => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
        : [...items.get(), { ...product, qty: 1 }]);
    },
    remove(id) {
      items.set(items.get().filter((i) => i.id !== id));
    },
    clear() { items.set([]); },
  };
}

export const cart = createCart();   // app-wide singleton; or per-instance
```

This is the Pinia / small-Redux shape. Consumers call methods on the store, not raw `signal.set()` calls — that gives you one place to validate, log, or hook devtools.

Promote to this when you find yourself writing the same mutation logic in multiple places, or when an unconstrained `signal.set()` would let callers put the store in invalid states.

### 4. Context provider (when state isn't module-singleton)

Sometimes "global" isn't really global — you have **multiple instances** of the same widget on one page, or state that should be tied to a component subtree's lifetime. Use the same `<x-*-provider>` pattern as auth:

```js
defineComponent({
  tag: 'x-cart-provider',
  setup(host) {
    host.cart = createCart();   // each instance gets its own
    return null;                 // enhance mode
  },
});
```

```js
// consumer
const cart = host.closest('x-cart-provider')?.cart;
```

`examples/auth-provider/` is the worked example; the shape is identical. Use this when module-level singletons don't fit — multi-tenant UIs, isolated widget instances, lifecycle scoped to a route.

## Choosing

| You have… | Use… |
|---|---|
| A handful of signals, app-wide | **Module-level signal** (#1) |
| More than ~6 signals worth indexing | **Atom registry** (#2) |
| Mutations with rules / actions / async / logging | **Store object** (#3) |
| Multiple independent instances OR subtree-scoped | **Context provider** (#4) |

You can mix freely. A store object's signals are still module-level signals; a context provider can host a store object. The patterns escalate; they don't conflict.

## What we deliberately don't ship

- **`createStore()` / `createAtom()` framework helpers.** The 3-line constructor is the documentation; a helper would obscure it.
- **A `dispatch(action)` reducer protocol.** Reducer pattern is fine; you can build it on top of #3 in 10 lines. We don't need to bake it in.
- **Devtools time-travel.** Useful but app-specific; depends on whether actions are enumerable, whether state is serialisable, whether storage is in scope. Out of band.
- **Middleware.** Same.
- **Hook-style consumer APIs** (e.g. `useStore()`). Components consume by `import`-then-`.get()`; that's the consumer API.

## Federation interop (the bit that's genuinely interesting)

Because the framework is pinned to one URL, `new Signal.State(0)` in module-A is the same `Signal.State` class as `new Signal.State(0)` in module-B — even if A is the host and B is a federated remote on a different path. Identity holds. A module-level signal **really is shared** across the boundary, with no extra plumbing.

That's a property nothing else in the ecosystem gives you for free:

| Library | Cross-bundle sharing |
|---|---|
| Redux | Single store passed via React Context — remote must receive it |
| Zustand | Module-level, but each bundle's copy of Zustand creates separate stores unless dedup'd |
| Pinia | Same — bundle-scoped instances |
| Jotai atoms | Same — atom identity is by reference; needs to be the same module instance |
| **salmo signals** | **Singleton-pinned by construction; module-level signals share across federated bundles for free** |

When you want a federated remote to read or write the same piece of state as the host, the answer is "have both `import { foo } from '/store/foo.js'`" and that's it.

## Comparison to other ecosystems

| | Redux | Zustand | Jotai | Solid stores | salmo |
|---|---|---|---|---|---|
| Granularity | Whole-tree | Whole-store | Atom | Signal | Signal |
| Reactivity | Subscribe + selector | Subscribe + selector | Reactive (atom) | Reactive | Reactive |
| Boilerplate | High (actions/reducers/types) | Low | Low | Low | Low |
| Devtools / time travel | Built-in | Plugin | None standard | None | None — your choice |
| Federation-friendly out of the box | No | No | No | No | **Yes** |

The trade we make: no batteries (devtools, middleware, time-travel), but the primitive composes cleanly and the federation story is free. If you want batteries, build them on top — `examples/` has the seeds.
