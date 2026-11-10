import { Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { TexAxis, VmfDocument } from '../vmf/map.ts';
import { solidNode, type FaceSpec } from '../edit/brushes.ts';

/**
 * Fences: a line of points A, B, C… (a tree: a point can branch, see `edit/pathPoints.ts`) that the fence follows,
 * on the ground between the points the way powerlines do. Each stretch can have doorways: an opening at a distance
 * along it (from the stretch's first point) with its own width, optionally with a gate. Two ways to build it:
 *
 * - **model**: a row of prop_static fence models along each stretch, each at its nominal length end to end (the
 *   longest that fits first); neighbours share only their end posts. Every model below has a collision model, so with
 *   `solid 6` Recast reads them (`recast_mapmesh.cpp` GenerateStaticPropData).
 *   A stretch that isn't a whole number of pieces is left open at its end (the editor snaps points and doorways to
 *   whole pieces so that rarely happens); at a corner sharper than 90° the next stretch starts past the first one's
 *   pieces, otherwise the two share the corner's end post.
 * - **brush**: func_detail, which vbsp merges into the world that Recast reads: posts at about the spacing with
 *   panels (an alpha-tested fence material), rails, pickets or a guardrail beam between them; or a solid wall
 *   (segmented at the points, mitred at corners, square at doorways, pillars beside gates), with an optional coping
 *   and a pipe railing on top.
 *
 * Except for walls (which block units themselves) an NPC clip strip runs along the fence (not across the doorways)
 * by default, so units can't slip through gaps under rails or between models; the stairs keep their NPC clip as world
 * brushes and so does this.
 *
 * Pure geometry: `fenceLayout` (stretches, runs and doorway gaps), `buildFence` (brushes and props), `fenceOutline`
 * (preview lines). Storage is in `fenceStore.ts`.
 */

export type FenceMode = 'model' | 'brush';

/** A piece of a model fence: its model, how far along to put the next one, and its bounds (scripts/model-bounds.mjs). */
interface ModelPiece {
  model: string;
  /** The nominal length: the next piece starts this far on (end posts overlap a little). */
  step: number;
  min: [number, number, number];
  max: [number, number, number];
}

export interface FenceModelStyle {
  label: string;
  /** The model axis the fence runs along. */
  axis: 'x' | 'y';
  /** Longest first. */
  pieces: ModelPiece[];
  /** How far the models sink into the ground (posts stand in it on slopes). */
  sink: number;
  /** A gate leaf for doorways with a gate, swung open beside the opening (decoration, not solid). */
  gate?: ModelPiece;
  /** Gate posts beside an opening when there is no gate model. */
  postMaterial: string;
}

/**
 * Fence models Lambda Wars has (all static props with a .phy collision model, checked against the game's mounted
 * content through the editor's asset index; bounds measured with scripts/model-bounds.mjs).
 */
export const FENCE_MODELS = {
  chainlink: {
    label: 'Chain-link (City 17)', axis: 'y', sink: 2, postMaterial: 'METAL/METALPIPE001A',
    pieces: [
      { model: 'models/props_c17/fence03a.mdl', step: 256, min: [-2, -130, -54], max: [2, 130, 54] },
      { model: 'models/props_c17/fence01a.mdl', step: 128, min: [-2, -67, -54], max: [2, 67, 54] },
    ],
    gate: { model: 'models/props_c17/gate_door02a.mdl', step: 128, min: [-2, -64, -64], max: [2, 64, 64] },
  },
  wasteland: {
    label: 'Chain-link, tall (wasteland)', axis: 'y', sink: 4, postMaterial: 'METAL/METALPIPE001A',
    pieces: [
      { model: 'models/props_wasteland/exterior_fence_notbarbed002d.mdl', step: 256, min: [-13, -129, -76], max: [-8, 129, 56] },
      { model: 'models/props_wasteland/exterior_fence_notbarbed002c.mdl', step: 128, min: [-13, -65, -76], max: [-8, 65, 56] },
    ],
    gate: { model: 'models/props_c17/gate_door02a.mdl', step: 128, min: [-2, -64, -64], max: [2, 64, 64] },
  },
  barbed: {
    label: 'Chain-link, barbed wire', axis: 'y', sink: 4, postMaterial: 'METAL/METALPIPE001A',
    pieces: [
      { model: 'models/props_wasteland/exterior_fence002d.mdl', step: 256, min: [-13, -129, -76], max: [13, 129, 76] },
      { model: 'models/props_wasteland/exterior_fence002c.mdl', step: 128, min: [-13, -65, -76], max: [13, 65, 76] },
    ],
    gate: { model: 'models/props_c17/gate_door02a.mdl', step: 128, min: [-2, -64, -64], max: [2, 64, 64] },
  },
  panels: {
    label: 'Chain-link panels (interior)', axis: 'y', sink: 2, postMaterial: 'METAL/METALPIPE001A',
    pieces: [
      { model: 'models/props_wasteland/interior_fence002d.mdl', step: 256, min: [-3, -128, -64], max: [3, 128, 64] },
      { model: 'models/props_wasteland/interior_fence002c.mdl', step: 128, min: [-3, -65, -64], max: [3, 65, 64] },
    ],
    gate: { model: 'models/props_c17/gate_door02a.mdl', step: 128, min: [-2, -64, -64], max: [2, 64, 64] },
  },
  planks: {
    label: 'Wooden planks', axis: 'y', sink: 2, postMaterial: 'WOOD/WOODBEAM001A',
    pieces: [
      { model: 'models/brush/fence_wood_256.mdl', step: 256, min: [-3, -129, -1], max: [3, 130, 130] },
      { model: 'models/brush/fence_wood_128.mdl', step: 128, min: [-3, -65, -1], max: [3, 68, 129] },
    ],
  },
  boards: {
    label: 'Wooden boards, tall', axis: 'y', sink: 2, postMaterial: 'WOOD/WOODBEAM001A',
    pieces: [
      { model: 'models/props_forest/fence_border_256.mdl', step: 256, min: [-7, -128, 0], max: [6, 133, 160] },
      { model: 'models/props_forest/fence_border_128.mdl', step: 128, min: [-7, -67, 0], max: [6, 68, 160] },
    ],
  },
  trail: {
    label: 'Wooden rails (trail)', axis: 'y', sink: 2, postMaterial: 'WOOD/WOODBEAM001A',
    pieces: [
      { model: 'models/props_forest/fence_trail_256.mdl', step: 256, min: [-7, -127, 0], max: [6, 129, 64] },
      { model: 'models/props_forest/fence_trail_128.mdl', step: 128, min: [-7, -65, 0], max: [6, 69, 64] },
    ],
  },
} satisfies Record<string, FenceModelStyle>;
export type FenceModelId = keyof typeof FENCE_MODELS;

/** A solid wall (func_detail), segmented at the points with mitred corners, an optional cap on top. */
export interface WallSpec {
  thickness: number;
  /** Coping on top: as tall as `height`, standing out `overhang` on both sides. */
  cap?: { material: string; height: number; overhang: number };
  /** Pillars beside a doorway with a gate: this much wider than the wall. */
  pillar: number;
}

export interface FenceBrushStyle {
  label: string;
  /** Posts with panels or rails, a solid wall (optionally with a railing on it), pickets, or a guardrail. */
  kind: 'posts' | 'wall' | 'pickets' | 'guardrail';
  /** Default height (of the wall itself for walls), post spacing (segment length for walls) and main material. */
  height: number;
  spacing: number;
  post: { size: number; material: string };
  /** A panel between the posts (a fence material, fitted to its height), or none. */
  panel?: { thickness: number; lift: number };
  /** Rails between the posts: centre heights as fractions of the height, and their size across and up. */
  rails?: { at: number[]; width: number; depth: number; material: string };
  /** A rail along the top of the panels. */
  topRail?: { size: number; material: string };
  wall?: WallSpec;
  /** A pipe railing standing on a wall: its height over the wall's top, rails as fractions of that. */
  railing?: { height: number; at: number[] };
  /** Pickets between the posts: width across the fence, thickness, gap between them. */
  pickets?: { width: number; depth: number; gap: number };
  /** A guardrail's beam: its bottom and top over the ground, thickness. */
  beam?: { bottom: number; top: number; depth: number };
  material: string;
}

const COPING = { material: 'CONCRETE/CONCRETEFLOOR027A', height: 4, overhang: 2 };

/**
 * Brush fences and walls, func_detail. Materials checked in the game's content (`/api/list` and the VMTs) and all
 * used by other generators: concrete/concretewall001a, brick/brickwall001a, concrete/concretefloor027a,
 * wood/woodwall009a, wood/woodbeam001a/002a, metal/metalpipe001a, metal/metalwall001a, and the alpha-tested fence
 * materials in FENCE_MATERIALS.
 */
export const FENCE_STYLES = {
  chainlink: {
    label: 'Chain-link on pipes', kind: 'posts', height: 112, spacing: 128, material: 'METAL/METALFENCE004A',
    post: { size: 4, material: 'METAL/METALPIPE001A' }, panel: { thickness: 2, lift: 2 }, topRail: { size: 3, material: 'METAL/METALPIPE001A' },
  },
  boards: {
    label: 'Wooden boards', kind: 'posts', height: 96, spacing: 128, material: 'WOOD/WOODFENCE001',
    post: { size: 6, material: 'WOOD/WOODBEAM001A' }, panel: { thickness: 2, lift: 0 },
  },
  rails: {
    label: 'Wooden rails', kind: 'posts', height: 64, spacing: 128, material: 'WOOD/WOODBEAM002A',
    post: { size: 8, material: 'WOOD/WOODBEAM001A' }, rails: { at: [0.35, 0.85], width: 4, depth: 8, material: 'WOOD/WOODBEAM002A' },
  },
  bars: {
    label: 'Metal bars', kind: 'posts', height: 96, spacing: 128, material: 'METAL/METALFENCE003A',
    post: { size: 6, material: 'METAL/METALPIPE001A' }, panel: { thickness: 2, lift: 0 }, topRail: { size: 4, material: 'METAL/METALPIPE001A' },
  },
  wallConcrete: {
    label: 'Short wall, concrete', kind: 'wall', height: 48, spacing: 256, material: 'CONCRETE/CONCRETEWALL001A',
    post: { size: 24, material: 'CONCRETE/CONCRETEWALL001A' }, wall: { thickness: 16, cap: COPING, pillar: 8 },
  },
  wallBrick: {
    label: 'Short wall, brick', kind: 'wall', height: 48, spacing: 256, material: 'BRICK/BRICKWALL001A',
    post: { size: 24, material: 'BRICK/BRICKWALL001A' }, wall: { thickness: 16, cap: COPING, pillar: 8 },
  },
  wallTall: {
    label: 'Wall, full height', kind: 'wall', height: 192, spacing: 256, material: 'CONCRETE/CONCRETEWALL001A',
    post: { size: 24, material: 'CONCRETE/CONCRETEWALL001A' }, wall: { thickness: 16, cap: COPING, pillar: 8 },
  },
  wallRailing: {
    label: 'Low wall with railing', kind: 'wall', height: 32, spacing: 128, material: 'CONCRETE/CONCRETEWALL001A',
    post: { size: 3, material: 'METAL/METALPIPE001A' }, wall: { thickness: 12, cap: COPING, pillar: 8 }, railing: { height: 44, at: [0.5, 1] },
  },
  pickets: {
    label: 'Picket fence', kind: 'pickets', height: 48, spacing: 128, material: 'WOOD/WOODWALL009A',
    post: { size: 6, material: 'WOOD/WOODBEAM001A' }, rails: { at: [0.3, 0.75], width: 2, depth: 4, material: 'WOOD/WOODWALL009A' },
    pickets: { width: 4, depth: 2, gap: 6 },
  },
  guardrail: {
    label: 'Metal guardrail', kind: 'guardrail', height: 32, spacing: 96, material: 'METAL/METALWALL001A',
    post: { size: 6, material: 'METAL/METALPIPE001A' }, beam: { bottom: 18, top: 30, depth: 2 },
  },
} satisfies Record<string, FenceBrushStyle>;
export type FenceStyleId = keyof typeof FENCE_STYLES;

/** A brush style, typed as the interface (the table is checked with `satisfies`). */
export const brushStyle = (id: FenceStyleId): FenceBrushStyle => FENCE_STYLES[id] as FenceBrushStyle;

/**
 * Panel, rail and wall materials for brush fences (all exist in the game: wood/woodfence001 and metal/metalfence003a,
 * 004a, 007a are alpha-tested, 512×512).
 */
export const FENCE_MATERIALS: [string, string][] = [
  ['METAL/METALFENCE004A', 'Chain-link'],
  ['METAL/METALFENCE007A', 'Chain-link, rusty'],
  ['METAL/METALFENCE003A', 'Metal bars'],
  ['WOOD/WOODFENCE001', 'Wooden boards'],
  ['WOOD/WOODBEAM002A', 'Wooden beam'],
  ['WOOD/WOODWALL009A', 'Wooden wall'],
  ['METAL/METALWALL074A', 'Metal sheet'],
  ['METAL/METALWALL001A', 'Metal plate'],
  ['CONCRETE/CONCRETEWALL001A', 'Concrete'],
  ['BRICK/BRICKWALL001A', 'Brick'],
  ['STONE/STONEWALL017A', 'Stone'],
  ['PLASTER/PLASTERWALL003A', 'Plaster'],
];

/** An opening in a stretch: its middle `at` units along the stretch from its first point, `width` wide. */
export interface FenceDoor {
  at: number;
  width: number;
  /** Gate posts or pillars beside it, and a gate leaf swung open (model fences that have one). */
  gate?: boolean;
}

/** A stretch of the fence from one point to the next, with its doorways. */
export interface FenceLink { from: number; to: number; doors?: FenceDoor[] }

export interface FencePoint { x: number; y: number; z: number }

export interface FenceSpec {
  uid: string;
  /** In the path's one order: A first, `links[k].to === k + 1`. */
  points: FencePoint[];
  links: FenceLink[];
  mode: FenceMode;
  model: FenceModelId;
  style: FenceStyleId;
  /** Brush fences: height (of the wall itself for walls), distance between posts, and a material other than the style's. */
  height: number;
  spacing: number;
  material?: string;
  /** NPC clip along the fence (not the doorways). Walls block units themselves and get none. */
  clip: boolean;
  /** Walls: the coping on top (none: the style's own choice). */
  cap?: boolean;
}

export const DEFAULT_FENCE: Omit<FenceSpec, 'uid' | 'points' | 'links'> = {
  mode: 'model', model: 'chainlink', style: 'chainlink', height: FENCE_STYLES.chainlink.height, spacing: FENCE_STYLES.chainlink.spacing, clip: true,
};

/**
 * A settings change as it applies: a new brush style brings its own height, spacing and material (a material or cap
 * picked for the old style is dropped).
 */
export function fencePatch(current: Pick<FenceSpec, 'style'>, patch: Partial<FenceSpec>): Partial<FenceSpec> {
  if (!patch.style || patch.style === current.style) return patch;
  const style = FENCE_STYLES[patch.style];
  return { height: style.height, spacing: style.spacing, material: undefined, cap: undefined, ...patch };
}

export const newFenceUid = (): string => Math.random().toString(36).slice(2, 8);

/** A new doorway's width, and the narrowest and the shortest piece of fence kept beside one. */
export const DOOR_WIDTH = 96;
export const MIN_DOOR = 32;
const MIN_RUN = 8;
/** Points between the ends stand on the ground under them when it is within this of the straight line. */
const GROUND_REACH = 256;
/** How far posts, walls and the clip reach into the ground. */
const SINK = 8;
const NPCCLIP = 'TOOLS/TOOLSNPCCLIP';
/** Width of the NPC clip strip (at least the fence's own thickness). */
const CLIP_WIDTH = 8;
/** A model piece still fits a length this much shorter than it (points are rounded to whole units). */
const FIT = 1;

// --- Spec ----------------------------------------------------------------------------------------------------

const num = (v: number) => String(Math.round(v * 100) / 100);

/**
 * `uid|mode|model|style|height|spacing|clip|material|points|links|cap`: points `x,y,z;…`; links in order (link k
 * ends at point k + 1), each its parent point and its doors `@at,width[,g]`; cap `1` or `0`, left out for the style's own.
 */
export function encodeFence(s: FenceSpec): string {
  const points = s.points.map((p) => `${num(p.x)},${num(p.y)},${num(p.z)}`).join(';');
  const links = s.links.map((l) => `${l.from}${(l.doors ?? []).map((d) => `@${num(d.at)},${num(d.width)}${d.gate ? ',g' : ''}`).join('')}`).join(';');
  const parts = [s.uid, s.mode, s.model, s.style, num(s.height), num(s.spacing), s.clip ? 1 : 0, s.material ?? '', points, links];
  return (s.cap === undefined ? parts : [...parts, s.cap ? 1 : 0]).join('|');
}

export function decodeFence(v: string): FenceSpec | null {
  const parts = v.split('|');
  if (parts.length < 10) return null;
  const [uid, mode, model, style, height, spacing, clip, material, pts, lnk, cap] = parts;
  if (!uid || (mode !== 'model' && mode !== 'brush') || !(model in FENCE_MODELS) || !(style in FENCE_STYLES)) return null;
  const points = pts.split(';').filter(Boolean).map((p) => { const [x, y, z] = p.split(',').map(Number); return { x, y, z }; });
  if (!points.length || points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))) return null;
  const links: FenceLink[] = lnk ? lnk.split(';').map((item, k) => {
    const [from, ...doors] = item.split('@');
    const link: FenceLink = { from: Number(from), to: k + 1 };
    if (doors.length) link.doors = doors.map((d) => { const [at, width, g] = d.split(','); return { at: Number(at), width: Number(width), ...(g === 'g' ? { gate: true } : {}) }; });
    return link;
  }) : [];
  if (links.length !== points.length - 1 || links.some((l) => !(l.from >= 0 && l.from < l.to))) return null;
  return {
    uid, mode, model: model as FenceModelId, style: style as FenceStyleId, height: Number(height) || FENCE_STYLES[style as FenceStyleId].height,
    spacing: Number(spacing) || FENCE_STYLES[style as FenceStyleId].spacing, clip: clip === '1', ...(material ? { material } : {}), points, links,
    ...(cap === '1' || cap === '0' ? { cap: cap === '1' } : {}),
  };
}

// --- Model pieces --------------------------------------------------------------------------------------------

export const modelStyle = (id: FenceModelId): FenceModelStyle => FENCE_MODELS[id] as FenceModelStyle;

const pieceLength = (style: FenceModelStyle, p: ModelPiece) => (style.axis === 'y' ? p.max[1] - p.min[1] : p.max[0] - p.min[0]);
const pieceWidth = (style: FenceModelStyle, p: ModelPiece) => (style.axis === 'y' ? p.max[0] - p.min[0] : p.max[1] - p.min[1]);

/** How far a piece's bounds stand out past its nominal length at each end: its end post. */
export const pieceOverhang = (style: FenceModelStyle, p: ModelPiece): number => Math.max(0, (pieceLength(style, p) - p.step) / 2);

/** A model style's widest half-width and longest end post. */
export function modelReach(style: FenceModelStyle): { half: number; over: number } {
  return { half: Math.max(...style.pieces.map((p) => pieceWidth(style, p) / 2)), over: Math.max(...style.pieces.map((p) => pieceOverhang(style, p))) };
}

/** What points and doorways snap to: the shortest model piece (0 for brush fences, which fit any length). */
export function pieceUnit(spec: Partial<Pick<FenceSpec, 'mode' | 'model'>>): number {
  if (spec.mode !== 'model' || !spec.model) return 0;
  return Math.min(...modelStyle(spec.model).pieces.map((p) => p.step));
}

/**
 * Where a point goes when it ends a stretch from `from`: model fences make the stretch a whole number of the shortest
 * piece (at least one), along the line from `from` to `at`. Plan only (x, y), rounded to whole units.
 */
export function snapToPieces(from: { x: number; y: number }, at: { x: number; y: number }, unit: number): { x: number; y: number } {
  const dx = at.x - from.x, dy = at.y - from.y, d = Math.hypot(dx, dy);
  if (!unit || d < 1e-6) return { x: Math.round(at.x), y: Math.round(at.y) };
  const n = Math.max(1, Math.round(d / unit));
  return { x: Math.round(from.x + (dx / d) * n * unit), y: Math.round(from.y + (dy / d) * n * unit) };
}

// --- Layout --------------------------------------------------------------------------------------------------

export type Ground = (x: number, y: number) => number | null;

/** A piece of a stretch without doorways: from `s0` to `s1` along it. Model fences: their pieces reach `filled`. */
export interface FenceRun { link: number; s0: number; s1: number; filled?: number }
/** A doorway as built: where its opening runs along the stretch (clamped, for models snapped to whole pieces). */
export interface FenceGap { link: number; door: number; s0: number; s1: number; gate: boolean }

export interface FenceStretch {
  link: number;
  a: FencePoint;
  b: FencePoint;
  /** Plan length and direction. */
  length: number;
  dir: Vector2;
  /** Model fences: where the first piece starts (past the post of a sharp corner). */
  start: number;
  runs: FenceRun[];
  gaps: FenceGap[];
  /** Model fences: the length left open because the runs aren't whole numbers of pieces (at their ends). */
  open: number;
}

/** A model piece of a run: its middle along the stretch, and which piece. */
export interface PlacedPiece { s: number; piece: ModelPiece }

/**
 * Model pieces for a run, each at its nominal length, end to end from the start of the run: the longest that fits,
 * then shorter ones. What is left at the end of the run stays open; pieces never squeeze or overlap more than their
 * end posts.
 */
export function modelPieces(style: FenceModelStyle, run: Pick<FenceRun, 's0' | 's1'>): PlacedPiece[] {
  const pieces = [...style.pieces].sort((p, q) => q.step - p.step);
  const out: PlacedPiece[] = [];
  for (let s = run.s0; ;) {
    const p = pieces.find((q) => q.step <= run.s1 - s + FIT);
    if (!p) break;
    out.push({ s: s + p.step / 2, piece: p });
    s += p.step;
  }
  return out;
}

const awayDirs = (spec: Pick<FenceSpec, 'points' | 'links'>, point: number): { link: number; start: boolean; u: Vector2 }[] => {
  const dirOf = (l: FenceLink) => {
    const a = spec.points[l.from], b = spec.points[l.to];
    return new Vector2(b.x - a.x, b.y - a.y).normalize();
  };
  const into = spec.links.flatMap((l, k) => (l.to === point ? [{ link: k, start: false, u: dirOf(l).negate() }] : []));
  const out = spec.links.flatMap((l, k) => (l.from === point ? [{ link: k, start: true, u: dirOf(l) }] : []));
  return [...into, ...out];
};

/**
 * Model fences: how far a stretch's first piece starts from its first point. Where it leaves a point at less than 90°
 * to a stretch already there (the one coming in, or an earlier branch), it starts past that stretch's pieces; at 90°
 * or more the two share the corner's end post.
 */
function cornerClearance(spec: Pick<FenceSpec, 'points' | 'links'>, k: number, reach: { half: number; over: number }): number {
  const ends = awayDirs(spec, spec.links[k].from);
  const mine = ends.findIndex((e) => e.link === k && e.start);
  let clear = 0;
  for (const e of ends.slice(0, mine)) {
    const theta = Math.acos(Math.max(-1, Math.min(1, e.u.dot(ends[mine].u))));
    if (theta >= Math.PI / 2 - 1e-3) continue;
    clear = Math.max(clear, Math.ceil(reach.half / Math.tan(Math.max(theta, 0.05) / 2) + reach.over));
  }
  return clear;
}

/** The stretches of a fence, each cut into runs by its doorways (each opening clamped to fit, overlaps merged). */
export function fenceLayout(spec: Pick<FenceSpec, 'points' | 'links'> & Partial<Pick<FenceSpec, 'mode' | 'model'>>): FenceStretch[] {
  const unit = pieceUnit(spec);
  const style = unit ? modelStyle(spec.model!) : null;
  const reach = style ? modelReach(style) : null;
  return spec.links.map((link, k) => {
    const a = spec.points[link.from], b = spec.points[link.to];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = length > 0 ? new Vector2((b.x - a.x) / length, (b.y - a.y) / length) : new Vector2(1, 0);
    const start = reach ? Math.min(length, cornerClearance(spec, k, reach)) : 0;
    const gaps = doorGaps(link.doors ?? [], length, unit, start).map((g) => ({ ...g, link: k }));
    const runs: FenceRun[] = [];
    let s = start;
    for (const g of gaps) {
      if (g.s0 - s >= MIN_RUN) runs.push({ link: k, s0: s, s1: g.s0 });
      s = g.s1;
    }
    if (length - s >= MIN_RUN) runs.push({ link: k, s0: s, s1: length });
    let open = 0;
    if (style) {
      for (const run of runs) {
        const pieces = modelPieces(style, run);
        run.filled = pieces.length ? pieces[pieces.length - 1].s + pieces[pieces.length - 1].piece.step / 2 : run.s0;
        open += Math.max(0, run.s1 - run.filled);
      }
    }
    return { link: k, a, b, length, dir, start, runs, gaps, open: Math.round(open) };
  });
}

/**
 * Where a stretch's doorways open: each clamped into the stretch, sorted, overlapping ones merged into the first. With
 * a `unit` (model fences) an opening is a whole number of pieces wide and starts a whole number of pieces after
 * `origin`, so the pieces beside it end exactly at it.
 */
export function doorGaps(doors: FenceDoor[], length: number, unit = 0, origin = 0): Omit<FenceGap, 'link'>[] {
  const out: Omit<FenceGap, 'link'>[] = [];
  const last = unit ? origin + Math.floor((length - origin + FIT) / unit) * unit : length;
  doors.map((d, door) => {
    if (!unit) {
      const width = Math.min(Math.max(MIN_DOOR, d.width), length);
      const at = Math.min(Math.max(d.at, width / 2), length - width / 2);
      return { door, s0: at - width / 2, s1: at + width / 2, gate: !!d.gate };
    }
    const width = Math.max(unit, Math.ceil((d.width - FIT) / unit) * unit);
    const s0 = Math.min(Math.max(origin, origin + Math.round((d.at - width / 2 - origin) / unit) * unit), Math.max(origin, last - width));
    return { door, s0, s1: Math.min(length, s0 + width), gate: !!d.gate };
  }).sort((p, q) => p.s0 - q.s0).forEach((g) => {
    const prev = out[out.length - 1];
    if (prev && g.s0 <= prev.s1 + (unit ? 0 : MIN_RUN)) { prev.s1 = Math.max(prev.s1, g.s1); prev.gate ||= g.gate; } else out.push({ ...g });
  });
  // A doorway that leaves a sliver of fence at an end takes it (for models: less than a piece after it).
  for (const g of out) {
    if (g.s0 - origin < MIN_RUN) g.s0 = unit ? origin : 0;
    if (length - g.s1 < (unit ? unit - FIT : MIN_RUN)) g.s1 = length;
  }
  return out;
}

/** The point `s` along a stretch, on the ground under it when that is near the straight line between its ends. */
export function pointAlong(st: Pick<FenceStretch, 'a' | 'b' | 'length'>, s: number, ground?: Ground): Vector3 {
  const t = st.length > 0 ? s / st.length : 0;
  const x = st.a.x + (st.b.x - st.a.x) * t, y = st.a.y + (st.b.y - st.a.y) * t;
  let z = st.a.z + (st.b.z - st.a.z) * t;
  // The ends are the points themselves (snapped to the ground when placed).
  if (s > 0.5 && s < st.length - 0.5) {
    const g = ground?.(x, y);
    if (g != null && Math.abs(g - z) <= GROUND_REACH) z = g;
  }
  return new Vector3(x, y, z);
}

/** Where posts stand in a run: both ends and evenly between at about the spacing. */
export function postStations(run: Pick<FenceRun, 's0' | 's1'>, spacing: number): number[] {
  const n = Math.max(1, Math.round((run.s1 - run.s0) / Math.max(16, spacing)));
  return Array.from({ length: n + 1 }, (_, j) => run.s0 + ((run.s1 - run.s0) * j) / n);
}

/** A model piece as placed: its stretch, middle (in plan and along the stretch), length of its bounds and half-width. */
export interface ModelPlacement { link: number; s: number; centre: Vector2; dir: Vector2; piece: ModelPiece; length: number; half: number; over: number }

/** Every model piece of a model fence, in plan. */
export function modelPlacements(spec: FenceSpec, layout = fenceLayout(spec)): ModelPlacement[] {
  const style = modelStyle(spec.model);
  return layout.flatMap((st) => st.runs.flatMap((run) => modelPieces(style, run).map(({ s, piece }) => ({
    link: st.link, s, piece, dir: st.dir.clone(), centre: new Vector2(st.a.x + st.dir.x * s, st.a.y + st.dir.y * s),
    length: pieceLength(style, piece), half: pieceWidth(style, piece) / 2, over: pieceOverhang(style, piece),
  }))));
}

/** The yaw that turns a model's long axis along `dir`. */
export function modelYaw(axis: 'x' | 'y', dir: Vector2): number {
  const deg = (Math.atan2(axis === 'x' ? dir.y : -dir.x, axis === 'x' ? dir.x : dir.y) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360);
}

/** The origin that puts a model's bounds' middle (in plan) on `at` turned by `yaw`, its bottom `sink` under `z`. */
export function modelOrigin(piece: Pick<ModelPiece, 'min' | 'max'>, at: { x: number; y: number }, z: number, yaw: number, sink: number): Vector3 {
  const cx = (piece.min[0] + piece.max[0]) / 2, cy = (piece.min[1] + piece.max[1]) / 2;
  const r = (yaw * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return new Vector3(Math.round(at.x - (cx * c - cy * s)), Math.round(at.y - (cx * s + cy * c)), Math.round(z - piece.min[2] - sink));
}

/** Whether a wall gets its coping. */
export const wallCap = (spec: Pick<FenceSpec, 'style' | 'cap'>): boolean => !!brushStyle(spec.style).wall?.cap && (spec.cap ?? true);

/** How tall the fence stands (a wall with its cap and railing). */
export function fenceHeight(spec: Pick<FenceSpec, 'mode' | 'model' | 'height' | 'style'> & Partial<Pick<FenceSpec, 'cap'>>): number {
  if (spec.mode === 'brush') {
    const style = brushStyle(spec.style);
    return spec.height + (wallCap(spec) ? style.wall!.cap!.height : 0) + (style.railing?.height ?? 0);
  }
  const m = modelStyle(spec.model);
  return Math.max(...m.pieces.map((p) => p.max[2] - p.min[2])) - m.sink;
}

/** Whether the fence blocks units by itself everywhere (solid walls), so it needs no NPC clip. */
export const fenceIsSolid = (spec: Pick<FenceSpec, 'mode' | 'style'>): boolean => spec.mode === 'brush' && brushStyle(spec.style).kind === 'wall';

/** How thick the fence is across (for the clip). */
function fenceThickness(spec: Pick<FenceSpec, 'mode' | 'model' | 'style'>): number {
  if (spec.mode === 'brush') return brushStyle(spec.style).wall?.thickness ?? brushStyle(spec.style).post.size;
  return modelReach(modelStyle(spec.model)).half * 2;
}

// --- Brushes -------------------------------------------------------------------------------------------------

type HeightAt = (p: Vector2) => number;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A footprint along `dir` from `origin`: s0..s1 along, t0..t1 across (to the left). */
function strip(origin: Vector2, dir: Vector2, s0: number, s1: number, t0: number, t1: number): Vector2[] {
  const left = new Vector2(-dir.y, dir.x);
  const at = (s: number, t: number) => origin.clone().addScaledVector(dir, s).addScaledVector(left, t);
  return [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)];
}

/** A height that runs linearly from `za` at `a` to `zb` at `b` (measured along `dir`). */
function slope(a: Vector2, dir: Vector2, length: number, za: number, zb: number): HeightAt {
  const k = length > 0 ? (zb - za) / length : 0;
  return (p) => za + ((p.x - a.x) * dir.x + (p.y - a.y) * dir.y) * k;
}

/**
 * Texture axes along a fence: u along it, v down; `top` at the top of the texture. Panels fit one texture height
 * over `height` units; walls give `scale` (Hammer's 0.25).
 */
interface PanelTexture { dir: Vector2; origin: Vector2; height: number; top: number; scale?: number }

/**
 * A convex brush over a convex footprint between a bottom and a top height (linear in plan). Side faces along the
 * fence take `texture` (u along it, v down); the rest are world aligned.
 */
function prism(doc: VmfDocument, foot: Vector2[], bottom: HeightAt, top: HeightAt, material: string | ((n: Vector3) => string), texture?: PanelTexture): KVNode | null {
  const pts = foot.map((p) => new Vector2(r3(p.x), r3(p.y)));
  const lo = pts.map((p) => new Vector3(p.x, p.y, r3(bottom(p)))), hi = pts.map((p) => new Vector3(p.x, p.y, r3(top(p))));
  if (hi.some((c, i) => c.z < lo[i].z + 0.5)) return null;
  const centre = new Vector3();
  for (const p of [...lo, ...hi]) centre.add(p);
  centre.divideScalar(lo.length * 2);
  const faces: FaceSpec[] = [];
  const scale = texture ? texture.scale ?? texture.height / 512 : 0;
  const face = (a: Vector3, b: Vector3, c: Vector3) => {
    let n = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(b, a));
    if (n.lengthSq() < 1e-6) return;
    if (n.dot(new Vector3().subVectors(a, centre)) < 0) { [b, c] = [c, b]; n = n.negate(); }
    n.normalize();
    const f: FaceSpec = { points: [a, b, c], material: typeof material === 'string' ? material : material(n) };
    if (texture && Math.abs(n.z) < 0.7 && Math.abs(n.x * texture.dir.x + n.y * texture.dir.y) < 0.5) {
      const u: TexAxis = { axis: new Vector3(texture.dir.x, texture.dir.y, 0), shift: r3(-(texture.origin.x * texture.dir.x + texture.origin.y * texture.dir.y) / scale), scale: r3(scale) };
      const v: TexAxis = { axis: new Vector3(0, 0, -1), shift: r3(texture.top / scale), scale: r3(scale) };
      Object.assign(f, { u, v });
    }
    faces.push(f);
  };
  face(hi[0], hi[1], hi[2]);
  face(lo[0], lo[1], lo[2]);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    face(lo[i], lo[j], hi[j]);
  }
  return solidNode(doc, faces, '200 160 90');
}

/** A line in plan: through `p` along `d`. */
interface Cut { p: Vector2; d: Vector2 }
const cross2 = (a: Vector2, b: Vector2) => a.x * b.y - a.y * b.x;
const leftOf = (d: Vector2) => new Vector2(-d.y, d.x);

/**
 * How a wall `half` wide ends at one of its stretch's points: mitred with the other stretch of the point's main pair
 * (the one coming in and the first one out, or A's first two), square at an end, and a branch stops at the face of
 * the main wall it leaves. Null: square across at the point.
 */
function wallEndCut(spec: Pick<FenceSpec, 'points' | 'links'>, k: number, atStart: boolean, half: number): Cut | null {
  const link = spec.links[k];
  const point = atStart ? link.from : link.to;
  const ends = awayDirs(spec, point);
  if (ends.length < 2) return null;
  const P = new Vector2(spec.points[point].x, spec.points[point].y);
  const mine = ends.find((e) => e.link === k && e.start === atStart)!;
  const main = ends.slice(0, 2);
  if (main.includes(mine)) {
    const other = main[0] === mine ? main[1] : main[0];
    const bis = mine.u.clone().add(other.u);
    if (bis.length() < 1e-3) return null;
    // Nearly folded back: the mitre would run far out; square ends overlap a little instead.
    if (mine.u.dot(other.u) > 0.94) return null;
    return { p: P, d: bis.normalize() };
  }
  // A branch: up to the face of the main stretch it leaves closest to.
  const near = main[0].u.dot(mine.u) >= main[1].u.dot(mine.u) ? main[0] : main[1];
  const sin = cross2(near.u, mine.u);
  if (Math.abs(sin) < 0.34) return null;
  return { p: P.clone().addScaledVector(leftOf(near.u), Math.sign(sin) * half), d: near.u.clone() };
}

/**
 * The plan footprint of a wall segment of a stretch from `s0` to `s1`, `half` wide, its ends on `cutA` and `cutB`
 * (null: square across). Corners that would fold over fall back to square ends.
 */
function wallFoot(st: FenceStretch, s0: number, s1: number, half: number, cutA: Cut | null, cutB: Cut | null): Vector2[] {
  const a = new Vector2(st.a.x, st.a.y), left = leftOf(st.dir);
  const along = (t: number, cut: Cut | null, s: number): number => {
    if (!cut) return s;
    const p0 = a.clone().addScaledVector(left, t);
    const den = cross2(st.dir, cut.d);
    if (Math.abs(den) < 1e-3) return s;
    return cross2(cut.p.clone().sub(p0), cut.d) / den;
  };
  let ends = [-half, half].map((t) => [along(t, cutA, s0), along(t, cutB, s1)]);
  if (ends.some(([p, q]) => q - p < 1)) ends = [[s0, s1], [s0, s1]];
  const at = (s: number, t: number) => a.clone().addScaledVector(st.dir, s).addScaledVector(left, t);
  return [at(ends[0][0], -half), at(ends[0][1], -half), at(ends[1][1], half), at(ends[1][0], half)];
}

export interface FenceProp { classname: string; origin: Vector3; keys: Record<string, string> }

export interface FenceBuild {
  /** func_detail brushes: posts, panels, rails, walls, gate posts. */
  detail: KVNode[];
  /** World NPC clip brushes. */
  clip: KVNode[];
  props: FenceProp[];
  /** Counted for the summary. */
  posts: number;
  pieces: number;
  doors: number;
  length: number;
}

/** Builds a fence: its brushes, its clip and its props. `ground` puts what stands between the points on the ground. */
export function buildFence(doc: VmfDocument, spec: FenceSpec, ground?: Ground): FenceBuild {
  const out: FenceBuild = { detail: [], clip: [], props: [], posts: 0, pieces: 0, doors: 0, length: 0 };
  const add = (list: KVNode[], node: KVNode | null) => { if (node) list.push(node); };
  const height = fenceHeight(spec);
  const stretches = fenceLayout(spec);
  const postsAt = new Set<string>();
  /** A square post at a ground point, turned along the stretch (once per spot: corners are shared). */
  const post = (st: FenceStretch, p: Vector3, size: number, base: number, top: number, material: string, count = true) => {
    const key = `${Math.round(p.x)},${Math.round(p.y)},${size},${base}`;
    if (postsAt.has(key)) return;
    postsAt.add(key);
    const foot = strip(new Vector2(p.x, p.y), st.dir, -size / 2, size / 2, -size / 2, size / 2);
    add(out.detail, prism(doc, foot, () => p.z + base, () => p.z + top, material));
    if (count) out.posts++;
  };
  /** A bar along a stretch from ground point p to q, `t0..t1` across, from `b` to `t` over the ground. */
  const bar = (st: FenceStretch, p: Vector3, q: Vector3, t0: number, t1: number, b: number, t: number, material: string, list: KVNode[], texture?: PanelTexture) => {
    const a = new Vector2(p.x, p.y), len = a.distanceTo(new Vector2(q.x, q.y));
    if (len < 1) return;
    const line = slope(a, st.dir, len, p.z, q.z);
    add(list, prism(doc, strip(a, st.dir, 0, len, t0, t1), (x) => line(x) + b, (x) => line(x) + t, material, texture));
  };
  const stations = (st: FenceStretch, run: Pick<FenceRun, 's0' | 's1'>, spacing: number) => postStations(run, spacing).map((s) => pointAlong(st, s, ground));
  const style = brushStyle(spec.style);

  for (const st of stretches) {
    out.length += st.length;
    out.doors += st.gaps.length;
    if (spec.mode === 'brush') {
      const material = spec.material ?? style.material;
      if (style.kind === 'wall') buildWall(st);
      else {
        for (const run of st.runs) {
          const pts = stations(st, run, spec.spacing);
          const postTop = style.kind === 'pickets' ? spec.height + 4 : spec.height + (style.topRail ? style.topRail.size / 2 : 4);
          pts.forEach((p) => post(st, p, style.post.size, -SINK, postTop, style.post.material));
          for (let j = 0; j + 1 < pts.length; j++) betweenPosts(st, pts[j], pts[j + 1], material);
          if (style.pickets) pickets(st, run, material);
        }
        for (const g of st.gaps) {
          if (!g.gate) continue;
          for (const s of [g.s0, g.s1]) post(st, pointAlong(st, s, ground), style.post.size + 4, -SINK, spec.height + 24, style.post.material, false);
        }
      }
    } else buildModels(st);
    if (spec.clip && !fenceIsSolid(spec)) {
      const w = Math.max(CLIP_WIDTH, fenceThickness(spec)) / 2;
      for (const run of st.runs) {
        // Model fences: only as far as their pieces reach (an open end stays open).
        const end = run.filled ?? run.s1;
        if (end - run.s0 < 1) continue;
        const pts = stations(st, { s0: run.s0, s1: end }, 128);
        for (let j = 0; j + 1 < pts.length; j++) bar(st, pts[j], pts[j + 1], -w, w, -SINK, Math.max(64, height + 8), NPCCLIP, out.clip);
      }
    }
  }
  return out;

  /** Panels, rails, a top rail or a guardrail's beam between two posts. */
  function betweenPosts(st: FenceStretch, p: Vector3, q: Vector3, material: string): void {
    const half = style.post.size / 2;
    if (style.panel) {
      const th = style.panel.thickness / 2;
      const texture: PanelTexture = { dir: st.dir, origin: new Vector2(st.a.x, st.a.y), height: spec.height - style.panel.lift, top: Math.max(p.z, q.z) + spec.height };
      // From post edge to post edge, so panels never stand in the posts.
      const d = Math.max(1, p.distanceTo(q));
      const pIn = p.clone().addScaledVector(new Vector3(st.dir.x, st.dir.y, 0), half), qIn = q.clone().addScaledVector(new Vector3(st.dir.x, st.dir.y, 0), -half);
      pIn.z = p.z + ((q.z - p.z) * half) / d;
      qIn.z = q.z - ((q.z - p.z) * half) / d;
      bar(st, pIn, qIn, -th, th, style.panel.lift, spec.height, material, out.detail, texture);
    }
    if (style.topRail) {
      const r = style.topRail.size / 2;
      bar(st, p, q, -r, r, spec.height - r, spec.height + r, style.topRail.material, out.detail);
    }
    if (style.rails) {
      const rails = style.rails;
      for (const at of rails.at) bar(st, p, q, -rails.width / 2, rails.width / 2, at * spec.height - rails.depth / 2, at * spec.height + rails.depth / 2, spec.material ?? rails.material, out.detail);
    }
    if (style.beam) {
      // On the left of the posts, so it never stands in them.
      bar(st, p, q, half, half + style.beam.depth, style.beam.bottom, style.beam.top, material, out.detail);
    }
  }

  /** Pickets along a run, on the left of the rails, between the posts. */
  function pickets(st: FenceStretch, run: FenceRun, material: string): void {
    const pk = style.pickets!, railHalf = (style.rails?.width ?? 0) / 2, postHalf = style.post.size / 2;
    const step = pk.width + pk.gap;
    const from = run.s0 + postHalf + pk.gap, to = run.s1 - postHalf - pk.gap;
    const n = Math.floor((to - from + pk.gap) / step);
    if (n < 1) return;
    const lead = from + (to - from - (n * step - pk.gap)) / 2;
    for (let i = 0; i < n; i++) {
      const s = lead + i * step;
      const p = pointAlong(st, s + pk.width / 2, ground);
      const foot = strip(new Vector2(st.a.x, st.a.y), st.dir, s, s + pk.width, railHalf, railHalf + pk.depth);
      add(out.detail, prism(doc, foot, () => p.z + 2, () => p.z + spec.height, material));
    }
  }

  /**
   * A solid wall along a stretch: segments between the points (and where the ground changes), mitred where two
   * stretches meet, square at doorways; pillars beside an opening with a gate; a coping and a railing on top.
   */
  function buildWall(st: FenceStretch): void {
    const wall = style.wall!;
    const half = wall.thickness / 2;
    const cap = wallCap(spec) ? wall.cap! : null;
    const material = spec.material ?? style.material;
    const pillar = wall.thickness + wall.pillar;
    const texture = (top: number): PanelTexture => ({ dir: st.dir, origin: new Vector2(st.a.x, st.a.y), height: 0, top, scale: 0.25 });
    const gateAt = (s: number) => st.gaps.some((g) => g.gate && (Math.abs(g.s0 - s) < 0.5 || Math.abs(g.s1 - s) < 0.5));
    const cuts = (w: number) => ({ a: wallEndCut(spec, st.link, true, w), b: wallEndCut(spec, st.link, false, w) });
    const wallCuts = cuts(half), capCuts = cap ? cuts(half + cap.overhang) : null;
    for (const run of st.runs) {
      // Pillars take the ends of a run beside a gate, so the opening keeps its width.
      const s0 = run.s0 + (gateAt(run.s0) ? pillar : 0), s1 = run.s1 - (gateAt(run.s1) ? pillar : 0);
      if (s1 - s0 >= 1) {
        // Segments where the ground bends (one per run on flat ground).
        const pts = postStations({ s0, s1 }, spec.spacing).map((s) => ({ s, p: pointAlong(st, s, ground) }));
        const keep = pts.filter((q, i) => i === 0 || i === pts.length - 1 || Math.abs((pts[i - 1].p.z + pts[i + 1].p.z) / 2 - q.p.z) > 0.5);
        for (let j = 0; j + 1 < keep.length; j++) {
          const A = keep[j], B = keep[j + 1];
          const atA = A.s < 0.5, atB = B.s > st.length - 0.5;
          const a2 = new Vector2(A.p.x, A.p.y);
          const line = slope(a2, st.dir, B.s - A.s, A.p.z, B.p.z);
          const top = Math.max(A.p.z, B.p.z) + spec.height;
          add(out.detail, prism(doc, wallFoot(st, A.s, B.s, half, atA ? wallCuts.a : null, atB ? wallCuts.b : null),
            (x) => line(x) - SINK, (x) => line(x) + spec.height, material, texture(top)));
          if (cap && capCuts) {
            add(out.detail, prism(doc, wallFoot(st, A.s, B.s, half + cap.overhang, atA ? capCuts.a : null, atB ? capCuts.b : null),
              (x) => line(x) + spec.height, (x) => line(x) + spec.height + cap.height, cap.material));
          }
          if (style.railing) railing(st, A.p, B.p, spec.height + (cap?.height ?? 0));
        }
      }
      for (const [g0, g1] of [[run.s0, s0], [s1, run.s1]]) {
        if (g1 - g0 < 1) continue;
        const p = pointAlong(st, (g0 + g1) / 2, ground);
        const ph = pillar / 2;
        const foot = strip(new Vector2(st.a.x, st.a.y), st.dir, g0, g1, -ph, ph);
        add(out.detail, prism(doc, foot, () => p.z - SINK, () => p.z + spec.height + 8, material));
        if (cap) add(out.detail, prism(doc, strip(new Vector2(st.a.x, st.a.y), st.dir, g0 - cap.overhang, g1 + cap.overhang, -ph - cap.overhang, ph + cap.overhang),
          () => p.z + spec.height + 8, () => p.z + spec.height + 8 + cap.height, cap.material));
      }
    }
  }

  /** A pipe railing standing on a wall from p to q (its posts at the spacing). */
  function railing(st: FenceStretch, p: Vector3, q: Vector3, base: number): void {
    const r = style.railing!, size = style.post.size;
    const len = new Vector2(p.x, p.y).distanceTo(new Vector2(q.x, q.y));
    const n = Math.max(1, Math.round(len / spec.spacing));
    const at = (j: number) => p.clone().lerp(q, j / n);
    for (let j = 0; j <= n; j++) post(st, at(j), size, base, base + r.height, style.post.material);
    for (const f of r.at) bar(st, p, q, -size / 2, size / 2, base + f * r.height - size / 2, base + f * r.height + size / 2, style.post.material, out.detail);
  }

  /** Model pieces along a stretch, and gate leaves (or gate posts) at its doorways. */
  function buildModels(st: FenceStretch): void {
    const m = modelStyle(spec.model);
    const yaw = modelYaw(m.axis, st.dir);
    for (const run of st.runs) {
      for (const { s, piece } of modelPieces(m, run)) {
        const mid = pointAlong(st, s, ground);
        const ends = [pointAlong(st, s - piece.step / 2, ground), pointAlong(st, s + piece.step / 2, ground)];
        const z = Math.min(mid.z, ...ends.map((e) => e.z));
        out.props.push({ classname: 'prop_static', origin: modelOrigin(piece, mid, z, yaw, m.sink), keys: { model: piece.model, angles: `0 ${yaw} 0`, solid: '6', skin: '0', disableshadows: '0' } });
        out.pieces++;
      }
    }
    for (const g of st.gaps) {
      if (!g.gate) continue;
      const gate = m.gate;
      if (!gate) {
        for (const s of [g.s0, g.s1]) post(st, pointAlong(st, s, ground), 10, -SINK, height + 16, m.postMaterial, false);
        continue;
      }
      // Leaves swung open to the left of the fence, hinged at the sides of the opening (two when it is wide).
      const left = leftOf(st.dir);
      const sides = g.s1 - g.s0 >= gate.step * 1.75 ? [g.s0, g.s1] : [g.s0];
      for (const s of sides) {
        const hinge = pointAlong(st, s, ground);
        const inward = s === g.s0 ? 1 : -1;
        const at = { x: hinge.x + left.x * (gate.step / 2) + st.dir.x * inward * 4, y: hinge.y + left.y * (gate.step / 2) + st.dir.y * inward * 4 };
        const leafYaw = modelYaw(m.axis, left);
        out.props.push({ classname: 'prop_static', origin: modelOrigin(gate, at, hinge.z, leafYaw, 0), keys: { model: gate.model, angles: `0 ${leafYaw} 0`, solid: '0', skin: '0' } });
      }
    }
  }
}

// --- Preview ---------------------------------------------------------------------------------------------------

/**
 * Lines for a planned fence (segments, flat x, y, z pairs): along the ground and the top of every run, an upright at
 * every post or model joint, tall uprights with a crossbar at each doorway, and for model fences a low cross over
 * each end left open (a stretch that isn't a whole number of pieces).
 */
export function fenceOutline(spec: FenceSpec, ground?: Ground): number[] {
  const out: number[] = [];
  const height = fenceHeight(spec);
  const seg = (a: Vector3, b: Vector3) => out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const up = (p: Vector3, h: number) => seg(p, new Vector3(p.x, p.y, p.z + h));
  const lift = (p: Vector3, h: number) => new Vector3(p.x, p.y, p.z + h);
  for (const st of fenceLayout(spec)) {
    for (const run of st.runs) {
      const stations = spec.mode === 'brush' ? postStations(run, spec.spacing)
        : [run.s0, ...modelPieces(modelStyle(spec.model), run).map((p) => p.s + p.piece.step / 2)];
      const pts = stations.map((s) => pointAlong(st, s, ground));
      if (pts.length < 2) continue;
      pts.forEach((p) => up(p, height));
      for (let j = 0; j + 1 < pts.length; j++) {
        seg(pts[j], pts[j + 1]);
        seg(lift(pts[j], height), lift(pts[j + 1], height));
      }
      if (run.filled !== undefined && run.s1 - run.filled > 1) {
        const a = pointAlong(st, run.filled, ground), b = pointAlong(st, run.s1, ground);
        seg(a, lift(b, 24));
        seg(lift(a, 24), b);
      }
    }
    for (const g of st.gaps) {
      const a = pointAlong(st, g.s0, ground), b = pointAlong(st, g.s1, ground);
      up(a, height + 24);
      up(b, height + 24);
      seg(lift(a, height + 24), lift(b, height + 24));
    }
  }
  return out;
}

/** "3 stretches · 1,024 units · 2 doorways". */
export function fenceSummary(b: Pick<FenceBuild, 'length' | 'doors'>, stretches: number): string {
  return `${stretches} stretch${stretches === 1 ? '' : 'es'} · ${Math.round(b.length)} units · ${b.doors} doorway${b.doors === 1 ? '' : 's'}`;
}
