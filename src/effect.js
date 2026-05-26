// effect() — the framework-level reactive primitive, built on the
// proposal's low-level Watcher + Computed APIs.
//
// Disposal follows the platform convention: pass an AbortSignal in
// `options.signal` (same shape as fetch, addEventListener, etc), or
// call the returned dispose function. Either tears down the same way.

import { Signal } from './signal.js';
import { getCurrentScope } from './scope.js';

/**
 * @typedef {Object} EffectOptions
 * @property {AbortSignal} [signal]
 */

/**
 * Run `fn` once now, then re-run whenever any signal it reads changes.
 * Returns a dispose function. Pass `{signal}` to also dispose on abort.
 *
 * @param {() => void} fn
 * @param {EffectOptions} [options]
 * @returns {() => void}
 */
export function effect(fn, { signal } = {}) {
  signal ??= getCurrentScope()?.signal;
  if (signal?.aborted) return () => {};

  const c = new Signal.Computed(fn);

  let scheduled = false;
  let disposed = false;
  const w = new Signal.subtle.Watcher(() => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed) return;
      for (const pending of w.getPending()) {
        /** @type {{ get(): unknown }} */ (/** @type {unknown} */ (pending)).get();
      }
      w.watch();             // re-arm
    });
  });

  w.watch(c);
  c.get();                   // initial run

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    w.unwatch(c);
  };

  signal?.addEventListener('abort', dispose, { once: true });
  return dispose;
}
