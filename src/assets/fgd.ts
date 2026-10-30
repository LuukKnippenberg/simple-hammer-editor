/** Entity class definitions from the game's FGD (served by the dev server). */

export interface FgdKey {
  name: string;
  type: string;
  label: string;
  default: string;
  description: string;
  choices?: { value: string; label: string }[];
}

export interface FgdClass {
  name: string;
  type: string;
  description: string;
  studio?: string;
  iconsprite?: string;
  keys: FgdKey[];
}

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
