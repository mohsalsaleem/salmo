// Reference auth-provider — a context-provider Custom Element built
// purely from the framework's existing primitives. No new APIs.
//
// Pattern:
//   <x-auth-provider> stores the session signal + a fetchAuthed helper
//   on instance state. Children find it with this.closest('x-auth-provider')
//   and read .session (a Signal) and .fetchAuthed(input, init) directly.
//
// Apps own the auth strategy (token vs cookie, refresh policy, storage).
// The framework owns nothing here — this whole file is reference code
// that an app copies and adapts.

import {
  defineComponent, html, Signal, when, lazyComponent,
} from '../../src/index.js';

// ---- <x-auth-provider> --------------------------------------------------
// Exposes two things on instance state for children to read:
//   provider.session       — Signal<{ user, token, expiresAt } | null>
//   provider.fetchAuthed(input, init)  — fetch wrapper that attaches
//                                          the bearer + handles 401 refresh
//
// We deliberately attach them as instance properties (not props bag),
// because children read them by reference, not bind them. No reactivity
// is lost: the session signal IS reactive, so child code that calls
// `provider.session.get()` inside a render fn re-renders correctly.

defineComponent({
  tag: 'x-auth-provider',
  setup(host /** @type {any} */) {
    /** @type {Signal.State<{ user: string, token: string, expiresAt: number } | null>} */
    const session = new Signal.State(null);

    // Restore from sessionStorage so a refresh keeps you logged in.
    try {
      const saved = sessionStorage.getItem('demo-session');
      if (saved) session.set(JSON.parse(saved));
    } catch {}

    /** @param {{ user: string }} who */
    const login = async (who) => {
      // In a real app this is the network call. Here we mint a fake token.
      const token = btoa(`${who.user}.${Date.now()}`);
      const next = { user: who.user, token, expiresAt: Date.now() + 5 * 60_000 };
      session.set(next);
      sessionStorage.setItem('demo-session', JSON.stringify(next));
    };
    const logout = () => {
      session.set(null);
      sessionStorage.removeItem('demo-session');
    };

    /** @type {(input: RequestInfo, init?: RequestInit) => Promise<Response>} */
    const fetchAuthed = async (input, init = {}) => {
      const s = session.get();
      const headers = new Headers(init.headers ?? {});
      if (s?.token) headers.set('Authorization', `Bearer ${s.token}`);
      const res = await fetch(input, { ...init, headers, credentials: 'same-origin' });
      // 401 → in a real app, attempt refresh once and retry. Demo just clears.
      if (res.status === 401) logout();
      return res;
    };

    // Mock backend — for the demo, intercept /demo-api/ calls and return
    // session-aware responses without a real server.
    const realFetch = window.fetch.bind(window);
    window.fetch = async (/** @type {any} */ input, /** @type {any} */ init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url?.startsWith('/demo-api/me')) {
        const auth = init.headers?.get?.('Authorization') ?? init.headers?.Authorization;
        if (!auth) return new Response(JSON.stringify({ error: 'no auth' }), { status: 401, headers: { 'content-type': 'application/json' } });
        const s = session.get();
        if (!s || `Bearer ${s.token}` !== auth) {
          return new Response(JSON.stringify({ error: 'bad token' }), { status: 401, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ user: s.user, serverTime: new Date().toISOString() }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return realFetch(input, init);
    };

    // Attach the public surface on the host element. Children look us up
    // via `closest('x-auth-provider')` and read these directly.
    host.session = session;
    host.login = login;
    host.logout = logout;
    host.fetchAuthed = fetchAuthed;

    // The provider itself renders nothing; it just hosts state for its
    // children. Returning null leaves the children DOM intact (enhance
    // mode), so the <section>s in index.html stay put.
    return null;
  },
});

// ---- <x-login-panel> ----------------------------------------------------
// A consumer in the SAME bundle as the provider. Demonstrates the
// closest()-based lookup.

defineComponent({
  tag: 'x-login-panel',
  setup(host) {
    const username = new Signal.State('');
    /** @type {{ session: Signal.State<any>, login: (w: any) => Promise<void>, logout: () => void }} */
    const provider = /** @type {any} */ (host.closest('x-auth-provider'));

    const submit = async (e) => {
      e.preventDefault();
      if (!username.get()) return;
      await provider.login({ user: username.get() });
      username.set('');
    };

    return () => {
      const s = provider.session.get();
      return when(s,
        () => html`
          <p>Hi, <strong>${s.user}</strong>. Token expires in
            ${Math.max(0, Math.round((s.expiresAt - Date.now()) / 1000))}s.</p>
          <button @click=${() => provider.logout()}>Log out</button>
        `,
      ) ?? html`
        <form @submit=${submit}>
          <input placeholder="username" required
            .value=${username.get()}
            @input=${(/** @type {any} */ e) => username.set(e.target.value)}>
          <button class="primary" type="submit">Log in</button>
        </form>
      `;
    };
  },
});

// ---- Federated consumer (separate bundle) -------------------------------
lazyComponent({
  tag: 'x-private-info-lazy',
  src: new URL('./widgets/private-info.js', import.meta.url).href,
  as: 'x-private-info',
});
