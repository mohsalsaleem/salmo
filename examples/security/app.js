// Trusted Types demo, on top of lit-html.
//
// lit-html registers its own TT policy ("lit-html") on first use; that
// policy covers the framework's template parsing. The user-facing
// "trust me with this HTML" wrapper is the `unsafeHTML` directive,
// re-exported from our framework as a familiar name.
//
// Add the policy name to your CSP:
//
//   Content-Security-Policy:
//     require-trusted-types-for 'script';
//     trusted-types lit-html
//
// (see index.html in this folder for the meta-tag version).

import {
  defineComponent, html, Signal, unsafeHTML, render,
} from '../../src/index.js';

defineComponent({
  tag: 'x-tt-demo',
  setup() {
    const log = new Signal.State(/** @type {string[]} */ ([]));
    const append = (line) => log.set([...log.get(), line]);

    const tryRaw = () => {
      try {
        const div = document.createElement('div');
        div.innerHTML = '<em>raw assignment</em>';
        append('PLAIN el.innerHTML succeeded (TT not enforced?)');
      } catch (e) {
        append('PLAIN el.innerHTML refused: ' + (e instanceof Error ? e.message : String(e)));
      }
    };
    const tryFramework = () => {
      try {
        const out = document.querySelector('#sink2-out');
        render(html`<div>${unsafeHTML('<em>framework-routed</em>')}</div>`, out);
        append('framework unsafeHTML(...) succeeded');
      } catch (e) {
        append('framework unsafeHTML(...) threw: ' + (e instanceof Error ? e.message : String(e)));
      }
    };

    return () => html`
      <section class="good">
        <h2>Framework templates (Sink 1)</h2>
        <p>
          The framework's own template parsing works under TT — this
          paragraph came from <code>html\`\`</code>. lit-html parses
          through its own registered policy, no application code needed.
        </p>
      </section>

      <section>
        <h2>Direct DOM assignment (Sink 2)</h2>
        <p>Click the buttons; the log below records what happened.</p>
        <button @click=${tryRaw}>Try plain el.innerHTML = string</button>
        <button @click=${tryFramework}>Try framework unsafeHTML(...)</button>
        <div id="sink2-out"></div>
        <pre class="log">${log.get().join('\n') || '(nothing yet)'}</pre>
      </section>

      <section class="good">
        <h2>What the CSP looks like</h2>
        <pre>require-trusted-types-for 'script';
trusted-types lit-html</pre>
      </section>
    `;
  },
});
