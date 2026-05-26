// Remote bundle. Defines <x-remote-clock>. Imports the framework via
// the bare specifier — the host's import map resolves this to the same
// URL the host uses, so the singleton-core check passes and signals
// flow across.
//
// In a real deployment this would live at a different origin entirely
// (https://team-x.com/widgets/clock.js) and the host would
// import('https://team-x.com/widgets/clock.js') via lazyComponent.

import {
  defineComponent, html, Signal, effect,
} from 'salmo';

defineComponent({
  tag: 'x-remote-clock',
  setup() {
    const now = new Signal.State(new Date().toLocaleTimeString());
    // The host stashed its signal on window. In a follow-up commit
    // that adds property forwarding through the lazy wrapper, this
    // becomes a real <x-remote-clock-lazy .rate=${tickRate}> binding.
    /** @type {{ get(): number }} */
    const tickRate = /** @type {any} */ (window).__sharedTickRate
      ?? new Signal.State(1000);

    let intervalId = null;
    effect(() => {
      const rate = tickRate.get();
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => {
        now.set(new Date().toLocaleTimeString());
      }, rate);
    });

    return () => html`
      <p>
        Remote clock says: <strong>${now.get()}</strong>
        <span style="color:#888;font-size:0.9rem;">
          (tick = ${tickRate.get()}ms — driven by the host's signal)
        </span>
      </p>
    `;
  },
});
