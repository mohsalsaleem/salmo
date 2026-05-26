// TodoMVC ported to salmo-on-Lit. Architectural difference
// from the previous version: setup() returns a render function (not a
// template directly), so signal reads inside it become deps of the
// component's render effect and the component re-renders on signal
// change. Lit's template diff makes whole-component re-render cheap.

import {
  defineComponent, html, Signal, effect,
  repeat, when, classMap, ref,
} from '../../src/index.js';

const STORAGE_KEY = 'salmo:todomvc';

const loadInitial = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []; }
  catch { return []; }
};

const hashFilter = () => {
  const h = location.hash.replace(/^#\//, '');
  return h === 'active' || h === 'completed' ? h : 'all';
};

// ---- <x-todo-item> ------------------------------------------------------

defineComponent({
  tag: 'x-todo-item',
  props: ['item', 'editing'],
  setup(host, props, emit) {
    const id = () => props.item.get()?.id;

    return () => html`
      <li class=${classMap({
        completed: !!props.item.get()?.done,
        editing: !!props.editing.get(),
      })}>
        <div class="view">
          <input class="toggle" type="checkbox"
            .checked=${!!props.item.get()?.done}
            @change=${() => emit('toggle', { id: id() })}>
          <label @dblclick=${() => emit('begin-edit', { id: id() })}>${props.item.get()?.text}</label>
          <button class="destroy" @click=${() => emit('remove', { id: id() })}></button>
        </div>
        ${when(props.editing.get(), () => html`
          <input
            class="edit"
            .value=${props.item.get()?.text ?? ''}
            ${ref((el) => { if (el) { /** @type {HTMLInputElement} */ (el).focus(); /** @type {HTMLInputElement} */ (el).select(); } })}
            @blur=${(e) => emit('commit', { id: id(), text: e.target.value })}
            @keydown=${(e) => {
              if (e.key === 'Enter') e.target.blur();
              if (e.key === 'Escape') emit('cancel');
            }}
          >
        `)}
      </li>
    `;
  },
});

// ---- <x-todo-app> -------------------------------------------------------

defineComponent({
  tag: 'x-todo-app',
  setup() {
    const items = new Signal.State(loadInitial());
    const filter = new Signal.State(hashFilter());
    const editingId = new Signal.State(/** @type {number | null} */ (null));
    const draft = new Signal.State('');

    const visible = new Signal.Computed(() => {
      const arr = items.get();
      const f = filter.get();
      if (f === 'active') return arr.filter((t) => !t.done);
      if (f === 'completed') return arr.filter((t) => t.done);
      return arr;
    });
    const remaining = new Signal.Computed(() => items.get().filter((t) => !t.done).length);
    const anyDone = new Signal.Computed(() => items.get().some((t) => t.done));
    const allDone = new Signal.Computed(() =>
      items.get().length > 0 && items.get().every((t) => t.done));

    effect(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.get())); } catch {}
    });
    window.addEventListener('hashchange', () => filter.set(hashFilter()));

    const updateItem = (id, patch) =>
      items.set(items.get().map((t) => t.id === id ? { ...t, ...patch } : t));

    const addTodo = () => {
      const text = draft.get().trim();
      if (!text) return;
      items.set([...items.get(), { id: Date.now() + Math.random(), text, done: false }]);
      draft.set('');
    };
    const onToggle = (e) => {
      const t = items.get().find((x) => x.id === e.detail.id);
      if (t) updateItem(e.detail.id, { done: !t.done });
    };
    const onRemove = (e) =>
      items.set(items.get().filter((t) => t.id !== e.detail.id));
    const onBeginEdit = (e) => editingId.set(e.detail.id);
    const onCommit = (e) => {
      const trimmed = (e.detail.text ?? '').trim();
      if (!trimmed) {
        items.set(items.get().filter((t) => t.id !== e.detail.id));
      } else {
        updateItem(e.detail.id, { text: trimmed });
      }
      editingId.set(null);
    };
    const onCancel = () => editingId.set(null);
    const toggleAll = (done) => items.set(items.get().map((t) => ({ ...t, done })));
    const clearCompleted = () => items.set(items.get().filter((t) => !t.done));

    return () => html`
      <section class="todoapp">
        <header class="header">
          <h1>todos</h1>
          <input
            class="new-todo"
            placeholder="What needs to be done?"
            autofocus
            .value=${draft.get()}
            @input=${(e) => draft.set(e.target.value)}
            @keydown=${(e) => { if (e.key === 'Enter') addTodo(); }}
          >
        </header>

        ${when(items.get().length > 0, () => html`
          <section class="main">
            <input id="toggle-all" class="toggle-all" type="checkbox"
              .checked=${allDone.get()} @change=${(e) => toggleAll(e.target.checked)}>
            <label for="toggle-all">Mark all as complete</label>
            <ul class="todo-list">${repeat(visible.get(), (t) => t.id, (t) => html`
              <x-todo-item
                .item=${t}
                .editing=${editingId.get() === t.id}
                @toggle=${onToggle}
                @remove=${onRemove}
                @begin-edit=${onBeginEdit}
                @commit=${onCommit}
                @cancel=${onCancel}
              ></x-todo-item>
            `)}</ul>
          </section>

          <footer class="footer">
            <span class="todo-count">
              <strong>${remaining.get()}</strong>
              ${remaining.get() === 1 ? ' item left' : ' items left'}
            </span>
            <ul class="filters">
              <li><a class=${classMap({ selected: filter.get() === 'all' })} href="#/">All</a></li>
              <li><a class=${classMap({ selected: filter.get() === 'active' })} href="#/active">Active</a></li>
              <li><a class=${classMap({ selected: filter.get() === 'completed' })} href="#/completed">Completed</a></li>
            </ul>
            ${when(anyDone.get(), () => html`
              <button class="clear-completed" @click=${clearCompleted}>Clear completed</button>
            `)}
          </footer>
        `)}
      </section>
    `;
  },
});
