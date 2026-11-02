import { ARCHITECTURES, FACADE_STYLES, QUALITY, type ArchitectureName, type BuildingOptions } from '../gen/buildings.ts';
import { INTERIOR_STYLES } from '../gen/styles.ts';
import { LIGHT_LEVELS } from '../gen/interiorDressing.ts';
import { extrasRows, type ExtrasFor } from './extrasOptions.ts';
import { num, row, seedButton, select, toggle } from './form.ts';
import { h } from './dom.ts';

/** One row of the building sheet, by the option it sets. */
export type BuildingRow = 'architecture' | 'floors' | 'facade' | 'corners' | 'roofs' | 'quality' | 'detail' | 'towers' | 'courtyards' | 'annexes'
  | 'alleys' | 'weathering' | 'interiors' | 'interiorStyle' | 'cutHeight' | 'furnish' | 'lights' | 'lightLevel' | 'wideDoors';

/**
 * The building generators' option sheet (the Tune step and the Selection panel): the rows the caller asks for,
 * optionally more folded under "More options", the Extras group and the seed. Every change calls back with a
 * patch; the caller rebuilds (Tune) or keeps it for Regenerate (Selection).
 */
export interface BuildingSheet {
  options: BuildingOptions;
  /** Which generator: its floor limit, some hints, and the extras it gets. */
  kind: ExtrasFor;
  rows: BuildingRow[];
  /** Rows folded under "More options" (Tune); none: no fold. */
  more?: BuildingRow[];
  set(patch: Partial<BuildingOptions>): void;
  /** "More options" and "Extras" folded open: the sheet flips them and calls `redraw`. */
  folds: { more: boolean; extras: boolean };
  redraw(): void;
}

const FROM_ARCH: [string, string] = ['', 'From architecture'];
const ROOFS: [string, string][] = [['mixed', 'Mixed'], ['mansard', 'Mansard with dormers'], ['hip', 'Hipped'], ['gable', 'Gabled'], ['curved', 'Curved (bell)'], ['flat', 'Flat with parapet']];
const CORNERS: [string, string][] = [FROM_ARCH, ['mixed', 'Mixed'], ['chamfer', 'Cut (45°)'], ['round', 'Rounded'], ['square', 'Square']];
const DETAIL: [string, string][] = [['0', 'None'], ['1', 'Low: base and cornice'], ['2', 'Medium: + ledges, columns'], ['3', 'High: + brackets']];

export function buildingSheet(sheet: BuildingSheet): HTMLElement[] {
  const options = sheet.options, kind = sheet.kind;
  // A house has 1–2 floors whatever is asked (layoutOptions).
  const topFloor = kind === 'house' ? 2 : 12;
  /** A drop-down for option `key`; '' (From architecture) stores undefined. */
  const choice = (label: string, key: keyof BuildingOptions, choices: [string, string, string?][], fallback = '', title = '') =>
    row(label, select(choices, String(options[key] ?? fallback), (v) => sheet.set({ [key]: v || undefined }), title));
  const check = (label: string, key: 'courtyards' | 'towers' | 'annexes' | 'alleys' | 'interiorLights' | 'wideDoors', byDefault: boolean, hint: string, title = '') =>
    row(label, toggle(options[key] ?? byDefault, (v) => sheet.set({ [key]: v }), title), h('span.hint', {}, hint));

  // Each architecture has its usual height.
  const architecture = row('Architecture', select(Object.entries(ARCHITECTURES).map(([key, preset]) => [key, preset.label]), options.architecture ?? 'mixed', (v) => {
    const floorRange = ARCHITECTURES[v as ArchitectureName].floors;
    sheet.set({ architecture: v as ArchitectureName, minFloors: Math.min(floorRange[0], topFloor), maxFloors: Math.min(floorRange[1], topFloor) });
  }, 'Kind of buildings: facades, roofs, corners, towers and street features'));
  const floors = row('Floors',
    num(options.minFloors, (v) => sheet.set({ minFloors: Math.trunc(v), maxFloors: Math.max(options.maxFloors, Math.trunc(v)) }), { min: 1, max: topFloor }),
    h('span.muted', {}, 'to'),
    num(options.maxFloors, (v) => sheet.set({ maxFloors: Math.trunc(v), minFloors: Math.min(options.minFloors, Math.trunc(v)) }), { min: 1, max: topFloor }));
  const roofs = choice('Roofs', 'roofs', ROOFS, 'mixed');
  // Filler blocks away from the action cost vbsp far less (decoration is what fills its t-junction buffer).
  const quality = choice('Quality', 'quality', Object.entries(QUALITY).map(([key, level]) => [key, level.label, level.hint]), 'high',
    'High near the action, filler further away: decoration is what a big map runs out of room for');
  const facade = choice('Facade', 'style', [FROM_ARCH, ...Object.keys(FACADE_STYLES).map((name) => [name, name] as [string, string])]);
  const corners = choice('Corners', 'corners', CORNERS);
  const detail = row('Detail', select(DETAIL, String(options.detail ?? 2), (v) => sheet.set({ detail: Number(v) as BuildingOptions['detail'] }), 'Facade decoration, built as func_detail'));
  const weatheringSlider = h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: options.weathering ?? 0.5, title: 'Water stains and dirt on street walls' }) as HTMLInputElement;
  weatheringSlider.addEventListener('change', () => sheet.set({ weathering: parseFloat(weatheringSlider.value) }));
  const weathering = row('Weathering', weatheringSlider);
  const interiors = choice('Interiors', 'interiors', [FROM_ARCH, ['none', 'None'], ['some', 'Some'], ['all', 'All']], '',
    'Enterable open-top houses on small lots and sheds of 1–2 floors (rooms, doors, furniture)');
  const interiorStyle = choice(kind === 'house' ? 'Style' : 'Interior style', 'interiorStyle', [FROM_ARCH, ...Object.entries(INTERIOR_STYLES).map(([key, style]) => [key, style.label] as [string, string])]);
  const cutHeight = row('Cut height', num(options.cutHeight ?? 112, (v) => sheet.set({ cutHeight: Math.trunc(v) }),
    { min: 96, max: 128, step: 8, title: 'Height the walls are cut off at; the RTS camera sees more floor when lower' }));
  const furnish = choice('Furnish', 'furnish', [['full', 'Full'], ['sparse', 'Sparse'], ['none', 'None']], 'full');
  const lights = check('Lights', 'interiorLights', true, 'wall lamps', 'Wall lamps with lights in most rooms');
  // A number, left out at its default.
  const lightLevel = row('Light level', select(LIGHT_LEVELS.map(([level, label]) => [String(level), label]), String(options.interiorLightLevel ?? 1),
    (v) => sheet.set({ interiorLightLevel: Number(v) === 1 ? undefined : Number(v) }), 'How bright the lamps inside the houses are'));
  const wideDoors = check('Wide doors', 'wideDoors', false, 'for large units', '128-wide doorways so the antlion guard fits through');

  const rowsByName: Record<BuildingRow, HTMLElement> = {
    architecture, floors, facade, corners, roofs, quality, detail,
    towers: check('Towers', 'towers', true, kind === 'building' ? 'on a corner' : 'domes and spires'),
    courtyards: check('Courtyards', 'courtyards', true, 'blocks of 896+ units'),
    annexes: check('Annexes', 'annexes', true, kind === 'building' ? 'a shed in its yard' : 'sheds in yards'),
    alleys: check('Alleys', 'alleys', false, 'with sky bridges'),
    weathering, interiors, interiorStyle, cutHeight, furnish, lights, lightLevel, wideDoors,
  };
  const out = sheet.rows.map((name) => rowsByName[name]);
  if (sheet.more) {
    const open = sheet.folds.more;
    out.push(h('button.gen-more', { onclick: () => { sheet.folds.more = !open; sheet.redraw(); } }, `${open ? '▾' : '▸'} More options (${sheet.more.length})`));
    if (open) out.push(...sheet.more.map((name) => rowsByName[name]));
  }
  // Trees, lamps, cables and props round the buildings, under their own heading.
  const extras = extrasRows(options, (key, value) => sheet.set({ [key]: value }), kind, sheet.folds.extras, (open) => { sheet.folds.extras = open; sheet.redraw(); });
  const seed = row('Seed', num(options.seed, (v) => sheet.set({ seed: Math.trunc(v) }), { min: 1, title: 'The same seed and settings give the same buildings' }),
    seedButton(() => sheet.set({ seed: Math.floor(Math.random() * 100000) })));
  return [...out, ...extras, seed];
}
