// effect() — the framework-level reactive primitive, built on the
// proposal's low-level Watcher + Computed APIs.
//
// Pattern (recommended by the Signals proposal):
//   - Wrap the user's fn in a Computed so dep-tracking is automatic.
//   - A Watcher fires synchronously when any tracked dep is invalidated.
//   - The watcher's notify queues a microtask, batching multiple sets in
//     the same tick into a single re-run.

import { Signal } from './signal.js';

export function effect(fn) {
  const c = new Signal.Computed(fn);

  let scheduled = false;
  const w = new Signal.subtle.Watcher(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      for (const pending of w.getPending()) pending.get();
      w.watch();             // re-arm
    });
  });

  w.watch(c);
  c.get();                   // initial run

  return () => { w.unwatch(c); };
}
