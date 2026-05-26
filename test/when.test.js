import { describe, it, expect } from 'vitest';
import { html, when } from '../src/index.js';
import { Signal } from '../src/signal.js';

const tick = () => new Promise((r) => queueMicrotask(r));

function mount(frag) {
  const div = document.createElement('div');
  div.appendChild(frag);
  return div;
}

describe('when()', () => {
  it('renders the template when condFn is truthy', () => {
    const div = mount(html`<p>${when(() => true, () => html`<span>yes</span>`)}</p>`);
    expect(div.querySelector('p span').textContent).toBe('yes');
  });

  it('renders nothing when condFn is falsy', () => {
    const div = mount(html`<p>${when(() => false, () => html`<span>yes</span>`)}</p>`);
    expect(div.querySelector('p').textContent).toBe('');
    expect(div.querySelector('p').querySelector('span')).toBe(null);
  });

  it('flips reactively when the underlying signal changes', async () => {
    const open = new Signal.State(false);
    const div = mount(html`<p>${when(() => open.get(), () => html`<span>shown</span>`)}</p>`);
    expect(div.querySelector('span')).toBe(null);

    open.set(true);
    await tick();
    expect(div.querySelector('span').textContent).toBe('shown');

    open.set(false);
    await tick();
    expect(div.querySelector('span')).toBe(null);
  });
});
