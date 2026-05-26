// The "federated" rich editor — lives at its own URL so the notes app
// loads it via lazyComponent. In a real deployment this could be at a
// different origin (vendor.example.com/editor.js) with SRI pinned and
// the host's allowedOrigins listing it.
//
// Implementation: textarea + a tiny toolbar (B / I / link). Emits
// `change` events the host listens for. Reads .value as a prop.

import {
  defineComponent, html, Signal,
} from '../../../src/index.js';

defineComponent({
  tag: 'x-rich-editor',
  props: ['value'],
  setup(host, props, emit) {
    const value = new Signal.State(props.value.get() ?? '');
    // Sync external value changes (e.g. when selection switches to a
    // different note) without losing focus or cursor for in-progress
    // edits — only update when the prop differs from the local state.
    const propValue = new Signal.Computed(() => props.value.get() ?? '');
    let lastProp = propValue.get();
    const syncIfProp = () => {
      const p = propValue.get();
      if (p !== lastProp) {
        lastProp = p;
        value.set(p);
      }
    };

    /** @type {ReturnType<typeof setTimeout> | null} */
    let debounce = null;
    const onInput = (e) => {
      value.set(e.target.value);
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => emit('change', { value: value.get() }), 400);
    };

    /** @param {string} wrap */
    const wrap = (left, right = left) => {
      const ta = host.querySelector('textarea');
      if (!ta) return;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      const v = value.get();
      const next = v.slice(0, start) + left + v.slice(start, end) + right + v.slice(end);
      value.set(next);
      emit('change', { value: next });
      // Restore selection inside the wrap.
      queueMicrotask(() => {
        ta.focus();
        ta.setSelectionRange(start + left.length, end + left.length);
      });
    };

    return () => {
      syncIfProp();
      return html`
        <style>
          :host { display: block; }
          .bar { display: flex; gap: 0.25rem; margin-bottom: 0.3rem; }
          .bar button {
            font: inherit; padding: 0.15rem 0.55rem;
            border: 1px solid #ddd; background: white; border-radius: 3px; cursor: pointer;
            font-size: 0.85rem;
          }
          .bar button:hover { background: #f4f4f4; }
          textarea {
            width: 100%; min-height: 12rem;
            padding: 0.7rem;
            font: inherit; border: 1px solid #ddd; border-radius: 4px;
            box-sizing: border-box; resize: vertical;
            font-family: ui-monospace, monospace; font-size: 0.95em;
          }
          textarea:focus { outline: 2px solid #06f; outline-offset: -1px; }
          .hint { color: #888; font-size: 0.75rem; margin-top: 0.2rem; }
        </style>
        <div class="bar">
          <button type="button" @click=${() => wrap('**')}>B</button>
          <button type="button" @click=${() => wrap('_')}>I</button>
          <button type="button" @click=${() => wrap('[', '](url)')}>link</button>
          <button type="button" @click=${() => wrap('\n- ', '')}>list</button>
        </div>
        <textarea @input=${onInput}>${value.get()}</textarea>
        <div class="hint">Markdown-ish. Loaded from /examples/notes/widgets/editor.js — a separate bundle.</div>
      `;
    };
  },
  shadow: true,
});
