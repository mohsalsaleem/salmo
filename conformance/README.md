# TC39 Signals conformance suite

Tests in `tests/` are vendored verbatim from
[proposal-signals/signal-polyfill](https://github.com/proposal-signals/signal-polyfill)
(Apache-2.0). They are the same tests the proposal's reference polyfill
runs against itself. `src/wrapper.js` is a one-line shim that re-exports
our `framework/src/signal.js` under the path those tests expect, so the
suite runs unmodified against our implementation.

Run with:

    npm run test:conformance

Failures here = divergence from the proposal as encoded by the upstream
polyfill, NOT regressions in our own test suite.

## Current baseline

10 / 39 tests passing across the loadable suites (3 suites — `graph`,
`ported/preact`, `ported/vue` — don't load yet because they reference
APIs we have not implemented at all).

Missing surface, by category:

- `Signal.subtle.untrack`, `Signal.subtle.currentComputed`
- `Signal.subtle.introspectSources`, `introspectSinks`, `hasSinks`
- `Signal.subtle.watched` / `Signal.subtle.unwatched` lifecycle symbols
- Custom equality (`equals` option on State / Computed)
- Cached errors in Computed (computed throws should re-throw the same
  error until deps change)
- Watcher `this` binding (notify called with the watcher as `this` when
  given a non-arrow function)
- Prohibited reads/writes inside watcher notify

Filling these in is the path to higher conformance — each one is a
small, locally testable change.
