// html`...` — tagged template that parses through the platform's
// `<template>` element and binds reactive holes via effect().
//
// Interpolation kinds:
//   ${'static'}                primitive    → text node
//   ${signal}                  Signal       → reactive text
//   ${() => expr}              function     → reactive text
//   ${arrayOfNodes}            array        → flattened
//   <a href=${...}>            attribute    → reactive attr
//   <button onclick=${fn}>     event        → addEventListener
//
// Every effect and listener created here picks up the surrounding
// AbortSignal from withScope(), so component disconnects clean up
// the whole subtree by aborting one controller.

import { Signal } from './signal.js';
import { effect } from './effect.js';
import { getCurrentScope } from './scope.js';

/** @typedef {import('./signal.js').Signal extends infer S ? unknown : unknown} _signalImport */

/**
 * @typedef {unknown} Hole
 *   A value interpolated into an html template. Functions and Signal
 *   instances become reactive; other values render as static content.
 */

/**
 * @typedef {(...args: unknown[]) => void} Deferred
 */

// Marker is a plain-ASCII token so the HTML parser treats it as ordinary
// text/attribute content (avoids parser quirks around control chars).
const MARK_PREFIX = '__mohsal_mark_';
const MARK_RE = /__mohsal_mark_(\d+)__/g;
const MARK_INCLUDES = MARK_PREFIX;

/**
 * Tagged template that produces a reactive DocumentFragment.
 *
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {DocumentFragment}
 */
export function html(strings, ...values) {
  const src = strings.reduce(
    (s, str, i) => s + str + (i < values.length ? `${MARK_PREFIX}${i}__` : ''),
    ''
  );
  const tpl = /** @type {HTMLTemplateElement} */ (document.createElement('template'));
  tpl.innerHTML = src;
  // <template>.content lives in a separate inert document where Custom
  // Elements stay in "pending" state — `customElements.upgrade()`
  // doesn't reach across document boundaries. importNode clones into
  // the main document, which DOES upgrade custom elements, so
  // .prop=${} bindings in the deferred phase below go through the
  // upgraded setter rather than landing as plain expando properties.
  const frag = typeof document.importNode === 'function'
    ? document.importNode(tpl.content, true)
    : tpl.content;
  /** @type {Array<() => void>} */
  const deferred = [];

  bindAttributes(frag, values, deferred);
  bindTextHoles(frag, values, deferred);

  // Run effects only after the fragment is fully constructed so that
  // reactive holes have a parent to operate against.
  deferred.forEach((fn) => fn());
  return frag;
}

/**
 * @param {DocumentFragment} frag
 * @param {unknown[]} values
 * @param {Array<() => void>} deferred
 */
function bindAttributes(frag, values, deferred) {
  for (const el of frag.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (!attr.value.includes(MARK_INCLUDES)) continue;
      const matches = [...attr.value.matchAll(MARK_RE)];
      const isWhole = matches.length === 1 && matches[0][0] === attr.value;

      if (attr.name.startsWith('on') && isWhole) {
        const handler = /** @type {EventListener} */ (values[+matches[0][1]]);
        const eventName = attr.name.slice(2);
        el.removeAttribute(attr.name);
        el.addEventListener(eventName, handler);
        // Real browsers support addEventListener({signal}) for cleanup,
        // but not every DOM impl does — do it explicitly so it works
        // both in happy-dom tests and the browser.
        const signal = getCurrentScope()?.signal;
        signal?.addEventListener(
          'abort',
          () => el.removeEventListener(eventName, handler),
          { once: true }
        );
        continue;
      }

      // .propName=${value} — bind to the DOM property, not the HTML
      // attribute. Needed for things HTML attributes can't express:
      // `checked` toggling, `value` updating after first paint, anything
      // where the parser-time attribute and the live property diverge.
      if (attr.name.startsWith('.') && isWhole) {
        const propName = attr.name.slice(1);
        const idx = +matches[0][1];
        el.removeAttribute(attr.name);
        deferred.push(() => effect(() => {
          /** @type {any} */ (el)[propName] = readValue(values[idx]);
        }));
        continue;
      }

      // class:name=${signal} — reactively toggle a single class.
      // Coexists with a static `class="..."` attribute on the same
      // element; this never overwrites that.
      if (attr.name.startsWith('class:') && isWhole) {
        const className = attr.name.slice('class:'.length);
        const idx = +matches[0][1];
        el.removeAttribute(attr.name);
        deferred.push(() => effect(() => {
          el.classList.toggle(className, !!readValue(values[idx]));
        }));
        continue;
      }

      // :propName=${signal} — two-way bind a DOM property to a
      // Signal.State. Equivalent to writing the property binding AND
      // the matching input/change handler yourself.
      if (attr.name.startsWith(':') && isWhole) {
        const propName = attr.name.slice(1);
        const idx = +matches[0][1];
        const signal = /** @type {{ set(v: unknown): void; get(): unknown }} */ (
          /** @type {unknown} */ (values[idx])
        );
        el.removeAttribute(attr.name);
        deferred.push(() => effect(() => {
          /** @type {any} */ (el)[propName] = readValue(signal);
        }));
        const eventName = propName === 'checked' || propName === 'selected' ? 'change' : 'input';
        const handler = (/** @type {Event} */ e) => {
          signal.set(/** @type {any} */ (e.target)[propName]);
        };
        el.addEventListener(eventName, handler);
        const sig = getCurrentScope()?.signal;
        sig?.addEventListener(
          'abort',
          () => el.removeEventListener(eventName, handler),
          { once: true }
        );
        continue;
      }

      // ref=${cb} — runs once in the next microtask, by which time the
      // surrounding fragment has been inserted into the DOM. cb may
      // return a cleanup function that fires when the surrounding
      // scope's AbortSignal aborts (e.g. component disconnect).
      if (attr.name === 'ref' && isWhole) {
        const cb = /** @type {(el: Element) => (() => void) | void} */ (
          values[+matches[0][1]]
        );
        el.removeAttribute(attr.name);
        const signal = getCurrentScope()?.signal;
        queueMicrotask(() => {
          if (signal?.aborted) return;
          const cleanup = cb(el);
          if (typeof cleanup === 'function') {
            signal?.addEventListener('abort', cleanup, { once: true });
          }
        });
        continue;
      }

      const tmpl = attr.value;
      const name = attr.name;
      deferred.push(() => effect(() => {
        el.setAttribute(name, tmpl.replace(MARK_RE, (_, i) => String(readValue(values[+i]))));
      }));
    }
  }
}

/**
 * @param {DocumentFragment} frag
 * @param {unknown[]} values
 * @param {Array<() => void>} deferred
 */
function bindTextHoles(frag, values, deferred) {
  // happy-dom's TreeWalker doesn't honor SHOW_TEXT; walk everything
  // and filter ourselves. SHOW_ALL works correctly across implementations.
  /** @type {Text[]} */
  const texts = [];
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_ALL);
  for (let n; (n = walker.nextNode()); ) {
    if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').includes(MARK_INCLUDES)) {
      texts.push(/** @type {Text} */ (n));
    }
  }
  for (const tn of texts) {
    const parts = (tn.textContent ?? '').split(MARK_RE);
    /** @type {Node[]} */
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        if (parts[i]) out.push(document.createTextNode(parts[i]));
        continue;
      }
      const v = values[+parts[i]];
      if (typeof v === 'function' || isSignal(v)) {
        const anchor = document.createComment('');
        out.push(anchor);
        const read = /** @type {() => unknown} */ (
          typeof v === 'function' ? v : () => /** @type {{ get(): unknown }} */ (v).get()
        );
        /** @type {Node[]} */
        let curr = [];
        deferred.push(() => effect(() => {
          const next = toNodes(read());
          const p = /** @type {Node & { insertBefore: Function; removeChild: Function; }} */ (anchor.parentNode);
          const nextSet = new Set(next);
          // Walk `next` back-to-front and only insert when a node is
          // actually out of place — same-position insertBefore calls
          // can blur a focused descendant in some DOM impls (happy-dom)
          // and are pointless work in real ones.
          /** @type {Node} */
          let cursor = anchor;
          for (let i = next.length - 1; i >= 0; i--) {
            const n = next[i];
            if (n.nextSibling !== cursor || n.parentNode !== p) {
              p.insertBefore(n, cursor);
            }
            cursor = n;
          }
          for (const n of curr) {
            if (!nextSet.has(n) && n.parentNode === p) p.removeChild(n);
          }
          curr = next;
        }));
      } else {
        out.push(...toNodes(v));
      }
    }
    tn.replaceWith(...out);
  }
}

/**
 * @param {unknown} v
 * @returns {unknown}
 */
function readValue(v) {
  if (typeof v === 'function') return v();
  if (isSignal(v)) return /** @type {{ get(): unknown }} */ (v).get();
  return v;
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isSignal(v) {
  return v instanceof Signal.State || v instanceof Signal.Computed;
}

/**
 * @param {unknown} v
 * @returns {Node[]}
 */
function toNodes(v) {
  if (v == null || v === false) return [];
  // Duck-type by nodeType — instanceof Node/DocumentFragment is unreliable
  // across DOM impls (happy-dom uses different class identities).
  const n = /** @type {{ nodeType?: number; childNodes?: NodeListOf<Node> }} */ (v);
  if (n.nodeType === 11) return [...(n.childNodes ?? [])]; // DocumentFragment
  if (typeof n.nodeType === 'number') return [/** @type {Node} */ (v)];
  if (Array.isArray(v)) return v.flatMap(toNodes);
  return [document.createTextNode(String(v))];
}
