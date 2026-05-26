// Three styling patterns side-by-side. Same defineComponent API; only
// the rendering choices differ.

import {
  defineComponent, html, Signal,
  classMap, styleMap,
} from '../../src/index.js';

// ---- 1. Light DOM + page CSS -------------------------------------------
defineComponent({
  tag: 'x-light-demo',
  setup: () => html`
    <span class="pill">primary</span>
    <span class="pill muted">muted</span>
    <span class="pill">primary</span>
  `,
});

// ---- 2. Shadow DOM with scoped <style> ---------------------------------
defineComponent({
  tag: 'x-shadow-demo',
  shadow: true,
  setup: () => html`
    <style>
      /* This .pill rule only applies INSIDE this shadow root. The
         outer page's identically-named selector cannot reach in. */
      .pill {
        display: inline-block;
        padding: 0.35rem 0.9rem;
        border-radius: 999px;
        background: #c5e8c5;        /* different colour to make it obvious */
        color: #1a4d1a;
        font-size: 0.9rem;
        margin-right: 0.4rem;
        font-family: system-ui, sans-serif;
      }
      .pill.muted { background: #eee; color: #888; }
    </style>
    <span class="pill">scoped</span>
    <span class="pill muted">also scoped</span>
    <p style="font-size:0.85em;color:#666;margin-top:0.5rem;">
      The page CSS rule for <code>.pill</code> (blue, used above)
      does <em>not</em> reach inside this shadow root.
    </p>
  `,
});

// ---- 3. Reactive: classMap + styleMap ----------------------------------
defineComponent({
  tag: 'x-reactive-demo',
  setup() {
    const big = new Signal.State(false);
    const danger = new Signal.State(false);
    const hue = new Signal.State(210);

    return () => html`
      <style>
        x-reactive-demo .box {
          display: inline-block;
          padding: 0.5rem 1rem;
          border-radius: 6px;
          background: #f4f4f4;
          font-family: system-ui, sans-serif;
          transition: all 0.2s ease;
          border: 2px solid transparent;
        }
        x-reactive-demo .box.big { padding: 1rem 1.5rem; font-size: 1.2rem; }
        x-reactive-demo .box.danger { border-color: #c00; color: #c00; background: #fff5f5; }
        x-reactive-demo button { font: inherit; padding: 0.3rem 0.7rem; margin-right: 0.4rem; }
        x-reactive-demo .controls { margin-top: 0.5rem; }
      </style>

      <div class=${classMap({
        box: true,
        big: big.get(),
        danger: danger.get(),
      })} style=${styleMap({
        backgroundColor: `hsl(${hue.get()}, 70%, 92%)`,
        color: `hsl(${hue.get()}, 60%, 25%)`,
      })}>
        Reactive box (class:big=${String(big.get())}, hue=${hue.get()})
      </div>

      <div class="controls">
        <button @click=${() => big.set(!big.get())}>Toggle big</button>
        <button @click=${() => danger.set(!danger.get())}>Toggle danger</button>
        <button @click=${() => hue.set((hue.get() + 30) % 360)}>Next hue</button>
      </div>
    `;
  },
});
