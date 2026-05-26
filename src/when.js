// when(condFn, renderFn) — reactive conditional. Returns a function
// so html`${when(...)}` reads as "reactive interpolation," matching
// the rest of the system. The condFn runs inside an effect, so any
// signal it reads becomes a dep.
//
//   ${when(() => editingId.get() === t.id, () => html`<input class="edit">`)}
//
// More readable than the equivalent `${() => cond ? html`...` : ''}`.

/**
 * @template T
 * @param {() => unknown} condFn
 * @param {() => T} renderFn
 * @returns {() => T | null}
 */
export function when(condFn, renderFn) {
  return () => (condFn() ? renderFn() : null);
}
