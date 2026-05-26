// Manifest Explorer — paste a federation manifest URL, see what
// components it offers, register them via loadFromManifest, and live-
// preview each one.

import {
  defineComponent, html, Signal, loadFromManifest,
} from '../../src/index.js';

defineComponent({
  tag: 'x-manifest-explorer',
  setup() {
    const defaultUrl = new URL('../dashboard/widgets/manifest.json', import.meta.url).href;
    const url = new Signal.State(defaultUrl);
    const manifest = new Signal.State(/** @type {any} */ (null));
    const error = new Signal.State(/** @type {string | null} */ (null));

    const load = async () => {
      error.set(null);
      manifest.set(null);
      try {
        const m = await loadFromManifest(url.get());
        manifest.set(m);
      } catch (err) {
        error.set(err instanceof Error ? err.message : String(err));
      }
    };

    const suggestions = [
      ['Dashboard widgets', defaultUrl],
    ];

    return () => html`
      <h1>Federation Manifest Explorer</h1>
      <p>
        Paste a manifest URL — the framework fetches it, validates the
        schema, and lazy-registers every component listed. Each gets a
        live preview below.
      </p>

      <form @submit=${(e) => { e.preventDefault(); load(); }}>
        <input type="url" required
          .value=${url.get()}
          @input=${(e) => url.set(e.target.value)}
          placeholder="https://example.com/manifest.json">
        <button type="submit">Load</button>
      </form>

      <div class="suggestions">
        Try: ${suggestions.map(([label, u], i) => html`<a
          @click=${() => { url.set(u); load(); }}
        >${label}</a>${i < suggestions.length - 1 ? ' · ' : ''}`)}
      </div>

      ${error.get() ? html`<div class="error">${error.get()}</div>` : ''}

      ${manifest.get() ? renderManifest(manifest.get()) : ''}
    `;
  },
});

/** @param {any} m */
function renderManifest(m) {
  return html`
    <div class="manifest-meta">
      <strong>${m.name}</strong> v${m.version}
      ${m.framework ? html` · framework: ${m.framework.name}${m.framework.minVersion ? ` ≥ ${m.framework.minVersion}` : ''}` : ''}
      · ${m.components.length} component${m.components.length === 1 ? '' : 's'}
    </div>

    ${m.components.map((/** @type {any} */ c) => html`
      <div class="component-card">
        <h3>&lt;${c.tag}&gt;</h3>
        <div class="src">src: ${c.src}</div>
        ${(c.props?.length ?? 0) > 0 ? html`
          <p style="margin:0.5rem 0 0.2rem;font-size:0.9rem;">props:</p>
          <pre>${JSON.stringify(c.props, null, 2)}</pre>
        ` : ''}
        ${(c.events?.length ?? 0) > 0 ? html`
          <p style="margin:0.5rem 0 0.2rem;font-size:0.9rem;">events:</p>
          <pre>${JSON.stringify(c.events, null, 2)}</pre>
        ` : ''}
        <p style="margin:0.5rem 0 0.2rem;font-size:0.9rem;">live preview:</p>
        <div class="preview">
          ${previewElementHtml(c.tag)}
        </div>
      </div>
    `)}
  `;
}

/** Use innerHTML so we can produce a custom element by its dynamic tag.
 *  lit-html's tagged templates don't substitute tag names, so we use a
 *  thin escape hatch here (the tag is validated to contain only safe
 *  characters by loadFromManifest's validator).
 *  @param {string} tag
 */
function previewElementHtml(tag) {
  const wrapper = document.createElement('div');
  // lazyComponent registered `${tag}-lazy` for us.
  wrapper.innerHTML = `<${tag}-lazy></${tag}-lazy>`;
  return wrapper;
}
