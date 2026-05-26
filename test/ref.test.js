import { describe, it, expect } from 'vitest';
import { html } from '../src/html.js';
import { withScope } from '../src/scope.js';

const tick = () => new Promise((r) => queueMicrotask(r));

function mount(frag) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  div.appendChild(frag);
  return div;
}

describe('ref=${cb}', () => {
  it('invokes the callback with the element after mount', async () => {
    let received;
    const div = mount(html`<input ref=${(el) => { received = el; }}>`);
    await tick();
    expect(received).toBe(div.querySelector('input'));
    div.remove();
  });

  it('does not leave a stray ref attribute on the element', async () => {
    const div = mount(html`<input ref=${() => {}}>`);
    await tick();
    expect(div.querySelector('input').hasAttribute('ref')).toBe(false);
    div.remove();
  });

  it('runs once, not on every re-render of the surrounding template', async () => {
    let calls = 0;
    const div = mount(html`<input ref=${() => { calls++; }}>`);
    await tick();
    expect(calls).toBe(1);
    await tick();
    expect(calls).toBe(1);
    div.remove();
  });

  it('runs returned cleanup when the surrounding scope aborts', async () => {
    const ctrl = new AbortController();
    let cleaned = false;
    let div;
    withScope({ signal: ctrl.signal }, () => {
      div = mount(html`<button ref=${() => () => { cleaned = true; }}>x</button>`);
    });
    await tick();
    expect(cleaned).toBe(false);

    ctrl.abort();
    expect(cleaned).toBe(true);
    div.remove();
  });

  it('works for elements created by html`` inside arrays / map', async () => {
    const seen = [];
    const items = ['a', 'b', 'c'];
    const div = mount(html`<ul>${items.map((x) =>
      html`<li ref=${(el) => { seen.push(el.dataset.x); }} data-x=${x}>${x}</li>`,
    )}</ul>`);
    await tick();
    expect(seen).toEqual(['a', 'b', 'c']);
    div.remove();
  });
});
