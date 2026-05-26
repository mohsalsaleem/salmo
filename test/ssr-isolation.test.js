import { describe, it, expect } from 'vitest';
import { renderToString } from '../src/ssr.js';
import { defineComponent, html, Signal, effect } from '../src/index.js';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('SSR cleanup between renders', () => {
  it('effects started during a render are aborted when the element disconnects', async () => {
    // The element is added to body for render, then removed — which
    // fires disconnectedCallback, which aborts the component scope,
    // which disposes all effects scoped under it. Without that
    // cleanup, a long-running effect would keep running across renders
    // and respond to later signal changes — a real leak on a server
    // that handles many requests.

    const shared = new Signal.State(0);
    let runs = 0;
    defineComponent({
      tag: 'x-ssr-cleanup-1',
      setup() {
        effect(() => { shared.get(); runs++; });
        return html`<p>x</p>`;
      },
    });

    renderToString('x-ssr-cleanup-1');
    expect(runs).toBe(1);

    renderToString('x-ssr-cleanup-1');
    expect(runs).toBe(2);

    renderToString('x-ssr-cleanup-1');
    expect(runs).toBe(3);

    // Now poke the shared signal. If old effects were still alive,
    // each prior render's effect would re-run — runs would jump by 3.
    // After cleanup, none of them are tracking and runs stays at 3.
    shared.set(1);
    await tick();
    expect(runs).toBe(3);
  });

  it('multiple components from one render are all cleaned up', async () => {
    const shared = new Signal.State(0);
    let runs = 0;
    defineComponent({
      tag: 'x-ssr-cleanup-2',
      setup() {
        effect(() => { shared.get(); runs++; });
        return html`<p>x</p>`;
      },
    });

    renderToString('x-ssr-cleanup-2');
    renderToString('x-ssr-cleanup-2');
    renderToString('x-ssr-cleanup-2');
    expect(runs).toBe(3);

    shared.set(2);
    await tick();
    expect(runs).toBe(3); // still — every render's scope was aborted
  });
});
