// Reactive scopes carry an AbortSignal that owns the lifetime of any
// effects or event listeners created inside them. Custom Elements set
// up a scope in connectedCallback and abort it in disconnectedCallback.

/**
 * @typedef {Object} Scope
 * @property {AbortSignal} [signal]
 */

/** @type {Scope | null} */
let currentScope = null;

/** @returns {Scope | null} */
export function getCurrentScope() { return currentScope; }

/**
 * Run `fn` with the given scope set as ambient. Effects and event
 * listeners created inside pick up `scope.signal` for disposal.
 *
 * @template T
 * @param {Scope} scope
 * @param {() => T} fn
 * @returns {T}
 */
export function withScope(scope, fn) {
  const prev = currentScope;
  currentScope = scope;
  try { return fn(); }
  finally { currentScope = prev; }
}
