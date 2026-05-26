import { describe, it, expect } from 'vitest';
import { Signal } from '../src/signal.js';
import { effect } from '../src/effect.js';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('effect', () => {
  it('runs once synchronously', () => {
    let runs = 0;
    effect(() => { runs++; });
    expect(runs).toBe(1);
  });

  it('re-runs when a read State changes (in a microtask)', async () => {
    const a = new Signal.State(0);
    let seen;
    effect(() => { seen = a.get(); });
    expect(seen).toBe(0);

    a.set(1);
    expect(seen).toBe(0);     // not yet — scheduled
    await tick();
    expect(seen).toBe(1);
  });

  it('batches multiple sets in the same tick into one re-run', async () => {
    const a = new Signal.State(0);
    let runs = 0;
    effect(() => { a.get(); runs++; });
    expect(runs).toBe(1);

    a.set(1); a.set(2); a.set(3);
    await tick();
    expect(runs).toBe(2);     // 1 initial + 1 batched
  });

  it('returns a dispose function that stops further runs', async () => {
    const a = new Signal.State(0);
    let runs = 0;
    const dispose = effect(() => { a.get(); runs++; });
    expect(runs).toBe(1);

    dispose();
    a.set(1);
    await tick();
    expect(runs).toBe(1);
  });

  it('tracks newly-read deps after a re-run', async () => {
    const flag = new Signal.State(true);
    const a = new Signal.State('a');
    const b = new Signal.State('b');
    let seen;
    effect(() => { seen = flag.get() ? a.get() : b.get(); });
    expect(seen).toBe('a');

    flag.set(false);
    await tick();
    expect(seen).toBe('b');

    // a is no longer a dep — changing it should not re-run.
    let runsBefore = 0;
    effect(() => { runsBefore++; b.get(); });
    a.set('a2');
    await tick();
    expect(seen).toBe('b');   // unchanged
  });
});
