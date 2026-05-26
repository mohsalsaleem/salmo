// Conformance shim. Re-exports our Signal implementation under the
// path the upstream proposal-signals/signal-polyfill tests import
// (`../../src/wrapper.js`), so the suite runs against ours unchanged.
//
// Tests live under framework/conformance/tests and are vendored verbatim
// from https://github.com/proposal-signals/signal-polyfill (Apache-2.0).

export { Signal } from '../../src/signal.js';
