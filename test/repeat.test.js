import { describe, it, expect } from 'vitest';
import { html, repeat } from '../src/index.js';
import { Signal } from '../src/signal.js';

const tick = () => new Promise((r) => queueMicrotask(r));

function mount(frag) {
  const div = document.createElement('div');
  div.appendChild(frag);
  return div;
}

describe('repeat()', () => {
  it('renders a static array initially', () => {
    const items = new Signal.State(['a', 'b', 'c']);
    const div = mount(html`<ul>${repeat(items, (x) => x, (x) => html`<li>${x}</li>`)}</ul>`);
    expect(div.querySelector('ul').textContent).toBe('abc');
  });

  it('reuses the same DOM node for an unchanged key across re-renders', async () => {
    const items = new Signal.State([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
    const div = mount(html`<ul>${repeat(items, (t) => t.id, (t) => html`<li>${t.text}</li>`)}</ul>`);
    const liBefore = div.querySelector('ul').children[1]; // id=2

    items.set([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
    await tick();
    const liAfter = div.querySelector('ul').children[1];
    expect(liAfter).toBe(liBefore); // same node reused
  });

  it('removes nodes whose keys disappear', async () => {
    const items = new Signal.State([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const div = mount(html`<ul>${repeat(items, (t) => t.id, (t) => html`<li>${t.id}</li>`)}</ul>`);
    expect(div.querySelector('ul').textContent).toBe('123');

    items.set([{ id: 1 }, { id: 3 }]);
    await tick();
    expect(div.querySelector('ul').textContent).toBe('13');
  });

  it('reorders existing nodes without re-creating them', async () => {
    const items = new Signal.State([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const div = mount(html`<ul>${repeat(items, (t) => t.id, (t) => html`<li>${t.id}</li>`)}</ul>`);
    const lis = [...div.querySelector('ul').children];

    items.set([{ id: 3 }, { id: 1 }, { id: 2 }]);
    await tick();
    const reordered = [...div.querySelector('ul').children];
    expect(reordered[0]).toBe(lis[2]); // node 3 moved to front
    expect(reordered[1]).toBe(lis[0]);
    expect(reordered[2]).toBe(lis[1]);
  });

  it('preserves DOM state (focus) on a reused node across unrelated updates', async () => {
    const items = new Signal.State([{ id: 1 }, { id: 2 }]);
    const div = mount(
      html`<ul>${repeat(items, (t) => t.id, (t) => html`<li><input data-id=${t.id}></li>`)}</ul>`,
    );
    document.body.appendChild(div);
    const input2 = div.querySelector('input[data-id="2"]');
    input2.focus();
    expect(document.activeElement).toBe(input2);

    // Mutate the list (push a new id) — id=2's node should NOT be re-created.
    items.set([{ id: 1 }, { id: 2 }, { id: 3 }]);
    await tick();
    expect(document.activeElement).toBe(input2); // still focused
    document.body.removeChild(div);
  });

  it('disposes per-item scopes when a key disappears (effects stop)', async () => {
    const items = new Signal.State([{ id: 1, n: new Signal.State(0) }]);
    const it = items.get()[0];

    let runs = 0;
    const div = mount(
      html`<ul>${repeat(
        items,
        (t) => t.id,
        (t) => html`<li>${() => { runs++; return t.n.get(); }}</li>`,
      )}</ul>`,
    );
    expect(runs).toBe(1);

    it.n.set(1);
    await tick();
    expect(runs).toBe(2);

    // Remove the item entirely.
    items.set([]);
    await tick();
    expect(div.querySelector('ul').textContent).toBe('');

    // The per-item effect should be gone — further sets must NOT bump runs.
    it.n.set(2);
    await tick();
    expect(runs).toBe(2);
  });
});
