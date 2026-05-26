// Shared between server and client. The server's render.mjs imports
// this as a Node module; the browser loads it as a regular ESM script.
// Either way: exactly the same component definitions execute.

import { defineComponent, html, Signal } from '../../src/index.js';

defineComponent({
  tag: 'x-counter',
  props: ['initial'],
  setup(host, props, emit) {
    const count = new Signal.State(Number(props.initial.get()) || 0);
    const inc = () => { count.set(count.get() + 1); emit('changed', { count: count.get() }); };
    const dec = () => { count.set(count.get() - 1); emit('changed', { count: count.get() }); };

    return () => html`
      <div class="counter">
        <button @click=${dec} aria-label="decrement">−</button>
        <strong>${count.get()}</strong>
        <button @click=${inc} aria-label="increment">+</button>
      </div>
    `;
  },
});

defineComponent({
  tag: 'x-page',
  setup: () => () => html`
    <h1>SSR + hydration demo</h1>
    <p>
      This whole page was rendered to HTML on Node (via
      <code>renderToString</code> + happy-dom), then shipped to the
      browser. When the JS loads, the browser parses the HTML,
      upgrades each <code>&lt;x-counter&gt;</code>, and the buttons
      become interactive.
    </p>

    <fieldset>
      <legend>Counter A (initial 0)</legend>
      <x-counter initial="0"></x-counter>
    </fieldset>

    <fieldset>
      <legend>Counter B (initial 42)</legend>
      <x-counter initial="42"></x-counter>
    </fieldset>

    <p style="color:#888;font-size:0.9rem;">
      Open view-source: each counter's number appears in the HTML
      the server produced. After hydration the counts are interactive.
    </p>
  `,
});
