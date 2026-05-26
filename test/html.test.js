import { describe, it, expect } from 'vitest';
import { html } from '../src/html.js';
import { Signal } from '../src/signal.js';
import { withScope } from '../src/scope.js';

const tick = () => new Promise((r) => queueMicrotask(r));

function mount(frag) {
  const div = document.createElement('div');
  div.appendChild(frag);
  return div;
}

describe('html', () => {
  it('renders a static template', () => {
    const div = mount(html`<p>hello</p>`);
    expect(div.innerHTML).toBe('<p>hello</p>');
  });

  it('interpolates primitives as text', () => {
    const div = mount(html`<p>hello ${'world'}</p>`);
    expect(div.textContent).toBe('hello world');
  });

  it('interpolates a Signal.State reactively', async () => {
    const name = new Signal.State('world');
    const div = mount(html`<p>hello ${name}</p>`);
    expect(div.textContent).toBe('hello world');

    name.set('mohsal');
    await tick();
    expect(div.textContent).toBe('hello mohsal');
  });

  it('interpolates a function as a reactive expression', async () => {
    const n = new Signal.State(1);
    const div = mount(html`<p>doubled: ${() => n.get() * 2}</p>`);
    expect(div.textContent).toBe('doubled: 2');

    n.set(5);
    await tick();
    expect(div.textContent).toBe('doubled: 10');
  });

  it('binds event handlers via addEventListener', () => {
    let clicks = 0;
    const div = mount(html`<button onclick=${() => clicks++}>x</button>`);
    div.querySelector('button').click();
    expect(clicks).toBe(1);
  });

  it('renders reactive attributes', async () => {
    const cls = new Signal.State('one');
    const div = mount(html`<p class=${cls}>x</p>`);
    expect(div.querySelector('p').className).toBe('one');

    cls.set('two');
    await tick();
    expect(div.querySelector('p').className).toBe('two');
  });

  it('renders an array of nodes', () => {
    const items = ['a', 'b', 'c'];
    const div = mount(html`<ul>${items.map(x => html`<li>${x}</li>`)}</ul>`);
    expect(div.querySelector('ul').innerHTML).toBe('<li>a</li><li>b</li><li>c</li>');
  });

  it('reactively re-renders a list when its source signal changes', async () => {
    const items = new Signal.State(['a', 'b']);
    const div = mount(html`<ul>${() => items.get().map(x => html`<li>${x}</li>`)}</ul>`);
    expect(div.querySelector('ul').textContent).toBe('ab');

    items.set(['a', 'b', 'c']);
    await tick();
    expect(div.querySelector('ul').textContent).toBe('abc');

    items.set(['z']);
    await tick();
    expect(div.querySelector('ul').textContent).toBe('z');
  });

  it('aborts all reactivity via the surrounding scope signal', async () => {
    const ctrl = new AbortController();
    const name = new Signal.State('world');
    let div;
    withScope({ signal: ctrl.signal }, () => {
      div = mount(html`<p>${name}</p>`);
    });
    expect(div.textContent).toBe('world');

    ctrl.abort();
    name.set('after');
    await tick();
    expect(div.textContent).toBe('world');
  });

  it('removes event listeners on scope abort', () => {
    const ctrl = new AbortController();
    let clicks = 0;
    let div;
    withScope({ signal: ctrl.signal }, () => {
      div = mount(html`<button onclick=${() => clicks++}>x</button>`);
    });
    const btn = div.querySelector('button');
    btn.click();
    expect(clicks).toBe(1);

    ctrl.abort();
    btn.click();
    expect(clicks).toBe(1);
  });
});
