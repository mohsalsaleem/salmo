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

// Marker is a plain-ASCII token so the HTML parser treats it as ordinary
// text/attribute content (avoids parser quirks around control chars).
const MARK_PREFIX = '__mohsal_mark_';
const MARK_RE = /__mohsal_mark_(\d+)__/g;
const MARK_INCLUDES = MARK_PREFIX;

export function html(strings, ...values) {
  const src = strings.reduce(
    (s, str, i) => s + str + (i < values.length ? `${MARK_PREFIX}${i}__` : ''),
    ''
  );
  const tpl = document.createElement('template');
  tpl.innerHTML = src;
  const frag = tpl.content;
  const deferred = [];

  bindAttributes(frag, values, deferred);
  bindTextHoles(frag, values, deferred);

  // Run effects only after the fragment is fully constructed so that
  // reactive holes have a parent to operate against.
  deferred.forEach((fn) => fn());
  return frag;
}

function bindAttributes(frag, values, deferred) {
  for (const el of frag.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (!attr.value.includes(MARK_INCLUDES)) continue;
      const matches = [...attr.value.matchAll(MARK_RE)];
      const isWhole = matches.length === 1 && matches[0][0] === attr.value;

      if (attr.name.startsWith('on') && isWhole) {
        const handler = values[+matches[0][1]];
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

      const tmpl = attr.value;
      const name = attr.name;
      deferred.push(() => effect(() => {
        el.setAttribute(name, tmpl.replace(MARK_RE, (_, i) => readValue(values[+i])));
      }));
    }
  }
}

function bindTextHoles(frag, values, deferred) {
  // happy-dom's TreeWalker doesn't honor SHOW_TEXT; walk everything
  // and filter ourselves. SHOW_ALL works correctly across implementations.
  const texts = [];
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_ALL);
  for (let n; (n = walker.nextNode()); ) {
    if (n.nodeType === Node.TEXT_NODE && n.textContent.includes(MARK_INCLUDES)) {
      texts.push(n);
    }
  }
  for (const tn of texts) {
    const parts = tn.textContent.split(MARK_RE);
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
        const read = typeof v === 'function' ? v : () => v.get();
        let curr = [];
        deferred.push(() => effect(() => {
          const next = toNodes(read());
          const p = anchor.parentNode;
          for (const n of curr) p.removeChild(n);
          for (const n of next) p.insertBefore(n, anchor);
          curr = next;
        }));
      } else {
        out.push(...toNodes(v));
      }
    }
    tn.replaceWith(...out);
  }
}

function readValue(v) {
  if (typeof v === 'function') return v();
  if (isSignal(v)) return v.get();
  return v;
}

function isSignal(v) {
  return v instanceof Signal.State || v instanceof Signal.Computed;
}

function toNodes(v) {
  if (v == null || v === false) return [];
  // Duck-type by nodeType — instanceof Node/DocumentFragment is unreliable
  // across DOM impls (happy-dom uses different class identities).
  if (v?.nodeType === 11) return [...v.childNodes]; // DocumentFragment
  if (typeof v?.nodeType === 'number') return [v];
  if (Array.isArray(v)) return v.flatMap(toNodes);
  return [document.createTextNode(String(v))];
}
