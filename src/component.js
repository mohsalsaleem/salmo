// Component layer, built on lit-html.
//
// Same defineComponent / props / emit API surface as before. The
// internals swap our hand-rolled fragment-and-effect dance for
// lit-html's `render()` + diff. setup() now returns either:
//
//   - a function (() => TemplateResult) — wrapped in an effect so any
//     signal read inside re-renders the component. This is the common
//     path; lit-html's diff makes "re-render the whole component" cheap.
//
//   - a TemplateResult directly — rendered once, no reactivity. Useful
//     for fully-static components.
//
//   - null/undefined — leave the host DOM untouched (enhance mode).

import { render } from 'lit-html';
import { Signal } from './signal.js';
import { effect } from './effect.js';
import { withScope } from './scope.js';

/** @typedef {import('lit-html').TemplateResult} TemplateResult */

/**
 * @typedef {Object} ComponentSpec
 * @property {string} tag
 * @property {(host: HTMLElement, props: Record<string, InstanceType<typeof Signal.State<unknown>>>, emit: (type: string, detail?: unknown) => void) => (() => TemplateResult) | TemplateResult | null | undefined} setup
 * @property {boolean} [shadow]
 * @property {readonly string[]} [props]
 */

/** @param {ComponentSpec} spec */
export function defineComponent({ tag, setup, shadow = false, props = [] }) {
  /** @type {WeakMap<HTMLElement, Record<string, InstanceType<typeof Signal.State<unknown>>>>} */
  const propBags = new WeakMap();

  class Component extends HTMLElement {
    /** @type {AbortController | null} */ #controller = null;
    /** @type {HTMLElement | ShadowRoot | null} */ #root = null;
    /** @type {boolean} */ #owned = false;

    static get observedAttributes() { return props; }

    constructor() {
      super();
      /** @type {Record<string, InstanceType<typeof Signal.State<unknown>>>} */
      const bag = {};
      for (const name of props) {
        const initial = this.hasAttribute(name) ? this.getAttribute(name) : undefined;
        bag[name] = new Signal.State(/** @type {unknown} */ (initial));
      }
      propBags.set(this, bag);
    }

    /** @param {string} name @param {string|null} _old @param {string|null} value */
    attributeChangedCallback(name, _old, value) {
      propBags.get(this)?.[name]?.set(value);
    }

    connectedCallback() {
      this.#controller = new AbortController();
      this.#root = shadow ? this.attachShadow({ mode: 'open' }) : this;
      const root = this.#root;
      /** @type {(type: string, detail?: unknown) => void} */
      const emit = (type, detail) => {
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
      };

      withScope({ signal: this.#controller.signal }, () => {
        const view = setup(
          this,
          /** @type {Record<string, InstanceType<typeof Signal.State<unknown>>>} */ (propBags.get(this) ?? {}),
          emit,
        );

        if (typeof view === 'function') {
          // Reactive path: each signal read inside the render fn becomes
          // a dep of this effect; on signal change, we ask lit-html to
          // re-render, and its template diff updates only what changed.
          effect(() => {
            render(/** @type {() => TemplateResult} */ (view)(), root);
          });
          this.#owned = true;
        } else if (view != null) {
          render(/** @type {TemplateResult} */ (view), root);
          this.#owned = true;
        }
      });
    }

    disconnectedCallback() {
      this.#controller?.abort();
      this.#controller = null;
      if (this.#owned && this.#root) {
        render(null, this.#root);
        this.#owned = false;
      }
    }
  }

  for (const name of props) {
    Object.defineProperty(Component.prototype, name, {
      get() { return propBags.get(this)?.[name]?.get(); },
      set(value) { propBags.get(this)?.[name]?.set(value); },
      enumerable: true,
      configurable: true,
    });
  }

  customElements.define(tag, Component);
  return Component;
}
