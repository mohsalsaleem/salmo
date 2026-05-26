import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, html, Signal, lazyComponent } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 10));

/** @type {ReturnType<typeof vi.spyOn> | null} */
let errSpy = null;
afterEach(() => { errSpy?.mockRestore(); errSpy = null; });

let _id = 0;
const fresh = (p) => `${p}-${++_id}`;

describe('defineComponent onError', () => {
  it('catches a throw in setup() and renders the boundary template', () => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tag = fresh('err');
    defineComponent({
      tag,
      onError: (err) => html`<div role="alert">caught: ${err.message}</div>`,
      setup: () => { throw new Error('setup blew up'); },
    });
    const host = document.createElement(tag);
    document.body.append(host);
    expect(host.querySelector('[role=alert]')?.textContent).toContain('setup blew up');
    host.remove();
  });

  it('catches a throw in the render function and renders the boundary', async () => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tag = fresh('err');
    const trigger = new Signal.State(false);
    defineComponent({
      tag,
      onError: (err) => html`<div role="alert">render-err: ${err.message}</div>`,
      setup: () => () => {
        if (trigger.get()) throw new Error('render blew up');
        return html`<p>ok</p>`;
      },
    });
    const host = document.createElement(tag);
    document.body.append(host);
    expect(host.querySelector('p')?.textContent).toBe('ok');

    trigger.set(true);
    await tick();
    expect(host.querySelector('[role=alert]')?.textContent).toContain('render blew up');
    host.remove();
  });

  it('without onError, re-throws so the failure is not silent', () => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tag = fresh('err');
    defineComponent({
      tag,
      setup: () => { throw new Error('boom'); },
    });
    const host = document.createElement(tag);
    expect(() => document.body.append(host)).toThrow(/boom/);
    host.remove();
  });
});

describe('lazyComponent error handling', () => {
  it('renders a default error UI when the import fails, replacing the fallback', async () => {
    const lazyTag = fresh('lz');
    const realTag = fresh('real');
    lazyComponent({
      tag: lazyTag,
      src: `http://localhost-impossible:1/missing-${_id}.js`,
      as: realTag,
      timeout: 10,
      fallback: () => html`<span class="ph">loading</span>`,
    });
    const host = document.createElement(lazyTag);
    const errored = new Promise((r) => host.addEventListener('lazy-error', r, { once: true }));
    document.body.append(host);
    expect(host.querySelector('.ph')).toBeTruthy();
    await errored;
    // Give lit-html a microtask to commit the error template.
    await new Promise((r) => setTimeout(r, 20));
    expect(host.querySelector('.ph')).toBeFalsy();
    expect(host.querySelector('[role=alert]')).toBeTruthy();
    host.remove();
  });

  it('user-provided onerror replaces the default', async () => {
    const lazyTag = fresh('lz');
    const realTag = fresh('real');
    lazyComponent({
      tag: lazyTag,
      src: `http://localhost-impossible:1/onerror-${_id}.js`,
      as: realTag,
      timeout: 10,
      onerror: ({ error }) => html`<div class="my-error">${error.message}</div>`,
    });
    const host = document.createElement(lazyTag);
    const errored = new Promise((r) => host.addEventListener('lazy-error', r, { once: true }));
    document.body.append(host);
    await errored;
    await new Promise((r) => setTimeout(r, 20));
    expect(host.querySelector('.my-error')).toBeTruthy();
    host.remove();
  });

  it('times out a slow / unreachable import (timeout option)', async () => {
    const lazyTag = fresh('lz');
    const realTag = fresh('real');
    lazyComponent({
      tag: lazyTag,
      src: `http://localhost-impossible:1/slow-${_id}.js`,
      as: realTag,
      timeout: 5,
    });
    const host = document.createElement(lazyTag);
    const errored = new Promise((r) => host.addEventListener('lazy-error', r, { once: true }));
    document.body.append(host);
    await errored;
    await new Promise((r) => setTimeout(r, 20));
    expect(host.querySelector('[role=alert]')).toBeTruthy();
    host.remove();
  });
});
