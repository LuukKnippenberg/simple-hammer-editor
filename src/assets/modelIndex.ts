/** The game's model list with the header facts the picker filters on (served by the dev server, see server/models.ts). */

export interface ModelEntry {
  path: string;
  /** Compiled with $staticprop and without physics prop_data: vbsp keeps it as prop_static. */
  static: boolean;
  /** Has a physics prop_data block. */
  physics: boolean;
  skins: number;
  /** Hull size in units (x, y, z). */
  size: [number, number, number];
  materials: number;
}

let loading: Promise<ModelEntry[]> | null = null;
const byPath = new Map<string, ModelEntry>();

export function loadModelIndex(): Promise<ModelEntry[]> {
  loading ??= fetch('/api/models')
    .then((r) => (r.ok ? r.json() : []))
    .then((list: ModelEntry[]) => {
      for (const m of list) byPath.set(m.path, m);
      return list;
    })
    .catch(() => []);
  return loading;
}

/** A model's entry, once the index has loaded. */
export function modelEntry(path: string): ModelEntry | undefined {
  return byPath.get(path.toLowerCase().replace(/\\/g, '/'));
}

/** `models/props_c17/oildrum001.mdl` → `oildrum001`. */
export function modelName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop()!.replace(/\.mdl$/i, '');
}

/** `models/props_c17/oildrum001.mdl` → `props_c17` (the folder under models/). */
export function modelFolder(path: string): string {
  const p = path.replace(/\\/g, '/').toLowerCase().split('/');
  return p.length > 2 ? p[1] : '';
}

export type SizeClass = 'small' | 'medium' | 'large' | 'huge';
export const SIZE_CLASSES: { id: SizeClass; label: string; max: number }[] = [
  { id: 'small', label: 'Small · up to 32 u', max: 32 },
  { id: 'medium', label: 'Medium · up to 96 u', max: 96 },
  { id: 'large', label: 'Large · up to 256 u', max: 256 },
  { id: 'huge', label: 'Huge · over 256 u', max: Infinity },
];

/** Size class by the model's largest dimension. */
export function sizeClass(m: Pick<ModelEntry, 'size'>): SizeClass {
  const s = Math.max(...m.size);
  return SIZE_CLASSES.find((c) => s <= c.max)!.id;
}
