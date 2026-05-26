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

  it('emits declarative shadow DOM for shadow=true components', () => {
    const tag = fresh('x-dsd');
    defineComponent({
      tag,
      shadow: true,
      setup: () => html`<style>p{color:red}</style><p>scoped</p>`,
    });
    const out = renderToString(tag);
    // The opening template tag with shadowrootmode="open" lets a
    // DSD-aware browser attach the shadow root before any JS runs.
    expect(out).toContain('<template shadowrootmode="open">');
    expect(out).toContain('<p>scoped</p>');
    expect(out).toContain('</template>');
  });

  it('does not emit declarative shadow DOM for light-DOM components', () => {
    const tag = fresh('x-light');
    defineComponent({ tag, setup: () => html`<p>light</p>` });
    const out = renderToString(tag);
    expect(out).not.toContain('shadowrootmode');
    expect(out).toContain('<p>light</p>');
  });
});

describe('declarative shadow DOM hydration', () => {
  it('connectedCallback reuses an existing (browser-attached) shadow root', () => {
    const tag = fresh('x-dsd-hydrate');
    defineComponent({
      tag,
      shadow: true,
      setup: () => html`<p>live</p>`,
    });
    // Simulate the browser parsing a <template shadowrootmode="open">:
    // attach the shadow root and populate it BEFORE the element is
    // connected (and before the framework's connectedCallback runs).
    const host = document.createElement(tag);
    const preAttached = host.attachShadow({ mode: 'open' });
    preAttached.innerHTML = '<p>ssr-content</p>';

    // Without the fix, the framework would call attachShadow a second
    // time and throw "Shadow root cannot be created on a host which
    // already hosts a shadow tree".
    document.body.append(host);

    // The same shadow root instance is reused (identity check), and
    // the framework's first render replaced its content with the live
    // template.
    expect(host.shadowRoot).toBe(preAttached);
    expect(host.shadowRoot?.querySelector('p')?.textContent).toBe('live');
    host.remove();
  });
});
