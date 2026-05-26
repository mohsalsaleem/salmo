// Dashboard host bundle.
// Owns the shared signals — playing, speedMultiplier, the global update
// counter, the FPS gauge. Each grid cell is a federated <x-metric>
// loaded from /examples/dashboard/widgets/metric.js (a different bundle
// path). Both share one Signal class via the framework singleton.

import {
  defineComponent, html, Signal, effect, lazyComponent,
} from '../../../src/index.js';
// Dev-only overlay; drop it into the page to see what's federated.
import '../../../src/devtools.js';

// ---- shared state (exposed to the remote via window) ----
const playing = new Signal.State(true);
const speedMultiplier = new Signal.State(1.0);
const updateCount = new Signal.State(0);
const fps = new Signal.State(0);

/** @type {any} */ (window).__dashboard = {
  playing,
  speed: speedMultiplier,
  incrementUpdate: () => updateCount.set(updateCount.get() + 1),
};

// FPS measurement — count rAF frames per second and write into the
// fps signal so the UI shows it.
let frames = 0;
const tickFrame = () => { frames++; requestAnimationFrame(tickFrame); };
requestAnimationFrame(tickFrame);
setInterval(() => { fps.set(frames); frames = 0; }, 1000);

// elapsed time, for updates-per-second math
const startedAt = Date.now();
const tickerNow = new Signal.State(startedAt);
setInterval(() => tickerNow.set(Date.now()), 500);
const updatesPerSec = new Signal.Computed(() => {
  const elapsed = (tickerNow.get() - startedAt) / 1000;
  return elapsed > 0 ? Math.round(updateCount.get() / elapsed) : 0;
});

// ---- federated cell (lazy-loaded remote) ----
lazyComponent({
  tag: 'x-metric-lazy',
  src: new URL('../widgets/metric.js', import.meta.url).href,
  as: 'x-metric',
});

// ---- the dashboard component ----
defineComponent({
  tag: 'x-dashboard',
  setup() {
    const cells = Array.from({ length: 100 }, (_, i) => i);

    return () => html`
      <header>
        <h1>Dashboard</h1>
        <div class="controls">
          <button @click=${() => playing.set(!playing.get())}>
            ${playing.get() ? 'Pause' : 'Resume'}
          </button>
          <label>
            Speed: ${speedMultiplier.get().toFixed(1)}×
            <input type="range" min="0.1" max="5" step="0.1"
              .value=${String(speedMultiplier.get())}
              @input=${(e) => speedMultiplier.set(Number(e.target.value))}>
          </label>
        </div>
        <div class="stats">
          <span>FPS <strong>${fps.get()}</strong></span>
          <span>Updates <strong>${updateCount.get()}</strong></span>
          <span>Updates/s <strong>${updatesPerSec.get()}</strong></span>
          <span>Cells <strong>${cells.length}</strong></span>
        </div>
      </header>

      <div class="grid">
        ${cells.map((i) => html`<x-metric-lazy data-id=${i}></x-metric-lazy>`)}
      </div>

      <p style="color:#888;font-size:0.9rem;margin-top:1rem;">
        100 federated <code>&lt;x-metric&gt;</code> cells, loaded once
        from a remote bundle and shared via this page's framework
        instance. Each cell holds its own value signal and updates on
        its own random interval (100–500 ms base, scaled by the
        speed slider above). The host owns the play/pause and speed
        signals; each cell reads them. FPS should stay at 60 even at 5×.
      </p>
    `;
  },
});
