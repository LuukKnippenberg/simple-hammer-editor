import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedThumb, clearThumbCache, readThumb, taskQueue, writeThumb, type StoredThumb } from '../src/assets/thumbCache.ts';

// Tests run without IndexedDB (and /api/config can't be fetched), so the store is the memory fallback.

const png = (text: string): StoredThumb => ({ blob: new Blob([text], { type: 'image/png' }), width: 16, height: 8 });

/** A promise with its resolve function, to hold a task until the test lets it finish. */
function gate<T = void>(): { promise: Promise<T>; open: (v: T) => void } {
  let open!: (v: T) => void;
  const promise = new Promise<T>((r) => (open = r));
  return { promise, open };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => clearThumbCache());

describe('task queue', () => {
  it('runs at most `limit` tasks at once', async () => {
    const q = taskQueue(2);
    const gates = [gate(), gate(), gate()];
    const done = gates.map((g) => q.run(() => g.promise));
    await tick();
    expect([q.running(), q.waiting()]).toEqual([2, 1]);
    gates[0].open();
    await tick();
    expect([q.running(), q.waiting()]).toEqual([2, 0]);
    gates[1].open();
    gates[2].open();
    await Promise.all(done);
    expect(q.running()).toBe(0);
  });

  it('starts the highest priority first, read when a slot frees up, else in arrival order', async () => {
    const q = taskQueue(1);
    const order: string[] = [];
    const first = gate();
    const prio: Record<string, number> = { a: 0, b: 0, c: 5, d: 0 };
    const all = [q.run(() => first.promise)];
    for (const id of ['a', 'b', 'c', 'd']) all.push(q.run(async () => void order.push(id), () => prio[id]));
    // d scrolled into view while it waited.
    prio.d = 9;
    first.open();
    await Promise.all(all);
    expect(order).toEqual(['d', 'c', 'a', 'b']);
  });

  it('drops a waiting task when its signal aborts, without running it', async () => {
    const q = taskQueue(1);
    const first = gate();
    const ctl = new AbortController();
    const ran = vi.fn(async () => 'ran');
    const busy = q.run(() => first.promise);
    const dropped = q.run(ran, undefined, ctl.signal);
    ctl.abort();
    expect(await dropped).toBeNull();
    expect(q.waiting()).toBe(0);
    first.open();
    await busy;
    expect(ran).not.toHaveBeenCalled();
    expect(await q.run(ran, undefined, ctl.signal)).toBeNull();
  });

  it('resolves null when a task throws, and keeps going', async () => {
    const q = taskQueue(1);
    expect(await q.run(async () => { throw new Error('bad'); })).toBeNull();
    expect(await q.run(async () => 3)).toBe(3);
  });
});

describe('thumbnail store', () => {
  it('keeps blobs in memory when IndexedDB is missing', async () => {
    expect(await readThumb('model|a.mdl|0|112')).toBeNull();
    const t = png('a');
    await writeThumb('model|a.mdl|0|112', t);
    expect(await readThumb('model|a.mdl|0|112')).toBe(t);
    await clearThumbCache();
    expect(await readThumb('model|a.mdl|0|112')).toBeNull();
  });

  it('falls back to memory when opening IndexedDB throws (a private window)', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('denied', 'InvalidStateError'); } });
    try {
      const fresh = await import('../src/assets/thumbCache.ts');
      const t = png('b');
      await fresh.writeThumb('material|brick/a|64', t);
      expect(await fresh.readThumb('material|brick/a|64')).toBe(t);
      expect(await fresh.cachedThumb('material|brick/a|64', async () => null)).toMatchObject({ width: 16 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('cached thumbnails', () => {
  it('makes each key once, and again after a clear', async () => {
    const make = vi.fn(async () => png('x'));
    const a = await cachedThumb('k1', make);
    const b = await cachedThumb('k1', make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).toMatchObject({ width: 16, height: 8 });
    expect(a!.url).toMatch(/^blob:/);
    await clearThumbCache();
    await cachedThumb('k1', make);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('remembers that there is nothing to show', async () => {
    const make = vi.fn(async () => null);
    expect(await cachedThumb('missing', make)).toBeNull();
    expect(await cachedThumb('missing', make)).toBeNull();
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('gives an aborted request null, and keeps the work while another request waits', async () => {
    const g = gate<StoredThumb>();
    const make = vi.fn((_p: () => number, _s: AbortSignal) => g.promise);
    const one = new AbortController(), two = new AbortController();
    const a = cachedThumb('shared', make, { signal: one.signal });
    const b = cachedThumb('shared', make, { signal: two.signal });
    one.abort();
    expect(await a).toBeNull();
    await tick();
    const signal = make.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    g.open(png('s'));
    expect(await b).toMatchObject({ width: 16 });
  });

  it('drops the work once every request aborted, and starts over on the next request', async () => {
    const q = taskQueue(1);
    const block = gate();
    void q.run(() => block.promise);
    const make = vi.fn((priority: () => number, signal: AbortSignal) => q.run(async () => png('late'), priority, signal));
    const ctl = new AbortController();
    const a = cachedThumb('scrolled', make, { signal: ctl.signal });
    await tick();
    ctl.abort();
    expect(await a).toBeNull();
    expect(q.waiting()).toBe(0);
    block.open();
    expect(await cachedThumb('scrolled', make)).toMatchObject({ width: 16 });
    expect(make).toHaveBeenCalledTimes(2);
  });

  it('never drops work that a request without a signal waits for', async () => {
    const g = gate<StoredThumb>();
    const make = vi.fn((_p: () => number, _s: AbortSignal) => g.promise);
    const ctl = new AbortController();
    const plain = cachedThumb('pinned', make);
    void cachedThumb('pinned', make, { signal: ctl.signal });
    ctl.abort();
    await tick();
    expect(make.mock.calls[0][1].aborted).toBe(false);
    g.open(png('p'));
    expect(await plain).toMatchObject({ height: 8 });
  });

  it('passes the highest requested priority to the maker', async () => {
    const g = gate<StoredThumb>();
    let priority: () => number = () => NaN;
    const a = cachedThumb('prio', (p) => { priority = p; return g.promise; }, { priority: 1 });
    await tick();
    expect(priority()).toBe(1);
    void cachedThumb('prio', () => g.promise, { priority: 7 });
    expect(priority()).toBe(7);
    g.open(png('q'));
    await a;
  });
});
