// Trusted Types integration.
//
// When a page enables Trusted Types via CSP (e.g.
// `Content-Security-Policy: require-trusted-types-for 'script';
//  trusted-types mohsal-framework`), the browser refuses strings at
// dangerous DOM sinks — innerHTML, srcdoc, script.src, eval, etc. The
// only way to satisfy the browser is to assign a typed object produced
// by a registered policy.
//
// Our policy is named "mohsal-framework". It passes HTML through
// unchanged (the framework owns its templates and already runs the
// safe-default checks in html.js) and refuses script / scriptURL
// (the framework never generates either — script execution comes
// from user-author files that the host loads directly).
//
// In environments where Trusted Types isn't present (most browsers
// out of the box, all Node) every helper is a no-op: it returns the
// raw string unchanged. The framework's behaviour is identical; we
// just don't add the layer.

/** @type {any} */
let _policy = null;
/** Memo: have we already tried to create the policy in this realm? */
let _tried = false;

/**
 * Lazily create and cache the Trusted Types policy. Returns null when
 * Trusted Types isn't available, or when policy creation is forbidden
 * (e.g. the CSP didn't allow our name) — callers fall through to plain
 * string assignment, which the browser will then refuse with a clearer
 * error than anything we could synthesise.
 */
export function getPolicy() {
  if (_tried) return _policy;
  _tried = true;
  /** @type {any} */
  const tt = /** @type {any} */ (globalThis).trustedTypes;
  if (!tt || typeof tt.createPolicy !== 'function') return null;
  try {
    _policy = tt.createPolicy('mohsal-framework', {
      createHTML: (/** @type {string} */ s) => s,
      createScript: () => {
        throw new Error(
          "mohsal-framework's policy does not produce TrustedScript; " +
          "the framework never generates script bodies."
        );
      },
      createScriptURL: () => {
        throw new Error(
          "mohsal-framework's policy does not produce TrustedScriptURL; " +
          "import remote modules via lazyComponent({ src }) instead, " +
          "which goes through standard module loading."
        );
      },
    });
  } catch {
    _policy = null;
  }
  return _policy;
}

/**
 * Convert a string into TrustedHTML if Trusted Types is active.
 * Returns the original string otherwise. Safe to use at any sink that
 * accepts both strings and TrustedHTML.
 *
 * @param {string} s
 * @returns {string}
 */
export function trustHTML(s) {
  const p = getPolicy();
  return p ? p.createHTML(s) : s;
}
