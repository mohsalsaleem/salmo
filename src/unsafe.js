// unsafe(value) — opt-in marker. Wrap a value in unsafe() to bypass
// the framework's protections at sinks that would otherwise sanitize
// or refuse (innerHTML/outerHTML/srcdoc property writes, dangerous
// URL schemes in href/src/etc.).
//
// The name is deliberately loud: if you're typing `unsafe(` you're
// telling future-you and your reviewer that you understand the value
// is trusted and the framework should step out of the way.
//
//   html`<div .innerHTML=${unsafe(serverRenderedHTML)}></div>`
//   html`<a href=${unsafe('javascript:doThing()')}>x</a>`

const UNSAFE = Symbol.for('mohsal-framework.unsafe');

/**
 * @template T
 * @param {T} value
 * @returns {{ value: T }}
 */
export function unsafe(value) {
  /** @type {any} */
  const o = { value };
  o[UNSAFE] = true;
  return o;
}

/**
 * Returns { trusted, value }. Trusted means the caller wrapped in unsafe().
 * @param {unknown} v
 * @returns {{ trusted: boolean; value: unknown }}
 */
export function unwrapTrust(v) {
  if (v && typeof v === 'object' && /** @type {any} */ (v)[UNSAFE]) {
    return { trusted: true, value: /** @type {any} */ (v).value };
  }
  return { trusted: false, value: v };
}
