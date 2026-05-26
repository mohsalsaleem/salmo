# notes — fullstack demo

A real multi-user notes app that exercises every framework feature in one place.

## What it demonstrates

| Feature | Where |
|---|---|
| **Signals** | `notes`, `selectedId`, `session`, `draft`, error/busy state in the auth form |
| **`defineComponent` + props + events** | `<x-notes-app>` (root), `<x-auth>`, `<x-notes-board>`, `<x-rich-editor>` |
| **SSR + hydration** | Server renders `<x-notes-app>` with the user's notes inlined via the `initial` prop; client picks the same module up and hydrates |
| **Federation** | The rich text editor is registered with `lazyComponent` from `widgets/editor.js` — a separate bundle path the host loads on demand |
| **Shadow DOM scoping** | `<x-rich-editor>` uses `shadow: true` and a scoped `<style>` block; the host page's CSS doesn't reach in |
| **Custom events** | The editor emits `change`; the board listens via `@change=${…}` |
| **`classMap` / property bindings** | Active row in the notes list, `?disabled=${busy.get()}` on the auth button |
| **Auth** | HMAC-signed `HttpOnly` cookie; `pbkdf2Sync` for password hashing; persistence in SQLite |

## Run

```sh
node examples/notes/server.mjs              # starts on :8081
node examples/notes/e2e.mjs                 # in another shell
open http://localhost:8081                  # browse manually
```

Zero npm deps beyond what the framework already vendors. Uses Node's built-in `node:sqlite` (experimental, Node 22+) and `node:http`.

## Backend

`server.mjs` is one file:

- `node:sqlite` for storage (one DB file, two tables: `users`, `notes`)
- `node:http` for routing
- Signed cookies via `crypto.createHmac` — no JWT library, no session store
- `pbkdf2Sync` (100k iters) for password hashing
- `setupDOM` + `renderToString` from the framework for SSR

## Auth model

- Server sets `nsess=<userId>.<hmac>` as an `HttpOnly; SameSite=Strict; Path=/; Max-Age=14d` cookie on login/signup
- Every API request reads the cookie, verifies the HMAC (timing-safe), looks up the user
- Logout sends `Set-Cookie: Max-Age=0` to expire it
- Browser auto-attaches the cookie on subsequent requests (no token plumbing in the client)
- The frontend never sees the cookie value — it's `HttpOnly`. The client only knows "am I logged in" by what `/api/me` returns.

## SSR flow

```
GET / →
   server reads session cookie →
   if logged in: SELECT notes WHERE user_id = ? →
   renderToString('x-notes-app', { initial: JSON.stringify({ session, notes }) }) →
   wrap in HTML shell + <script type=module src="/framework/examples/notes/app.js"> →
   return.
```

In the browser, the same `app.js` defines the same components; existing custom-element tags upgrade and read the `initial` attribute to seed their signals. No flash, no double-fetch on first paint.

## Federation flow

The host page calls `lazyComponent({ tag: 'x-rich-editor-lazy', src: '/framework/examples/notes/widgets/editor.js', as: 'x-rich-editor' })` at module load. On the server (SSR mode set by `setupDOM`), the lazy element renders empty and the editor's import is skipped. In the browser, the lazy element triggers the import the first time an `<x-rich-editor-lazy>` is connected, mounts the real `<x-rich-editor>` inside, and forwards attributes (including `value=`).

This is the same path `examples/federation/` uses; the difference here is the surrounding app is real (auth, persistence, SSR).

## Testing

`e2e.mjs` runs against the live server with playwright. Eight assertions covering the full round-trip:

1. SSR login form
2. Create note
3. Edit title via input, body via federated editor
4. Logout
5. Re-login as same user
6. Notes restored from DB
7. Title round-trips
8. Body round-trips
