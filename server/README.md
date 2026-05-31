# salmo/server — Go server packages

This is the Go side of Salmo. It exists alongside (not instead of) the JS framework at the repo root. See [`../FULLSTACK.md`](../FULLSTACK.md) for the design rationale: what Salmo owns vs doesn't, the three drop-in modes, and why Go was picked over slice abstractions.

The Go module is rooted here so the JS repo stays JS-only at the top level. Import paths look like:

```go
import "github.com/mohsalsaleem/salmo/server/dsd"
```

## Packages

| Package | What it does | Status |
|---|---|---|
| [`dsd/`](dsd/) | Renders Salmo components to the DSD wire format defined in [`../SSR.md`](../SSR.md). Implements protocol rules (1)–(4). | v0 — landed |
| [`render/`](render/) | `Fragment` and `Page` helpers that drop into any `http.Handler`. Owns Content-Type + the HTML document scaffold. | v0 — landed |
| `session/` | The session interface from `AUTH.md`. Cookie+HMAC default; swap Redis/Postgres/Valkey. | planned |
| `federation/` | Server-side manifest emission + JWT exchange for Mode 3 cross-origin auth. | planned |

Each package is independently useful — you can use `dsd` from a non-Salmo Go server today, and the framework deliberately stops there rather than bundling routing / DB / sessions opinions.

## Tests

```sh
cd server && go test ./...
```

## What this package is *not*

- Not a web framework. Salmo doesn't own routing — bring chi, echo, gin, or stdlib `net/http`.
- Not an ORM. Components take props, not DB handles — bring sqlc, pgx, ent, or `database/sql`.
- Not a session store. The `session` package (when it lands) defines an interface; you pick the backend.

See `../FULLSTACK.md` for the long-form on owned vs not-owned.
