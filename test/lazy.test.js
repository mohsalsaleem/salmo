import { describe, it, expect, vi } from 'vitest';
import { lazyComponent, defineComponent, html } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

let _id = 0;
const fresh = (s) => `${s}-${++_id}`;

describe('lazyComponent', () => {
  it('renders fallback synchronously, then swaps in the real element after load', async () => {
    const realTag = fresh('real');
    const lazyTag = fresh('lazy');
    // The "remote" module: in real life this would be a URL. Here we
    // fake a module specifier that resolves to a data: URL exporting a
    // module that calls defineComponent.
    const moduleSrc = `data:text/javascript;base64,${btoa(`
      const tag = ${JSON.stringify(realTag)};
      class R extends HTMLElement {
        connectedCallback() { this.innerHTML = '<em>real</em>'; }
      }
      customElements.define(tag, R);
    `)}`;

    lazyComponent({
      tag: lazyTag, src: moduleSrc, as: realTag,
      fallback: () => html`<span class="placeholder">…</span>`,
    });

    const host = document.createElement(lazyTag);
    document.body.append(host);
    // Sync render — placeholder is present.
    expect(host.querySelector('.placeholder')).toBeTruthy();

    // After import resolves, real element appears.
    await tick();
    await tick();
    expect(host.querySelector('em')?.textContent).toBe('real');
    host.remove();
  });

  it('forwards attributes from lazy host to real element', async () => {
    const realTag = fresh('real');
    const lazyTag = fresh('lazy');
    const moduleSrc = `data:text/javascript;base64,${btoa(`
      class R extends HTMLElement {
        connectedCallback() {
          this.innerHTML = '<i>' + (this.getAttribute('data-foo') ?? '') + '</i>';
        }
      }
      customElements.define(${JSON.stringify(realTag)}, R);
    `)}`;

    lazyComponent({ tag: lazyTag, src: moduleSrc, as: realTag });

    const host = document.createElement(lazyTag);
    host.setAttribute('data-foo', 'hello');
    document.body.append(host);
    await tick();
    await tick();
    expect(host.querySelector('i')?.textContent).toBe('hello');
    host.remove();
  });

  it('throws on missing `as`', () => {
    expect(() => lazyComponent({ tag: fresh('lz'), src: 'data:,' })).toThrow();
  });

  describe('supply-chain checks (Phase 3)', () => {
    it('refuses a source whose origin is not in allowedOrigins', async () => {
      const realTag = fresh('real');
      const lazyTag = fresh('lazy');
      const moduleSrc = `data:text/javascript,console.log('${realTag}')`;
      lazyComponent({
        tag: lazyTag, src: moduleSrc, as: realTag,
        allowedOrigins: ['https://acme.example.com'],
      });
      const errs = [];
      const host = document.createElement(lazyTag);
      host.addEventListener('lazy-error', (/** @type {any} */ e) => errs.push(e.detail.error.message));
      document.body.append(host);
      await tick(); await tick();
      expect(errs.join('\n')).toMatch(/not in allowedOrigins/);
      host.remove();
    });

    it('accepts a source whose origin IS in allowedOrigins', async () => {
      const realTag = fresh('real');
      const lazyTag = fresh('lazy');
      const moduleSrc = `data:text/javascript;base64,${btoa(`
        class R extends HTMLElement { connectedCallback() { this.textContent = 'ok'; } }
        customElements.define(${JSON.stringify(realTag)}, R);
      `)}`;
      // Origin of a data: URL is "null" — explicitly allow that.
      lazyComponent({ tag: lazyTag, src: moduleSrc, as: realTag, allowedOrigins: ['null'] });
      const host = document.createElement(lazyTag);
      document.body.append(host);
      await tick(); await tick();
      expect(host.textContent).toContain('ok');
      host.remove();
    });

    it('rejects on integrity mismatch', async () => {
      const realTag = fresh('real');
      const lazyTag = fresh('lazy');
      const moduleSrc = `data:text/javascript;base64,${btoa(`customElements.define(${JSON.stringify(realTag)}, class extends HTMLElement {});`)}`;
      lazyComponent({
        tag: lazyTag, src: moduleSrc, as: realTag,
        integrity: 'sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      });
      const errs = [];
      const host = document.createElement(lazyTag);
      host.addEventListener('lazy-error', (/** @type {any} */ e) => errs.push(e.detail.error.message));
      document.body.append(host);
      await new Promise((r) => setTimeout(r, 30));
      expect(errs.join('\n')).toMatch(/integrity check failed/);
      host.remove();
    });
  });
});
