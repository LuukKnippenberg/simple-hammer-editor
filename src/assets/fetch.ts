/** Fetches game files through the dev server, with de-duplication and a pending counter for "busy" state. */

const inflight = new Map<string, Promise<ArrayBuffer | null>>();
let pending = 0;

export function pendingRequests(): number {
  return pending;
}

export function fetchGameFile(path: string): Promise<ArrayBuffer | null> {
  const key = path.toLowerCase().replace(/\\/g, '/');
  let p = inflight.get(key);
  if (!p) {
    pending++;
    p = fetch(`/api/file?path=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null)
      .finally(() => pending--);
    inflight.set(key, p);
  }
  return p;
}

/** Drops a fetched file, so the next request reads it again (after the editor rewrote it). */
export function forgetGameFile(path: string): void {
  inflight.delete(path.toLowerCase().replace(/\\/g, '/'));
}

export async function fetchGameText(path: string): Promise<string | null> {
  const buf = await fetchGameFile(path);
  return buf ? new TextDecoder('latin1').decode(buf) : null;
}

/** Tracks arbitrary async work (e.g. texture decoding) in the same busy counter. */
export async function track<T>(p: Promise<T>): Promise<T> {
  pending++;
  try {
    return await p;
  } finally {
    pending--;
  }
}
