// Host bundle. Defines the page shell, owns a `tickRate` signal, and
// declares a lazy element that loads the remote clock module on connect.
// Both bundles import `salmo` from the same URL (per the
// import map in index.html), so they share one Signal.State class.

import {
  defineComponent, html, Signal, lazyComponent,
} from 'salmo';

const tickRate = new Signal.State(1000);
// Stash on window so the remote can grab it. (In a real app this would
// be passed via a property binding on the lazy element; full property
// forwarding through the lazy wrapper is a follow-up.)
/** @type {any} */ (window).__sharedTickRate = tickRate;

lazyComponent({
  tag: 'x-remote-clock-lazy',
  src: new URL('../remote/clock.js', import.meta.url).href,
  as: 'x-remote-clock',
  fallback: () => {
    const span = document.createElement('span');
    span.className = 'placeholder';
    span.textContent = 'Loading remote clock…';
    return span;
  },
});

defineComponent({
  tag: 'x-host-app',
  setup() {
    const setRate = (ms) => tickRate.set(ms);

    return () => html`
      <fieldset>
        <legend>Host controls</legend>
        <p>Current tick rate: <strong>${tickRate.get()}ms</strong></p>
        <button @click=${() => setRate(250)}>250ms</button>
        <button @click=${() => setRate(1000)}>1s</button>
        <button @click=${() => setRate(2000)}>2s</button>
      </fieldset>

      <fieldset>
        <legend>Remote component (lazy-loaded)</legend>
        <x-remote-clock-lazy></x-remote-clock-lazy>
      </fieldset>

      <p style="color:#888;font-size:0.9rem;margin-top:1rem;">
        Try clicking a rate above — the remote clock should pick it up
        immediately, because both bundles share the same Signal.State
        class (one framework instance, pinned by the import map).
      </p>
    `;
  },
});
