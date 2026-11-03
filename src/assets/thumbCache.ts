/**
 * Thumbnails that survive a reload: PNG blobs in IndexedDB, keyed on the game install, plus the queues that make them
 * (highest priority first, dropped when nobody wants them any more). Without IndexedDB (a private window, or any
 * error) the blobs stay in memory for this page.
 */

/** A thumbnail ready to show: an object URL and the source's size in pixels. */
export interface Thumb {
  url: string;
  width: number;
  height: number;
}

/** What the cache stores: the PNG and the source's size in pixels. */
export interface StoredThumb {
  blob: Blob;
  width: number;
  height: number;
}

/** Optional scheduling for a thumbnail request. */
export interface ThumbOptions {
  /** Higher runs sooner (default 0): visible tiles ask with a higher number than ones further down. */
  priority?: number;
  /** Aborting it (the tile scrolled away) resolves the request with null, and drops the work if nobody else waits. */
  signal?: AbortSignal;
}

/** Bump when the renderers change, so old thumbnails are no longer read. */
const VERSION = 1;
const DB_NAME = 'she-thumbnails';
const STORE = 'thumbs';

const memory = new Map<string, StoredThumb>();
let dbPromise: Promise<IDBDatabase | null> | null = null;
let installPromise: Promise<string> | null = null;
/** Counts clears, so a write that was under way during one doesn't bring a thumbnail back. */
let generation = 0;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** The active game install, so thumbnails of another install (or before a switch) are never mixed up. */
function install(): Promise<string> {
  installPromise ??= fetch('/api/config')
    .then((r) => r.json())
    .then((cfg: { install?: string | null }) => (cfg.install ?? '').toLowerCase())
    .catch(() => '');
  return installPromise;
}

async function storeKey(key: string): Promise<string> {
  return `v${VERSION}|${await install()}|${key}`;
}

/** Runs one request on the thumbnail store; resolves null when IndexedDB is missing or fails. */
async function request<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<{ value: T } | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise((resolve) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve({ value: req.result as T });
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** A stored thumbnail, from IndexedDB or the memory fallback. */
export async function readThumb(key: string): Promise<StoredThumb | null> {
  const k = await storeKey(key);
  const hit = await request<StoredThumb | undefined>('readonly', (s) => s.get(k));
  return hit?.value?.blob ? hit.value : memory.get(k) ?? null;
}

/** Stores a thumbnail in IndexedDB, or in memory when that fails. */
export async function writeThumb(key: string, thumb: StoredThumb): Promise<void> {
  const gen = generation;
  const k = await storeKey(key);
  if (gen !== generation) return;
  const stored = await request('readwrite', (s) => (gen === generation ? s.put(thumb, k) : s.count()));
  if (!stored && gen === generation) memory.set(k, thumb);
}

interface Job {
  promise: Promise<Thumb | null>;
  priority: number;
  /** Someone asked without a signal: the job is never dropped. */
  pinned: boolean;
  /** Requests with a signal that haven't aborted yet. */
  waiting: number;
  abort: AbortController;
}

const jobs = new Map<string, Job>();

/**
 * The thumbnail under `key` (made unique per renderer by the caller): from this page's memory, the store, or `make`.
 * `make` gets the job's current priority and a signal that aborts once every request has; it queues itself and
 * returns null when aborted or when there is nothing to show. Made thumbnails are written to the store.
 */
export function cachedThumb(
  key: string,
  make: (priority: () => number, signal: AbortSignal) => Promise<StoredThumb | null>,
  opts: ThumbOptions = {},
): Promise<Thumb | null> {
  const { signal } = opts;
  if (signal?.aborted) return Promise.resolve(null);
  let job = jobs.get(key);
  if (!job) {
    const abort = new AbortController();
    const created: Job = { priority: -Infinity, pinned: false, waiting: 0, abort, promise: null! };
    created.promise = (async () => {
      const hit = await readThumb(key);
      if (hit) return toThumb(hit);
      if (abort.signal.aborted) return null;
      const made = await make(() => created.priority, abort.signal);
      if (!made) return null;
      void writeThumb(key, made);
      return toThumb(made);
    })().catch(() => null);
    jobs.set(key, created);
    job = created;
  }
  job.priority = Math.max(job.priority, opts.priority ?? 0);
  if (!signal) {
    job.pinned = true;
    return job.promise;
  }
  const j = job;
  j.waiting++;
  return new Promise((resolve) => {
    const onAbort = () => {
      resolve(null);
      if (--j.waiting > 0 || j.pinned) return;
      // Nobody waits any more: drop the work, and let the next request start over.
      j.abort.abort();
      if (jobs.get(key) === j) jobs.delete(key);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void j.promise.then((t) => {
      signal.removeEventListener('abort', onAbort);
      if (!signal.aborted) {
        j.waiting--;
        resolve(t);
      }
    });
  });
}

function toThumb(s: StoredThumb): Thumb {
  return { url: URL.createObjectURL(s.blob), width: s.width, height: s.height };
}

/** Forgets every thumbnail: the store (all installs), the memory fallback and this page's finished ones. */
export async function clearThumbCache(): Promise<void> {
  generation++;
  memory.clear();
  jobs.clear();
  await request('readwrite', (s) => s.clear());
}

/** A canvas as a PNG blob (null if the browser can't encode it). */
export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

/** Runs queued tasks, at most `limit` at once. */
export interface TaskQueue {
  /**
   * Runs `task` when a slot is free, the highest `priority()` first (read each time a slot frees up, so a request can
   * be moved up while it waits). Resolves null without running when `signal` aborts first.
   */
  run<T>(task: () => Promise<T>, priority?: () => number, signal?: AbortSignal): Promise<T | null>;
  /** Tasks waiting for a slot. */
  waiting(): number;
  /** Tasks running now. */
  running(): number;
}

/** A priority queue for thumbnail work (equal priorities run in the order they came). */
export function taskQueue(limit: number): TaskQueue {
  const queue: { priority: () => number; start: () => void; signal?: AbortSignal }[] = [];
  let running = 0;
  const next = () => {
    while (running < limit) {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].signal?.aborted) queue.splice(i, 1);
      if (!queue.length) return;
      let best = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].priority() > queue[best].priority()) best = i;
      queue.splice(best, 1)[0].start();
    }
  };
  return {
    run<T>(task: () => Promise<T>, priority = () => 0, signal?: AbortSignal): Promise<T | null> {
      if (signal?.aborted) return Promise.resolve(null);
      return new Promise<T | null>((resolve) => {
        const entry = {
          priority, signal,
          start: () => {
            signal?.removeEventListener('abort', onAbort);
            running++;
            task().then(resolve, () => resolve(null)).finally(() => {
              running--;
              next();
            });
          },
        };
        const onAbort = () => {
          const i = queue.indexOf(entry);
          if (i >= 0) queue.splice(i, 1);
          resolve(null);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        queue.push(entry);
        next();
      });
    },
    waiting: () => queue.length,
    running: () => running,
  };
}
