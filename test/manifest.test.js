import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFromManifest } from '../src/manifest.js';

const tick = () => new Promise((r) => setTimeout(r, 10));

/** @type {any} */
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

/** Stub fetch with a per-URL response map. */
function stubFetch(/** @type {Record<string, unknown>} */ map) {
  globalThis.fetch = vi.fn(async (/** @type {any} */ url) => {
    const key = typeof url === 'string' ? url : url.url;
    if (!(key in map)) return /** @type {any} */ ({ ok: false, status: 404 });
    const body = map[key];
    if (body instanceof Error) throw body;
    return /** @type {any} */ ({
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
    });
  });
}

describe('loadFromManifest', () => {
  it('fetches a manifest and registers lazyComponents for each entry', async () => {
    stubFetch({
      'http://x/manifest.json': {
        name: 'acme', version: '1.0.0',
        components: [
          { tag: 'acme-a', src: './a.js' },
          { tag: 'acme-b', src: './b.js' },
        ],
      },
    });
    const m = await loadFromManifest('http://x/manifest.json');
    expect(m.name).toBe('acme');
    expect(customElements.get('acme-a-lazy')).toBeDefined();
    expect(customElements.get('acme-b-lazy')).toBeDefined();
  });

  it('resolves component src relative to the manifest URL', async () => {
    stubFetch({
      'http://x/sub/manifest.json': {
        name: 'rel', version: '1.0.0',
        components: [{ tag: 'rel-card', src: './widgets/card.js' }],
      },
    });
    await loadFromManifest('http://x/sub/manifest.json');
    expect(customElements.get('rel-card-lazy')).toBeDefined();
  });

  it('rejects when fetch fails', async () => {
    stubFetch({});
    await expect(loadFromManifest('http://x/nope.json')).rejects.toThrow(/failed to fetch manifest/);
  });

  it('rejects a manifest missing required fields', async () => {
    stubFetch({
      'http://x/bad.json': { components: [] },
    });
    await expect(loadFromManifest('http://x/bad.json')).rejects.toThrow(/missing required \{name, version\}/);
  });

  it('rejects a component tag without a hyphen', async () => {
    stubFetch({
      'http://x/m.json': {
        name: 'n', version: '1', components: [{ tag: 'badtag', src: './x.js' }],
      },
    });
    await expect(loadFromManifest('http://x/m.json')).rejects.toThrow(/must contain one/);
  });

  it('honours the optional accept() gate', async () => {
    stubFetch({
      'http://x/m.json': {
        name: 'opt', version: '1', components: [
          { tag: 'opt-a', src: './a.js' },
          { tag: 'opt-skip', src: './skip.js' },
        ],
      },
    });
    await loadFromManifest('http://x/m.json', { accept: (c) => c.tag !== 'opt-skip' });
    expect(customElements.get('opt-a-lazy')).toBeDefined();
    expect(customElements.get('opt-skip-lazy')).toBeUndefined();
  });
});
