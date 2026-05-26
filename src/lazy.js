// lazyComponent({ tag, src, as, fallback }) — federation's loading primitive.
//
// Defines a Custom Element under `tag` that, on first connect, dynamically
// import()s `src` and then mounts the *real* component (registered by the
// remote module under `as`) inside itself, forwarding the placeholder's
// attributes. Loading is a first-class state, not a try/catch around
// `await import()`.
//
//   lazyComponent({
//     tag: 'acme-calendar-lazy',
//     src: 'https://acme.example.com/calendar.js',
//     as: 'acme-calendar',                  // the real tag the remote registers
//     fallback: () => html`<p>Loading…</p>`,
//   });
//
// Trust: loading a remote .js runs that code with your origin's privileges.
// Use only sources you trust. There's no sandboxing path that preserves
// shared signals.

/** @typedef {Object} LazySpec
 *  @property {string} tag              Tag the placeholder registers under.
 *  @property {string} src              Module URL to import().
 *  @property {string} [as]             Real tag the remote registers (default: same as `tag`+ '-' breaks; you must override).
 *  @property {() => Node | DocumentFragment} [fallback]    Placeholder while loading / on error.
 */

/** Shared promises so concurrent lazy elements pointing at the same src
 *  do not trigger N parallel imports. @type {Map<string, Promise<void>>} */
const inFlight = new Map();

/**
 * @param {LazySpec} spec
 */
export function lazyComponent({ tag, src, as, fallback }) {
  if (!as) throw new Error('lazyComponent: `as` (the real tag the remote registers) is required');
  if (as === tag) throw new Error('lazyComponent: `as` must differ from `tag` (the placeholder cannot reuse the real tag)');
  const realTag = /** @type {string} */ (as);

  class LazyElement extends HTMLElement {
    connectedCallback() {
      // Render the fallback synchronously.
      if (fallback) {
        const node = fallback();
        if (node) this.append(node);
      }

      let p = inFlight.get(src);
      if (!p) {
        p = import(src).then(() => undefined);
        inFlight.set(src, p);
      }

      p.then(
        () => {
          if (!this.isConnected) return;
          if (!customElements.get(realTag)) {
            this.dispatchEvent(new CustomEvent('lazy-error', {
              detail: { src, error: new Error(`module loaded but no element registered as <${as}>`) },
              bubbles: true,
            }));
            return;
          }
          this.replaceChildren();
          const real = document.createElement(realTag);
          // Forward attributes so usage like <my-lazy data-foo="x"> reaches
          // the real element. Property bindings need to be set on the lazy
          // host directly (see examples/federation/) — that's a follow-up.
          for (const attr of [...this.attributes]) {
            real.setAttribute(attr.name, attr.value);
          }
          this.append(real);
        },
        (err) => {
          if (!this.isConnected) return;
          this.dispatchEvent(new CustomEvent('lazy-error', {
            detail: { src, error: err }, bubbles: true,
          }));
        },
      );
    }

    disconnectedCallback() {
      while (this.firstChild) this.removeChild(this.firstChild);
    }
  }
  customElements.define(tag, LazyElement);
  return LazyElement;
}
