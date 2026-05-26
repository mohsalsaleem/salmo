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
    this.#value = value;
    for (const sub of [...this.#subs]) sub._markDirty();
  }

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

  _removeSub(sub) { this.#subs.delete(sub); }
}

export const Signal = { State, Computed };
