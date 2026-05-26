// repeat(source, keyFn, renderFn) — keyed list rendering.
//
// Without this, the parent template re-runs `items.map(...)` on every
// change and the surrounding text-hole effect tears down every <li>
// and rebuilds it from scratch — destroying any DOM state inside
// (focus, scroll position, partially-typed input). repeat() keeps a
// Map<key, {nodes, controller}> so unchanged keys keep their nodes,
// and each per-item scope is aborted only when the key disappears.

import { withScope, getCurrentScope } from './scope.js';

/**
 * @template T, K
 * @param {{ get(): T[] } | (() => T[])} source
 * @param {(item: T, index: number) => K} keyFn
 * @param {(item: T, index: number) => DocumentFragment | Node} renderFn
 * @returns {() => Node[]}
 */
export function repeat(source, keyFn, renderFn) {
  /** @type {Map<K, { nodes: Node[]; controller: AbortController }>} */
  const byKey = new Map();
  // Captured at creation time — when the surrounding component's scope
  // aborts, every per-item controller has to abort too so effects and
  // listeners inside item templates don't leak.
  const parentSignal = getCurrentScope()?.signal;

  return () => {
    const items = typeof source === 'function' ? source() : source.get();
    /** @type {Node[]} */
    const out = [];
    /** @type {Set<K>} */
    const seen = new Set();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = keyFn(item, i);
      seen.add(key);

      let entry = byKey.get(key);
      if (!entry) {
        const controller = new AbortController();
        parentSignal?.addEventListener('abort', () => controller.abort(), { once: true });
        /** @type {Node[]} */
        let nodes = [];
        withScope({ signal: controller.signal }, () => {
          const result = renderFn(item, i);
          // DocumentFragment unwraps to its children; any Node passes through.
          if (/** @type {any} */ (result)?.nodeType === 11) {
            nodes = [.../** @type {DocumentFragment} */ (result).childNodes];
          } else {
            nodes = [/** @type {Node} */ (result)];
          }
        });
        entry = { nodes, controller };
        byKey.set(key, entry);
      }
      out.push(...entry.nodes);
    }

    for (const [key, entry] of byKey) {
      if (!seen.has(key)) {
        entry.controller.abort();
        byKey.delete(key);
      }
    }
    return out;
  };
}
