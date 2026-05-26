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

describe(':propName=${signal} two-way binding', () => {
  it(':value reflects signal → input AND input → signal', async () => {
    const text = new Signal.State('hello');
    const div = mount(html`<input :value=${text}>`);
    const input = div.querySelector('input');
    expect(input.value).toBe('hello');

    // Outbound: signal changes propagate to input.
    text.set('world');
    await tick();
    expect(input.value).toBe('world');

    // Inbound: input event updates the signal.
    input.value = 'typed';
    input.dispatchEvent(new Event('input'));
    expect(text.get()).toBe('typed');
  });

  it(':checked reflects signal both ways for a checkbox', async () => {
    const on = new Signal.State(false);
    const div = mount(html`<input type="checkbox" :checked=${on}>`);
    const box = div.querySelector('input');
    expect(box.checked).toBe(false);

    on.set(true);
    await tick();
    expect(box.checked).toBe(true);

    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(on.get()).toBe(false);
  });

  it('removes the input listener on scope abort', () => {
    const ctrl = new AbortController();
    const text = new Signal.State('a');
    let div;
    withScope({ signal: ctrl.signal }, () => {
      div = mount(html`<input :value=${text}>`);
    });
    const input = div.querySelector('input');

    ctrl.abort();
    input.value = 'b';
    input.dispatchEvent(new Event('input'));
    expect(text.get()).toBe('a'); // listener was removed
  });
});
