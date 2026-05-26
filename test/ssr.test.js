import { describe, it, expect } from 'vitest';
import { renderToString } from '../src/ssr.js';
import { defineComponent, html, Signal } from '../src/index.js';

// happy-dom is the test environment so the globals are already set up
// (no need to call setupDOM here). The same module would do that in a
// fresh Node process.

let _id = 0;
const fresh = (p) => `${p}-${++_id}`;

describe('renderToString', () => {
  it('renders a no-props component to its initial HTML', () => {
    const tag = fresh('x-ssr');
    defineComponent({ tag, setup: () => html`<p>hello</p>` });
    const out = renderToString(tag);
    expect(out).toBe(`<${tag}><p>hello</p></${tag}>`);
  });

  it('renders props that drive content', () => {
    const tag = fresh('x-ssr');
    defineComponent({
      tag, props: ['label'],
      setup: (_h, props) => html`<span>${() => props.label.get()}</span>`,
    });
    const out = renderToString(tag, { label: 'world' });
    expect(out).toContain('<span>world');
  });

  it('renders nested signal-driven content with versions stable', () => {
    const tag = fresh('x-ssr');
    defineComponent({
      tag,
      setup() {
        const n = new Signal.State(5);
        const doubled = new Signal.Computed(() => n.get() * 2);
        return html`<em>${n}-${doubled}</em>`;
      },
    });
    const out = renderToString(tag);
    expect(out).toContain('5');
    expect(out).toContain('10');
  });
});
