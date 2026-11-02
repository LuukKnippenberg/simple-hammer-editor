import {
  LARGE_WIDTH, MAX_RISE, RAIL_MATERIALS, RAIL_STYLES, SIDE_MATERIALS, STEP_MATERIALS, STRUCTURES, pointNames,
  type StairsOptions, type StairsResult, type StairsSpec, type StairsFlight,
} from '../gen/stairs.ts';
import { h } from './dom.ts';

/**
 * The stairs' option sheet (the Tune step and the Selection panel): shape, steps, structure, hand rails and
 * materials, then one row per flight and landing. Every change calls back with a patch; the caller rebuilds.
 */
export interface StairsSheet {
  spec: StairsSpec;
  /** What the spec builds now (step counts, treads, landing sizes). */
  result: StairsResult | null;
  set(patch: Partial<StairsOptions>): void;
  setFlight(i: number, patch: Partial<StairsFlight>): void;
  /** The flight row picked (lit in the list). */
  hot?: number;
  onHot?(i: number): void;
}

const seg = <T extends string>(label: string, choices: [T, string, string?][], value: T, pick: (v: T) => void) =>
  h('div.row', {}, label ? h('label', {}, label) : null, h('div.seg', {}, ...choices.map(([v, l, title]) =>
    h(v === value ? 'button.active' : 'button', { title: title ?? '', onclick: () => pick(v) }, l))));

const numIn = (value: number, set: (v: number) => void, o: { min?: number; max?: number; step?: number; title?: string } = {}) => {
  const i = h('input.num', { type: 'number', value: String(Math.round(value * 10) / 10), step: String(o.step ?? 1), min: String(o.min ?? 0), title: o.title ?? '' }) as HTMLInputElement;
  i.addEventListener('change', () => {
    const v = Math.max(o.min ?? 0, Math.min(o.max ?? Infinity, parseFloat(i.value) || 0));
    i.blur();
    set(v);
  });
  return i;
};

const short = (m: string) => m.split('/').pop()!.toLowerCase();
const matSelect = (label: string, list: string[], value: string, set: (v: string) => void) => {
  const all = list.includes(value) ? list : [value, ...list];
  const el = h('select', { title: value }, ...all.map((m) => h('option', { value: m }, short(m)))) as HTMLSelectElement;
  el.value = value;
  el.addEventListener('change', () => { el.blur(); set(el.value); });
  return h('div.row', {}, h('label', {}, label), el);
};

const head = (title: string, note = '') => h('div.stairs-head', {}, h('b', {}, title), note ? h('span', {}, note) : null);

export function stairsSheet(s: StairsSheet): HTMLElement[] {
  const o = s.spec.options, r = s.result;
  const one = s.spec.flights.length === 1 ? 0 : -1;
  const f0 = one === 0 ? r?.flights[0] : undefined;
  const rows: (HTMLElement | null)[] = [
    head('Shape'),
    seg('Plan', [['blocky', 'Blocky', 'Square to the grid: each flight snaps to the nearest 90°'], ['angle', 'Any angle', 'Follows the points exactly']], o.plan, (v) => s.set({ plan: v })),
    seg('Profile', [['steps', 'Steps'], ['ramp', 'Ramp', 'One smooth slope, for vehicles']], o.profile, (v) => s.set({ profile: v })),
  ];
  if (o.profile === 'steps') {
    rows.push(head('Steps', f0 ? `height ${Math.round(f0.height)} from A to B` : `rise ${MAX_RISE} at most`));
    if (f0 && one === 0) {
      const fl = s.spec.flights[0];
      const steps = numIn(f0.steps, (v) => s.setFlight(0, { steps: v || undefined }), { min: 1, max: 200, title: `At least ${Math.ceil(Math.abs(f0.height) / MAX_RISE)}: no step rises more than ${MAX_RISE}` });
      rows.push(h('div.row', {}, h('label', {}, 'Steps'), steps,
        h('button', { title: 'One step fewer', onclick: () => s.setFlight(0, { steps: Math.max(1, f0.steps - 1) }) }, '−'),
        h('button', { title: 'One step more', onclick: () => s.setFlight(0, { steps: f0.steps + 1 }) }, '+'),
        fl.steps ? h('button', { title: 'Count the steps from the height again', onclick: () => s.setFlight(0, { steps: undefined }) }, 'auto') : h('span.unit.auto', {}, 'auto')));
      rows.push(h('div.row', {}, h('label', {}, 'Rise · tread'), h('span.mono', {}, `${fmt(f0.rise)} · ${fmt(f0.tread)}`), h('span.unit', {}, 'from height ÷ steps')));
    }
  }
  rows.push(h('div.row', {}, h('label', {}, 'Width'), numIn(o.width, (v) => s.set({ width: Math.max(32, v) }), { min: 32, step: 16 }),
    h('span.unit', { title: 'Recast keeps a large unit 58 from every edge' }, o.width < LARGE_WIDTH ? `large units: ${LARGE_WIDTH}+` : 'fits large units')));
  rows.push(h('div.row', { title: 'Flat runs at the ends of flights that have no landing' }, h('label', {}, 'Landing top'), numIn(o.landingTop, (v) => s.set({ landingTop: v }), { step: 16 }),
    h('span.unit', {}, 'bottom'), numIn(o.landingBottom, (v) => s.set({ landingBottom: v }), { step: 16 })));
  if (f0?.steep) rows.push(h('div.hint.warn', {}, 'Too steep for units: make the flight longer than it is high (under 45°).'));

  rows.push(head('Structure'),
    seg('', STRUCTURES.map(([v, l, t]) => [v, l, t] as [typeof v, string, string]), o.structure, (v) => s.set({ structure: v })));
  if (o.structure !== 'solid') rows.push(seg('Side beams', [['none', 'None'], ['both', 'Both'], ['under', 'Under']], o.beams, (v) => s.set({ beams: v })));
  if (o.profile === 'steps') {
    const clip = h('input', { type: 'checkbox', checked: o.clip }) as HTMLInputElement;
    clip.addEventListener('change', () => s.set({ clip: clip.checked }));
    rows.push(h('div.row', { title: 'An NPC clip ramp on the step nosings: the navmesh sees one smooth slope' }, h('label', {}, 'Clip ramp'), clip, h('span.hint', {}, 'units walk it as a slope')));
  }

  rows.push(head('Hand rails'),
    seg('Sides', [['none', 'None'], ['left', 'Left'], ['right', 'Right'], ['both', 'Both']], o.rails, (v) => s.set({ rails: v })));
  if (o.rails !== 'none') {
    const style = h('select', {}, ...RAIL_STYLES.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
    style.value = o.railStyle;
    style.addEventListener('change', () => { style.blur(); s.set({ railStyle: style.value as StairsOptions['railStyle'] }); });
    rows.push(h('div.row', {}, h('label', {}, 'Style'), style),
      h('div.row', {}, h('label', {}, 'Height · posts'), numIn(o.railHeight, (v) => s.set({ railHeight: Math.max(16, v) }), { min: 16, step: 4 }),
        numIn(o.postSpacing, (v) => s.set({ postSpacing: Math.max(32, v) }), { min: 32, step: 16, title: 'Post spacing' })));
  }

  rows.push(head('Materials'),
    matSelect('Steps', STEP_MATERIALS, o.stepMaterial, (v) => s.set({ stepMaterial: v })),
    matSelect('Sides', SIDE_MATERIALS, o.sideMaterial, (v) => s.set({ sideMaterial: v })),
    o.rails !== 'none' ? matSelect('Rails', RAIL_MATERIALS, o.railMaterial, (v) => s.set({ railMaterial: v })) : null);

  if (s.spec.flights.length > 1 && r) rows.push(...flightRows(s));
  return rows.filter((x): x is HTMLElement => !!x);
}

/** One row per flight (steps and width override the sheet) and per landing. */
function flightRows(s: StairsSheet): HTMLElement[] {
  const r = s.result!, names = pointNames(s.spec);
  const out: HTMLElement[] = [head('Flights & landings', 'a row only overrides steps and width')];
  const landingRow = (node: number) => {
    const l = r.landings.find((x) => x.node === node);
    if (!l) return null;
    const what = l.joins >= 4 ? 'cross' : l.joins === 3 ? 'T junction' : 'turn';
    return h('div.stairs-flight.landing', {}, h('span.k', {}, `Landing ${names[node]}`), h('span.m', {}, `${l.size[0]} × ${l.size[1]}`), h('span.d', {}, what));
  };
  const shown = new Set<number>();
  s.spec.flights.forEach((f, i) => {
    if (!shown.has(f.from) && f.from > 0) { const lr = landingRow(f.from); if (lr) out.push(lr); shown.add(f.from); }
    const info = r.flights[i];
    const row = h(`div.stairs-flight${s.hot === i ? '.on' : ''}`, { onclick: () => s.onHot?.(i) },
      h('span.k', {}, `${names[f.from]} → ${names[f.to]}`),
      h('span.m', {}, info.steps ? `${info.steps} steps · ${info.height >= 0 ? '↑' : '↓'}${Math.abs(Math.round(info.height))}` : 'flat'),
      numIn(info.steps, (v) => s.setFlight(i, { steps: v || undefined }), { min: 0, title: 'Steps (0: automatic)' }),
      numIn(f.width ?? s.spec.options.width, (v) => s.setFlight(i, { width: v === s.spec.options.width ? undefined : Math.max(32, v) }), { min: 32, step: 16, title: 'Width' }),
      info.steep ? h('span.d.warn', {}, 'too steep') : null);
    out.push(row);
  });
  return out;
}

const fmt = (v: number) => String(Math.round(v * 10) / 10);
