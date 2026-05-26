import { describe, it, expect } from 'vitest';
import { html } from '../src/html.js';
import { Signal } from '../src/signal.js';

const tick = () => new Promise((r) => queueMicrotask(r));

function mount(frag) {
  const div = document.createElement('div');
  div.appendChild(frag);
  return div;
}

describe('class:name=${signal}', () => {
  it('adds and removes a single class reactively', async () => {
    const on = new Signal.State(false);
    const div = mount(html`<p class:active=${on}>x</p>`);
    const p = div.querySelector('p');
    expect(p.classList.contains('active')).toBe(false);

    on.set(true);
    await tick();
    expect(p.classList.contains('active')).toBe(true);

    on.set(false);
    await tick();
    expect(p.classList.contains('active')).toBe(false);
  });

  it('coexists with a static class attribute', async () => {
    const editing = new Signal.State(true);
    const div = mount(html`<li class="todo" class:editing=${editing}>x</li>`);
    const li = div.querySelector('li');
    expect(li.classList.contains('todo')).toBe(true);
    expect(li.classList.contains('editing')).toBe(true);

    editing.set(false);
    await tick();
    expect(li.classList.contains('todo')).toBe(true);
    expect(li.classList.contains('editing')).toBe(false);
  });

  it('accepts a function (not only a Signal)', async () => {
    const editingId = new Signal.State(null);
    const t = { id: 7 };
    const div = mount(html`<li class:editing=${() => editingId.get() === t.id}>x</li>`);
    const li = div.querySelector('li');
    expect(li.classList.contains('editing')).toBe(false);

    editingId.set(7);
    await tick();
    expect(li.classList.contains('editing')).toBe(true);
  });
});
