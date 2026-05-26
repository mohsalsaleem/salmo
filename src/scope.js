// Reactive scopes carry an AbortSignal that owns the lifetime of any
// effects or event listeners created inside them. Custom Elements set
// up a scope in connectedCallback and abort it in disconnectedCallback.

let currentScope = null;

export function getCurrentScope() { return currentScope; }

export function withScope(scope, fn) {
  const prev = currentScope;
  currentScope = scope;
  try { return fn(); }
  finally { currentScope = prev; }
}
