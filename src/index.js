// Singleton enforcement — see signal.js comment.
//
// Default is `warn` because the most common cause of a second load is
// HMR / dev-server tooling, and we don't want that to throw. In
// production, opt into `throw` so misconfigured federation fails loudly
// at boot rather than silently producing dead reactivity later:
//
//   import { configure } from 'salmo';
//   configure({ singletonViolation: 'throw' });

const MARKER = '__salmo_loaded__';
const BEHAVIOR_KEY = '__salmo_singleton_behavior__';
/** @type {any} */
const g = globalThis;

/** @type {'warn' | 'throw' | 'silent'} */
let singletonBehavior = g[BEHAVIOR_KEY] ?? 'warn';

if (g[MARKER]) {
  const msg =
    'salmo: a second copy of the core module is being loaded.\n' +
    'Signals created under one copy will NOT track signals or computeds\n' +
    'tracked under the other. Pin the framework to a single URL via an\n' +
    'import map.';
  if (singletonBehavior === 'throw') throw new Error(msg);
  if (singletonBehavior === 'warn') console.warn(msg);
} else {
  g[MARKER] = true;
}

/**
 * Tune framework-level behaviour. Currently exposes singleton-violation
 * policy: 'warn' (default), 'throw' (recommended for production), or
 * 'silent' (only useful in test environments).
 *
 * @param {{ singletonViolation?: 'warn' | 'throw' | 'silent' }} options
 */
export function configure({ singletonViolation } = {}) {
  if (singletonViolation) {
    singletonBehavior = singletonViolation;
    g[BEHAVIOR_KEY] = singletonViolation;
  }
}

// === From lit-html (vendored under framework/vendor/lit-html/). ===
// Relative paths so consumers don't need an import map — just load
// /framework/src/index.js and everything resolves.
export { html, render, svg, nothing } from '../vendor/lit-html/lit-html.js';
export { repeat } from '../vendor/lit-html/directives/repeat.js';
export { when } from '../vendor/lit-html/directives/when.js';
export { classMap } from '../vendor/lit-html/directives/class-map.js';
export { styleMap } from '../vendor/lit-html/directives/style-map.js';
export { ref } from '../vendor/lit-html/directives/ref.js';
export { unsafeHTML } from '../vendor/lit-html/directives/unsafe-html.js';

// === Ours: the parts Lit doesn't provide or that we want to control. ===
export { Signal } from './signal.js';
export { effect } from './effect.js';
export { withScope, getCurrentScope } from './scope.js';
export { defineComponent } from './component.js';
export { lazyComponent, reloadRemote } from './lazy.js';
export { loadFromManifest } from './manifest.js';
export { VERSION } from './version.js';
