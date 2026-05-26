# Contributing

Thanks for considering it. salmo is small on purpose; the bar for adding to it is "this is in service of the framework's core thesis (browser-native federation + TC39 signals)" rather than "this is a useful feature."

## What lives in `framework/src/`

Only things that:
1. The framework genuinely needs — federation lifecycle, security primitives, SSR plumbing, the singleton check.
2. The platform doesn't already provide as well — we vendor `lit-html` rather than rebuild a templating engine; we implement `Signal` because the platform doesn't yet.
3. Can't be expressed as application code without losing meaning.

Things that look useful but are app-shaped — auth libraries, state-management helpers, router primitives, devtools beyond the federation overlay, ORMs, fetch wrappers — belong in `examples/` (as reference patterns) or in your app, not in `src/`.

The three reference docs that make this concrete: [`AUTH.md`](AUTH.md), [`STATE.md`](STATE.md), [`SECURITY.md`](SECURITY.md). Each says explicitly what the framework owns vs what apps own. New contributions that blur this line need a strong argument.

## Setup

```sh
git clone <this-repo>
cd salmo
npm install        # dev deps only: vitest, happy-dom, typescript
```

That's it. Production is zero-dep (lit-html is vendored under `vendor/`).

## Running things

```sh
npm test                      # vitest, watch mode
npm run test:run              # one-shot
npm run test:conformance      # TC39 Signals conformance suite
npm run typecheck             # tsc --noEmit (JSDoc-based)
npm run types                 # emit .d.ts to types/

# Serve the examples
npx http-server -p 8080
# → http://localhost:8080/examples/<demo>/

# The fullstack notes demo has its own server:
node examples/notes/server.mjs
```

## Conventions

- **JSDoc, not TS source.** All `.js` files in `src/` are checked under `allowJs: true, checkJs: true, strict: true`. Types come through JSDoc.
- **No build step for source.** What lives in `src/` is what ships. `types/` is generated.
- **Tests live next to features.** One test file per concept; `framework/test/`. Vendored conformance tests under `framework/conformance/` are untouched (we only adapt their import path via a shim).
- **Examples are the integration tests.** New behaviour should be exercisable from an example, ideally a new one or as an addition to an existing one.

## What changes need

| Change kind | Needs |
|---|---|
| Doc typo / clarification | PR, no review ceremony |
| New example | PR + verified screenshot or playwright transcript |
| New optional argument on an existing API | PR + test that exercises it + JSDoc updated |
| New exported symbol from `src/index.js` | PR + test + design rationale in PR description (why does this belong in framework rather than application code?) |
| Anything that touches `signal.js` | PR + must keep 70/70 conformance + must not regress any of the unit tests |
| Touching `vendor/lit-html/` | Don't. Update by replacing the vendored tree from a fresh `npm install lit-html`. |

## Things that are explicit non-goals

These keep coming up; the answer is consistently "out of scope":

- **A state-management library.** See [`STATE.md`](STATE.md) — the primitive is enough.
- **An auth library.** See [`AUTH.md`](AUTH.md) — same reasoning.
- **A router.** See [`examples/router/`](examples/router/) — URL is a signal, navigation is a function, view is `when()`. 8 lines.
- **Sandboxed federation.** See [`SECURITY.md`](SECURITY.md) — there is no path that preserves shared signals across an iframe. Federation is for trusted publishers.
- **Streaming SSR stitching across remotes.** A separate-project-sized gap, documented in [`FEDERATION.md`](FEDERATION.md).
- **A separate template engine.** lit-html exists, is excellent, and is what we vendor.

## Security disclosure

For non-security bugs: open an issue. For security-sensitive findings: email the maintainer before opening publicly. There is no PGP key; transport-secured email is the assumed channel.
