// lazyComponent({ tag, src, as, fallback, integrity, allowedOrigins })
// — federation's loading primitive.
//
// Defines a Custom Element under `tag` that, on first connect,
// dynamically import()s `src` and then mounts the *real* component
// (registered by the remote module under `as`) inside itself,
// forwarding the placeholder's attributes. Loading is a first-class
// state, not a try/catch around `await import()`.
//
//   lazyComponent({
//     tag: 'acme-calendar-lazy',
//     src: 'https://acme.example.com/calendar.js',
//     as: 'acme-calendar',
//     integrity: 'sha384-...',                       // Phase 3
//     allowedOrigins: ['https://acme.example.com'],  // Phase 3
//     fallback: () => html`<p>Loading…</p>`,
//   });
//
// Trust model: loading a remote .js runs that code with your origin's
// privileges. There is no sandboxing path that preserves shared signals
// — iframes lose the bridge, Realms isn't here. The SRI + origin
// allowlist below close the *supply-chain* hole (the URL serving you
// something different than you expected); they do NOT sandbox the
// remote once it has loaded. See SECURITY.md.

import { render as litRender } from '../vendor/lit-html/lit-html.js';

/** @typedef {Object} LazySpec
 *  @property {string} tag              Tag the placeholder registers under.
 *  @property {string} src              Module URL to import().
 *  @property {string} [as]             Real tag the remote registers.
 *  @property {() => Node | DocumentFragment} [fallback] Placeholder while loading / on error.
 *  @property {string} [integrity]      Subresource Integrity, e.g. "sha384-abc...".
 *  @property {string[]} [allowedOrigins] Refuse to load from any other origin.
 */

/** Shared promises so concurrent lazy elements pointing at the same src
 *  do not trigger N parallel imports. @type {Map<string, Promise<unknown>>} */
const inFlight = new Map();

/**
 * @param {LazySpec} spec
 */
export function lazyComponent({ tag, src, as, fallback, integrity, allowedOrigins }) {
  if (!as) throw new Error('lazyComponent: `as` (the real tag the remote registers) is required');
  if (as === tag) throw new Error('lazyComponent: `as` must differ from `tag` (the placeholder cannot reuse the real tag)');
  const realTag = /** @type {string} */ (as);

  class LazyElement extends HTMLElement {
    connectedCallback() {
      if (fallback) {
        const out = fallback();
        // Accept either a DOM node or a lit-html TemplateResult.
        if (out && typeof (/** @type {any} */ (out).nodeType) === 'number') {
          this.append(/** @type {Node} */ (out));
        } else if (out) {
          litRender(/** @type {any} */ (out), this);
        }
      }

      let p = inFlight.get(src);
      if (!p) {
        p = verifiedImport(src, { integrity, allowedOrigins });
        inFlight.set(src, p);
      }

      p.then(
        () => {
          if (!this.isConnected) return;
          if (!customElements.get(realTag)) {
            this.dispatchEvent(new CustomEvent('lazy-error', {
              detail: { src, error: new Error(`module loaded but no element registered as <${realTag}>`) },
              bubbles: true,
            }));
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
          if (!this.isConnected) return;
          this.dispatchEvent(new CustomEvent('lazy-error', {
            detail: { src, error: err }, bubbles: true,
          }));
        },
      );
    }

    disconnectedCallback() {
      while (this.firstChild) this.removeChild(this.firstChild);
    }
  }
  customElements.define(tag, LazyElement);
  return LazyElement;
}

/**
 * Import a module URL with optional origin allowlisting and SRI hash
 * verification. With neither, this is a plain `import()`. With either,
 * we fetch the bytes ourselves, check them, and only then hand them to
 * the module loader as a blob URL — so a hijacked CDN can't ship you
 * code that imports normally.
 *
 * Limitation: blob-URL modules can't resolve relative imports (`./foo`)
 * inside the remote because the blob URL has no meaningful base. Bare
 * specifiers (resolved via the page's import map) work fine. For
 * SRI-verified remotes, ship single-file bundles.
 *
 * @param {string} src
 * @param {{ integrity?: string; allowedOrigins?: string[] }} opts
 * @returns {Promise<unknown>}
 */
async function verifiedImport(src, { integrity, allowedOrigins } = {}) {
  if (allowedOrigins && allowedOrigins.length > 0) {
    const url = new URL(src, /** @type {any} */ (globalThis).location?.href ?? 'http://localhost/');
    if (!allowedOrigins.includes(url.origin)) {
      throw new Error(
        `mohsal-framework: refusing to load ${src} — origin ${url.origin} ` +
        `not in allowedOrigins (${allowedOrigins.join(', ')})`
      );
    }
  }
  if (!integrity) return import(src);

  const m = /^(sha256|sha384|sha512)-(.+)$/.exec(integrity.trim());
  if (!m) {
    throw new Error(`mohsal-framework: unsupported integrity format: ${integrity}`);
  }
  const algoName = /** @type {'SHA-256'|'SHA-384'|'SHA-512'} */ (
    { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' }[m[1]]
  );
  const expected = m[2];

  const res = await fetch(src);
  if (!res.ok) throw new Error(`mohsal-framework: fetch ${src} failed (${res.status})`);
  const buf = await res.arrayBuffer();
  const hashBuf = await /** @type {Crypto} */ (
    /** @type {any} */ (globalThis).crypto
  ).subtle.digest(algoName, buf);
  const actual = arrayBufferToBase64(hashBuf);
  if (actual !== expected) {
    throw new Error(
      `mohsal-framework: integrity check failed for ${src} ` +
      `(expected ${algoName.toLowerCase()}-${expected}, got ${algoName.toLowerCase()}-${actual})`
    );
  }
  const blob = new Blob([buf], { type: 'text/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ blobUrl);
  } finally {
    // Defer revoke so the module's own dynamic imports (if any) can
    // still resolve against the blob URL during the same task.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
  }
}

/** @param {ArrayBuffer} buf */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return /** @type {any} */ (globalThis).btoa(bin);
}
