// lazyComponent — federation's loading primitive.
//
//   lazyComponent({
//     tag: 'acme-calendar-lazy',
//     src: 'https://acme.example.com/calendar.js',
//     as: 'acme-calendar',
//     timeout: 30_000,                              // ms; 0 disables
//     fallback: () => html`<p>Loading…</p>`,
//     onerror: ({ src, error, retry }) => html`...`,
//     integrity: 'sha384-...',
//     allowedOrigins: ['https://acme.example.com'],
//   });
//
// Trust model: loading a remote .js runs that code with your origin's
// privileges. No sandboxing path preserves shared signals — iframes
// lose the bridge, Realms isn't here. The SRI + origin allowlist below
// close the *supply-chain* hole only.  See SECURITY.md.

import { html, render as litRender } from '../vendor/lit-html/lit-html.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/** @typedef {Object} LazyErrorDetail
 *  @property {string} src
 *  @property {Error} error
 *  @property {() => void} retry
 */

/** @typedef {Object} LazySpec
 *  @property {string} tag
 *  @property {string} src
 *  @property {string} [as]
 *  @property {() => unknown} [fallback]   DOM Node or lit-html TemplateResult.
 *  @property {(d: LazyErrorDetail) => unknown} [onerror]
 *  @property {number} [timeout]           ms; default 30s, 0 = disabled
 *  @property {string} [integrity]
 *  @property {string[]} [allowedOrigins]
 */

/** Shared promises so concurrent lazy elements pointing at the same src
 *  do not trigger N parallel imports. @type {Map<string, Promise<unknown>>} */
const inFlight = new Map();

/** Tag → registration record, for devtools / reloadRemote.
 *  @type {Map<string, { src: string; realTag: string; registeredAt: number }>} */
const registry = new Map();

/** src → set of LIVE LazyElement instances. Used by reloadRemote so we
 *  can iterate every connected placeholder and call .retry().
 *  @type {Map<string, Set<HTMLElement & { retry: () => void }>>} */
const liveInstances = new Map();

/** Read-only view of the lazyComponent registry. The devtools overlay
 *  uses this to map a Custom Element tag back to its remote source. */
export function _getRegistry() { return registry; }

/** Devtools subscription so the overlay re-renders the moment a new
 *  lazyComponent is registered, instead of polling. */
/** @type {Set<() => void>} */
const registryListeners = new Set();
/** @param {() => void} fn @returns {() => void} */
export function _onRegistryChange(fn) {
  registryListeners.add(fn);
  return () => registryListeners.delete(fn);
}
function notifyRegistryChange() {
  for (const fn of [...registryListeners]) {
    try { fn(); } catch { /* listener bugs don't propagate */ }
  }
}

/**
 * Reload every connected instance of `src` (.retry() each one). Useful
 * for "the remote came back online, refresh my placeholders." Returns
 * the count of instances that were retried.
 *
 * Limitation: the browser's Custom Elements registry is write-once per
 * tag. We can re-import the module (and inFlight is cleared so the
 * import is fresh), but the remote's `customElements.define(tag, ...)`
 * call won't re-run — the existing class definition stays. So this
 * helps when the original load *failed* (network, integrity, timeout)
 * but the remote's source has since been corrected. For true HMR where
 * a working component's code changes, the browser provides no path
 * that doesn't also discard live state — see FEDERATION.md.
 *
 * @param {string} src
 * @returns {number}
 */
export function reloadRemote(src) {
  inFlight.delete(src);
  const insts = liveInstances.get(src);
  if (!insts) return 0;
  for (const inst of insts) inst.retry();
  return insts.size;
}

/** @param {LazyErrorDetail} d */
const defaultOnError = (d) => html`
  <div role="alert" style="
    padding: 0.75rem 1rem;
    border: 1px solid #c00;
    background: #fff5f5;
    color: #800;
    border-radius: 4px;
    font-family: system-ui, sans-serif;
    font-size: 0.9rem;
  ">
    <strong>Couldn't load remote component</strong><br>
    <small style="opacity:0.7">${d.src}</small><br>
    <code>${d.error?.message ?? String(d.error)}</code>
    <button @click=${d.retry} style="
      margin-top: 0.5rem;
      font: inherit;
      padding: 0.2rem 0.6rem;
      background: #c00; color: white; border: none; border-radius: 3px;
      cursor: pointer;
    ">Retry</button>
  </div>
`;

/**
 * @param {LazySpec} spec
 * @returns {CustomElementConstructor}
 */
export function lazyComponent({
  tag, src, as, fallback,
  onerror = defaultOnError,
  timeout = DEFAULT_TIMEOUT_MS,
  integrity, allowedOrigins,
}) {
  if (!as) throw new Error('lazyComponent: `as` (the real tag the remote registers) is required');
  if (as === tag) throw new Error('lazyComponent: `as` must differ from `tag` (the placeholder cannot reuse the real tag)');
  const realTag = /** @type {string} */ (as);

  class LazyElement extends HTMLElement {
    connectedCallback() {
      let set = liveInstances.get(src);
      if (!set) { set = new Set(); liveInstances.set(src, set); }
      set.add(/** @type {any} */ (this));
      this.#mount();
    }

    /**
     * Retry the import. Clears the shared in-flight cache so a new
     * import is kicked off rather than reusing the previous failure.
     */
    retry() {
      inFlight.delete(src);
      this.#mount();
    }

    #mount() {
      // Render the (possibly user-provided) fallback.
      this.replaceChildren();
      if (fallback) {
        const out = fallback();
        if (out && typeof (/** @type {any} */ (out).nodeType) === 'number') {
          this.append(/** @type {Node} */ (out));
        } else if (out) {
          litRender(/** @type {any} */ (out), this);
        }
      }

      // SSR: don't kick off the import. The client will load the
      // remote on hydration; the server emits the placeholder element
      // with whatever attributes it has, and the client takes over.
      if (/** @type {any} */ (globalThis).__salmo_ssr__) return;

      let importP = inFlight.get(src);
      if (!importP) {
        importP = verifiedImport(src, { integrity, allowedOrigins });
        inFlight.set(src, importP);
      }

      // Race the import against a configurable timeout. A hung CDN
      // would otherwise leave the placeholder visible forever.
      // We attach a no-op .catch to importP so that if the timeout
      // wins and importP later rejects, the rejection isn't surfaced
      // as an unhandledrejection — the LazyElement already gave up.
      if (timeout > 0) importP.catch(() => {});

      const racers = [importP];
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timer = null;
      if (timeout > 0) {
        racers.push(new Promise((_, rej) => {
          timer = setTimeout(
            () => rej(new Error(`salmo: load timed out after ${timeout}ms`)),
            timeout,
          );
        }));
      }

      Promise.race(racers).then(
        () => {
          if (timer) clearTimeout(timer);
          if (!this.isConnected) return;
          if (!customElements.get(realTag)) {
            this.#onError(new Error(`module loaded but no element registered as <${realTag}>`));
            return;
          }
          this.replaceChildren();
          const real = document.createElement(realTag);
          for (const attr of [...this.attributes]) {
            real.setAttribute(attr.name, attr.value);
          }
          this.append(real);
        },
        (err) => {
          if (timer) clearTimeout(timer);
          this.#onError(err instanceof Error ? err : new Error(String(err)));
        },
      );
    }

    /** @param {Error} error */
    #onError(error) {
      if (!this.isConnected) return;
      this.dispatchEvent(new CustomEvent('lazy-error', {
        detail: { src, error }, bubbles: true,
      }));
      // litRender owns the host's children once we hand it the
      // template — passing the SAME host repeatedly with different
      // templates is the supported pattern. Don't manually clear
      // first; that would discard lit-html's part tree set up for
      // the fallback render and re-hydrate from scratch (works for
      // the first call, but the second call leaks state).
      const detail = { src, error, retry: () => this.retry() };
      litRender(/** @type {any} */ (onerror(detail)), this);
    }

    disconnectedCallback() {
      liveInstances.get(src)?.delete(/** @type {any} */ (this));
      while (this.firstChild) this.removeChild(this.firstChild);
    }
  }
  customElements.define(tag, LazyElement);
  registry.set(tag, { src, realTag, registeredAt: Date.now() });
  notifyRegistryChange();
  return LazyElement;
}

/** @param {string} src @param {{ integrity?: string; allowedOrigins?: string[] }} [opts] */
async function verifiedImport(src, { integrity, allowedOrigins } = {}) {
  const hasAllowlist = !!(allowedOrigins && allowedOrigins.length > 0);
  const baseHref = /** @type {any} */ (globalThis).location?.href ?? 'http://localhost/';
  const preUrl = new URL(src, baseHref);
  const canRedirect = preUrl.protocol === 'http:' || preUrl.protocol === 'https:';

  // Pre-flight origin check on the request URL. For schemes where
  // redirects are possible (http/https) it's only the first gate; we
  // re-check post-fetch below to catch a redirect from an allowed
  // origin to a hostile one. For data:/blob:/javascript: URLs there's
  // no redirect path, so the pre-flight check is authoritative.
  if (hasAllowlist) {
    if (!(/** @type {string[]} */ (allowedOrigins)).includes(preUrl.origin)) {
      throw new Error(
        `salmo: refusing to load ${src} — origin ${preUrl.origin} ` +
        `not in allowedOrigins (${(/** @type {string[]} */ (allowedOrigins)).join(', ')})`
      );
    }
  }

  // Fast path: nothing to verify post-fetch.
  //   - no integrity AND no allowlist → direct dynamic import
  //   - no integrity AND allowlist set BUT scheme can't redirect → pre-flight
  //     already settled it, direct dynamic import
  if (!integrity && (!hasAllowlist || !canRedirect)) return import(src);

  // Slow path: fetch the bytes so we can (a) verify the post-redirect
  // origin against the allowlist (http/https only), and (b) verify SRI
  // on the actual bytes. We then import the verified bytes via a blob
  // URL so what runs is exactly what we hashed/origin-checked.
  const res = await fetch(src);
  if (!res.ok) throw new Error(`salmo: fetch ${src} failed (${res.status})`);

  if (hasAllowlist && canRedirect) {
    const finalUrl = res.url;
    if (!finalUrl) {
      throw new Error(
        `salmo: refusing to load ${src} — response is opaque, ` +
        `cannot verify final origin against allowedOrigins`
      );
    }
    const finalOrigin = new URL(finalUrl).origin;
    if (!(/** @type {string[]} */ (allowedOrigins)).includes(finalOrigin)) {
      throw new Error(
        `salmo: refusing to load ${src} — redirected to ${finalOrigin}, ` +
        `not in allowedOrigins (${(/** @type {string[]} */ (allowedOrigins)).join(', ')})`
      );
    }
  }

  const buf = await res.arrayBuffer();

  if (integrity) {
    const m = /^(sha256|sha384|sha512)-(.+)$/.exec(integrity.trim());
    if (!m) throw new Error(`salmo: unsupported integrity format: ${integrity}`);
    const algoName = /** @type {'SHA-256'|'SHA-384'|'SHA-512'} */ (
      { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' }[m[1]]
    );
    const expected = m[2];
    const hashBuf = await /** @type {Crypto} */ (
      /** @type {any} */ (globalThis).crypto
    ).subtle.digest(algoName, buf);
    const actual = arrayBufferToBase64(hashBuf);
    if (actual !== expected) {
      throw new Error(
        `salmo: integrity check failed for ${src} ` +
        `(expected ${algoName.toLowerCase()}-${expected}, got ${algoName.toLowerCase()}-${actual})`
      );
    }
  }

  const blob = new Blob([buf], { type: 'text/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  // Intentionally NOT revoking the blob URL after import resolves.
  // Static imports in the loaded module are resolved at parse time so
  // revocation would be safe for them, but any dynamic `import()` inside
  // the loaded module resolves relative to its own module URL — the
  // blob URL — and would fail once the blob is gone. The memory cost
  // per loaded remote (one O(module-size) blob retained) is negligible
  // next to the loaded code itself.
  return import(blobUrl);
}

/** @param {ArrayBuffer} buf */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return /** @type {any} */ (globalThis).btoa(bin);
}
