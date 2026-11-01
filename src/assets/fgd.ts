/** Entity class definitions from the game's FGD (served by the dev server). */

export interface FgdKey {
  name: string;
  type: string;
  label: string;
  default: string;
  description: string;
  choices?: { value: string; label: string }[];
  /** The class that declares the key (a base class such as Targetname or Wars, or the class itself). */
  base?: string;
}

export interface FgdClass {
  name: string;
  type: string;
  description: string;
  studio?: string;
  iconsprite?: string;
  keys: FgdKey[];
  inputs: FgdIO[];
  outputs: FgdIO[];
}

/** An entity input or output: name, parameter type (void, string, float, ...) and description. */
export interface FgdIO {
  name: string;
  type: string;
  description: string;
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
