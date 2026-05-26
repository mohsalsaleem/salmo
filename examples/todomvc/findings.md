# TodoMVC ergonomics report

Notes from building `examples/todomvc/` against `salmo`. Everything in the canonical TodoMVC spec works end-to-end (add, toggle, filter via hash routing, edit-in-place, delete, clear-completed, localStorage persistence — all verified). The component is one file, ~140 lines, no build step. The rough edges below are about how it felt to write, not whether it works.

## Worked well

- **`Signal.State` + `Signal.Computed`** map directly to "the data" + "what's derived from it." The component reads like a state machine, no diffing logic in the user code.
- **`effect()` for localStorage**: a single `effect(() => localStorage.setItem(...))` and persistence is wired. Reactivity finds the dep automatically.
- **`html\`\`` interpolation of arrays of fragments** for the list — `${visible.get().map(t => html\`<li>...\`)}` — reads like the markup it produces.
- **Custom-element + `withScope`**: connect runs setup, disconnect aborts the AbortController, listeners and effects all clean up themselves.
- **`.value=${signal}` and `.checked=${signal}`** (added this PR): once you have property binding, form state feels natural.

## Friction — verbose but works

### 1. Two-way input binding is two-line ceremony

Every editable input is:

```js
<input
  .value=${draft}
  oninput=${(e) => draft.set(e.target.value)}
>
```

The intent fits in ~5 characters; the framework asks for ~50. Every framework eventually adds sugar for this (Lit: nothing native, Vue: `v-model`, Svelte: `bind:value`).

**Proposed fix**: `:value=${signal}` desugars to value-binding + matching `oninput`/`onchange`.

### 2. Conditional class is verbose and easy to break

```js
class=${() =>
  (t.done ? 'completed' : '') +
  (editingId.get() === t.id ? ' editing' : '')
}
```

String concatenation, easy to forget the leading space, and an arrow-function wrapper for each render.

**Proposed fix**: support `class:editing=${signal}` for individual toggles (Svelte style). Static + reactive can coexist: `class="todo" class:done=${done}`.

### 3. Conditional rendering uses an empty string as the false branch

```js
${() => cond ? html`...` : ''}
```

The `''` is fine (it parses to an empty text node) but it documents nothing about intent. `${cond && html\`...\`}` works too — falsy returns `[]` from `toNodes` — but it's an accident of implementation, not a documented contract.

**Proposed fix**: either document the falsy-skip behaviour as part of the API contract, or add tiny `when(cond, () => template)` / `unless(...)` helpers for readable conditional blocks.

### 4. "Signal or function" is two ways to do the same thing

These are equivalent:

```js
${remaining}                  // pass the signal directly
${() => remaining.get()}      // pass a function that reads it
```

Both reactive, both work. The function form is needed for expressions (`${() => x.get() + 1}`) but for a single read it's noisier. New users will write the function form everywhere because it composes; the bare-signal form only works for solo reads. We should pick one and document the other as a shortcut, or drop one entirely.

### 5. Closure churn on every list mutation

Every `items.set([...])` runs `visible.get().map(t => html\`...\`)`, which creates fresh closures (`onclick=${() => toggle(t.id)}`) for every row, every time. Fine at 5 todos, painful at 5000.

The bigger issue is #1 of the next section — keyed reconciliation — which subsumes this.

## Missing — real-app blockers

### 1. **No keyed list reconciliation** (biggest issue)

`items.set(...)` re-runs the outer effect, which tears down all `<li>` elements and rebuilds them from scratch. Concrete consequence in this app: **open a todo for edit, then toggle a different todo. The edit input you were typing into gets recreated and you lose focus mid-keystroke.** Any real app with lists will hit this.

**Proposed fix**: a list primitive that diffs by key:

```js
${repeat(visible, (t) => t.id, (t) => html`<li>...</li>`)}
```

Internally it'd keep a Map<key, {node, scope}> and reuse nodes whose key persists.

### 2. **No `ref=${cb}` / post-mount hook**

When the user double-clicks to edit, we render the `<input class="edit">`. A real TodoMVC auto-focuses that input. We can't — there's no hook between "fragment created" and "element in document" where we could call `.focus()`. Same problem makes `autofocus=` only work on first paint (it's parser-time HTML semantics).

**Proposed fix**: support `ref=${(el) => { el.focus(); }}` as a directive — runs once when the element gets mounted into the DOM.

### 3. **Custom-element children can't receive rich props**

I built the whole TodoMVC as one component because the alternative — a `<x-todo-item .item=${t}>` child component — has no template-syntax way to pass an object. You'd have to query the element after creation and JS-assign a property, which loses reactivity.

**Proposed fix**: the `.prop=${value}` binding added this PR already works for built-in elements; extend the assignment logic to custom elements too (literally already does, since it's just `el[prop] = value`). The missing piece is: have the child component watch its assigned property reactively. That needs a small `Signal.from(host, 'propName')` helper or a base class that exposes reactive properties.

### 4. **No `dispatchEvent` story for child → parent**

Custom-event dispatch works natively (`host.dispatchEvent(new CustomEvent('todo-change', { detail }))`) but there's no template sugar like `<x-todo-item ontodo-change=${...}>`. Right now `on*=${fn}` handlers go through `addEventListener` — which already works for custom events too! So this is *almost* free; we just need to document and test it.

### 5. **Errors inside templates have no boundary**

If a render-time expression throws (say, `items.get().filter(...)` on a corrupt array), the effect tears down and the rest of the page can be left in a broken state. No way to log, fall back, or recover at a component boundary.

**Proposed fix**: wrap each `effect()` body in a try/catch with an optional `onError` config; default behaviour can stay "throw," but apps can opt into an error boundary.

## Prioritised next steps

| # | Fix | Effort | Why |
|---|---|---|---|
| 1 | Keyed list reconciliation (`repeat`/`each`) | medium | Without it, any real list-driven UI eats focus/scroll on every update. |
| 2 | `ref=${cb}` post-mount hook | small | Unlocks `.focus()` after render and `autofocus`-on-mount semantics. |
| 3 | `:value` / two-way binding sugar | small | Removes ~30% of input boilerplate. |
| 4 | `class:name=${signal}` sugar | small | Removes the conditional-class string concat. |
| 5 | Doc + test the `${falsy}`-skips-render contract; add `when` helper | tiny | Just naming what already works. |
| 6 | Reactive property binding for child custom elements | medium | Unlocks real component composition. |

The first three together are probably an afternoon of work and would meaningfully change how the app reads.

## Follow-up: partial templates vs a separate template engine

Posed the question: "should we introduce a {{mustache}}-style template
engine to fight verbosity?" Refactored the whole component into 7
named partial-template functions (`header`, `todoView`, `todoEdit`,
`todoItem`, `mainSection`, `filterLink`, `footer`) plus a `when()`
helper to settle it empirically.

Result:

- **Total line count went UP** (144 → 162). Each function signature
  costs lines; composition doesn't compress.
- **Top-level component dropped from 70 lines of nested template to
  7 lines** of named calls. Each partial reads as "this one thing,"
  the top-level reads as "this is the page."
- The remaining verbosity lives in **event handlers, immutable
  updates, and per-row binding configuration** — none of which a
  substitution-style template engine can shorten (functions can't
  be strings).

Conclusion: tagged-template literals + JS function composition + a
small directive set (`ref`, `:value`, `class:name`, `repeat`, `when`)
is the same shape as a "template engine" — but reactive, type-checked,
zero-build. A parallel `{{...}}` API surface would lose all of those
without buying back any of the verbosity.

## Follow-up: function partials vs real Custom Elements

Posed the question: where do the partial-template + state/actions-bag
patterns invite bugs, and does promoting a partial to a real
`<x-todo-item>` Custom Element change the picture? Refactored the
row into a real Custom Element with `props: ['item', 'editing']` and
`CustomEvent` outputs, side-by-side comparison below.

| Failure mode | Partial: `todoItem(t, editingId, actions)` | Custom Element: `<x-todo-item .item=${t} .editing=${...} oncommit=${...}>` |
|---|---|---|
| Pass value where signal expected | `todoView(t.text, ...)` silently frozen; no error | `.text=${str}` works once because the prop accepts any value; reactivity is by-passing-a-Signal-or-fn, same risk |
| Positional-arg swap | `header(addTodo, draft)` runs, partially-broken at runtime | Named attributes — `<x-todo-item .item=${editingId}>` is wrong but at least visibly named at the call-site |
| Forgotten arg | `todoItem(t)` — props undefined on use, runtime crash | `<x-todo-item .item=${t}>` without `.editing=` → child sees `undefined`, renders gracefully because the child decides what to do with a missing prop |
| Stale-closure on plain values | rampant — closures over `t` capture the old object; `repeat`'s ref-equality re-render is the workaround | gone — child re-renders by re-reading its own prop Signal, so a parent `host.item = newT` flows through automatically |
| God-bag dependency | `mainSection(state, actions)` reads whatever it likes — hidden coupling | child's `props` declaration spells out exactly what it consumes (`['item', 'editing']`) — deleting `editingId` from parent state is a typed missing-prop |
| Mutation back-channel | child reaches into `state.editingId.set(...)` — easy to do, hard to spot | impossible — child can only `dispatchEvent`; parent decides what to do |
| Re-render boundaries invisible | nothing tells you a partial runs once; surprises new contributors | child IS a `<x-tag>` you can find in DevTools, with `connectedCallback`/`disconnectedCallback` you can step through |

### What the Custom Element costs

Two things, both real, both fixable:

1. **`<template>.content` doesn't upgrade custom elements** — landed
   today as `document.importNode(tpl.content, true)` so children become
   live instances before `.prop=${}` bindings run. Without this, the
   prop setter never fires and the row renders empty.
2. **Larger upfront ceremony** — declaring `props: [...]`, fan-out of
   `CustomEvent` dispatches, an `oncommit`/`onremove`/`onbegin-edit`
   listener row in the parent for each action. ~30 extra lines vs the
   plain function partial.

### When to use which

- **Plain function partials** for things that compose only locally
  (a header, a footer, a label badge). Cheap, fine.
- **Custom Elements** for things that are *real components* —
  testable in isolation, identifiable in DevTools, with a contract
  that survives a refactor. Worth the ceremony when the partial has
  state, lifecycle, or a non-trivial input/output surface.

`<x-todo-item>` clears the bar; `header(draft, onAdd)` doesn't.
