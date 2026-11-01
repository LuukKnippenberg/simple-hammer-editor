import type { BuildingLayout } from '../gen/buildings.ts';

/**
 * What the Generate menu offers (see generateTool.ts): each generator, how it is placed, and the pure parts of the
 * menu and the placing (keys, the ghost footprint, what a lot becomes), kept free of the DOM for tests.
 */
export type GeneratorId = 'building' | 'block' | 'house' | 'interior' | 'road' | 'powerline' | 'poi';
export type GeneratorGroup = 'Buildings' | 'Infrastructure' | 'Places';
/** Drag a rectangle, click points along a route, or open the room designer. */
export type PlaceHow = 'drag' | 'points' | 'designer';

export interface GeneratorDef {
  id: GeneratorId;
  /** Key in the open menu. */
  key: string;
  group: GeneratorGroup;
  name: string;
  icon: string;
  how: PlaceHow;
  /** With a block brush selected it fills that brush instead of being placed. */
  fills: boolean;
  desc: string;
  /** Key that starts it from anywhere (outside the menu). */
  direct?: string;
}

export const GENERATORS: GeneratorDef[] = [
  { id: 'building', key: '1', group: 'Buildings', name: 'Building', icon: '🏠', how: 'drag', fills: true, desc: 'One building on your footprint: floors, facade, roof' },
  { id: 'block', key: '2', group: 'Buildings', name: 'Building block', icon: '🏢', how: 'drag', fills: true, desc: 'A city block: ring round a courtyard, or a row' },
  { id: 'house', key: '3', group: 'Buildings', name: 'Simple interior building', icon: '🏚', how: 'drag', fills: true, desc: 'An enterable roofless house, furnished from its style' },
  { id: 'interior', key: '4', group: 'Buildings', name: 'Custom interior building', icon: '🏛', how: 'designer', fills: false, desc: 'Rooms on a floor plan in the room designer' },
  { id: 'road', key: '5', group: 'Infrastructure', name: 'Road', icon: '🛣', how: 'points', fills: false, desc: 'Streets with pavements and kerbs, joins other roads', direct: '7' },
  { id: 'powerline', key: '6', group: 'Infrastructure', name: 'Powerline', icon: '⚡', how: 'points', fills: false, desc: 'Poles and sagging wires, with feeds to houses', direct: '9' },
  { id: 'poi', key: '7', group: 'Places', name: 'Point of interest', icon: '⛲', how: 'drag', fills: true, desc: 'Squares, parks, camps, docks, quarries…', direct: 'p' },
];

export const GROUPS: GeneratorGroup[] = ['Buildings', 'Infrastructure', 'Places'];
export const HOW_LABEL: Record<PlaceHow, string> = { drag: 'drag', points: 'click points', designer: 'designer ↗' };

export const generator = (id: GeneratorId): GeneratorDef => GENERATORS.find((g) => g.id === id)!;

/** The generators that build blocks of buildings, and the layout each asks for. */
export const BUILDING_LAYOUTS: Partial<Record<GeneratorId, BuildingLayout>> = { building: 'single', block: 'block', house: 'house' };
export const isBuildingGenerator = (id: GeneratorId | null | undefined): id is 'building' | 'block' | 'house' => !!id && id in BUILDING_LAYOUTS;
/** The generator a stored block was made by. */
export const generatorOfLayout = (layout: BuildingLayout | undefined): GeneratorId => (layout === 'single' ? 'building' : layout === 'house' ? 'house' : 'block');

/** What a key does while the menu is open: pick a generator, repeat the last one (Enter), or close it (Esc, G). */
export function menuKey(key: string, last: GeneratorId | null): { pick: GeneratorId } | { close: true } | null {
  const k = key.toLowerCase();
  if (k === 'escape' || k === 'g') return { close: true };
  if (k === 'enter') return last ? { pick: last } : null;
  const g = GENERATORS.find((x) => x.key === k);
  return g ? { pick: g.id } : null;
}

/** The generator a key starts directly (7 road, 9 powerline, P point of interest). */
export const directGenerator = (key: string): GeneratorId | null => GENERATORS.find((g) => g.direct === key.toLowerCase())?.id ?? null;

export interface DragRect { x0: number; y0: number; x1: number; y1: number }

/**
 * The footprint of a drag from `a` to `b`, on a grid: Shift makes it square (the longer side), a drag under one grid
 * step places the default size round the start. At least `min` on each side.
 */
export function dragRect(a: { x: number; y: number }, b: { x: number; y: number }, o: { square?: boolean; grid?: number; min?: number; size?: [number, number] } = {}): DragRect {
  const g = o.grid ?? 64, min = o.min ?? 128;
  const sn = (v: number) => Math.round(v / g) * g;
  const ax = sn(a.x), ay = sn(a.y);
  let dx = sn(b.x) - ax, dy = sn(b.y) - ay;
  if (Math.abs(dx) < g && Math.abs(dy) < g && o.size) {
    const [w, d] = o.size;
    const x0 = sn(ax - w / 2), y0 = sn(ay - d / 2);
    return { x0, y0, x1: x0 + w, y1: y0 + d };
  }
  if (o.square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * s;
    dy = (dy < 0 ? -1 : 1) * s;
  }
  const grow = (v: number) => (Math.abs(v) < min ? (v < 0 ? -1 : 1) * min : v);
  dx = grow(dx);
  dy = grow(dy);
  return { x0: Math.min(ax, ax + dx), y0: Math.min(ay, ay + dy), x1: Math.max(ax, ax + dx), y1: Math.max(ay, ay + dy) };
}

/** Default footprint of a click without a drag. */
export const DEFAULT_SIZE: Record<'building' | 'block' | 'house', [number, number]> = { building: [512, 384], block: [1536, 1024], house: [448, 384] };

/** What a lot of this size will become, shown on the ghost footprint while dragging. */
export function lotPreview(id: 'building' | 'block' | 'house', w: number, d: number, o: { courtyards?: boolean } = {}): string {
  const min = Math.min(w, d), max = Math.max(w, d);
  if (id === 'house') return max > 640 ? 'Interior house at the street · the rest is its yard' : 'One interior house on the lot';
  if (id === 'building') return min >= 448 && max >= 320 ? 'One building · may be an L round a back yard' : 'One building on the whole lot';
  if ((o.courtyards ?? true) && min >= 896) return 'Ring round a courtyard · lots of 896+ units get one';
  const lots = Math.max(1, Math.round(max / 512));
  return `Row of ${lots === 1 ? 'one building' : `about ${lots} buildings`} · a courtyard needs 896+ units`;
}

/** The Tune step's summary of what was built. */
export function tuneSummary(id: GeneratorId, w: number, d: number, r: { buildings: number; houses: number; ring: boolean }): string {
  const size = `${w} × ${d}`;
  if (id === 'house') return `${size} · ${r.houses ? 'one interior house' : 'too small for an interior house'}`;
  if (id === 'building') return `${size} · ${r.buildings === 1 ? 'one building' : `${r.buildings} buildings`}`;
  const n = `${r.buildings} building${r.buildings === 1 ? '' : 's'}`;
  return `${size} · ${n}${r.ring ? ' round a courtyard' : ' in a row'}${r.houses ? ` · ${r.houses} enterable` : ''}`;
}
