// The federated cell. Lives at /examples/dashboard/widgets/ — loaded
// once via lazyComponent and reused for all 100 instances on the page.
//
// Reads three shared signals exposed by the host on window.__dashboard:
// playing / speed / incrementUpdate. (Full property forwarding through
// the lazy wrapper is still a follow-up; for this demo, window is the
// inter-bundle bus.)

import { defineComponent, html, Signal, effect } from '../../../src/index.js';

/** @type {any} */
const dash = /** @type {any} */ (window).__dashboard ?? {
  playing: new Signal.State(true),
  speed: new Signal.State(1),
  incrementUpdate: () => {},
};

defineComponent({
  tag: 'x-metric',
  setup(host) {
    const value = new Signal.State(0);
    const flashId = new Signal.State(0);

    // Each cell picks its own base interval in [100, 500] ms once.
    const baseIntervalMs = 100 + Math.random() * 400;
    /** @type {number | null} */
    let timerId = null;

    effect(() => {
      const isPlaying = dash.playing.get();
      const speed = dash.speed.get();
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      if (!isPlaying) return;
      const interval = Math.max(20, baseIntervalMs / speed);
      timerId = setInterval(() => {
        value.set(Math.floor(Math.random() * 100));
        flashId.set(flashId.get() + 1);
        dash.incrementUpdate();
      }, interval);
    });

    // Toggle the .flash class briefly per update so the cell pulses.
    // Read flashId so the render fn becomes a dep; schedule a microtask
    // to clear it (no setTimeout chain inside the render).
    let lastFlashId = -1;
    return () => {
      const id = flashId.get();
      const flash = id !== lastFlashId;
      if (flash) {
        lastFlashId = id;
        queueMicrotask(() => {
          // Clear the .flash class by re-running. The class only lasts
          // for one render cycle; CSS handles the fade-out.
          host.querySelector('.metric')?.classList.remove('flash');
        });
      }
      return html`
        <div class="metric ${flash ? 'flash' : ''}">
          <strong>${value.get()}</strong>
        </div>
      `;
    };
  },
});
