// Singleton enforcement — the reactive core has module-level state
// (currentObserver, inNotify, currentScope). Two copies of this module
// in one page would each carry their own version of that state, and
// signals tracked under one observer would not notify computeds being
// tracked under the other. Federation needs ONE instance shared across
// all bundles (achieved via an import map in the host page).
//
// The check is informational, not fatal — it warns clearly on the
// second load so the misconfiguration surfaces immediately instead of
// silently producing dead reactivity.

const MARKER = '__mohsal_framework_loaded__';
/** @type {any} */
const g = globalThis;
if (g[MARKER]) {
  // eslint-disable-next-line no-console
  console.warn(
    'mohsal-framework: a second copy of the core module is being loaded.\n' +
    'Signals created under one copy will not notify computeds tracked\n' +
    'under the other. Pin the framework to a single URL via an import map:\n' +
    '  <script type="importmap">' +
    '{ "imports": { "mohsal-framework": "/framework/src/index.js" } }' +
    '</script>'
  );
} else {
  g[MARKER] = true;
}

export { Signal } from './signal.js';
export { effect } from './effect.js';
export { html } from './html.js';
export { withScope, getCurrentScope } from './scope.js';
export { defineComponent } from './component.js';
export { repeat } from './repeat.js';
export { when } from './when.js';
export { lazyComponent } from './lazy.js';
