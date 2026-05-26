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
 * Sync snapshot only. Microtasks queued during the initial render (e.g.
 * any reactive re-render triggered by a signal mutated inside setup)
 * have not yet run when `outerHTML` is read. Components whose first
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
  const out = el.outerHTML;
  document.body.removeChild(el);
  return out;
}
