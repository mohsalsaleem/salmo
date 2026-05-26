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
 * @property {() => boolean} [_isLive]
 */

/**
 * @typedef {Object} Source
 * @property {(sub: Subscriber) => void} _addSub
 * @property {(sub: Subscriber) => void} _removeSub
 * @property {() => number} _version
 * @property {() => void} _validate
 * @property {() => boolean} [_isPending]
 * @property {() => boolean} [_isLive]
 * @property {() => void} [_incrementLive]
 * @property {() => void} [_decrementLive]
 */

/** @type {Subscriber | null} */
let currentObserver = null;

// Set to true while a Watcher's notify callback is on the stack.
// The proposal prohibits signal reads and writes inside notify —
// the user has to schedule a microtask if they want to act on the change.
let inNotify = false;

/** @param {string} op */
function assertNotInNotify(op) {
  if (inNotify) {
    throw new Error(`Cannot ${op} a signal inside a Watcher's notify callback`);
  }
}

// Lifecycle hook symbols. Users pass functions under these keys in a
// signal's options bag to be notified when the signal goes live (has
// at least one transitive Watcher) or stops being live.
const watchedSymbol = Symbol('Signal.subtle.watched');
const unwatchedSymbol = Symbol('Signal.subtle.unwatched');

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
  #liveCount = 0;
  /** @type {((this: State<T>) => void) | undefined} */ #onWatched;
  /** @type {((this: State<T>) => void) | undefined} */ #onUnwatched;

  /**
   * @param {T} value
   * @param {EqualsOptions<T> & {[k: symbol]: ((this: State<T>) => void) | undefined}} [options]
   */
  constructor(value, options = {}) {
    this.#value = value;
    this.#equals = options.equals ?? Object.is;
    this.#onWatched = /** @type {any} */ (options[watchedSymbol]);
    this.#onUnwatched = /** @type {any} */ (options[unwatchedSymbol]);
  }

  // Liveness ---------------------------------------------------------
  _incrementLive() {
    this.#liveCount++;
    if (this.#liveCount === 1) this.#onWatched?.call(this);
  }
  _decrementLive() {
    this.#liveCount--;
    if (this.#liveCount === 0) this.#onUnwatched?.call(this);
  }

  /** @returns {T} */
  get() {
    assertNotInNotify('read');
    if (currentObserver) {
      this.#subs.add(currentObserver);
      currentObserver._trackDep?.(this, this.#version);
    }
    return this.#value;
  }

  /** @param {T} value */
  set(value) {
    assertNotInNotify('write');
    if (this.#equals.call(this, this.#value, value)) return;
    this.#value = value;
    this.#version++;
    for (const sub of [...this.#subs]) sub._notify(DIRTY);
  }

  // Internal source interface ---------------------------------------------
  /** @param {Subscriber} sub */ _addSub(sub) { this.#subs.add(sub); }
  /** @param {Subscriber} sub */ _removeSub(sub) { this.#subs.delete(sub); }
  _subsArray() { return [...this.#subs]; }
  _hasSubs() { return this.#liveCount > 0; }
  _version() { return this.#version; }
  _isLive() { return this.#liveCount > 0; }
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
  /** @type {unknown} */
  #error;
  #hasError = false;
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
  #liveCount = 0;
  /** @type {((this: Computed<T>) => void) | undefined} */ #onWatched;
  /** @type {((this: Computed<T>) => void) | undefined} */ #onUnwatched;

  /**
   * @param {() => T} fn
   * @param {EqualsOptions<T> & {[k: symbol]: ((this: Computed<T>) => void) | undefined}} [options]
   */
  constructor(fn, options = {}) {
    this.#fn = fn;
    this.#equals = options.equals ?? Object.is;
    this.#onWatched = /** @type {any} */ (options[watchedSymbol]);
    this.#onUnwatched = /** @type {any} */ (options[unwatchedSymbol]);
  }

  // Liveness ---------------------------------------------------------
  _incrementLive() {
    this.#liveCount++;
    if (this.#liveCount === 1) {
      this.#onWatched?.call(this);
      // Propagate to deps so they go live too.
      for (const dep of this.#deps.keys()) dep._incrementLive?.();
    }
  }
  _decrementLive() {
    this.#liveCount--;
    if (this.#liveCount === 0) {
      this.#onUnwatched?.call(this);
      for (const dep of this.#deps.keys()) dep._decrementLive?.();
    }
  }

  /** @returns {T} */
  get() {
    assertNotInNotify('read');
    this.#validate();
    if (currentObserver) {
      this.#subs.add(currentObserver);
      currentObserver._trackDep?.(this, this.#version);
    }
    if (this.#hasError) throw this.#error;
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
    // Snapshot old deps; rebuild from scratch so we can compute the
    // delta below — only really-removed deps should be torn down (and
    // only really-added ones should propagate liveness).
    const oldDeps = this.#deps;
    this.#deps = new Map();

    const prev = currentObserver;
    currentObserver = this;
    // outcome: 'value' = new value, 'unchanged' = equals said no diff,
    // 'error' = either fn() or equals() threw.
    /** @type {'value' | 'unchanged' | 'error'} */
    let outcome = 'value';
    /** @type {T | undefined} */
    let nextValue;
    /** @type {unknown} */
    let nextError;

    try {
      try {
        nextValue = this.#fn();
      } catch (e) {
        outcome = 'error';
        nextError = e;
      }
      // equals runs INSIDE the tracking context so anything it reads
      // becomes a dep of this computed (not of whoever was on the
      // stack before us — that would leak tracking info upward).
      if (outcome === 'value' && this.#everComputed && !this.#hasError) {
        try {
          if (this.#equals.call(
            this,
            /** @type {T} */ (this.#value),
            /** @type {T} */ (nextValue),
          )) {
            outcome = 'unchanged';
          }
        } catch (e) {
          outcome = 'error';
          nextError = e;
        }
      }
    } finally {
      currentObserver = prev;
    }

    // Deps that disappeared: unsubscribe + propagate unwatched if live.
    for (const dep of oldDeps.keys()) {
      if (!this.#deps.has(dep)) {
        dep._removeSub(this);
        if (this.#liveCount > 0) dep._decrementLive?.();
      }
    }
    // Deps that newly appeared: propagate watched if live.
    if (this.#liveCount > 0) {
      for (const dep of this.#deps.keys()) {
        if (!oldDeps.has(dep)) dep._incrementLive?.();
      }
    }

    if (outcome === 'value') {
      this.#value = nextValue;
      this.#hasError = false;
      this.#error = undefined;
      this.#version++;
    } else if (outcome === 'error') {
      this.#error = nextError;
      this.#hasError = true;
      this.#version++;
    } else if (this.#hasError) {
      // 'unchanged' but we were caching an error → clear it, bump version.
      this.#hasError = false;
      this.#error = undefined;
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
  _hasSubs() { return this.#liveCount > 0; }
  _version() { return this.#version; }
  _validate() { this.#validate(); }
  _isPending() { return this.#state !== CLEAN; }
  _isLive() { return this.#liveCount > 0; }
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
      if (this.#watching.has(s)) continue;
      this.#watching.add(s);
      s._addSub(this);
      s._incrementLive?.();
    }
  }

  /** @param {...Source} signals */
  unwatch(...signals) {
    for (const s of signals) {
      if (!this.#watching.has(s)) continue;
      this.#watching.delete(s);
      s._removeSub(this);
      s._decrementLive?.();
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
    const prevObs = currentObserver;
    const prevNotify = inNotify;
    currentObserver = null;
    inNotify = true;
    try { this.#notify.call(this); }
    finally { inNotify = prevNotify; currentObserver = prevObs; }
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
  if (x instanceof State || x instanceof Computed) {
    // Only sinks in a live observation chain count — non-live subs are
    // dangling tracking edges with no consumer that would re-run.
    return x._subsArray().filter((s) => s instanceof Watcher || s._isLive?.());
  }
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

/** @param {unknown} x */
function isState(x) { return x instanceof State; }
/** @param {unknown} x */
function isComputed(x) { return x instanceof Computed; }

export const Signal = {
  State,
  Computed,
  isState,
  isComputed,
  subtle: {
    Watcher,
    untrack,
    currentComputed,
    introspectSources,
    introspectSinks,
    hasSinks,
    watched: watchedSymbol,
    unwatched: unwatchedSymbol,
  },
};
