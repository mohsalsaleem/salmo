# Security model

This document is the authoritative reference for what mohsal-framework protects against, what it does not, and how to use it safely. It exists to be honest about boundaries — every framework that promises sandboxing without delivering it is the security feature.

## TL;DR

| Threat | Status |
|---|---|
| XSS via interpolated data into safe sinks (text, attributes, events) | Closed by construction |
| XSS via `.innerHTML` / `.outerHTML` / `.srcdoc` | Closed by Phase 1: thrown unless `unsafe()`-wrapped |
| XSS via `javascript:` / `vbscript:` / `data:text/html` in URLs | Closed by Phase 1: rewritten to `about:blank` unless `unsafe()`-wrapped |
| Defense-in-depth via Trusted Types CSP | Closed by Phase 2: framework registers a `mohsal-framework` policy |
| Hijacked-CDN remote modules | Closed by Phase 3: `lazyComponent({ integrity, allowedOrigins })` |
| State leakage between SSR renders | Closed by lifecycle: disconnect aborts the scope automatically |
| **Malicious remote running with your origin's privileges after load** | **Not solvable in-framework.** No sandbox; document the trust model. |
| Reflective XSS / CSRF / cookies | Out of scope — these are server / HTTP concerns. |

## The threat model

The framework runs in the browser, sometimes with code loaded from multiple origins. Threats fall into a few buckets:

1. **Untrusted data flowing into the DOM** — the classic XSS. User input lands in a template, escapes its slot, executes as code.
2. **Untrusted remote modules** — a `lazyComponent` whose URL has been hijacked, or whose origin has gone rogue.
3. **Cross-bundle state poisoning** — a remote you trusted reaches into signals you didn't mean to expose.
4. **SSR state leakage** — request A's component state shows up in request B because the server reused the DOM.
5. **CSP friction** — the framework relies on something a strict CSP forbids (`eval`, `new Function`, inline handlers).

## What we do, mechanism by mechanism

### `html\`\`` (the templates)

Author-written template literal strings are part of the JS source — they cannot be poisoned by data. **Only the interpolated values are runtime input.** Each kind of hole has its own discipline:

- **Text holes** (`${x}`) become `document.createTextNode(String(v))`. Strings can never escape into tag structure.
- **Function / signal text holes** (`${() => …}`, `${signal}`) read the value reactively and produce text nodes the same way.
- **Node / fragment holes** are inserted directly. The framework trusts that the caller built them safely (typically via another `html\`\``).
- **Event holes** (`onclick=${fn}`) take a function *reference*, never a string. We call `addEventListener`, never `setAttribute("onclick", …)`.
- **Attribute holes** (`attr=${x}`) become `el.setAttribute(name, finalString)`. The final string is checked against a dangerous-scheme regex when the attribute is URL-bearing.
- **Property holes** (`.prop=${x}`) become `el[propName] = v`. `.innerHTML` / `.outerHTML` / `.srcdoc` writes refuse non-`unsafe()`-wrapped values.

### `unsafe(value)` — the explicit escape hatch

The framework refuses to set `.innerHTML` from a plain string. If you really need to (e.g. you have a server-rendered HTML chunk and you've sanitized it elsewhere), wrap it: `unsafe(myTrustedHtml)`. The loud name is part of the design — `unsafe(` at the callsite tells future-you that you knew.

URL attributes apply the same idea: `<a href=${'javascript:foo()'}>` is sanitized; `<a href=${unsafe('javascript:foo()')}>` is not. **However**, a composed attribute (`<a href="/users/${id}">`) keeps its sanitization even if `id` carries `unsafe()`, because the static `/users/` prefix would give false confidence about the final string. To bypass the sanitizer, the *whole* attribute value must come from a single `unsafe()` interpolation.

### Trusted Types (Phase 2)

When your page sends a CSP with `require-trusted-types-for 'script'`, the browser refuses strings at DOM sinks. mohsal-framework registers a `"mohsal-framework"` policy on first load; the framework's sinks (the template parser, the `unsafe()`-allowed `.innerHTML` writes) all route through it. Add this to your CSP:

```
Content-Security-Policy: require-trusted-types-for 'script'; trusted-types mohsal-framework
```

See `examples/security/` for a working demo. `createScript` and `createScriptURL` in our policy both refuse — the framework never produces either, so there's nothing legitimate that should ask for them.

### `lazyComponent({ integrity, allowedOrigins })` (Phase 3)

The plain form (`lazyComponent({ tag, src, as })`) does an `import(src)`. That is **fully trusting** the source. For production federation, use the integrity options:

```js
lazyComponent({
  tag: 'acme-calendar-lazy',
  src: 'https://acme.example.com/widgets/calendar.js',
  as: 'acme-calendar',
  integrity: 'sha384-base64hash',
  allowedOrigins: ['https://acme.example.com'],
});
```

With either option set, the framework fetches the bytes itself, verifies the origin and the hash, then hands the verified bytes to the module loader as a blob URL. A hijacked CDN serving different bytes will fail the hash check; an attacker who can redirect the URL will fail the origin check.

**Limitation:** modules loaded via blob URL can't resolve their own relative imports (`./other.js`) because the blob URL has no meaningful base. Bare specifiers (resolved through the page's import map) work fine. For SRI-verified remotes, ship single-file bundles.

### SSR isolation (Phase 4)

`renderToString(tag, props)` creates the element, runs `connectedCallback`, captures `outerHTML`, then removes the element from `document.body`. The remove fires `disconnectedCallback`, which aborts the component's `AbortController`, which disposes every effect and event listener scoped under it. **No state leaks between renders** as long as user code keeps its mutable state inside `setup()` rather than at module top-level.

`framework/test/ssr-isolation.test.js` proves this with a shared signal across multiple renders.

For workloads where you cannot trust user code to follow this rule (multi-tenant SSR, etc.), the right answer is **process isolation**: spin up a worker thread or child process per request. The framework is small and fast to load; this is cheap enough for production.

## What we do NOT protect against

### A malicious remote module after it has loaded

Once `lazyComponent` has imported a remote `.js`, that code runs in your page's realm. It can:

- Read and write any signal you've put in scope.
- Read DOM, including data from other components.
- Make `fetch` requests on your origin (and send your cookies).
- Mutate any global.

There is no path to sandbox this while preserving shared signals — iframes lose the bridge (signals are JS references, they don't cross frames), and the Realms proposal isn't shipping. The integrity + origin checks in Phase 3 close the *supply chain* (you got the bytes you asked for, from the host you asked), not the runtime behaviour of those bytes.

**Treat `lazyComponent({ src })` like an `npm install`**: federation is for first-party teams and vetted vendors. Pin with SRI, restrict origin, and audit what you load.

### CSRF, cookies, server-side authorization

These are HTTP and server concerns; the framework has no opinion. Use standard practices: SameSite cookies, CSRF tokens for state-changing endpoints, Authorization headers.

### Side-channel attacks (timing, microarchitectural)

Out of scope. If you're rendering attacker-controlled content alongside secret data in the same page, the platform's same-origin protections are what stand between them. A small UI framework can't help.

## Recommended CSP

A useful starting point for a page built with mohsal-framework. Adjust to your needs.

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
require-trusted-types-for 'script';
trusted-types mohsal-framework;
```

The framework itself uses no `eval`, no `new Function`, no inline event handlers, no inline scripts — so `'unsafe-eval'` and `'unsafe-inline'` for `script-src` are unnecessary.

If you use federated remotes, list their origins under `script-src`:

```
script-src 'self' https://acme.example.com https://bcorp.example.com;
```

## Reporting

Found something we got wrong? Open an issue, or for sensitive disclosure, email the maintainer. There is no PGP key; the threat model assumed here is "transport-secured email is sufficient."
