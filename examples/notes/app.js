// Notes app — frontend. Same module loaded by:
//   - the Node server for SSR (renderToString on x-notes-app)
//   - the browser as a regular ESM script
//
// Architecture:
//   <x-notes-app>          — root; reads `initial` data attribute on
//                            connect (server-supplied user + notes),
//                            owns the session + notes signals, routes
//                            between auth and notes views.
//   <x-auth>               — login / signup form (light DOM).
//   <x-notes-board>        — list + editor side-by-side. Owns
//                            selectedId; nothing else.
//   <x-rich-editor-lazy>   — federated. Loaded from
//                            /examples/notes/widgets/editor.js, shows
//                            a real <x-rich-editor> after the import.

import {
  defineComponent, html, Signal, effect, when, repeat, classMap,
  lazyComponent,
} from '../../src/index.js';

// ---- Federated editor registration -------------------------------------
// Done at module load so SSR sees it too (the manifest pattern would
// normally fetch this; one-component manifest would be overkill here).
lazyComponent({
  tag: 'x-rich-editor-lazy',
  src: new URL('./widgets/editor.js', import.meta.url).href,
  as: 'x-rich-editor',
});

// ---- API helper ---------------------------------------------------------
const api = (path, opts = {}) =>
  fetch(path, {
    credentials: 'same-origin',
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (r) => {
    const ct = r.headers.get('content-type') ?? '';
    const data = ct.includes('json') ? await r.json() : null;
    if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
    return data;
  });

// ---- <x-auth> -----------------------------------------------------------
defineComponent({
  tag: 'x-auth',
  setup(host, props, emit) {
    const mode = new Signal.State(/** @type {'login' | 'signup'} */ ('login'));
    const username = new Signal.State('');
    const password = new Signal.State('');
    const error = new Signal.State(/** @type {string | null} */ (null));
    const busy = new Signal.State(false);

    const submit = async (e) => {
      e?.preventDefault?.();
      if (busy.get()) return;
      error.set(null);
      busy.set(true);
      try {
        const me = await api(`/api/${mode.get()}`, {
          method: 'POST',
          body: { username: username.get().trim(), password: password.get() },
        });
        emit('authed', me);
      } catch (err) {
        error.set(err instanceof Error ? err.message : String(err));
      } finally {
        busy.set(false);
      }
    };

    return () => html`
      <form class="form" @submit=${submit}>
        <h2>${mode.get() === 'login' ? 'Log in' : 'Sign up'}</h2>
        <label><span>username</span>
          <input autocomplete="username" required
            .value=${username.get()}
            @input=${(e) => username.set(e.target.value)}>
        </label>
        <label><span>password</span>
          <input type="password" autocomplete="current-password" required
            .value=${password.get()}
            @input=${(e) => password.set(e.target.value)}>
        </label>
        <div class="err">${error.get() ?? ''}</div>
        <div class="actions">
          <button class="primary" type="submit" ?disabled=${busy.get()}>
            ${busy.get() ? '…' : (mode.get() === 'login' ? 'Log in' : 'Sign up')}
          </button>
        </div>
        <div class="switch">
          ${mode.get() === 'login' ? html`
            New here? <a @click=${() => { mode.set('signup'); error.set(null); }}>Create an account</a>
          ` : html`
            Already have one? <a @click=${() => { mode.set('login'); error.set(null); }}>Log in</a>
          `}
        </div>
      </form>
    `;
  },
});

// ---- <x-notes-board> ----------------------------------------------------
defineComponent({
  tag: 'x-notes-board',
  props: ['notes'],  // JSON string of notes array, set by parent
  setup(host, props, emit) {
    /** @type {Signal.State<Array<{id:number,title:string,body:string,updatedAt:number}>>} */
    const notes = new Signal.State(parseNotes(props.notes.get()));
    const selectedId = new Signal.State(/** @type {number | null} */ (
      notes.get()[0]?.id ?? null
    ));
    // Mirror the parent's notes prop into our local signal whenever the
    // PROP changes. We track only props.notes here (not selectedId or
    // local notes) so a local mutation — create / save / remove — does
    // not bounce through this effect and overwrite itself from a stale
    // prop value.
    let lastProp = props.notes.get();
    effect(() => {
      const prop = props.notes.get();
      if (prop === lastProp) return;
      lastProp = prop;
      const next = parseNotes(prop);
      notes.set(next);
      const sid = selectedId.get();
      if (sid == null || !next.some((n) => n.id === sid)) {
        selectedId.set(next[0]?.id ?? null);
      }
    });
    // Ensure first-load selection: if we mounted with notes already
    // present but selectedId is null (unlikely with the constructor
    // above, but defensive), pick the first.
    if (selectedId.get() == null && notes.get()[0]) {
      selectedId.set(notes.get()[0].id);
    }
    const status = new Signal.State('');

    const selected = new Signal.Computed(() =>
      notes.get().find((n) => n.id === selectedId.get()) ?? null);

    /** @param {string} s */
    const setStatusAndClear = (s) => {
      status.set(s);
      const id = setTimeout(() => { if (status.get() === s) status.set(''); }, 1500);
      return () => clearTimeout(id);
    };

    const create = async () => {
      const created = await api('/api/notes', { method: 'POST', body: { title: 'Untitled', body: '' } });
      notes.set([created, ...notes.get()]);
      selectedId.set(created.id);
      setStatusAndClear('created');
    };

    /** @param {number} id @param {Partial<{title:string,body:string}>} patch */
    const save = async (id, patch) => {
      const updated = await api(`/api/notes/${id}`, { method: 'PUT', body: patch });
      notes.set(notes.get().map((n) => (n.id === id ? updated : n)));
      setStatusAndClear('saved');
    };

    /** @param {number} id */
    const remove = async (id) => {
      await api(`/api/notes/${id}`, { method: 'DELETE' });
      const remaining = notes.get().filter((n) => n.id !== id);
      notes.set(remaining);
      if (selectedId.get() === id) selectedId.set(remaining[0]?.id ?? null);
      setStatusAndClear('deleted');
    };

    return () => html`
      <div class="notes-grid">
        <div class="notes-list">
          <button class="primary" style="width:100%;margin-bottom:0.4rem"
            @click=${create}>+ New note</button>
          ${notes.get().length === 0
            ? html`<div class="empty">No notes yet. Create one!</div>`
            : repeat(notes.get(), (n) => n.id, (n) => html`
              <div class=${classMap({ 'note-item': true, active: selectedId.get() === n.id })}
                @click=${() => selectedId.set(n.id)}>
                <h3>${n.title || '(untitled)'}</h3>
                <div class="preview">${n.body || '(empty)'}</div>
              </div>
            `)}
        </div>

        ${when(selected.get(), () => {
          const n = selected.get();
          return html`
            <div class="editor">
              <input class="title" .value=${n.title}
                @change=${(e) => save(n.id, { title: e.target.value })}>
              <x-rich-editor-lazy
                data-note-id=${String(n.id)}
                value=${n.body}
                @change=${(/** @type {CustomEvent} */ e) => save(n.id, { body: e.detail.value })}>
              </x-rich-editor-lazy>
              <div class="editor-actions">
                <span class="status">${status.get()}</span>
                <button @click=${() => remove(n.id)}>Delete</button>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  },
});

// ---- <x-notes-app> (root) ----------------------------------------------
defineComponent({
  tag: 'x-notes-app',
  props: ['initial'],
  setup(host, props, emit) {
    /** @type {{ session: { id: number, username: string } | null, notes: any[] }} */
    const initial = (() => {
      try { return JSON.parse(props.initial.get() ?? '') ?? { session: null, notes: [] }; }
      catch { return { session: null, notes: [] }; }
    })();
    const session = new Signal.State(initial.session);
    const notes = new Signal.State(initial.notes);
    const notesJson = new Signal.Computed(() => JSON.stringify(notes.get()));

    const onAuthed = (/** @type {CustomEvent} */ e) => {
      session.set(e.detail);
      // After auth: fetch this user's notes (initial was empty).
      api('/api/notes').then((rows) => notes.set(rows));
    };

    const logout = async () => {
      await api('/api/logout', { method: 'POST' });
      session.set(null);
      notes.set([]);
    };

    return () => html`
      ${when(!session.get(), () => html`
        <div class="toolbar"><h1>Notes</h1><span class="who"></span></div>
        <x-auth @authed=${onAuthed}></x-auth>
      `)}
      ${when(session.get(), () => html`
        <div class="toolbar">
          <h1>Notes</h1>
          <span class="who">
            ${session.get().username}
            · <a style="color:#06f;cursor:pointer" @click=${logout}>log out</a>
          </span>
        </div>
        <x-notes-board .notes=${notesJson.get()}></x-notes-board>
      `)}
    `;
  },
});

function parseNotes(s) {
  try { return JSON.parse(s ?? '[]') ?? []; } catch { return []; }
}
