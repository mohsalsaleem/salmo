// A from-scratch implementation of the TC39 Signals proposal.
// https://github.com/tc39/proposal-signals
//
// We expose a `Signal` namespace with:
//   - Signal.State    — writable reactive cell
//   - Signal.Computed — derived value, lazy + memoised
//   - Signal.subtle.* — low-level hooks for frameworks (added later)

// The signal currently being evaluated. When a State or Computed is read
// inside this context, the relationship is recorded so reads auto-track.
let currentObserver = null;

class State {
  #value;
  #subs = new Set();

  constructor(value) { this.#value = value; }

  get() {
    if (currentObserver) {
      this.#subs.add(currentObserver);
      currentObserver._addDep(this);
    }
    return this.#value;
  }

  set(value) {
    if (Object.is(value, this.#value)) return;
    this.#value = value;
    for (const sub of [...this.#subs]) sub._markDirty();
  }

  _addSub(sub) { this.#subs.add(sub); }
  _removeSub(sub) { this.#subs.delete(sub); }
}

class Computed {
  #fn;
  #value;
  #dirty = true;
  #deps = new Set();
  #subs = new Set();

  constructor(fn) { this.#fn = fn; }

  get() {
    if (currentObserver) {
      this.#subs.add(currentObserver);
      currentObserver._addDep(this);
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
    return this.#value;
  }

  _addDep(dep) { this.#deps.add(dep); }

  _markDirty() {
    if (this.#dirty) return;
    this.#dirty = true;
    for (const sub of [...this.#subs]) sub._markDirty();
  }

  _isDirty() { return this.#dirty; }
  _addSub(sub) { this.#subs.add(sub); }
  _removeSub(sub) { this.#subs.delete(sub); }
}

class Watcher {
  #notify;
  #armed = true;
  #watching = new Set();

  constructor(notify) { this.#notify = notify; }

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

  unwatch(...signals) {
    for (const s of signals) {
      this.#watching.delete(s);
      s._removeSub(this);
    }
  }

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
