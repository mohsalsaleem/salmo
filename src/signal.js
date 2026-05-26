// A from-scratch implementation of the TC39 Signals proposal.
// https://github.com/tc39/proposal-signals
//
// We expose a `Signal` namespace with:
//   - Signal.State    — writable reactive cell
//   - Signal.Computed — derived value, lazy + memoised
//   - Signal.subtle.* — low-level hooks for frameworks (added later)

/**
 * @typedef {Object} Subscriber
 * @property {() => void} _markDirty
 * @property {(dep: Source) => void} [_addDep]
 */

/**
 * @typedef {Object} Source
 * @property {(sub: Subscriber) => void} _addSub
 * @property {(sub: Subscriber) => void} _removeSub
 * @property {() => boolean} [_isDirty]
 */

// The signal currently being evaluated. When a State or Computed is read
// inside this context, the relationship is recorded so reads auto-track.
/** @type {Subscriber | null} */
let currentObserver = null;

/**
 * @template T
 */
class State {
  /** @type {T} */
  #value;
  /** @type {Set<Subscriber>} */
  #subs = new Set();

  /** @param {T} value */
  constructor(value) { this.#value = value; }

  /** @returns {T} */
  get() {
    if (currentObserver) {
      this.#subs.add(currentObserver);
      currentObserver._addDep?.(this);
    }
    return this.#value;
  }

  /** @param {T} value */
  set(value) {
    if (Object.is(value, this.#value)) return;
    this.#value = value;
    for (const sub of [...this.#subs]) sub._markDirty();
  }

  /** @param {Subscriber} sub */
  _addSub(sub) { this.#subs.add(sub); }
  /** @param {Subscriber} sub */
  _removeSub(sub) { this.#subs.delete(sub); }
}

/**
 * @template T
 */
class Computed {
  /** @type {() => T} */
  #fn;
  /** @type {T | undefined} */
  #value;
  #dirty = true;
  /** @type {Set<Source>} */
  #deps = new Set();
  /** @type {Set<Subscriber>} */
  #subs = new Set();

  /** @param {() => T} fn */
  constructor(fn) { this.#fn = fn; }

  /** @returns {T} */
  get() {
    if (currentObserver) {
      this.#subs.add(currentObserver);
      currentObserver._addDep?.(this);
    }
    if (this.#dirty) {
      // Drop stale dep links — we rebuild them as we re-run.
      for (const dep of this.#deps) dep._removeSub(this);
      this.#deps.clear();

      const prev = currentObserver;
      currentObserver = this;
      try { this.#value = this.#fn(); }
      finally { currentObserver = prev; }

      this.#dirty = false;
    }
    return /** @type {T} */ (this.#value);
  }

  /** @param {Source} dep */
  _addDep(dep) { this.#deps.add(dep); }

  _markDirty() {
    if (this.#dirty) return;
    this.#dirty = true;
    for (const sub of [...this.#subs]) sub._markDirty();
  }

  _isDirty() { return this.#dirty; }
  /** @param {Subscriber} sub */
  _addSub(sub) { this.#subs.add(sub); }
  /** @param {Subscriber} sub */
  _removeSub(sub) { this.#subs.delete(sub); }
}

class Watcher {
  /** @type {() => void} */
  #notify;
  #armed = true;
  /** @type {Set<Source>} */
  #watching = new Set();

  /** @param {() => void} notify */
  constructor(notify) { this.#notify = notify; }

  /** @param {...Source} signals */
  watch(...signals) {
    if (signals.length === 0) {
      this.#armed = true;
      return;
    }
    for (const s of signals) {
      this.#watching.add(s);
      s._addSub(this);
    }
  }

  /** @param {...Source} signals */
  unwatch(...signals) {
    for (const s of signals) {
      this.#watching.delete(s);
      s._removeSub(this);
    }
  }

  /** @returns {Source[]} */
  getPending() {
    return [...this.#watching].filter(s => s._isDirty?.());
  }

  _markDirty() {
    if (!this.#armed) return;
    this.#armed = false;
    // Per the proposal: notify runs in an untracked context.
    const prev = currentObserver;
    currentObserver = null;
    try { this.#notify(); }
    finally { currentObserver = prev; }
  }

  // Watchers are never themselves observed.
  _addDep() {}
}

export const Signal = { State, Computed, subtle: { Watcher } };
