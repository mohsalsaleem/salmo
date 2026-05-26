import { describe, it, expect } from 'vitest';
import { Signal } from '../src/signal.js';

describe('Signal.subtle.untrack', () => {
  it('reads inside untrack do not become dependencies', () => {
    const a = new Signal.State(1);
    const b = new Signal.State(10);
    let runs = 0;
    const c = new Signal.Computed(() => {
      runs++;
      return a.get() + Signal.subtle.untrack(() => b.get());
    });
    expect(c.get()).toBe(11);
    expect(runs).toBe(1);

    b.set(20);                // not a dep
    expect(c.get()).toBe(11); // cached
    expect(runs).toBe(1);

    a.set(2);                 // is a dep
    expect(c.get()).toBe(22); // re-runs, picks up new b
    expect(runs).toBe(2);
  });
});

describe('Signal.subtle.currentComputed', () => {
  it('returns the active Computed during evaluation, else undefined', () => {
    expect(Signal.subtle.currentComputed()).toBe(undefined);
    let inside;
    const c = new Signal.Computed(() => { inside = Signal.subtle.currentComputed(); return 1; });
    c.get();
    expect(inside).toBe(c);
    expect(Signal.subtle.currentComputed()).toBe(undefined);
  });
});

describe('Signal.subtle introspection', () => {
  it('hasSinks tracks live observation, not dangling tracking edges', () => {
    const s = new Signal.State(0);
    expect(Signal.subtle.hasSinks(s)).toBe(false);
    const c = new Signal.Computed(() => s.get());
    c.get();
    // c is not watched → not live → s has no live sinks
    expect(Signal.subtle.hasSinks(s)).toBe(false);

    const w = new Signal.subtle.Watcher(() => {});
    w.watch(c);
    c.get(); // re-runs deps tracking under live observation
    expect(Signal.subtle.hasSinks(s)).toBe(true);

    w.unwatch(c);
    expect(Signal.subtle.hasSinks(s)).toBe(false);
  });

  it('introspectSinks returns only live downstream subscribers', () => {
    const s = new Signal.State(0);
    const c = new Signal.Computed(() => s.get());
    c.get();
    expect(Signal.subtle.introspectSinks(s)).toStrictEqual([]);

    const w = new Signal.subtle.Watcher(() => {});
    w.watch(c);
    c.get();
    expect(Signal.subtle.introspectSinks(s)).toContain(c);
  });

  it('introspectSources returns deps of a Computed and sources of a Watcher', () => {
    const a = new Signal.State(1);
    const b = new Signal.State(2);
    const c = new Signal.Computed(() => a.get() + b.get());
    c.get();
    expect(Signal.subtle.introspectSources(c).sort()).toEqual([a, b].sort());

    const w = new Signal.subtle.Watcher(() => {});
    expect(Signal.subtle.introspectSources(w)).toStrictEqual([]);
    w.watch(c);
    expect(Signal.subtle.introspectSources(w)).toEqual([c]);
  });

  it('throws TypeError for wrong arg shapes', () => {
    const s = new Signal.State(0);
    const w = new Signal.subtle.Watcher(() => {});
    expect(() => Signal.subtle.introspectSources({})).toThrowError(TypeError);
    expect(() => Signal.subtle.introspectSources(s)).toThrowError(TypeError);
    expect(() => Signal.subtle.introspectSinks(w)).toThrowError(TypeError);
    expect(() => Signal.subtle.hasSinks(w)).toThrowError(TypeError);
    expect(() => Signal.subtle.hasSinks({})).toThrowError(TypeError);
  });
});
