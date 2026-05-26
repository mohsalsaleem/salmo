import { describe, it, expect } from 'vitest';
import { defineComponent, html, Signal } from '../src/index.js';

const tick = () => new Promise((r) => queueMicrotask(r));

let _id = 0;
const freshTag = () => `x-props-${++_id}`;

describe('defineComponent props', () => {
  it('exposes declared props as JS properties on the host', () => {
    const tag = freshTag();
    defineComponent({
      tag, props: ['item'],
      setup: () => html`<span>x</span>`,
    });
    const host = document.createElement(tag);
    host.item = { text: 'hello' };
    expect(host.item).toEqual({ text: 'hello' });
  });

  it('hands setup() a props bag of Signals; updates flow when the parent sets the property', async () => {
    const tag = freshTag();
    defineComponent({
      tag, props: ['label'],
      setup: (host, props) => html`<span>${() => props.label.get() ?? '—'}</span>`,
    });
    const host = document.createElement(tag);
    document.body.append(host);
    expect(host.querySelector('span').textContent).toBe('—');

    host.label = 'one';
    await tick();
    expect(host.querySelector('span').textContent).toBe('one');

    host.label = 'two';
    await tick();
    expect(host.querySelector('span').textContent).toBe('two');
    host.remove();
  });

  it('keeps multiple instances independent', async () => {
    const tag = freshTag();
    defineComponent({
      tag, props: ['n'],
      setup: (host, props) => html`<span>${() => props.n.get()}</span>`,
    });
    const a = document.createElement(tag);
    const b = document.createElement(tag);
    document.body.append(a, b);
    a.n = 1; b.n = 2;
    await tick();
    expect(a.querySelector('span').textContent).toBe('1');
    expect(b.querySelector('span').textContent).toBe('2');
    a.remove(); b.remove();
  });

  it('property set before connect is visible when setup runs', async () => {
    const tag = freshTag();
    defineComponent({
      tag, props: ['v'],
      setup: (host, props) => html`<span>${() => props.v.get()}</span>`,
    });
    const host = document.createElement(tag);
    host.v = 'preset'; // before append
    document.body.append(host);
    expect(host.querySelector('span').textContent).toBe('preset');
    host.remove();
  });

  it('parent .prop=${signal-or-fn} bindings flow into a child custom element', async () => {
    // Fixed tags so html`` literally sees them (no dynamic-tag templating).
    defineComponent({
      tag: 'x-pchild-1', props: ['msg'],
      setup: (host, props) => html`<em>${() => props.msg.get()}</em>`,
    });

    const txt = new Signal.State('a');
    defineComponent({
      tag: 'x-pparent-1',
      setup: () => html`<x-pchild-1 .msg=${txt}></x-pchild-1>`,
    });

    const parent = document.createElement('x-pparent-1');
    document.body.append(parent);
    expect(parent.querySelector('em').textContent).toBe('a');

    txt.set('b');
    await tick();
    expect(parent.querySelector('em').textContent).toBe('b');
    parent.remove();
  });

  it('child → parent communication via dispatchEvent + onevent', () => {
    defineComponent({
      tag: 'x-echild-1',
      setup: (host) => html`<button onclick=${() =>
        host.dispatchEvent(new CustomEvent('commit', { detail: { id: 7 } }))
      }>x</button>`,
    });

    let received;
    defineComponent({
      tag: 'x-eparent-1',
      setup: () => html`<x-echild-1 oncommit=${(/** @type {CustomEvent} */ e) => { received = e.detail; }}></x-echild-1>`,
    });

    const parent = document.createElement('x-eparent-1');
    document.body.append(parent);
    parent.querySelector('button').click();
    expect(received).toEqual({ id: 7 });
    parent.remove();
  });
});
