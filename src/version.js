// Framework version — bumped manually. Used by manifest version
// enforcement and the devtools overlay.

export const VERSION = '0.1.0';

/**
 * Lite semver: parse dot-separated numeric parts and compare. Suffixes
 * like `-alpha` are stripped (we only do core-version checks), so
 * `gte('1.0.0-alpha', '1.0.0')` returns `true` — non-standard, but
 * adequate for the framework's "minimum required version" use case.
 * If you need full semver semantics (prerelease ordering, build
 * metadata), use a real semver library at the consumer level.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}  true iff a >= b
 */
export function gte(a, b) {
  /** @param {string} s */
  const norm = (s) => s.split('-')[0].split('.').map((/** @type {string} */ p) => Number(p) || 0);
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
