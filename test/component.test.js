import { describe, it, expect } from 'vitest';
import { defineComponent } from '../src/component.js';
import { html } from '../src/html.js';
import { Signal } from '../src/signal.js';

const tick = () => new Promise((r) => queueMicrotask(r));

let _id = 0;
const freshTag = () => `x-test-${++_id}`;

describe('defineComponent', () => {
  it('registers a custom element with the given tag', () => {
    const tag = freshTag();
    defineComponent({ tag, setup: () => html`<p>hi</p>` });
    expect(customElements.get(tag)).toBeDefined();
  });

  it('renders setup output into light DOM by default', () => {
    const tag = freshTag();
    defineComponent({ tag, setup: () => html`<p>hello</p>` });
    const host = document.createElement(tag);
    document.body.append(host);
    expect(host.innerHTML).toBe('<p>hello</p>');
    host.remove();
  });

  it('reactivity works inside the component', async () => {
    const tag = freshTag();
    defineComponent({
      tag,
      setup() {
        const count = new Signal.State(0);
        return html`<button onclick=${() => count.set(count.get() + 1)}>${count}</button>`;
      },
    });
    const host = document.createElement(tag);
    document.body.append(host);
    const btn = host.querySelector('button');
    expect(btn.textContent).toBe('0');

    btn.click();
    await tick();
    expect(btn.textContent).toBe('1');
    host.remove();
  });

  it('disconnects abort the scope: further state changes do not update the DOM', async () => {
    const tag = freshTag();
    let count;
    defineComponent({
      tag,
      setup() {
        count = new Signal.State(0);
        return html`<span>${count}</span>`;
      },
    });
    const host = document.createElement(tag);
    document.body.append(host);
    const span = host.querySelector('span');
    expect(span.textContent).toBe('0');

    host.remove();             // triggers disconnectedCallback
    count.set(99);
    await tick();
    expect(span.textContent).toBe('0');
  });

  it('opts into Shadow DOM via shadow:true', () => {
    const tag = freshTag();
    defineComponent({
      tag,
      shadow: true,
      setup: () => html`<p>shadowed</p>`,
    });
    const host = document.createElement(tag);
    document.body.append(host);
    expect(host.innerHTML).toBe('');                   // light DOM is empty
    expect(host.shadowRoot?.innerHTML).toBe('<p>shadowed</p>');
    host.remove();
  });

  it('passes the host element to setup', () => {
    const tag = freshTag();
    let received;
    defineComponent({ tag, setup(host) { received = host; return html`<p>x</p>`; } });
    const host = document.createElement(tag);
    document.body.append(host);
    expect(received).toBe(host);
    host.remove();
  });
});
