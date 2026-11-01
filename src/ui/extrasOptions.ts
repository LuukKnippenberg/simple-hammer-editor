import type { BuildingOptions } from '../gen/buildings.ts';
import { LAMP_SPACING, LAMP_SPACINGS, TREE_DENSITIES, type TreeDensity } from '../gen/extras.ts';
import { h } from './dom.ts';

/** What the building generators add beyond the buildings, by the generator they apply to. */
export type ExtrasFor = 'block' | 'building' | 'house';

/** The defaults each extras option falls back to; a value set back to its default is left out of the block. */
const DEFAULTS = { extras: true, trees: 'normal', lamps: true, lampSpacing: LAMP_SPACING, cables: true, clutter: true, awnings: true, yardProps: true } as const;
type ExtraKey = keyof typeof DEFAULTS | 'roofProps';

/**
 * The "Extras" group of a building generator's options: a heading with the master switch that folds open to one
 * row per kind of extra (trees, lamps and their spacing, cables, wall clutter, awnings, yard props, roof props).
 * `o` is read for the current values, `set` stores a change (undefined: back to the default). `open` and
 * `onFold` keep the group folded or open across renders.
 */
export function extrasRows(o: BuildingOptions, set: <K extends ExtraKey>(k: K, v: BuildingOptions[K] | undefined) => void, kind: ExtrasFor, open: boolean, onFold: (open: boolean) => void): HTMLElement[] {
  const store = <K extends keyof typeof DEFAULTS>(k: K, v: BuildingOptions[K]) => set(k, v === DEFAULTS[k] ? undefined : v);
  const on = o.extras ?? true;
  const master = h('input', { type: 'checkbox', checked: on, title: 'Everything beyond the buildings: trees, lamps, cables, clutter, props' }) as HTMLInputElement;
  master.addEventListener('change', () => store('extras', master.checked));
  const fold = h('button.gen-fold', { title: open ? 'Hide the extras' : 'Show the extras', onclick: () => onFold(!open) }, open ? '▾' : '▸');
  const head = h('div.row.gen-extras-head', {}, fold, h('label', { onclick: () => onFold(!open) }, 'Extras'), master,
    h('span.hint', {}, on ? 'trees, lamps, cables, props' : 'all off'));
  if (!open || !on) return [head];

  const check = (label: string, k: 'lamps' | 'cables' | 'clutter' | 'awnings' | 'yardProps', hint: string) => {
    const el = h('input', { type: 'checkbox', checked: o[k] ?? DEFAULTS[k] }) as HTMLInputElement;
    el.addEventListener('change', () => store(k, el.checked));
    return h('div.row.gen-extra', {}, h('label', {}, label), el, h('span.hint', {}, hint));
  };
  const trees = h('select', { title: 'Street, courtyard and yard trees' }, ...Object.entries(TREE_DENSITIES).map(([k, d]) => h('option', { value: k }, d.label))) as HTMLSelectElement;
  trees.value = o.trees ?? DEFAULTS.trees;
  trees.addEventListener('change', () => { trees.blur(); store('trees', trees.value as TreeDensity); });
  const lamps = check('Street lamps', 'lamps', 'along the pavements');
  const spacing = h('select', { title: 'Distance between lamp (and tree) spots along the pavement' },
    ...LAMP_SPACINGS.map(([v, l]) => h('option', { value: String(v) }, l))) as HTMLSelectElement;
  spacing.value = String(o.lampSpacing ?? LAMP_SPACING);
  spacing.disabled = !(o.lamps ?? true);
  spacing.addEventListener('change', () => { spacing.blur(); store('lampSpacing', Number(spacing.value)); });
  const roof = h('input', { type: 'checkbox', checked: o.roofProps }) as HTMLInputElement;
  roof.addEventListener('change', () => set('roofProps', roof.checked));

  const rows = [h('div.row.gen-extra', {}, h('label', {}, 'Trees'), trees), lamps, h('div.row.gen-extra', {}, h('label', {}, 'Spacing'), spacing)];
  if (kind === 'house') return [head, ...rows];
  rows.push(check('Cables', 'cables', 'across the streets'), check('Wall clutter', 'clutter', 'pipes, dishes, meters, antennas'), check('Awnings', 'awnings', 'over shop windows'));
  if (kind === 'block') rows.push(check('Yard props', 'yardProps', 'benches, play, cars (green yards)'));
  rows.push(h('div.row.gen-extra', {}, h('label', {}, 'Roof props'), roof, h('span.hint', {}, 'vents and dishes on flat roofs')));
  return [head, ...rows];
}
