// A from-scratch implementation of the TC39 Signals proposal.
// https://github.com/tc39/proposal-signals
//
// Internals follow the 3-state lazy-validation model used by Solid /
// Vue / Preact / the polyfill: a Computed is CLEAN, CHECK, or DIRTY.
// State changes mark direct subscribers DIRTY and transitive subs
// CHECK. On read, a CHECK Computed re-validates its deps by version
// number — if no dep's value actually changed, it stays CLEAN and
// downstream subs never re-run (this is what custom equality buys).

const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;

/**
 * @typedef {Object} Subscriber
 * @property {(mark: 1 | 2) => void} _notify
 * @property {(source: Source, version: number) => void} [_trackDep]
 */

/**
 * @typedef {Object} Source
 * @property {(sub: Subscriber) => void} _addSub
 * @property {(sub: Subscriber) => void} _removeSub
 * @property {() => number} _version
 * @property {() => void} _validate
 * @property {() => boolean} [_isPending]
 */

/** @type {Subscriber | null} */
let currentObserver = null;

/**
 * @template T
 * @typedef {Object} EqualsOptions
 * @property {(a: T, b: T) => boolean} [equals]
 */

/**
 * @template T
 */
class State {
  /** @type {T} */
  #value;
  /** @type {Set<Subscriber>} */
  #subs = new Set();
  /** @type {(a: T, b: T) => boolean} */
  #equals;
  #version = 0;

  /**
   * @param {T} value
   * @param {EqualsOptions<T>} [options]
   */
  constructor(value, options = {}) {
    this.#value = value;
    this.#equals = options.equals ?? Object.is;
  }

  /** @returns {T} */
  get() {
    if (currentObserver) {
      this.#subs.add(currentObserver);
      currentObserver._trackDep?.(this, this.#version);
    }
    return this.#value;
  }

  /** @param {T} value */
  set(value) {
    if (this.#equals.call(this, this.#value, value)) return;
    this.#value = value;
    this.#version++;
    for (const sub of [...this.#subs]) sub._notify(DIRTY);
  }

  // Internal source interface ---------------------------------------------
  /** @param {Subscriber} sub */ _addSub(sub) { this.#subs.add(sub); }
  /** @param {Subscriber} sub */ _removeSub(sub) { this.#subs.delete(sub); }
  _subsArray() { return [...this.#subs]; }
  _hasSubs() { return this.#subs.size > 0; }
  _version() { return this.#version; }
  /** States are always valid — nothing to validate. */
  _validate() {}
}

/**
 * @template T
 */
class Computed {
  /** @type {() => T} */
  #fn;
  /** @type {T | undefined} */
  #value;
  /** @type {(a: T, b: T) => boolean} */
  #equals;
  #version = 0;
  #everComputed = false;
  /** @type {0 | 1 | 2} */
  #state = DIRTY;
  /** @type {Map<Source, number>} */
  #deps = new Map();
  /** @type {Set<Subscriber>} */
  #subs = new Set();

  /**
   * @param {() => T} fn
   * @param {EqualsOptions<T>} [options]
   */
  constructor(fn, options = {}) {
    this.#fn = fn;
    this.#equals = options.equals ?? Object.is;
  }

  /** @returns {T} */
  get() {
    this.#validate();
    if (currentObserver) {
      this.#subs.add(currentObserver);
      currentObserver._trackDep?.(this, this.#version);
    }
    return /** @type {T} */ (this.#value);
  }

  #validate() {
    if (this.#state === CLEAN) return;
    if (this.#state === CHECK) {
      // Each dep may itself be CHECK — validate it first, then look at
      // whether its version moved. Only an actual value change (which
      // is what bumps version) promotes us to DIRTY.
      for (const [dep, recordedVersion] of this.#deps) {
        dep._validate();
        if (dep._version() !== recordedVersion) {
          this.#state = DIRTY;
          break;
        }
      }
      if (this.#state === CHECK) {
        this.#state = CLEAN;
        return;
      }
    }
    this.#recompute();
  }

  #recompute() {
    // Tear down old subscriptions; the run rebuilds them.
    for (const dep of this.#deps.keys()) dep._removeSub(this);
    this.#deps.clear();

    const prev = currentObserver;
    currentObserver = this;
    /** @type {T} */
    let next;
    try { next = this.#fn(); }
    finally { currentObserver = prev; }

    // First compute always stores the value (no prior value to compare).
    if (!this.#everComputed || !this.#equals.call(this, /** @type {T} */ (this.#value), next)) {
      this.#value = next;
      this.#version++;
    }
    this.#everComputed = true;
    this.#state = CLEAN;
  }

  // Subscriber interface --------------------------------------------------
  /** @param {1 | 2} mark */
  _notify(mark) {
    if (mark === DIRTY) {
      if (this.#state === DIRTY) return;
      const wasClean = this.#state === CLEAN;
      this.#state = DIRTY;
      if (wasClean) {
        for (const sub of [...this.#subs]) sub._notify(CHECK);
      }
    } else {
      if (this.#state !== CLEAN) return;
      this.#state = CHECK;
      for (const sub of [...this.#subs]) sub._notify(CHECK);
    }
  }

  /** @param {Source} source @param {number} version */
  _trackDep(source, version) { this.#deps.set(source, version); }

  // Source interface ------------------------------------------------------
  /** @param {Subscriber} sub */ _addSub(sub) { this.#subs.add(sub); }
  /** @param {Subscriber} sub */ _removeSub(sub) { this.#subs.delete(sub); }
  _subsArray() { return [...this.#subs]; }
  _hasSubs() { return this.#subs.size > 0; }
  _version() { return this.#version; }
  _validate() { this.#validate(); }
  _isPending() { return this.#state !== CLEAN; }
  _depsArray() { return [...this.#deps.keys()]; }
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
    return [...this.#watching].filter((s) => s._isPending?.());
  }

  /** @param {1 | 2} _mark */
  _notify(_mark) {
    if (!this.#armed) return;
    this.#armed = false;
    const prev = currentObserver;
    currentObserver = null;
    try { this.#notify.call(this); }
    finally { currentObserver = prev; }
  }

  // Watchers don't track deps — they only sit at the bottom.
  _trackDep() {}

  _sourcesArray() { return [...this.#watching]; }
}

// Public Signal.subtle surface ------------------------------------------

/**
 * @param {unknown} x
 * @returns {unknown[]}
 */
function introspectSources(x) {
  if (x instanceof Watcher) return x._sourcesArray();
  if (x instanceof Computed) return x._depsArray();
  throw new TypeError('Signal.subtle.introspectSources expects a Watcher or Computed');
}

/**
 * @param {unknown} x
 * @returns {unknown[]}
 */
function introspectSinks(x) {
  if (x instanceof State || x instanceof Computed) return x._subsArray();
  throw new TypeError('Signal.subtle.introspectSinks expects a State or Computed');
}

/**
 * @param {unknown} x
 * @returns {boolean}
 */
function hasSinks(x) {
  if (x instanceof State || x instanceof Computed) return x._hasSubs();
  throw new TypeError('Signal.subtle.hasSinks expects a State or Computed');
}

/**
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function untrack(fn) {
  const prev = currentObserver;
  currentObserver = null;
  try { return fn(); }
  finally { currentObserver = prev; }
}

/** @returns {Computed<unknown> | undefined} */
function currentComputed() {
  return currentObserver instanceof Computed
    ? /** @type {Computed<unknown>} */ (currentObserver)
    : undefined;
}

export const Signal = {
  State,
  Computed,
  subtle: {
    Watcher,
    untrack,
    currentComputed,
    introspectSources,
    introspectSinks,
    hasSinks,
  },
};
