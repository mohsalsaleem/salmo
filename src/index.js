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

// === From lit-html: templating + standard directives. ===
// We re-export the bare names so consumer code uses the same import
// regardless of substrate. If we ever swap engines, this is the one
// place that changes.
export { html, render, svg, nothing } from 'lit-html';
export { repeat } from 'lit-html/directives/repeat.js';
export { when } from 'lit-html/directives/when.js';
export { classMap } from 'lit-html/directives/class-map.js';
export { ref } from 'lit-html/directives/ref.js';
export { unsafeHTML } from 'lit-html/directives/unsafe-html.js';

// === Ours: the parts Lit doesn't provide or that we want to control. ===
export { Signal } from './signal.js';
export { effect } from './effect.js';
export { withScope, getCurrentScope } from './scope.js';
export { defineComponent } from './component.js';
export { lazyComponent } from './lazy.js';
