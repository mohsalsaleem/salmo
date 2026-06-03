# blog-go

The hello-blog tutorial referenced in [FULLSTACK.md](../../FULLSTACK.md). Exercises all three Go packages — [`server/dsd`](../../server/dsd/), [`server/render`](../../server/render/), [`server/session`](../../server/session/) — against a real sqlite database, with stdlib `net/http` for routing and raw SQL for queries.

This is the deepest end-to-end example of the "Bring your backend. Salmo handles rendering, federation, and hydration." pitch. Every concrete choice (sqlite vs Postgres, stdlib mux vs chi, raw SQL vs sqlc) is independent of Salmo — the framework only owns what's in `server/`.

## What's in it

| Concern | How it's handled here | Where Salmo helps |
|---|---|---|
| Routing | `http.ServeMux` (stdlib) | not Salmo's concern |
| Database | sqlite via `modernc.org/sqlite` (pure Go, no CGO) | not Salmo's concern |
| Query layer | raw SQL with `database/sql` | not Salmo's concern |
| Session | `session.CookieStore[Identity]` with random ID issued on first visit | `server/session` |
| HTML scaffold | `render.Page` for the document wrapper | `server/render` |
| Component rendering | `dsd.Component` implementations using `html/template` | `server/dsd` |
| Forms | browser-native `<form method="post">` with stdlib `r.ParseForm()` | not Salmo's concern |
| Auth UI | none — identity is anonymous-but-stable via session cookie | not Salmo's concern (see [AUTH.md](../../AUTH.md)) |

No JavaScript runtime is loaded. The blog is pure server-rendered HTML; the only "interactivity" is form submission. See [`examples/server-hello/`](../server-hello/) for the JS hydration flow if you want to see DSD picked up by `defineComponent` on the client.

## Run

From this directory:

```sh
cd examples/blog-go
go run .
```

Then open <http://localhost:8080>. A `blog.db` file is created in the current directory on first run; delete it to start fresh.

## What to try

1. Visit `/` — empty list, "You've posted 0 times".
2. Click "Write a post", fill the form, publish. You're redirected to `/posts/1`.
3. Go back to `/`. Counter now says "1 time" (singular). Post appears at top.
4. Open the same URL in a different browser (or incognito). Counter says "0 times" — a fresh identity was issued. The post you just wrote still shows up because it's in the DB, but it's attributed to your *first* visitor ID.

## Caveats

- **The session-signing secret is regenerated on each run.** Restarting the server invalidates everyone's cookies and gives them a fresh identity. Production code loads the secret from env / a vault. This is documented in `main.go` next to the relevant code.
- **There's no validation beyond "title and body must be non-empty".** No length limits enforced server-side (the HTML form has `maxlength="200"` on title, but a determined client can bypass that). The blog is a tutorial, not a hardened CMS.
- **There's no XSS protection in the post body.** Wait — yes there is: every dynamic value is rendered through `html/template`, which auto-escapes. Try posting `<script>alert(1)</script>` as a body and notice it shows as literal text rather than executing.
- **No CSRF protection.** A real app would need it on `POST /posts`. Out of scope for the tutorial.

## File layout

```
examples/blog-go/
├── README.md         # this file
├── go.mod            # own module with replace pointing to ../../server
├── go.sum            # locked dependencies (modernc.org/sqlite + transitive)
└── main.go           # the whole app, ~280 LOC
```

Everything lives in one file on purpose — the tutorial is meant to be readable in one sitting. Real projects would split handlers, db, and components into separate files; nothing in Salmo's design requires that, but nothing prevents it either.
