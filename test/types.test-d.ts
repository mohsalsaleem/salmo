// Type-only smoke test. tsc compiles this; vitest doesn't.
// Verifies that the public API surface is usable from a TypeScript
// consumer with no errors and correct inference.

import {
  Signal,
  effect,
  html,
  withScope,
  defineComponent,
} from '../src/index.js';

// State is generic and inferred from initial value.
const count = new Signal.State(0);
const n: number = count.get();
count.set(n + 1);

// Computed is generic from the function return type.
const doubled = new Signal.Computed(() => count.get() * 2);
const d: number = doubled.get();

// effect: signature accepts AbortSignal and returns dispose.
const ctrl = new AbortController();
const dispose: () => void = effect(() => {
  count.get();
}, { signal: ctrl.signal });
dispose();

// withScope is generic in the callback return type.
const scoped: string = withScope({ signal: ctrl.signal }, () => 'ok');

// html returns a TemplateResult (from lit-html).
const frag = html`<p>${count.get()}</p>`;

// defineComponent accepts a setup that returns Node/Fragment/null.
defineComponent({
  tag: 'x-types',
  shadow: false,
  setup(host: HTMLElement) {
    host.tagName; // host is typed
    return html`<span>${doubled}</span>`;
  },
});

// Suppress "declared but never used" lint when this file is only loaded
// for type-checking.
export type _ = [typeof d, typeof scoped, typeof frag];
