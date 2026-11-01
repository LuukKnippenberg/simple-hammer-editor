/** Pure keyvalue logic behind the entity inspector: grouping keys, changing class, merging a multi-selection. */

export interface KeyDef {
  name: string;
  type: string;
  label: string;
  default: string;
  description: string;
  choices?: { value: string; label: string }[];
  base?: string;
}

export interface ClassDef {
  name: string;
  keys: KeyDef[];
}

/** Keys an entity carries that are not keyvalues to edit. */
const INTERNAL = new Set(['id', 'classname']);

export const KEY_GROUPS = ['Model', 'Transform', 'Lambda Wars', 'Properties', 'Flags', 'Rendering', 'Fading', 'Lighting', 'Parent & global', 'Scripting', 'Other keys'] as const;
export type KeyGroup = (typeof KEY_GROUPS)[number];

const BY_NAME: [RegExp, KeyGroup][] = [
  [/^(origin|angles)$/, 'Transform'],
  [/^(model|skin|setbodygroup|body|modelscale)$/, 'Model'],
  [/^spawnflags$/, 'Flags'],
  [/^(fademindist|fademaxdist|fadescale|screenspacefade)$/, 'Fading'],
  [/^(lightingorigin|disablevertexlighting|disableselfshadowing|ignorenormals|disableshadows|disablereceiveshadows|disableflashlight)$/, 'Lighting'],
  [/^(rendercolor|renderamt|rendermode|renderfx|(min|max)(dx|cpu|gpu)level)$/, 'Rendering'],
  [/^(parentname|globalname)$/, 'Parent & global'],
  [/^(vscripts|thinkfunction|responsecontext|damagefilter)$/, 'Scripting'],
];

/**
 * The inspector group a key is shown in: by its name, else by the base class that declares it.
 * Keys the FGD does not describe (`described` false) go to Other keys.
 */
export function keyGroup(key: Pick<KeyDef, 'name' | 'base'>, warsClass = false, described = true): KeyGroup {
  const n = key.name.toLowerCase();
  for (const [re, g] of BY_NAME) if (re.test(n)) return g;
  if (!described) return 'Other keys';
  const base = (key.base ?? '').toLowerCase();
  if (base === 'wars' || base === 'baseunit' || warsClass) return 'Lambda Wars';
  return 'Properties';
}

/** Whether a value differs from the FGD default ("15" and "15.0" are the same number). */
export function differsFromDefault(value: string, def: string): boolean {
  if (value === def) return false;
  const a = value.trim().split(/\s+/), b = def.trim().split(/\s+/);
  if (a.length === b.length && a.every((x, i) => x !== '' && !isNaN(+x) && !isNaN(+b[i]) && +x === +b[i])) return false;
  return !(def === '' && value.trim() === '');
}

export interface ClassChangePlan {
  /** Keys the entity keeps (it has them and the new class knows them, or nobody describes them). */
  keep: string[];
  /** Keys the old class describes and the new one does not. */
  drop: string[];
  /** Keys of the new class the entity lacks, with their defaults. */
  add: { name: string; value: string }[];
}

/**
 * What changing an entity's class does to its keys. The name, origin, angles and keys no class describes
 * stay; outputs live in the connections block and are never touched.
 */
export function classChangePlan(props: [string, string][], from: ClassDef | undefined, to: ClassDef): ClassChangePlan {
  const toKeys = new Set(to.keys.map((k) => k.name.toLowerCase()));
  const fromKeys = new Set((from?.keys ?? []).map((k) => k.name.toLowerCase()));
  const have = new Set<string>();
  const keep: string[] = [], drop: string[] = [];
  for (const [k] of props) {
    const n = k.toLowerCase();
    if (INTERNAL.has(n) || have.has(n)) continue;
    have.add(n);
    if (toKeys.has(n) || !fromKeys.has(n) || n === 'origin' || n === 'targetname' || n === 'angles') keep.push(k);
    else drop.push(k);
  }
  const add = to.keys
    .filter((k) => !have.has(k.name.toLowerCase()) && k.default !== '' && k.type !== 'flags')
    .map((k) => ({ name: k.name, value: k.default }));
  return { keep, drop, add };
}

/** The keys an entity of a class shows: its FGD keys (with defaults) plus any extra keys it carries. */
export function effectiveKeys(props: [string, string][], cls: ClassDef | undefined): Map<string, { name: string; value: string; def?: KeyDef }> {
  const out = new Map<string, { name: string; value: string; def?: KeyDef }>();
  const own = new Map<string, [string, string]>();
  for (const p of props) if (!own.has(p[0].toLowerCase())) own.set(p[0].toLowerCase(), p);
  for (const k of cls?.keys ?? []) {
    const n = k.name.toLowerCase();
    if (INTERNAL.has(n)) continue;
    out.set(n, { name: k.name, value: own.get(n)?.[1] ?? k.default, def: k });
  }
  for (const [n, [k, v]] of own) if (!INTERNAL.has(n) && !out.has(n)) out.set(n, { name: k, value: v });
  return out;
}

export interface MergedKey {
  name: string;
  def?: KeyDef;
  /** Value → number of entities with it. */
  values: Map<string, number>;
}

export interface MergedSelection {
  /** Keys every selected entity has (by its class or its own keys). */
  shared: MergedKey[];
  /** Per class: the keys only entities of that class have. */
  only: { classname: string; count: number; keys: MergedKey[] }[];
}

/** Merges the keyvalues of several entities: what they share, with each key's values counted, and what is class-specific. */
export function mergeSelection(ents: { classname: string; props: [string, string][] }[], lookup: (cls: string) => ClassDef | undefined): MergedSelection {
  const per = ents.map((e) => ({ cls: e.classname, keys: effectiveKeys(e.props, lookup(e.classname)) }));
  const merge = (list: typeof per, names: string[]): MergedKey[] => names.map((n) => {
    const values = new Map<string, number>();
    let name = n, def: KeyDef | undefined;
    for (const p of list) {
      const k = p.keys.get(n)!;
      name = k.name;
      def ??= k.def;
      values.set(k.value, (values.get(k.value) ?? 0) + 1);
    }
    return { name, def, values };
  });
  const sharedNames = per.length ? [...per[0].keys.keys()].filter((n) => per.every((p) => p.keys.has(n))) : [];
  const sharedSet = new Set(sharedNames);
  const classes = [...new Set(per.map((p) => p.cls))];
  const only = classes.length < 2 ? [] : classes.map((cls) => {
    const list = per.filter((p) => p.cls === cls);
    const names = [...list[0].keys.keys()].filter((n) => !sharedSet.has(n) && list.every((p) => p.keys.has(n)));
    return { classname: cls, count: list.length, keys: merge(list, names) };
  }).filter((g) => g.keys.length);
  return { shared: merge(per, sharedNames), only };
}

/** A name from a pattern: `cp_#` becomes the first free `cp_1`, `cp_2`, ...; a name without # is used as is. */
export function expandName(pattern: string, used: Set<string>): string {
  const p = pattern.trim();
  if (!p.includes('#')) return p;
  for (let i = 1; ; i++) {
    const name = p.replace('#', String(i));
    if (!used.has(name)) return name;
  }
}
