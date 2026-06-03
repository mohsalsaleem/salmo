# Fullstack — what Salmo owns, what it doesn't, and how it composes

This is the design rationale for Salmo as a fullstack story. It records what's decided, what's deferred, and what was explicitly rejected — so a future reader (or a future us) can argue against it without having to reconstruct the conversation.

## TL;DR

> **Bring your backend. Salmo handles rendering, federation, and hydration — the parts that have to know about each other.**

Salmo is not Rails-for-Go and is not trying to be. The frontend already works as a pure browser-native library (CDN install, zero build). The fullstack story is about giving teams **three drop-in modes** with the same runtime and the same wire format, and a clean Go-server path for teams who want one.

## What Salmo owns vs what it doesn't

The principle: **Salmo owns the seam between client and server**. The seam is one thing — DSD output → signal hydration → federation refs — so it needs one spec. Everything that doesn't touch the seam stays out of scope.

| Concern | Owner |
|---|---|
| DSD rendering wire format | **Salmo** (spec in `SSR.md`) |
| Federation manifest + live signal refs | **Salmo** (spec in `FEDERATION.md`) |
| Client-side hydration runtime | **Salmo** (`src/component.js`, `src/ssr.js`) |
| Session interface (the contract) | **Salmo** (shape only — `Get` / `Set` / `Destroy`) |
| HTTP routing | app — stdlib `net/http`, chi, echo, gin, anything |
| Database / ORM | app — `*sql.DB`, pgx, sqlx, ent, GORM, raw SQL |
| Session store implementation | app — cookie+HMAC default; swap Redis/Postgres/Valkey |
| Jobs / queues / mailers / cache | app — River, asynq, gomail, anything |
| Auth policy (OAuth, refresh, multi-tab) | app — see `AUTH.md` |

The line is sharp on purpose. If Salmo started picking ORMs, it would be reinventing 20 years of Rails/Django/Spring batteries — a fight nobody wins. The DSD + signals + federation triangle is a real gap; that's the fight worth picking.

## Three drop-in modes

The unopinionated turn makes these *easier*, not harder — there's nothing Salmo could conflict with.

### Mode 1 — Pure frontend (works today)

CDN `<script type="module">`, components in any HTML, server can be anything from nginx to PHP to a CDN bucket. No Salmo on the server. This is the existing story — see the README CDN install.

### Mode 2 — Widget on someone else's page

Rails / Django / Spring / Laravel serves the page shell. Salmo runs in the browser, hydrates one interactive widget, fetches their existing JSON endpoints. The host backend's session cookie travels with `fetch`; their auth, routing, DB stay theirs. This is the "adopt Salmo for one page" path that drove jQuery, htmx, and React's early adoption.

### Mode 3 — Federation host across stacks

A Rails shop publishes a Salmo component manifest. A Django shop consumes it via `<salmo-foo-lazy src="...">`. **Live signal refs cross the language boundary**, because the boundary is HTTP + manifest, not a JS bundler. Webpack Module Federation and single-spa are JS-host-only; Salmo isn't. This is the killer differentiator at multi-team scale.

## When you do use Go on the server

For teams who want Salmo to be the whole stack, the recommended shape is a **Rails-shaped Go monolith** with federation primitives as the clean extract path:

```
   Start here:                      Outgrow it? Extract normally:
   ┌──────────────────┐             ┌──────────┐
   │  one Go binary   │             │   main   │  ← still Rails-shaped
   │  Rails-shaped    │   ────────> │   app    │
   │                  │             └────┬─────┘
   │                  │                  │ federation manifest
   └──────────────────┘                  ↓     + auth contract
                                    ┌──────────┐
                                    │  admin   │  ← separate Go service
                                    │  service │    separate repo OK
                                    └──────────┘    separate DB OK
```

The framework provides federation primitives (already shipped) + a `salmo.Render` helper that drops into any `http.Handler` + the session contract. The framework does **not** provide a magic deploy-time topology switch, slice annotations, or cross-process call routing.

Front-of-house split is free because federation handles it. Back-of-house split (DB, infra, auth boundary) is normal service-extraction work — the same work it would be in any framework — but at least the team didn't pay a slice tax for five years before they needed it.

## Why we rejected the "slice" abstraction

A Service-Weaver-inspired path was on the table: declare components-as-interfaces, let a deploy file decide whether cross-component calls are in-process or RPC. Same code, different deployment shapes. Logically a monolith, physically distributed.

**Rejected.** The hard parts of splitting a system are:

1. **Database topology** — schema is forever, can't be deferred
2. **Session / auth** — cookie domain, token issuance, gateway
3. **Deploy infra** — k8s, secrets, observability per service
4. **RPC contract** — the only one slices help with

Service Weaver spent its complexity budget on #4 and got abandoned because #1–#3 are where teams actually bleed. Salmo would inherit the same trap. The slice abstraction would also cost every Salmo user three new day-one concepts (slice, deploy, placement) for a benefit only the largest teams ever cash in — and those teams will do real extraction work anyway.

What we *do* take as inspiration from Service Weaver: **co-location is the default** (dev is always one process), and **atomic versioning by default** (one release pins all federated component versions together, opt in to independent cadence when a team needs to decouple).

## Hydration as protocol, not feature

`SSR.md` is the **DSD hydration protocol spec**, not a description of Salmo's renderer. Salmo's Node renderer is the reference implementation; anyone can write a Go / Ruby / Python / PHP renderer that emits the same wire format, and Salmo's client runtime will hydrate it.

This is a small repositioning with a large strategic payoff: it tells other ecosystems they can play without committing Salmo to building the ports. If the Python community wants `salmo-django` to emit DSD natively, the protocol is documented and stable; they don't need our blessing.

For the **SSR-for-non-Go-backends** question, three options exist:

1. **Skip server-render by default** — client renders everything. Zero effort, loses no-FOUC. Sensible default for Mode 1 / Mode 2.
2. **Render sidecar** — tiny Salmo render service over HTTP; Rails / Django calls it, gets DSD back. One extra hop, one extra process. The escape hatch for teams who need SSR without a Go server.
3. **Per-language ports** — a Ruby gem, Python package, PHP composer package that emits the same DSD natively. Heavy lift, community-driven.

Current plan: ship (1) as the documented default for Mode 1/2, document (2) for teams who need it, leave (3) to whoever feels the pain.

## Tutorial story

The unopinionated promise still requires the tutorial to pick *something* concrete to demo — `import salmo` falls flat with no DB. The honest path:

- The 10-minute hello-blog tutorial uses **sqlite + stdlib `net/http`** for the demo
- The tutorial ends with **"swap any of these — Salmo doesn't care"**, and links to alternate stacks
- The framework ships no generators that hard-code an ORM choice; if generators exist, they scaffold the file structure, not the DB layer

That preserves the unopinionated promise without leaving newcomers staring at a blank slate.

## Open questions

These were real forks blocking implementation. Initial decisions are recorded below; revisit if a decision turns out wrong.

1. **`salmo.Render` Go signature.** *Decision:* explicit `interface { Render(ctx context.Context, props Props) (Template, error) }`. Reflection-on-tags is magic; explicit interfaces match the codebase ethos and are easier to debug. Live in `server/render/` (planned). The `Component` interface in `server/dsd/` is the prototype.

2. **Cross-origin auth contract.** *Decision:* short-lived JWT exchange at federation load time. Host signs (HS256 with shared secret, or RS256 with JWKS); remote validates per request. postMessage bridge is fragile; "remote authenticates independently" defeats the SSO use case. JWT is the boring well-understood choice. Will land in `server/federation/`.

3. **Streaming SSR across remotes.** *Decision:* defer entirely. Out of scope for v1; revisit only when a real use case forces it. Genuinely a separate project — keeping it on the radar in `FEDERATION.md` is enough for now.

4. **ORM / router choice for the demo.** *Decision:* one stack deeply — sqlite + stdlib `net/http` + raw SQL. Three shallow stacks would make newcomers think they have to learn all three. The hello-blog tutorial uses this stack; a "swap guide" appendix lists alternatives (chi/echo, pgx/sqlx/ent, etc.).

## What's landed

| Component | Status | Path |
|---|---|---|
| DSD wire-format renderer (protocol rules 1–4) | v0 — 14/14 tests passing | [`server/dsd/`](server/dsd/) |
| `Fragment` / `Page` http.Handler helpers | v0 — 13/13 tests passing | [`server/render/`](server/render/) |
| Session interface + cookie+HMAC default | v0 — 14/14 tests passing | [`server/session/`](server/session/) |
| Node↔Go wire-format parity tests | v0 — 4/4 cases, regen script via Node | [`server/dsd/parity_test.go`](server/dsd/parity_test.go) |
| Minimal end-to-end example | v0 — Go server + DSD + client hydration | [`examples/server-hello/`](examples/server-hello/) |
| Hello-blog tutorial (sqlite + stdlib + raw SQL) | v0 — server-rendered, sessions, ~280 LOC main.go | [`examples/blog-go/`](examples/blog-go/) |
| Federation: manifest emission + JWT exchange | planned | `server/federation/` |

## What this doc is *not*

- Not a spec — see `SSR.md` for the DSD wire format, `FEDERATION.md` for the federation contract, `AUTH.md` for session patterns
- Not a roadmap — the Go server work isn't scheduled; this records the shape it would take *if* scheduled
- Not a commitment — every decision here is reversible; the rejected alternatives are documented above precisely so they can be revisited

If a decision here turns out wrong, edit this doc first, then the implementation. The doc is the argument; the code is the consequence.
