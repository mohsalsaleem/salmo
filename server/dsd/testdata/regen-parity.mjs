// regen-parity.mjs — regenerates the expected Node outputs that
// parity_test.go pins. Run from the repo root:
//
//   node server/dsd/testdata/regen-parity.mjs
//
// Diff the printed strings against the wantNormalized constants in
// server/dsd/parity_test.go. If they diverge:
//
//   (a) the Go renderer drifted from the spec — fix server/dsd/dsd.go
//   (b) the Node renderer / lit-html / happy-dom changed — update the
//       parity_test.go constants AND check whether SSR.md needs a
//       spec amendment for the change
//
// SSR.md defines "semantic parity": same DOM tree after browser parse
// ignoring HTML comments. This script strips comments before printing
// so the output is directly comparable to the wantNormalized strings.
//
// To add a new parity case, add a defineComponent + console.log here
// and a corresponding fixture + checkParity in parity_test.go — same
// commit.

import { setupDOM, renderToString } from '../../../src/ssr.js';
await setupDOM();
const { defineComponent, html } = await import('../../../src/index.js');

function strip(s) { return s.replace(/<!--[\s\S]*?-->/g, ''); }

defineComponent({
  tag: 'p-light',
  setup: () => html`<p>hi</p>`,
});
console.log('LightDOM:            ', strip(renderToString('p-light')));

defineComponent({
  tag: 'p-shadow',
  shadow: true,
  setup: () => html`<style>p{color:red}</style><p>scoped</p>`,
});
console.log('ShadowDOM:           ', strip(renderToString('p-shadow')));

defineComponent({
  tag: 'p-attr',
  props: ['cls'],
  setup: (h, p) => () => {
    h.setAttribute('class', p.cls.get());
    return html`<p>hi</p>`;
  },
});
console.log('AttributeAmpAndLT:   ', strip(renderToString('p-attr', { cls: 'foo<bar&baz' })));
console.log('AttributeQuoteEscape:', strip(renderToString('p-attr', { cls: 'say "hi"' })));
