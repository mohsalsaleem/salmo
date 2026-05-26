# Security model

This document is the authoritative reference for what salmo protects against, what it does not, and how to use it safely.

## TL;DR

| Threat | Status |
|---|---|
| XSS via text interpolation `${userInput}` in `html\`\`` | Closed by lit-html: text holes become text nodes, never escape into tag structure |
| XSS via `${unsafeHTML(userInput)}` | **User opt-in.** The directive name is deliberately loud. |
| XSS via `.innerHTML = string` written directly to a DOM node | **Under TT enforcement: closed by the browser.** Without TT: user code is responsible. |
| XSS via `javascript:` / `vbscript:` / `data:text/html` in URLs | **User responsibility** unless the framework grows a `safeURL` directive — currently not built in |
| Defense-in-depth via Trusted Types CSP | Closed: lit-html registers its own `"lit-html"` policy that handles the template parser's sink |
| Hijacked-CDN remote modules | Closed: `lazyComponent({ integrity, allowedOrigins })` |
| State leakage between SSR renders | Closed by lifecycle: disconnect aborts the scope automatically |
| **Malicious remote running with your origin's privileges after load** | **Not solvable in-framework.** No sandbox; document the trust model. |

## Threat model

1. **Untrusted data flowing into the DOM** — XSS classic.
2. **Untrusted remote modules** — a hijacked CDN, a rogue origin, an SRI mismatch.
3. **SSR state leakage** between server-side requests.
4. **CSP friction** — relying on `eval` / inline handlers / `new Function`.

## How each defense actually works

### Text interpolation is safe by default

`html\`<p>${userInput}</p>\`` from lit-html produces a text node. There is no codepath where a string interpolated in text position can become parsed HTML. To inject HTML you have to write `${unsafeHTML(userInput)}` — at which point you've stated the intent in plain letters at the call site.

### `unsafeHTML(value)` is the explicit opt-in

Re-exported from lit-html. Use when you have HTML you've already sanitized (server-rendered chunks, parsed Markdown, etc.). The framework does not validate the input — that's the contract.

### `.innerHTML = string` direct DOM assignment

If you bypass the templating layer and write `el.innerHTML = userInput` directly, salmo cannot help you. **Under a Trusted Types CSP, the browser will refuse.** Without TT, the assignment goes through. This is the same trade-off every browser-side framework makes.

If you want a framework-level refusal (like our pre-Lit implementation provided), the recommended approach now is to enforce Trusted Types via CSP — see below.

### Trusted Types

lit-html registers a `"lit-html"` Trusted Types policy on first use. To enable enforcement, add this CSP:

```
Content-Security-Policy:
  require-trusted-types-for 'script';
  trusted-types lit-html
```

See `examples/security/`. After this CSP is active, the browser refuses any string written to `innerHTML` / `outerHTML` / `srcdoc` etc. that didn't come from a registered policy. `lit-html` is the only policy needed; the framework's template parsing routes through it automatically.

### URL-attribute scheme sanitization (gap)

The pre-Lit version of this framework caught `javascript:` / `vbscript:` / `data:text/html` schemes in URL-bearing attributes (`href`, `src`, `formaction`, …) and rewrote them to `about:blank`. **Lit does not do this.** If you bind a URL attribute from untrusted data:

```js
html`<a href=${userControlled}>...</a>`
```

…the browser will happily activate `javascript:alert(1)` if `userControlled` is that. Mitigations:

1. **Sanitize at the source.** `new URL(input, location.href).href` parses + validates.
2. **Add a tiny `safeURL` directive** locally to your app: `<a href=${safeURL(userInput)}>`. ~10 lines.
3. **Enforce CSP `script-src 'self'`** so `javascript:` URLs don't execute scripts cross-origin even if they get into the DOM.

This is a known gap. If the framework's users hit it frequently we'll bring back a directive.

### `lazyComponent({ integrity, allowedOrigins })`

The plain form (`lazyComponent({ tag, src, as })`) does an `import(src)` and **fully trusts** the source. For production federation, use the integrity options:

```js
lazyComponent({
  tag: 'acme-calendar-lazy',
  src: 'https://acme.example.com/widgets/calendar.js',
  as: 'acme-calendar',
  integrity: 'sha384-base64hash',
  allowedOrigins: ['https://acme.example.com'],
});
```

`allowedOrigins` rejects before any fetch. `integrity` does a `fetch` + `crypto.subtle.digest` + blob-URL `import()` — a hijacked CDN serving different bytes fails the hash check.

Blob-URL modules cannot resolve relative imports (`./other.js`) because the blob URL has no meaningful base. Bare specifiers resolved through an import map work fine. For SRI-verified remotes, ship single-file bundles.

### SSR isolation

`renderToString(tag, props)` creates the element, runs `connectedCallback` (which mounts the lit-html render + sets up effects), captures `outerHTML`, then removes the element. Remove fires `disconnectedCallback`, which aborts the component's `AbortController`, which disposes every scoped effect and listener. No state leaks between renders as long as user code keeps state inside `setup()` rather than at module top-level.

For workloads where you cannot trust user code to follow this rule (multi-tenant SSR, attacker-controlled component definitions): use process isolation — worker thread or child process per request.

## What we do NOT protect against

### A malicious remote module after it has loaded

`lazyComponent` imports `.js` from a URL. Once that JS runs, it has full access to your origin: signals, DOM, fetch, cookies, everything. Integrity + origin checks close the *supply chain* — they don't sandbox runtime behaviour. **Treat `lazyComponent({ src })` like an `npm install`.** Pin with SRI, restrict origin, audit what you load.

### CSRF, cookies, server-side auth

HTTP / server concerns. Use SameSite cookies, CSRF tokens, Authorization headers.

### Side-channel attacks

Out of scope. If you're rendering attacker-controlled content alongside secret data in the same page, the platform's same-origin protections are what stands between them.

## Recommended CSP

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
require-trusted-types-for 'script';
trusted-types lit-html;
```

The framework itself uses no `eval`, no `new Function`, no inline event handlers — `'unsafe-eval'` and `'unsafe-inline'` for `script-src` are unnecessary.

If you use federated remotes, list their origins under `script-src`:

```
script-src 'self' https://acme.example.com https://bcorp.example.com;
```
