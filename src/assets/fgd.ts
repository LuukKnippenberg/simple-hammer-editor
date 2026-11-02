/** Entity class definitions from the game's FGD (served by the dev server). */

import type { FgdClass } from '../../server/fgd.ts';

// The server parses the FGD and sends these as JSON from /api/fgd, so its types are the truth. Type-only: nothing
// from the server module ends up in the browser bundle.
export type { FgdKey, FgdClass, FgdIO } from '../../server/fgd.ts';

const classes = new Map<string, FgdClass>();
let loading: Promise<Map<string, FgdClass>> | null = null;

export function loadFgd(): Promise<Map<string, FgdClass>> {
  loading ??= fetch('/api/fgd')
    .then((r) => (r.ok ? r.json() : []))
    .then((list: FgdClass[]) => {
      for (const c of list) classes.set(c.name.toLowerCase(), c);
      return classes;
    })
    .catch(() => classes);
  return loading;
}

export function fgdClass(name: string): FgdClass | undefined {
  return classes.get(name.toLowerCase());
}

export function fgdClasses(): FgdClass[] {
  return [...classes.values()];
}
