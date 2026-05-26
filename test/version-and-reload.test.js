import { describe, it, expect, vi, afterEach } from 'vitest';
import { VERSION } from '../src/version.js';
import { gte } from '../src/version.js';
import { loadFromManifest } from '../src/manifest.js';
import { lazyComponent, reloadRemote, _getRegistry } from '../src/lazy.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function stubFetch(/** @type {Record<string, unknown>} */ map) {
  globalThis.fetch = vi.fn(async (/** @type {any} */ u) => {
    const k = typeof u === 'string' ? u : u.url;
    return /** @type {any} */ ({ ok: !!map[k], status: map[k] ? 200 : 404, json: async () => map[k] });
  });
}

let _id = 0;
const fresh = (p) => `${p}-${++_id}`;

describe('version comparator', () => {
  it('gte returns true for equal versions', () => {
    expect(gte('0.1.0', '0.1.0')).toBe(true);
  });
  it('gte returns true for higher core version', () => {
    expect(gte('0.2.0', '0.1.9')).toBe(true);
    expect(gte('1.0.0', '0.99.99')).toBe(true);
  });
  it('gte returns false for lower core version', () => {
    expect(gte('0.1.0', '0.2.0')).toBe(false);
    expect(gte('0.1.0', '0.1.1')).toBe(false);
  });
  it('strips pre-release suffix for the comparison', () => {
    expect(gte('0.1.0-alpha', '0.1.0')).toBe(true);
  });
});

describe('manifest version enforcement', () => {
  it('throws when policy=throw and minVersion is higher than ours', async () => {
    stubFetch({
      'http://x/m.json': {
        name: 'too-new', version: '1.0.0',
        framework: { name: 'mohsal-framework', minVersion: '999.0.0' },
        components: [{ tag: 'too-new-foo', src: './foo.js' }],
      },
    });
    await expect(loadFromManifest('http://x/m.json', { onVersionMismatch: 'throw' }))
      .rejects.toThrow(/older than the minimum required/);
  });

  it('warns by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({
      'http://x/m2.json': {
        name: 'warns', version: '1.0.0',
        framework: { name: 'mohsal-framework', minVersion: '999.0.0' },
        components: [{ tag: 'warns-foo', src: './foo.js' }],
      },
    });
    await loadFromManifest('http://x/m2.json');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/older than the minimum required/));
    warn.mockRestore();
  });

  it('silent skips the message entirely', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({
      'http://x/m3.json': {
        name: 'silent', version: '1.0.0',
        framework: { name: 'mohsal-framework', minVersion: '999.0.0' },
        components: [{ tag: 'silent-foo', src: './foo.js' }],
      },
    });
    await loadFromManifest('http://x/m3.json', { onVersionMismatch: 'silent' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('no minVersion → no check, no warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({
      'http://x/m4.json': {
        name: 'ok', version: '1.0.0',
        components: [{ tag: 'ok-foo', src: './foo.js' }],
      },
    });
    await loadFromManifest('http://x/m4.json');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('lazyComponent registry + reloadRemote', () => {
  it('registers (tag → src) for devtools introspection', () => {
    const realTag = fresh('reg-real');
    const lazyTag = fresh('reg-lazy');
    lazyComponent({
      tag: lazyTag, as: realTag,
      src: `http://example.com/${realTag}.js`,
    });
    const r = _getRegistry();
    expect(r.has(lazyTag)).toBe(true);
    expect(r.get(lazyTag)?.src).toBe(`http://example.com/${realTag}.js`);
    expect(r.get(lazyTag)?.realTag).toBe(realTag);
  });

  it('reloadRemote retries every connected instance and returns the count', async () => {
    const realTag = fresh('rel-real');
    const lazyTag = fresh('rel-lazy');
    const src = `http://localhost-impossible:1/${realTag}.js`;
    lazyComponent({ tag: lazyTag, as: realTag, src, timeout: 10 });

    const a = document.createElement(lazyTag);
    const b = document.createElement(lazyTag);
    document.body.append(a, b);
    // Wait for initial failure
    await new Promise((r) => setTimeout(r, 60));

    const n = reloadRemote(src);
    expect(n).toBe(2);
    a.remove(); b.remove();
  });

  it('reloadRemote returns 0 for a src with no live instances', () => {
    expect(reloadRemote('http://no-such-src/')).toBe(0);
  });
});

describe('VERSION export', () => {
  it('is a semver-ish string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
