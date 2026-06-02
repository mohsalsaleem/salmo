# Auth — what the framework does, what your app does

This is a short reference for wiring authentication into apps built on salmo. **There is no auth module in `framework/src/`** (the JS side). Auth is too app-specific to bundle. What we provide are the primitives (signals, context-via-closest, federation plumbing) and the patterns below — pick the one that fits your app.

On the Go server side, [`server/session/`](server/session/) defines a small `Store[T]` interface (Get/Set/Destroy) with a cookie+HMAC default — same philosophy: framework owns the contract, app owns the policy. See `FULLSTACK.md` for how it composes with `server/render/`.

## TL;DR — who owns what

The principle: **framework owns the wiring, app owns the policy.**

| Concern | Owner |
|---|---|
| Reactive session state | Framework (`Signal.State`) |
| Sharing session across host ↔ remote | Framework (context provider via `closest()`) |
| Federation security boundary | Framework (SRI + `allowedOrigins`) |
| `fetchAuthed` wrapper *shape* | Framework documents |
| Cookie vs token vs hybrid | App |
| Where the token lives | App |
| Refresh strategy | App |
| OAuth / SSO flow | App |
| Login / signup UI | App |
| Role / permission checks at render time | App (uses `when()` + signals — nothing special needed) |
| Server-side session contract | Framework (`server/session.Store[T]`) |
| Server-side session backend (cookie / Redis / Postgres) | App (cookie+HMAC default ships in `server/session`) |
| Server-side session validation policy (expiry, rotation, audit) | App |

## Three patterns, by auth mechanism

### Pattern A — `HttpOnly` cookie (zero plumbing)

If your server sets an `HttpOnly; SameSite=Strict; Path=/` cookie on login, **the browser handles everything**. Federated remotes run in your origin, so any `fetch('/api/…')` they make includes the cookie automatically. No prop drilling, no provider component, no signal sharing.

`examples/notes/` uses this pattern. Backend is ~290 lines and the frontend has zero auth-aware framework code — components just call `fetch` and trust the browser.

**Pick this when you can.** Lowest moving parts.

### Pattern B — context provider (when you need a token)

When auth needs a header (`Authorization: Bearer …`), you have to put the token somewhere both host code and federated code can read. The framework-idiomatic shape is a Custom Element that hosts the state on its instance:

```js
defineComponent({
  tag: 'x-auth-provider',
  setup(host) {
    const session = new Signal.State(null);     // { user, token, expiresAt } | null
    host.session = session;
    host.login = async (creds) => { /* sets session */ };
    host.logout = () => { session.set(null); };
    host.fetchAuthed = async (input, init = {}) => {
      const t = session.get()?.token;
      const headers = new Headers(init.headers ?? {});
      if (t) headers.set('Authorization', `Bearer ${t}`);
      const r = await fetch(input, { ...init, headers });
      if (r.status === 401) host.logout();       // app-specific policy
      return r;
    };
    return null;   // enhance mode: don't replace children
  },
});
```

Wrap your tree in the provider:

```html
<x-auth-provider>
  <x-login-panel></x-login-panel>
  <x-some-feature></x-some-feature>
  <acme-foo-lazy></acme-foo-lazy>   <!-- federated -->
</x-auth-provider>
```

Children, including federated ones, find it with native DOM:

```js
const provider = host.closest('x-auth-provider');
const session = provider.session;          // Signal — reactive
const res = await provider.fetchAuthed('/api/foo');
```

That `closest()` call is the whole context mechanism. No new framework primitive — it's the same trick the platform's form-associated elements use. Working demo: `examples/auth-provider/`.

### Pattern C — window-global (do this sparingly)

For one-off shared state where context is overkill (the dashboard demo's `tickRate`), put the signal on `window.__myApp.session`. The remote reads it by name. Quick to write; gives you nothing static analysis can see. Use for prototypes, not production.

## Role gates — no framework primitive needed

`when()` + a signal is already enough.

```js
${when(session.get()?.role === 'admin', () => html`
  <button @click=${deleteUser}>Delete user</button>
`)}
```

Server-side authorization is the source of truth. Client gates are UX (don't show a button if it would fail anyway). Don't let them be the *only* check.

## Where the trust boundary actually is

The federated remote runs **in your origin** with all the privileges that implies — your cookies, your localStorage, your fetch credentials, your DOM. The token-sharing patterns above are about **ergonomics, not isolation.** A token you "didn't share" is still readable by any remote you load.

The real boundary is **what you load in the first place**:

- Pin remotes with `integrity` (SRI hash)
- Restrict origins with `allowedOrigins`
- Audit the manifest as you would `npm install`

That's covered in `SECURITY.md`. The federation supply-chain check is the auth-adjacent thing the framework owns; the rest is yours.

## Refresh, rotation, OAuth — your problem

Specifically out of scope here:

- **When to refresh** — eagerly N seconds before `expiresAt` / lazily on 401 / sliding window — your call
- **Where refresh tokens live** — `HttpOnly` cookie is recommended; `localStorage` is a real risk
- **What happens when refresh fails** — kick to login? show a banner? retry once? — app policy
- **Multi-tab session sync** — `BroadcastChannel` or polling, your choice
- **OAuth / OIDC flows** — entire libraries exist for this; use one

The framework's contribution is the session signal + a place to hang the helpers. The decisions belong to you.
