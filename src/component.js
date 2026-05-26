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
//   - reactive properties: declare `props: ['item', 'editing']` and
//     `host.item = ...` from a parent flows into a Signal that setup()
//     can read, so child re-renders happen automatically

import { withScope } from './scope.js';
import { Signal } from './signal.js';

/**
 * @typedef {Node | DocumentFragment | null | undefined | void} SetupResult
 */

/**
 * @typedef {Object} ComponentSpec
 * @property {string} tag
 *   Custom element tag (must contain a hyphen).
 * @property {(host: HTMLElement, props: Record<string, InstanceType<typeof Signal.State<unknown>>>, emit: (type: string, detail?: unknown) => void) => SetupResult} setup
 *   Called on connect. Receives the host element, a `props` bag of
 *   Signals (one per name declared in `props`), and an `emit(type, detail)`
 *   that dispatches a bubbling CustomEvent — the sanctioned outbound
 *   channel for child-to-parent communication.
 *   Return a DocumentFragment (typically from html``) and the framework
 *   will append it to the host (or shadowRoot). Return null to skip the
 *   swap entirely.
 * @property {boolean} [shadow]
 *   Opt into Shadow DOM. Default false.
 * @property {readonly string[]} [props]
 *   Reactive property names. Each becomes a JS property on the host
 *   element; assignments push into a Signal.State that setup() reads.
 */

/**
 * Define a Custom Element backed by a setup() function. Returns the
 * constructor (rarely needed — `customElements.get(tag)` also works).
 *
 * @param {ComponentSpec} spec
 * @returns {CustomElementConstructor}
 */
export function defineComponent({ tag, setup, shadow = false, props = [] }) {
  // Each instance gets its own bag of Signals, keyed by prop name.
  /** @type {WeakMap<HTMLElement, Record<string, InstanceType<typeof Signal.State<unknown>>>>} */
  const propBags = new WeakMap();

  class Component extends HTMLElement {
    /** @type {AbortController | null} */
    #controller = null;
    /** @type {HTMLElement | ShadowRoot | null} */
    #root = null;
    /** @type {boolean} */
    #owned = false;

    // Declared so attribute mutations (including those present at
    // parse-time, like server-rendered <x-counter initial="42">) sync
    // into the prop signal. Attribute values are strings — that's the
    // SSR contract; rich values come in via property bindings.
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
      // emit(type, detail) — sanctioned outbound channel. Bubbles by
      // default so parent on*=${} handlers catch it regardless of how
      // the host is wrapped.
      /** @type {(type: string, detail?: unknown) => void} */
      const emit = (type, detail) => {
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
      };

      withScope({ signal: this.#controller.signal }, () => {
        // Run setup BEFORE clearing so it can read existing children
        // (e.g. to self-hydrate from no-JS fallback content).
        const view = setup(
          this,
          /** @type {Record<string, InstanceType<typeof Signal.State<unknown>>>} */ (propBags.get(this) ?? {}),
          emit,
        );

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
  }

  // Install reactive property accessors. Setting `host.item = x` pushes
  // into the per-instance Signal; reading returns the current value.
  for (const name of props) {
    Object.defineProperty(Component.prototype, name, {
      get() {
        return propBags.get(this)?.[name]?.get();
      },
      set(value) {
        propBags.get(this)?.[name]?.set(value);
      },
      enumerable: true,
      configurable: true,
    });
  }

  customElements.define(tag, Component);
  return Component;
}
