// Federation manifest: a JSON file a remote serves at a known URL
// describing the components it offers, so a host can discover and
// register them without hard-coding tag names and paths.
//
// Schema:
//
//   {
//     "name": "acme-widgets",
//     "version": "1.0.0",
//     "framework": {
//       "name": "mohsal-framework",
//       "minVersion": "0.0.1"
//     },
//     "components": [
//       {
//         "tag": "acme-calendar",
//         "src": "./calendar.js",
//         "props": [{ "name": "date",  "type": "string" }],
//         "events": [{ "name": "select", "detail": { "iso": "string" } }]
//       }
//     ]
//   }
//
// `src` is resolved relative to the manifest URL. `lazyComponent` is
// registered per component with a deterministic placeholder tag
// (`${tag}-lazy`) so usage in templates is:
//
//   <acme-calendar-lazy></acme-calendar-lazy>
//
// The integrity + allowedOrigins options passed to `loadFromManifest`
// are forwarded to every lazyComponent — keeping the supply-chain
// guarantees regardless of how many components the manifest lists.

import { lazyComponent } from './lazy.js';

/**
 * @typedef {Object} ManifestComponent
 * @property {string} tag
 * @property {string} src           Relative or absolute URL of the module.
 * @property {string} [integrity]   Optional SRI hash for this component's module.
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
 * @typedef {Object} LoadOptions
 * @property {string[]} [allowedOrigins]
 *   Forwarded to every lazyComponent call.  Refuses to load any
 *   component whose `src` resolves outside this list.
 * @property {(spec: ManifestComponent, host: Manifest) => boolean} [accept]
 *   Optional gate — return false to skip a component (e.g. version
 *   incompatibility, missing feature, opt-out).
 */

/**
 * Fetch a federation manifest and register every component as a
 * lazyComponent. Returns the parsed manifest so callers can inspect it.
 *
 * @param {string} manifestUrl
 * @param {LoadOptions} [options]
 * @returns {Promise<Manifest>}
 */
export async function loadFromManifest(manifestUrl, options = {}) {
  const res = await fetch(manifestUrl);
  if (!res.ok) {
    throw new Error(`mohsal-framework: failed to fetch manifest at ${manifestUrl} (${res.status})`);
  }
  /** @type {Manifest} */
  const manifest = await res.json();
  validateManifest(manifest, manifestUrl);

  const base = new URL(manifestUrl, /** @type {any} */ (globalThis).location?.href ?? 'http://localhost/');

  for (const c of manifest.components) {
    if (options.accept && !options.accept(c, manifest)) continue;
    const src = new URL(c.src, base).href;
    lazyComponent({
      tag: `${c.tag}-lazy`,
      src,
      as: c.tag,
      integrity: c.integrity,
      allowedOrigins: options.allowedOrigins,
    });
  }
  return manifest;
}

/**
 * @param {unknown} m
 * @param {string} url
 * @returns {asserts m is Manifest}
 */
function validateManifest(m, url) {
  if (!m || typeof m !== 'object') {
    throw new Error(`mohsal-framework: manifest at ${url} is not an object`);
  }
  const mf = /** @type {any} */ (m);
  if (typeof mf.name !== 'string' || typeof mf.version !== 'string') {
    throw new Error(`mohsal-framework: manifest at ${url} is missing required {name, version}`);
  }
  if (!Array.isArray(mf.components)) {
    throw new Error(`mohsal-framework: manifest at ${url} has no components array`);
  }
  for (const c of mf.components) {
    if (!c || typeof c.tag !== 'string' || typeof c.src !== 'string') {
      throw new Error(`mohsal-framework: manifest at ${url} has a component missing {tag, src}: ${JSON.stringify(c)}`);
    }
    if (!c.tag.includes('-')) {
      throw new Error(`mohsal-framework: manifest at ${url} has component "${c.tag}" without a hyphen — Custom Element tags must contain one`);
    }
  }
}
