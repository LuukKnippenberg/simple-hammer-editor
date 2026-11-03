/**
 * First-run state and preferences kept in this browser (localStorage). Every read and write is wrapped: private
 * windows and blocked storage throw, and then the editor behaves as on a first run.
 */

export interface Prefs {
  /** The first-steps tour was shown (or skipped). */
  toured?: boolean;
  /** Layers › Scale is on. */
  scaleLayer?: boolean;
  /** Recover offers turned down: autosave file name → the autosave's modified time then. A newer autosave asks again. */
  recoverDismissed?: Record<string, number>;
  /** Compile & test options per map name. */
  testOptions?: Record<string, Record<string, unknown>>;
  /** The asset finder dock: its size, the last size it was shown at, a dragged height, the tab and each tab's source. */
  assetDock?: { size: 'hidden' | 'strip' | 'open'; last?: 'strip' | 'open'; height?: number; tab?: string; sources?: Record<string, string> };
  /** The one-time "Try the asset finder (B)" hint was shown. */
  assetHint?: boolean;
}

const PREFIX = 'she.pref.';

/** A stored preference, or undefined when unset, unreadable or storage is blocked. */
export function getPref<K extends keyof Prefs>(key: K): Prefs[K] | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as Prefs[K]);
  } catch {
    return undefined;
  }
}

/** Stores a preference (undefined removes it). Returns false when storage is blocked. */
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K] | undefined): boolean {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
