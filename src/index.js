// Singleton enforcement — see signal.js comment.
const MARKER = '__mohsal_framework_loaded__';
/** @type {any} */
const g = globalThis;
if (g[MARKER]) {
  // eslint-disable-next-line no-console
  console.warn(
    'mohsal-framework: a second copy of the core module is being loaded.\n' +
    'Pin to a single URL via an import map.'
  );
} else {
  g[MARKER] = true;
}

// === From lit-html (vendored under framework/vendor/lit-html/). ===
// Relative paths so consumers don't need an import map — just load
// /framework/src/index.js and everything resolves.
export { html, render, svg, nothing } from '../vendor/lit-html/lit-html.js';
export { repeat } from '../vendor/lit-html/directives/repeat.js';
export { when } from '../vendor/lit-html/directives/when.js';
export { classMap } from '../vendor/lit-html/directives/class-map.js';
export { ref } from '../vendor/lit-html/directives/ref.js';
export { unsafeHTML } from '../vendor/lit-html/directives/unsafe-html.js';

// === Ours: the parts Lit doesn't provide or that we want to control. ===
export { Signal } from './signal.js';
export { effect } from './effect.js';
export { withScope, getCurrentScope } from './scope.js';
export { defineComponent } from './component.js';
export { lazyComponent } from './lazy.js';
export { loadFromManifest } from './manifest.js';
