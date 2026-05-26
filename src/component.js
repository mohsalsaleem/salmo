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

      withScope({ signal: this.#controller.signal }, () => {
        const view = setup(this);
        if (view != null) /** @type {HTMLElement | ShadowRoot} */ (this.#root).append(view);
      });
    }

    disconnectedCallback() {
      this.#controller?.abort();
      this.#controller = null;
      const root = this.#root;
      while (root?.firstChild) root.removeChild(root.firstChild);
    }
  }
  customElements.define(tag, Component);
  return Component;
}
