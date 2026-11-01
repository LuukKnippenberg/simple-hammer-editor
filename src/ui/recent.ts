/** Most-recently-used and favourite lists (entity classes, models, decals), kept in this browser. */

/** `item` moved to the front of `list`, without duplicates, at most `max` long. */
export function pushRecent(list: string[], item: string, max = 12): string[] {
  const key = item.toLowerCase();
  return [item, ...list.filter((x) => x.toLowerCase() !== key)].slice(0, max);
}

/** The entry after `current` in `list` (wrapping), or the first one. */
export function nextInList(list: string[], current: string): string | undefined {
  if (!list.length) return undefined;
  const i = list.findIndex((x) => x.toLowerCase() === current.toLowerCase());
  return list[(i + 1) % list.length];
}

export class StoredList {
  private key: string;
  private max: number;
  items: string[];

  constructor(name: string, max = 12) {
    this.key = `she.${name}`;
    this.max = max;
    let saved: unknown = null;
    try { saved = JSON.parse(localStorage.getItem(this.key) ?? 'null'); } catch { /* no storage */ }
    this.items = Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : [];
  }

  has(item: string): boolean {
    return this.items.some((x) => x.toLowerCase() === item.toLowerCase());
  }

  push(item: string): void {
    this.items = pushRecent(this.items, item, this.max);
    this.save();
  }

  toggle(item: string): void {
    if (this.has(item)) this.items = this.items.filter((x) => x.toLowerCase() !== item.toLowerCase());
    else this.items = pushRecent(this.items, item, this.max);
    this.save();
  }

  private save(): void {
    try { localStorage.setItem(this.key, JSON.stringify(this.items)); } catch { /* no storage */ }
  }
}

export const recentClasses = new StoredList('recent.classes', 8);
export const recentModels = new StoredList('recent.models', 24);
export const favouriteModels = new StoredList('fav.models', 200);
export const recentDecals = new StoredList('recent.decals', 24);
