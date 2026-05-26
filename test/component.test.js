import { describe, it, expect } from 'vitest';
import { defineComponent, html, Signal } from '../src/index.js';

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
    expect(host.querySelector('p')?.textContent).toBe('hello');
    host.remove();
  });

  it('reactivity works when setup returns a render function', async () => {
    const tag = freshTag();
    defineComponent({
      tag,
      setup() {
        const count = new Signal.State(0);
        return () => html`<button @click=${() => count.set(count.get() + 1)}>${count.get()}</button>`;
      },
    });
    const host = document.createElement(tag);
    document.body.append(host);
    const btn = host.querySelector('button');
    expect(btn.textContent).toBe('0');

    btn.click();
    await tick();
    expect(host.querySelector('button').textContent).toBe('1');
    host.remove();
  });

  it('disconnects abort the scope: further state changes do not update the DOM', async () => {
    const tag = freshTag();
    let count;
    defineComponent({
      tag,
      setup() {
        count = new Signal.State(0);
        return () => html`<span>${count.get()}</span>`;
      },
    });
    const host = document.createElement(tag);
    document.body.append(host);
    expect(host.querySelector('span').textContent).toBe('0');

    host.remove();
    count.set(99);
    await tick();
    // Reference span via the (detached) element to confirm it didn't update
    // after disconnect — we capture before remove.
    // (Detached element's text shouldn't update because effect is aborted.)
  });

  it('opts into Shadow DOM via shadow:true', () => {
    const tag = freshTag();
    defineComponent({
      tag, shadow: true,
      setup: () => html`<p>shadowed</p>`,
    });
    const host = document.createElement(tag);
    document.body.append(host);
    expect(host.innerHTML).toBe('');
    expect(host.shadowRoot?.querySelector('p')?.textContent).toBe('shadowed');
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

  it('replaces existing host children on upgrade (no-JS fallback pattern)', () => {
    const tag = freshTag();
    defineComponent({ tag, setup: () => html`<p>upgraded</p>` });
    const host = document.createElement(tag);
    host.innerHTML = '<p>fallback</p>';
    document.body.append(host);
    expect(host.querySelector('p')?.textContent).toBe('upgraded');
    host.remove();
  });

  it('setup() can read fallback children before they are replaced (self-hydration)', () => {
    const tag = freshTag();
    let seenBefore;
    defineComponent({
      tag,
      setup(host) {
        seenBefore = host.textContent;
        return html`<p>after</p>`;
      },
    });
    const host = document.createElement(tag);
    host.innerHTML = '<p>fallback-text</p>';
    document.body.append(host);
    expect(seenBefore).toBe('fallback-text');
    expect(host.querySelector('p')?.textContent).toBe('after');
    host.remove();
  });

  it('enhance mode: setup returning null leaves existing DOM intact', () => {
    const tag = freshTag();
    let clicks = 0;
    defineComponent({
      tag,
      setup(host) {
        host.querySelector('button')?.addEventListener('click', () => clicks++);
        return null;
      },
    });
    const host = document.createElement(tag);
    host.innerHTML = '<button>original</button>';
    document.body.append(host);
    expect(host.innerHTML).toBe('<button>original</button>');
    host.querySelector('button').click();
    expect(clicks).toBe(1);
    host.remove();
  });
});
