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
});
