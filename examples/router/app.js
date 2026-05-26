// A complete router. Zero framework primitives beyond what we already
// have — the URL is just a Signal.State, navigation is a function that
// updates it, and rendering different views per path is `when()` calls.

import {
  defineComponent, html, Signal, when, classMap,
} from '../../src/index.js';

// ---- The router (the whole thing) ------------------------------------

const path = new Signal.State(location.pathname);
window.addEventListener('popstate', () => path.set(location.pathname));
const navigate = (to) => {
  history.pushState(null, '', to);
  path.set(to);
};
// Click handler: turn <a href> into history.pushState without a reload.
const onLinkClick = (e) => {
  const link = e.target.closest('a[href^="/"]');
  if (!link || e.metaKey || e.ctrlKey || e.button !== 0) return;
  e.preventDefault();
  navigate(link.getAttribute('href'));
};

// ---- Demo page using the router --------------------------------------

// Mount-path agnostic: derive the demo's URL prefix from where this
// script was loaded. Works whether served at /framework/examples/router/
// (integrated site) or /examples/router/ (standalone framework repo).
const BASE = new URL('.', import.meta.url).pathname.replace(/\/$/, '');

defineComponent({
  tag: 'x-router-demo',
  setup() {
    const here = () => path.get().replace(BASE, '') || '/';

    const Link = (to, label) => html`
      <a href=${BASE + to} class=${classMap({ active: here() === to })}>${label}</a>
    `;

    return () => html`
      <h1>Router demo</h1>
      <p>
        The whole router is 8 lines at the top of <code>app.js</code> —
        a <code>Signal.State</code> for the URL, a <code>navigate</code>
        function, and a click delegate for <code>&lt;a&gt;</code>
        elements. Path matching is just <code>when()</code>.
      </p>

      <nav @click=${onLinkClick}>
        ${Link('/', 'Home')}
        ${Link('/about', 'About')}
        ${Link('/contact', 'Contact')}
      </nav>

      <section>
        ${when(here() === '/', () => html`
          <h2>Home</h2>
          <p>This view is shown when path is /.</p>
        `)}
        ${when(here() === '/about', () => html`
          <h2>About</h2>
          <p>Built on salmo with zero router primitives.</p>
        `)}
        ${when(here() === '/contact', () => html`
          <h2>Contact</h2>
          <p>This is a static contact page rendered by the router.</p>
        `)}
      </section>

      <p style="color:#888;font-size:0.9rem;margin-top:2rem;">
        Try clicking the links — the URL changes (check the address
        bar) and the section updates reactively without reload.
        Browser back/forward also work, because <code>popstate</code>
        feeds the same signal.
      </p>
    `;
  },
});
