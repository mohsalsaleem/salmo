import { describe, it, expect } from 'vitest';
import { Signal } from '../src/signal.js';

describe('Signal.Computed', () => {
  it('derives a value from a state', () => {
    const count = new Signal.State(2);
    const doubled = new Signal.Computed(() => count.get() * 2);
    expect(doubled.get()).toBe(4);
  });

  it('recomputes when its dep changes', () => {
    const count = new Signal.State(2);
    const doubled = new Signal.Computed(() => count.get() * 2);
    expect(doubled.get()).toBe(4);
    count.set(5);
    expect(doubled.get()).toBe(10);
  });

  it('caches until a dep changes', () => {
    const count = new Signal.State(2);
    let runs = 0;
    const doubled = new Signal.Computed(() => { runs++; return count.get() * 2; });
    doubled.get(); doubled.get(); doubled.get();
    expect(runs).toBe(1);

    count.set(3);
    doubled.get(); doubled.get();
    expect(runs).toBe(2);
  });

  it('composes computeds', () => {
    const a = new Signal.State(1);
    const b = new Signal.Computed(() => a.get() + 1);
    const c = new Signal.Computed(() => b.get() * 10);
    expect(c.get()).toBe(20);
    a.set(4);
    expect(c.get()).toBe(50);
  });
});
