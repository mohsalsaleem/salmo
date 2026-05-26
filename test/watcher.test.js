import { describe, it, expect } from 'vitest';
import { Signal } from '../src/signal.js';

describe('Signal.subtle.Watcher', () => {
  it('calls notify synchronously when a watched State changes', () => {
    const a = new Signal.State(0);
    let calls = 0;
    const w = new Signal.subtle.Watcher(() => { calls++; });
    w.watch(a);

    a.set(1);
    expect(calls).toBe(1);
  });

  it('is one-shot: does not fire again until re-armed', () => {
    const a = new Signal.State(0);
    let calls = 0;
    const w = new Signal.subtle.Watcher(() => { calls++; });
    w.watch(a);

    a.set(1);
    expect(calls).toBe(1);
    a.set(2);                  // not re-armed
    expect(calls).toBe(1);

    w.watch();                 // re-arm with no args
    a.set(3);
    expect(calls).toBe(2);
  });

  it('does not fire after unwatch', () => {
    const a = new Signal.State(0);
    let calls = 0;
    const w = new Signal.subtle.Watcher(() => { calls++; });
    w.watch(a);
    w.unwatch(a);

    a.set(1);
    expect(calls).toBe(0);
  });

  it('fires when a watched Computed becomes dirty', () => {
    const a = new Signal.State(0);
    const b = new Signal.Computed(() => a.get() * 2);
    b.get();                   // establish: not dirty

    let calls = 0;
    const w = new Signal.subtle.Watcher(() => { calls++; });
    w.watch(b);

    a.set(1);
    expect(calls).toBe(1);
  });

  it('getPending returns currently-dirty watched computeds', () => {
    const a = new Signal.State(0);
    const b = new Signal.Computed(() => a.get() * 2);
    b.get();

    const w = new Signal.subtle.Watcher(() => {});
    w.watch(b);

    expect(w.getPending()).toEqual([]);
    a.set(1);
    expect(w.getPending()).toEqual([b]);
    b.get();
    expect(w.getPending()).toEqual([]);
  });

  it('prohibits signal reads and writes inside notify (spec-strict)', () => {
    const a = new Signal.State(0);
    let err;
    const w = new Signal.subtle.Watcher(() => {
      try { a.get(); } catch (e) { err = e; }
    });
    w.watch(a);
    a.set(1);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toMatch(/Watcher/);
  });
});
