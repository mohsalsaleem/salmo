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
});
