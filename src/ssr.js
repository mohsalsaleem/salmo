// Server-side rendering. The whole framework runs unchanged on Node —
// it only needs a DOM. happy-dom installs document/window/HTMLElement/
// customElements as globals, after which `defineComponent` /
// `customElements.define` / `host.append` all work as in the browser.
//
//   import { setupDOM } from 'salmo/ssr';
//   await setupDOM();
//   const { defineComponent, html } = await import('salmo');
//   defineComponent({ tag: 'x-hi', setup: () => html`<p>hi</p>` });
//   const el = document.createElement('x-hi');
//   document.body.append(el);
//   console.log(el.outerHTML); // → '<x-hi><p>hi</p></x-hi>'
//
// You can also pass `renderToString(thunk)` a function that takes
// `document` and returns an Element — it gives you back the HTML.
// Importing this file is a side-effect-free no-op in the browser.

/**
 * Install document/window/customElements/etc. as globals using happy-dom.
 * Returns the Window for explicit teardown if you need it (uncommon).
 * Subsequent calls are no-ops.
 *
 * @returns {Promise<unknown>}
 */
export async function setupDOM() {
  /** @type {any} */
  const g = globalThis;
  if (g.document && g.customElements) return g.window; // already set up

  // happy-dom is an optional peer dependency — only required when SSRing
  // on Node. Wrap the dynamic import so consumers get an actionable
  // error rather than a generic ERR_MODULE_NOT_FOUND.
  /** @type {any} */ let mod;
  try {
    mod = await import('happy-dom');
  } catch (err) {
    throw new Error(
      "salmo/ssr requires happy-dom to install browser globals on Node. " +
      "Install it as a peer: `npm install happy-dom`. " +
      `(underlying error: ${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const { Window } = mod;
  const window = new Window();
  for (const key of [
    'window', 'document', 'navigator', 'location',
    'HTMLElement', 'HTMLTemplateElement', 'HTMLInputElement',
    'Node', 'NodeFilter', 'DocumentFragment', 'Element',
    'Event', 'CustomEvent', 'EventTarget',
    'customElements', 'AbortController', 'AbortSignal',
    'Text', 'Comment',
  ]) {
    if (g[key] === undefined && /** @type {any} */ (window)[key] !== undefined) {
      g[key] = /** @type {any} */ (window)[key];
    }
  }
  // Mark this realm as SSR so lazyComponent skips its dynamic import
  // (the remote loads on the client during hydration; the server just
  // emits the placeholder element).
  /** @type {any} */ (globalThis).__salmo_ssr__ = true;
  return window;
}

/**
 * Render a top-level Custom Element tag to its serialized HTML string,
 * having run connectedCallback (so any html`` content is materialised).
 *
 * Open shadow roots are emitted as declarative shadow DOM —
 * `<template shadowrootmode="open">…</template>` — so a browser that
 * supports DSD attaches the shadow root before any JS runs (paint
 * styled, scoped content immediately). The client's connectedCallback
 * then reuses the existing shadow root; the first reactive render
 * replaces the SSR'd shadow content with the live template.
 *
 * Sync snapshot only. Microtasks queued during the initial render (e.g.
 * any reactive re-render triggered by a signal mutated inside setup)
 * have not yet run when serialization happens. Components whose first
 * render is synchronous render fully; async directives or post-setup
 * signal updates will not appear in the output.
 *
 * Caller is responsible for defining the component before calling this.
 *
 * @param {string} tag
 * @param {Record<string, unknown>} [props]
 * @returns {string}
 */
export function renderToString(tag, props = {}) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    /** @type {any} */ (el)[k] = v;
  }
  document.body.appendChild(el);
  const out = serializeNode(el);
  document.body.removeChild(el);
  return out;
}

// Tiny DOM serializer with declarative shadow DOM support. Replaces
// outerHTML because outerHTML does not include shadow root content,
// and there's no portable cross-runtime way to ask happy-dom for a
// DSD-aware serialization. Scope: HTML elements + text + comments +
// open shadow roots. Closed shadow roots are not serializable per the
// DSD spec, so we skip them (matches browser behaviour).

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** @param {string} v */
function escapeAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
/** @param {string} v */
function escapeText(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {any} el @returns {string} */
function serializeElement(el) {
  const tagName = String(el.tagName).toLowerCase();
  let attrs = '';
  for (const attr of el.attributes) {
    attrs += attr.value === ''
      ? ` ${attr.name}`
      : ` ${attr.name}="${escapeAttr(attr.value)}"`;
  }
  if (VOID_ELEMENTS.has(tagName)) return `<${tagName}${attrs}>`;

  let inner = '';
  const sr = el.shadowRoot;
  if (sr && sr.mode === 'open') {
    inner += `<template shadowrootmode="open">`;
    for (const child of sr.childNodes) inner += serializeNode(child);
    inner += `</template>`;
  }
  for (const child of el.childNodes) inner += serializeNode(child);
  return `<${tagName}${attrs}>${inner}</${tagName}>`;
}

/** @param {any} node @returns {string} */
function serializeNode(node) {
  switch (node.nodeType) {
    case 1: return serializeElement(node);                          // Element
    case 3: return escapeText(node.textContent ?? '');              // Text
    case 8: return `<!--${node.textContent ?? ''}-->`;              // Comment
    case 11: {                                                      // DocumentFragment
      let s = '';
      for (const child of node.childNodes) s += serializeNode(child);
      return s;
    }
    default: return '';
  }
}
