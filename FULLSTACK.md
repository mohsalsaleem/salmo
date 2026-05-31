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

These are real forks that block implementation, not just docs:

1. **`salmo.Render` Go signature.** Component as `interface { Render(props) Template }` or as a struct with reflection on tags? The first is explicit; the second is more ergonomic but adds reflection cost. Needs a sketch + three example apps to decide.

2. **Cross-origin auth contract.** AUTH.md already covers single-origin patterns. For Mode 3 (federation host across stacks), the host's session cookie isn't on the remote's origin. Options: short-lived JWT exchange at federation load time, a postMessage-based auth bridge, or require remotes to authenticate independently. The federation security model (`FEDERATION.md`, supply-chain section) constrains this.

3. **Streaming SSR across remotes.** `FEDERATION.md` flags this as still-open. The server-side stitching layer that fetches remote-rendered HTML and weaves it into the response stream is genuinely a separate project — not a small follow-up.

4. **ORM / router choice for the demo.** sqlite + stdlib is the default pick, but the tutorial-as-spec is itself a fork: does it show one stack deeply, or three stacks shallowly?

## What this doc is *not*

- Not a spec — see `SSR.md` for the DSD wire format, `FEDERATION.md` for the federation contract, `AUTH.md` for session patterns
- Not a roadmap — the Go server work isn't scheduled; this records the shape it would take *if* scheduled
- Not a commitment — every decision here is reversible; the rejected alternatives are documented above precisely so they can be revisited

If a decision here turns out wrong, edit this doc first, then the implementation. The doc is the argument; the code is the consequence.
