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

import { render } from '../vendor/lit-html/lit-html.js';
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
 * @property {(err: Error, host: HTMLElement) => TemplateResult | Node | null} [onError]
 *   Error boundary. If setup() throws, or the render function throws
 *   on any (re)render, the framework calls onError(err, host) and
 *   renders its result in place. Without onError, errors are logged
 *   to the console and re-thrown — the same behaviour you'd get
 *   without a boundary, but contained to the component.
 */

/**
 * @param {ComponentSpec} spec
 * @returns {CustomElementConstructor}
 */
export function defineComponent({ tag, setup, shadow = false, props = [], onError }) {
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

    /** @param {Error} err */
    #renderError(err) {
      // eslint-disable-next-line no-console
      console.error(`[${tag}] error in setup/render:`, err);
      if (!onError) {
        // No boundary: re-throw so the failure isn't silent. lit-html
        // hasn't necessarily committed; clear the root to avoid showing
        // half-rendered content alongside the console error.
        if (this.#root) {
          while (this.#root.firstChild) this.#root.removeChild(this.#root.firstChild);
        }
        throw err;
      }
      const result = onError(err, this);
      if (result == null) return;
      if (this.#root) {
        if (typeof (/** @type {any} */ (result).nodeType) === 'number') {
          while (this.#root.firstChild) this.#root.removeChild(this.#root.firstChild);
          this.#root.appendChild(/** @type {Node} */ (result));
        } else {
          render(/** @type {TemplateResult} */ (result), this.#root);
        }
      }
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
        /** @type {(() => TemplateResult) | TemplateResult | null | undefined} */
        let view;
        try {
          view = setup(
            this,
            /** @type {Record<string, InstanceType<typeof Signal.State<unknown>>>} */ (propBags.get(this) ?? {}),
            emit,
          );
        } catch (err) {
          this.#renderError(err instanceof Error ? err : new Error(String(err)));
          return;
        }

        if (view != null) {
          while (root.firstChild) root.removeChild(root.firstChild);
        }

        if (typeof view === 'function') {
          const renderFn = /** @type {() => TemplateResult} */ (view);
          effect(() => {
            try {
              render(renderFn(), root);
            } catch (err) {
              this.#renderError(err instanceof Error ? err : new Error(String(err)));
            }
          });
          this.#owned = true;
        } else if (view != null) {
          try {
            render(/** @type {TemplateResult} */ (view), root);
            this.#owned = true;
          } catch (err) {
            this.#renderError(err instanceof Error ? err : new Error(String(err)));
          }
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
