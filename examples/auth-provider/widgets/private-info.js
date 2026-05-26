// The federated consumer. Loaded from /examples/auth-provider/widgets/
// — different bundle path than the host's app.js. Reads the host's
// session signal via the closest('x-auth-provider') lookup and uses
// the host's fetchAuthed for an authenticated call.
//
// This is exactly the pattern a real federated widget would follow:
// no auth state of its own, no token storage, no refresh logic. The
// host owns all of that; the widget consumes.

import { defineComponent, html, Signal, when } from '../../../src/index.js';

defineComponent({
  tag: 'x-private-info',
  setup(host) {
    /** @type {any} */
    const provider = host.closest('x-auth-provider');
    if (!provider) {
      return () => html`<p style="color:#c00">No &lt;x-auth-provider&gt; ancestor.</p>`;
    }

    /** @type {Signal.State<{ user: string, serverTime: string } | null>} */
    const me = new Signal.State(null);
    /** @type {Signal.State<string | null>} */
    const error = new Signal.State(null);
    const busy = new Signal.State(false);

    const refresh = async () => {
      error.set(null);
      busy.set(true);
      try {
        const r = await provider.fetchAuthed('/demo-api/me');
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        me.set(await r.json());
      } catch (err) {
        error.set(err instanceof Error ? err.message : String(err));
        me.set(null);
      } finally {
        busy.set(false);
      }
    };

    return () => {
      const session = provider.session.get();
      return when(session,
        () => html`
          <button @click=${refresh} ?disabled=${busy.get()}>
            ${busy.get() ? 'Loading…' : 'Fetch /demo-api/me with the host’s token'}
          </button>
          ${error.get()
            ? html`<p style="color:#c00">${error.get()}</p>`
            : me.get()
              ? html`<pre style="background:#f4f4f4;padding:0.5rem;border-radius:4px">${JSON.stringify(me.get(), null, 2)}</pre>`
              : html`<p style="color:#888;font-size:0.85rem">click the button — the request will include the bearer the provider issued.</p>`}
        `,
      ) ?? html`<p style="color:#888">Log in above to use this widget.</p>`;
    };
  },
});
