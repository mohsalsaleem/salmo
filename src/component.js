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

export function defineComponent({ tag, setup, shadow = false }) {
  class Component extends HTMLElement {
    #controller;
    #root;

    connectedCallback() {
      this.#controller = new AbortController();
      this.#root = shadow ? this.attachShadow({ mode: 'open' }) : this;

      withScope({ signal: this.#controller.signal }, () => {
        const view = setup(this);
        if (view != null) this.#root.append(view);
      });
    }

    disconnectedCallback() {
      this.#controller?.abort();
      this.#controller = null;
      while (this.#root?.firstChild) this.#root.removeChild(this.#root.firstChild);
    }
  }
  customElements.define(tag, Component);
  return Component;
}
