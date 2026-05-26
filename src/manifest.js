// Federation manifest: a JSON file a remote serves at a known URL
// describing the components it offers, so a host can discover and
// register them without hard-coding tag names and paths.
//
// Schema:
//
//   {
//     "name": "acme-widgets",
//     "version": "1.0.0",
//     "framework": { "name": "salmo", "minVersion": "0.0.1" },
//     "components": [
//       {
//         "tag": "acme-calendar",
//         "src": "./calendar.js",
//         "integrity": "sha384-...",          // optional
//         "props": [{ "name": "date",  "type": "string" }],
//         "events": [{ "name": "select", "detail": { "iso": "string" } }]
//       }
//     ]
//   }
//
// `src` is resolved relative to the manifest URL. Each component is
// registered as `${tag}-lazy`. Per-component failures (an unsupported
// integrity format, a missing `tag`, etc.) are reported in the
// returned `results` array — they do not take the whole manifest down.

import { lazyComponent } from './lazy.js';
import { VERSION, gte } from './version.js';

/**
 * @typedef {Object} ManifestComponent
 * @property {string} tag
 * @property {string} src
 * @property {string} [integrity]
 * @property {Array<{ name: string, type?: string }>} [props]
 * @property {Array<{ name: string, detail?: any }>} [events]
 */

/**
 * @typedef {Object} Manifest
 * @property {string} name
 * @property {string} version
 * @property {{ name: string, minVersion?: string }} [framework]
 * @property {ManifestComponent[]} components
 */

/**
 * @typedef {Object} LoadResultEntry
 * @property {string} tag
 * @property {'registered' | 'skipped' | 'error'} status
 * @property {string} [reason]   For `skipped` (why) or `error` (message).
 */

/**
 * @typedef {Object} LoadResult
 * @property {Manifest} manifest
 * @property {LoadResultEntry[]} results
 */

/**
 * @typedef {Object} LoadOptions
 * @property {string[]} [allowedOrigins]
 *   Forwarded to every lazyComponent call.
 * @property {(spec: ManifestComponent, host: Manifest) => boolean} [accept]
 *   Return false to skip a component (e.g. version checks, opt-outs).
 * @property {number} [timeout]
 *   Forwarded to every lazyComponent call.
 * @property {'warn' | 'throw' | 'silent'} [onVersionMismatch]
 *   What to do if manifest.framework.minVersion is newer than ours.
 *   Default 'warn'.
 */

/**
 * @param {string} manifestUrl
 * @param {LoadOptions} [options]
 * @returns {Promise<LoadResult>}
 */
export async function loadFromManifest(manifestUrl, options = {}) {
  const res = await fetch(manifestUrl);
  if (!res.ok) {
    throw new Error(`salmo: failed to fetch manifest at ${manifestUrl} (${res.status})`);
  }
  /** @type {Manifest} */
  const manifest = await res.json();
  validateManifest(manifest, manifestUrl);

  // Version check — only meaningful if the manifest declares a
  // framework.minVersion AND it's higher than ours. Policy:
  //   throw  → fail loud at boot (recommended for production)
  //   warn   → log + continue (default; matches "best effort")
  //   silent → no-op
  const min = manifest.framework?.minVersion;
  if (min && !gte(VERSION, min)) {
    const msg =
      `salmo v${VERSION} is older than the minimum required by ` +
      `${manifest.name}@${manifest.version} (needs >= ${min}).`;
    const policy = options.onVersionMismatch ?? 'warn';
    if (policy === 'throw') throw new Error(msg);
    if (policy === 'warn') console.warn(msg);
  }

  const base = new URL(manifestUrl, /** @type {any} */ (globalThis).location?.href ?? 'http://localhost/');

  /** @type {LoadResultEntry[]} */
  const results = [];
  for (const c of manifest.components) {
    try {
      if (options.accept && !options.accept(c, manifest)) {
        results.push({ tag: c.tag, status: 'skipped', reason: 'rejected by accept()' });
        continue;
      }
      const src = new URL(c.src, base).href;
      lazyComponent({
        tag: `${c.tag}-lazy`,
        src,
        as: c.tag,
        integrity: c.integrity,
        allowedOrigins: options.allowedOrigins,
        timeout: options.timeout,
      });
      results.push({ tag: c.tag, status: 'registered' });
    } catch (err) {
      results.push({
        tag: c.tag,
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { manifest, results };
}

/**
 * @param {unknown} m
 * @param {string} url
 * @returns {asserts m is Manifest}
 */
function validateManifest(m, url) {
  if (!m || typeof m !== 'object') {
    throw new Error(`salmo: manifest at ${url} is not an object`);
  }
  const mf = /** @type {any} */ (m);
  if (typeof mf.name !== 'string' || typeof mf.version !== 'string') {
    throw new Error(`salmo: manifest at ${url} is missing required {name, version}`);
  }
  if (!Array.isArray(mf.components)) {
    throw new Error(`salmo: manifest at ${url} has no components array`);
  }
  for (const c of mf.components) {
    if (!c || typeof c.tag !== 'string' || typeof c.src !== 'string') {
      throw new Error(`salmo: manifest at ${url} has a component missing {tag, src}: ${JSON.stringify(c)}`);
    }
    if (!c.tag.includes('-')) {
      throw new Error(`salmo: manifest at ${url} has component "${c.tag}" without a hyphen — Custom Element tags must contain one`);
    }
  }
}
