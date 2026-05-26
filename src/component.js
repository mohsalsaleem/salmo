// defineComponent — a thin wrapper around `class extends HTMLElement`.
//
// Standards-rooted: the component IS a real Custom Element. The
// lifecycle is the platform's (connectedCallback/disconnectedCallback);
// disposal is the platform's (AbortController/AbortSignal). The framework
// only contributes:
//   - a withScope wrapper so signals inside setup() are tied to the
//     element's lifetime
//   - optional Shadow DOM mounting
//   - automatic DOM teardown on disconnect

import { withScope } from './scope.js';

/**
 * @typedef {Node | DocumentFragment | null | undefined | void} SetupResult
 */

/**
 * @typedef {Object} ComponentSpec
 * @property {string} tag                Custom element tag (must contain a hyphen).
 * @property {(host: HTMLElement) => SetupResult} setup
 *   Called on connect. Return a DocumentFragment (typically from html``)
 *   and the framework will append it to the host (or shadowRoot).
 * @property {boolean} [shadow]          Opt into Shadow DOM. Default false.
 */

/**
 * Define a Custom Element backed by a setup() function. Returns the
 * constructor (rarely needed — `customElements.get(tag)` also works).
 *
 * @param {ComponentSpec} spec
 * @returns {CustomElementConstructor}
 */
export function defineComponent({ tag, setup, shadow = false }) {
  class Component extends HTMLElement {
    /** @type {AbortController | null} */
    #controller = null;
    /** @type {HTMLElement | ShadowRoot | null} */
    #root = null;

    connectedCallback() {
      this.#controller = new AbortController();
      this.#root = shadow ? this.attachShadow({ mode: 'open' }) : this;
      const root = this.#root;

      withScope({ signal: this.#controller.signal }, () => {
        // Run setup BEFORE clearing so it can read existing children
        // (e.g. to self-hydrate from no-JS fallback content).
        const view = setup(this);

        // Replace mode: setup returned a view → swap children with view.
        // Enhance mode: setup returned null → leave existing DOM intact.
        if (view != null) {
          while (root.firstChild) root.removeChild(root.firstChild);
          root.append(view);
          this.#owned = true;
        }
      });
    }

    disconnectedCallback() {
      this.#controller?.abort();
      this.#controller = null;
      if (this.#owned) {
        const root = this.#root;
        while (root?.firstChild) root.removeChild(root.firstChild);
        this.#owned = false;
      }
    }

    /** @type {boolean} */
    #owned = false;
  }
  customElements.define(tag, Component);
  return Component;
}
