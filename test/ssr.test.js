import { describe, it, expect } from 'vitest';
import { renderToString } from '../src/ssr.js';
import { defineComponent, html, Signal } from '../src/index.js';

let _id = 0;
const fresh = (p) => `${p}-${++_id}`;

describe('renderToString', () => {
  it('renders a no-props component to its initial HTML', () => {
    const tag = fresh('x-ssr');
    defineComponent({ tag, setup: () => html`<p>hello</p>` });
    const out = renderToString(tag);
    expect(out).toContain('<p>hello</p>');
  });

  it('renders props that drive content', () => {
    const tag = fresh('x-ssr');
    defineComponent({
      tag, props: ['label'],
      setup: (_h, props) => () => html`<span>${props.label.get()}</span>`,
    });
    const out = renderToString(tag, { label: 'world' });
    expect(out).toContain('world');
  });

  it('renders signal-driven content', () => {
    const tag = fresh('x-ssr');
    defineComponent({
      tag,
      setup() {
        const n = new Signal.State(5);
        const doubled = new Signal.Computed(() => n.get() * 2);
        return () => html`<em>${n.get()}-${doubled.get()}</em>`;
      },
    });
    const out = renderToString(tag);
    expect(out).toContain('5');
    expect(out).toContain('10');
  });
});
