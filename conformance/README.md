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

**70 / 70** — full conformance with the proposal-signals polyfill's
own test suite (including the ported Solid graph, Preact, and Vue
suites). The journey:

| Commit | Tests | Δ |
|---|---|---|
| Wire-up | 10 / 39 | baseline |
| Introspection + `untrack` + `currentComputed` | 43 / 70 | +33 |
| 3-state validation + custom equality | 58 / 70 | +15 |
| `isState`/`isComputed` + prohibited-context + equals leak fix | 62 / 70 | +4 |
| Liveness + `watched`/`unwatched` lifecycle | 67 / 70 | +5 |
| Cached errors in Computed | 70 / 70 | +3 |

Re-run with `npm run test:conformance` whenever `src/signal.js` changes.
