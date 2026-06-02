# server-hello

A minimal end-to-end Salmo example: a Go server renders a Salmo component as Declarative Shadow DOM on first paint, then the matching client-side component upgrades it once the JS runtime loads.

Exercises:

- `server/dsd` — emits the DSD wire format ([SSR.md](../../SSR.md))
- `server/render` — `Page` helper wraps the component in HTML5 scaffold
- The JS runtime — `defineComponent`, `Signal.State`, `html` template tag

`server/session` isn't used here — see `examples/blog-go/` when that lands for a session example.

## Run

From this directory (the example is a separate Go module with a `replace` pointing to `../../server`):

```sh
cd examples/server-hello
go run .
```

Then open <http://localhost:8080> (or <http://localhost:8080/?name=Mo>). Internet is required on first load — the Salmo runtime comes from the documented JSDelivr CDN URL.

## What to look for in the browser

Before JS hydrates (visible if you throttle the network in DevTools):

> **Hello, World!**
> Server-rendered. Once JS loads, an interactive counter will appear below.

After JS hydrates:

> **Hello, World!**
> Hydrated. The counter below is reactive.
> [ Clicked 0 times ]

The text change + the button appearing are the visible signal that the JS runtime took over from the server-rendered DSD. View the page source (Ctrl-U) to see the DSD itself — the `<template shadowrootmode="open">…</template>` is what the browser uses to paint the styled greeting before any JS runs.

## What this demonstrates

1. **DSD round-trip.** The Go side emits valid declarative shadow DOM (`server/dsd` protocol rules 1–4); the browser parses it as a shadow root before JS executes. No FOUC for the styled box.
2. **Co-located server/client component definitions.** `main.go` defines the SSR shape; `static/app.js` defines the client shape. They share the `name` attribute on the host as the contract.
3. **Composes with stdlib `net/http`.** No router, no framework — `http.ServeMux` plus `render.Page`. Salmo doesn't own routing; see [FULLSTACK.md](../../FULLSTACK.md) for the unowned/owned breakdown.

## What this does NOT demonstrate (yet)

- **True hydration.** Per [SSR.md](../../SSR.md), v0.1.0 replaces shadow content on first reactive render rather than adopting it. The visible result is identical for components whose SSR output matches their client output, but DOM nodes are recreated. v0.2.0 adds lit-html marker-based hydration that adopts the existing nodes.
- **Cross-origin federation.** The component is locally defined on both sides. See [FEDERATION.md](../../FEDERATION.md) for the cross-origin live-reference story.
- **Sessions / auth.** The handler is unauthenticated. `server/session` provides the cookie+HMAC primitive; the blog example will exercise it end-to-end.

## File layout

```
examples/server-hello/
├── README.md         # this file
├── main.go           # Go server, defines Greeting, serves /
└── static/
    └── app.js        # client-side defineComponent('x-greeting', …)
```

The static directory is embedded into the Go binary via `//go:embed`, so the example is self-contained — no working-directory dependency at runtime. The Salmo runtime itself loads from the JSDelivr CDN (matching the documented production install path in the root `README.md`).
