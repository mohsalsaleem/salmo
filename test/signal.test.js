import { describe, it, expect } from 'vitest';
import { Signal } from '../src/signal.js';

describe('Signal.State', () => {
  it('holds the initial value', () => {
    const count = new Signal.State(42);
    expect(count.get()).toBe(42);
  });

  it('updates via .set', () => {
    const count = new Signal.State(0);
    count.set(5);
    expect(count.get()).toBe(5);
  });

  it('does not invalidate dependents when set with an Object.is-equal value', () => {
    const count = new Signal.State(1);
    let runs = 0;
    const doubled = new Signal.Computed(() => { runs++; return count.get() * 2; });
    doubled.get();
    expect(runs).toBe(1);

    count.set(1);            // same value
    doubled.get();
    expect(runs).toBe(1);    // no re-run

    count.set(NaN); count.set(NaN); // Object.is(NaN, NaN) === true
    doubled.get();
    expect(runs).toBe(2);    // only first NaN-set invalidated
  });
});
