// app.js — client-side definition of x-greeting that upgrades the
// DSD-rendered host element. The shadow root is already attached by
// the browser parser before this code runs; Salmo's connectedCallback
// reuses it rather than calling attachShadow a second time.

import { defineComponent, html, Signal } from 'https://cdn.jsdelivr.net/gh/mohsalsaleem/salmo@v0.1.0/src/index.js';

defineComponent({
  tag: 'x-greeting',
  shadow: true,
  props: ['name'],
  setup(_host, props) {
    const count = new Signal.State(0);
    return () => html`
      <style>
        :host { display: block; padding: 32px;
                font-family: system-ui, -apple-system, sans-serif;
                background: linear-gradient(135deg, #667eea, #764ba2);
                color: #fff; border-radius: 8px; text-align: center;
                max-width: 480px; margin: 48px auto; }
        h1 { margin: 0 0 12px; font-size: 32px; }
        p { margin: 0 0 16px; opacity: .85; line-height: 1.5; }
        button { background: #fff; color: #764ba2; border: 0;
                 padding: 10px 20px; border-radius: 6px;
                 font-size: 16px; cursor: pointer; font-weight: 600; }
        button:hover { background: #f0f0f0; }
      </style>
      <h1>Hello, ${props.name.get()}!</h1>
      <p>Hydrated. The counter below is reactive.</p>
      <button @click=${() => count.set(count.get() + 1)}>
        Clicked ${count.get()} times
      </button>
    `;
  },
});
