import { Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { TexAxis, VmfDocument } from '../vmf/map.ts';
import { solidNode, type FaceSpec } from '../edit/brushes.ts';

/**
 * Fences: a line of points A, B, C… (a tree: a point can branch, see `edit/pathPoints.ts`) that the fence follows,
 * on the ground between the points the way powerlines do. Each stretch can have doorways: an opening at a distance
 * along it (from the stretch's first point) with its own width, optionally with a gate. Two ways to build it:
 *
 * - **model**: a row of prop_static fence models along each stretch, as many as fit (the longest that fits first,
 *   then shorter ones), spread evenly so their end posts meet. Every model below has a collision model, so with
 *   `solid 6` Recast reads them (`recast_mapmesh.cpp` GenerateStaticPropData).
 * - **brush**: posts at about the spacing with panels (an alpha-tested fence material) or rails between them, all
 *   func_detail, which vbsp merges into the world that Recast reads.
 *
 * Either way an NPC clip strip runs along the fence (not across the doorways) by default, so units can't slip through
 * gaps under rails or between models; the stairs keep their NPC clip as world brushes and so does this.
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

export interface FenceBrushStyle {
  label: string;
  /** Default height, post spacing and panel material. */
  height: number;
  spacing: number;
  post: { size: number; material: string };
  /** A panel between the posts (a fence material, fitted to its height), or none. */
  panel?: { thickness: number; lift: number };
  /** Rails between the posts: centre heights as fractions of the height, and their size across and up. */
  rails?: { at: number[]; width: number; depth: number; material: string };
  /** A rail along the top of the panels. */
  topRail?: { size: number; material: string };
  material: string;
}

/** Brush fences: posts with panels or rails, func_detail. Materials checked in the game's content (see FENCE_MATERIALS). */
export const FENCE_STYLES = {
  chainlink: {
    label: 'Chain-link on pipes', height: 112, spacing: 128, material: 'METAL/METALFENCE004A',
    post: { size: 4, material: 'METAL/METALPIPE001A' }, panel: { thickness: 2, lift: 2 }, topRail: { size: 3, material: 'METAL/METALPIPE001A' },
  },
  boards: {
    label: 'Wooden boards', height: 96, spacing: 128, material: 'WOOD/WOODFENCE001',
    post: { size: 6, material: 'WOOD/WOODBEAM001A' }, panel: { thickness: 2, lift: 0 },
  },
  rails: {
    label: 'Wooden rails', height: 64, spacing: 128, material: 'WOOD/WOODBEAM002A',
    post: { size: 8, material: 'WOOD/WOODBEAM001A' }, rails: { at: [0.35, 0.85], width: 4, depth: 8, material: 'WOOD/WOODBEAM002A' },
  },
  bars: {
    label: 'Metal bars', height: 96, spacing: 128, material: 'METAL/METALFENCE003A',
    post: { size: 6, material: 'METAL/METALPIPE001A' }, panel: { thickness: 2, lift: 0 }, topRail: { size: 4, material: 'METAL/METALPIPE001A' },
  },
} satisfies Record<string, FenceBrushStyle>;
export type FenceStyleId = keyof typeof FENCE_STYLES;

/**
 * Panel and rail materials for brush fences (all exist in the game: wood/woodfence001 and metal/metalfence003a,
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
];

/** An opening in a stretch: its middle `at` units along the stretch from its first point, `width` wide. */
export interface FenceDoor {
  at: number;
  width: number;
  /** Gate posts beside it, and a gate leaf swung open (model fences that have one). */
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
  /** Brush fences: height of the panels, distance between posts, and a panel material other than the style's. */
  height: number;
  spacing: number;
  material?: string;
  /** NPC clip along the fence (not the doorways). */
  clip: boolean;
}

export const DEFAULT_FENCE: Omit<FenceSpec, 'uid' | 'points' | 'links'> = {
  mode: 'model', model: 'chainlink', style: 'chainlink', height: FENCE_STYLES.chainlink.height, spacing: FENCE_STYLES.chainlink.spacing, clip: true,
};

/**
 * A settings change as it applies: a new brush style brings its own height, spacing and material (a material picked
 * for the old style is dropped).
 */
export function fencePatch(current: Pick<FenceSpec, 'style'>, patch: Partial<FenceSpec>): Partial<FenceSpec> {
  if (!patch.style || patch.style === current.style) return patch;
  const style = FENCE_STYLES[patch.style];
  return { height: style.height, spacing: style.spacing, material: undefined, ...patch };
}

export const newFenceUid = (): string => Math.random().toString(36).slice(2, 8);

/** A new doorway's width, and the narrowest and the shortest piece of fence kept beside one. */
export const DOOR_WIDTH = 96;
export const MIN_DOOR = 32;
const MIN_RUN = 8;
/** Points between the ends stand on the ground under them when it is within this of the straight line. */
const GROUND_REACH = 256;
/** How far posts and the clip reach into the ground. */
const SINK = 8;
const NPCCLIP = 'TOOLS/TOOLSNPCCLIP';
/** Width of the NPC clip strip (at least the fence's own thickness). */
const CLIP_WIDTH = 8;

// --- Spec ----------------------------------------------------------------------------------------------------

const num = (v: number) => String(Math.round(v * 100) / 100);

/**
 * `uid|mode|model|style|height|spacing|clip|material|points|links`: points `x,y,z;…`; links in order (link k ends
 * at point k + 1), each its parent point and its doors `@at,width[,g]`.
 */
export function encodeFence(s: FenceSpec): string {
  const points = s.points.map((p) => `${num(p.x)},${num(p.y)},${num(p.z)}`).join(';');
  const links = s.links.map((l) => `${l.from}${(l.doors ?? []).map((d) => `@${num(d.at)},${num(d.width)}${d.gate ? ',g' : ''}`).join('')}`).join(';');
  return [s.uid, s.mode, s.model, s.style, num(s.height), num(s.spacing), s.clip ? 1 : 0, s.material ?? '', points, links].join('|');
}

export function decodeFence(v: string): FenceSpec | null {
  const parts = v.split('|');
  if (parts.length < 10) return null;
  const [uid, mode, model, style, height, spacing, clip, material, pts, lnk] = parts;
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
  };
}

// --- Layout --------------------------------------------------------------------------------------------------

export type Ground = (x: number, y: number) => number | null;

/** A piece of a stretch without doorways: from `s0` to `s1` along it. */
export interface FenceRun { link: number; s0: number; s1: number }
/** A doorway as built: where its opening runs along the stretch (clamped to fit). */
export interface FenceGap { link: number; door: number; s0: number; s1: number; gate: boolean }

export interface FenceStretch {
  link: number;
  a: FencePoint;
  b: FencePoint;
  /** Plan length and direction. */
  length: number;
  dir: Vector2;
  runs: FenceRun[];
  gaps: FenceGap[];
}

/** The stretches of a fence, each cut into runs by its doorways (each opening clamped to fit, overlaps merged). */
export function fenceLayout(spec: Pick<FenceSpec, 'points' | 'links'>): FenceStretch[] {
  return spec.links.map((link, k) => {
    const a = spec.points[link.from], b = spec.points[link.to];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = length > 0 ? new Vector2((b.x - a.x) / length, (b.y - a.y) / length) : new Vector2(1, 0);
    const gaps = doorGaps(link.doors ?? [], length).map((g) => ({ ...g, link: k }));
    const runs: FenceRun[] = [];
    let s = 0;
    for (const g of gaps) {
      if (g.s0 - s >= MIN_RUN) runs.push({ link: k, s0: s, s1: g.s0 });
      s = g.s1;
    }
    if (length - s >= MIN_RUN) runs.push({ link: k, s0: s, s1: length });
    return { link: k, a, b, length, dir, runs, gaps };
  });
}

/** Where a stretch's doorways open: each clamped into the stretch, sorted, overlapping ones merged into the first. */
export function doorGaps(doors: FenceDoor[], length: number): Omit<FenceGap, 'link'>[] {
  const out: Omit<FenceGap, 'link'>[] = [];
  doors.map((d, door) => {
    const width = Math.min(Math.max(MIN_DOOR, d.width), length);
    const at = Math.min(Math.max(d.at, width / 2), length - width / 2);
    return { door, s0: at - width / 2, s1: at + width / 2, gate: !!d.gate };
  }).sort((p, q) => p.s0 - q.s0).forEach((g) => {
    const last = out[out.length - 1];
    if (last && g.s0 <= last.s1 + MIN_RUN) { last.s1 = Math.max(last.s1, g.s1); last.gate ||= g.gate; } else out.push({ ...g });
  });
  // A doorway that leaves a sliver of fence at an end takes it.
  for (const g of out) { if (g.s0 < MIN_RUN) g.s0 = 0; if (length - g.s1 < MIN_RUN) g.s1 = length; }
  return out;
}

/** The point `s` along a stretch, on the ground under it when that is near the straight line between its ends. */
export function pointAlong(st: FenceStretch, s: number, ground?: Ground): Vector3 {
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
export function postStations(run: FenceRun, spacing: number): number[] {
  const n = Math.max(1, Math.round((run.s1 - run.s0) / Math.max(16, spacing)));
  return Array.from({ length: n + 1 }, (_, j) => run.s0 + ((run.s1 - run.s0) * j) / n);
}

/** A model piece of a run: its middle along the stretch, and which piece. */
export interface PlacedPiece { s: number; piece: ModelPiece }

/**
 * Model pieces for a run: the longest that fits, then shorter ones, from end to end of the run with the leftover (a
 * little gap, or an overlap) shared between the joints. A run shorter than half the shortest piece gets none (the clip still closes it).
 */
export function modelPieces(style: FenceModelStyle, run: FenceRun): PlacedPiece[] {
  const len = run.s1 - run.s0;
  const pieces = [...style.pieces].sort((p, q) => q.step - p.step);
  const smallest = pieces[pieces.length - 1];
  const tol = smallest.step / 8;
  if (len < smallest.step / 2) return [];
  const chosen: ModelPiece[] = [];
  let left = len;
  while (left > tol) {
    const p = pieces.find((q) => q.step <= left + tol) ?? smallest;
    chosen.push(p);
    left -= p.step;
  }
  // The first and the last piece end at the run's ends (no piece reaches into a doorway or past a corner); the
  // leftover is shared between the joints. One piece stands in the middle.
  if (chosen.length === 1) return [{ s: (run.s0 + run.s1) / 2, piece: chosen[0] }];
  const gap = left / (chosen.length - 1);
  const out: PlacedPiece[] = [];
  let s = run.s0;
  for (const piece of chosen) {
    out.push({ s: s + piece.step / 2, piece });
    s += piece.step + gap;
  }
  return out;
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

/** How tall the fence stands. */
export function fenceHeight(spec: Pick<FenceSpec, 'mode' | 'model' | 'height'>): number {
  if (spec.mode === 'brush') return spec.height;
  const m = FENCE_MODELS[spec.model] as FenceModelStyle;
  return Math.max(...m.pieces.map((p) => p.max[2] - p.min[2])) - m.sink;
}

/** How thick the fence is across (for the clip). */
function fenceThickness(spec: Pick<FenceSpec, 'mode' | 'model' | 'style'>): number {
  if (spec.mode === 'brush') return FENCE_STYLES[spec.style].post.size;
  const m = FENCE_MODELS[spec.model] as FenceModelStyle;
  return Math.max(...m.pieces.map((p) => (m.axis === 'y' ? p.max[0] - p.min[0] : p.max[1] - p.min[1])));
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

/** Texture axes along a panel: u along the fence, v down; one texture height over `height` units, top at `top`. */
interface PanelTexture { dir: Vector2; origin: Vector2; height: number; top: number }

/**
 * A convex brush over a convex footprint between a bottom and a top height (linear in plan). Side faces along the
 * fence take `texture` (u along it, the material fitted to the panel's height); the rest are world aligned.
 */
function prism(doc: VmfDocument, foot: Vector2[], bottom: HeightAt, top: HeightAt, material: string, texture?: PanelTexture): KVNode | null {
  const pts = foot.map((p) => new Vector2(r3(p.x), r3(p.y)));
  const lo = pts.map((p) => new Vector3(p.x, p.y, r3(bottom(p)))), hi = pts.map((p) => new Vector3(p.x, p.y, r3(top(p))));
  if (hi.some((c, i) => c.z < lo[i].z + 0.5)) return null;
  const centre = new Vector3();
  for (const p of [...lo, ...hi]) centre.add(p);
  centre.divideScalar(lo.length * 2);
  const faces: FaceSpec[] = [];
  const scale = texture ? texture.height / 512 : 0;
  const face = (a: Vector3, b: Vector3, c: Vector3) => {
    let n = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(b, a));
    if (n.lengthSq() < 1e-6) return;
    if (n.dot(new Vector3().subVectors(a, centre)) < 0) { [b, c] = [c, b]; n = n.negate(); }
    n.normalize();
    const f: FaceSpec = { points: [a, b, c], material };
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

export interface FenceProp { classname: string; origin: Vector3; keys: Record<string, string> }

export interface FenceBuild {
  /** func_detail brushes: posts, panels, rails, gate posts. */
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
  const post = (st: FenceStretch, p: Vector3, size: number, top: number, material: string, count = true) => {
    const key = `${Math.round(p.x)},${Math.round(p.y)},${size}`;
    if (postsAt.has(key)) return;
    postsAt.add(key);
    const foot = strip(new Vector2(p.x, p.y), st.dir, -size / 2, size / 2, -size / 2, size / 2);
    add(out.detail, prism(doc, foot, () => p.z - SINK, () => p.z + top, material));
    if (count) out.posts++;
  };
  /** A bar along a stretch from ground point p to q, `t0..t1` across, from `b` to `t` over the ground. */
  const bar = (st: FenceStretch, p: Vector3, q: Vector3, t0: number, t1: number, b: number, t: number, material: string, list: KVNode[], texture?: PanelTexture) => {
    const a = new Vector2(p.x, p.y), len = a.distanceTo(new Vector2(q.x, q.y));
    if (len < 1) return;
    const line = slope(a, st.dir, len, p.z, q.z);
    add(list, prism(doc, strip(a, st.dir, 0, len, t0, t1), (x) => line(x) + b, (x) => line(x) + t, material, texture));
  };

  for (const st of stretches) {
    out.length += st.length;
    out.doors += st.gaps.length;
    if (spec.mode === 'brush') {
      const style = FENCE_STYLES[spec.style] as FenceBrushStyle;
      const material = spec.material ?? style.material;
      const half = style.post.size / 2;
      for (const run of st.runs) {
        const stations = postStations(run, spec.spacing).map((s) => pointAlong(st, s, ground));
        stations.forEach((p) => post(st, p, style.post.size, height + (style.topRail ? style.topRail.size / 2 : 4), style.post.material));
        for (let j = 0; j + 1 < stations.length; j++) {
          const p = stations[j], q = stations[j + 1];
          if (style.panel) {
            const th = style.panel.thickness / 2;
            const texture: PanelTexture = { dir: st.dir, origin: new Vector2(st.a.x, st.a.y), height: height - style.panel.lift, top: Math.max(p.z, q.z) + height };
            // From post edge to post edge, so panels never stand in the posts.
            const pIn = p.clone().addScaledVector(new Vector3(st.dir.x, st.dir.y, 0), half), qIn = q.clone().addScaledVector(new Vector3(st.dir.x, st.dir.y, 0), -half);
            pIn.z = p.z + ((q.z - p.z) * half) / Math.max(1, p.distanceTo(q));
            qIn.z = q.z - ((q.z - p.z) * half) / Math.max(1, p.distanceTo(q));
            bar(st, pIn, qIn, -th, th, style.panel.lift, height, material, out.detail, texture);
          }
          if (style.topRail) {
            const r = style.topRail.size / 2;
            bar(st, p, q, -r, r, height - r, height + r, style.topRail.material, out.detail);
          }
          if (style.rails) {
            const rails = style.rails;
            for (const at of rails.at) bar(st, p, q, -rails.width / 2, rails.width / 2, at * height - rails.depth / 2, at * height + rails.depth / 2, spec.material ?? rails.material, out.detail);
          }
        }
      }
      for (const g of st.gaps) {
        if (!g.gate) continue;
        for (const s of [g.s0, g.s1]) post(st, pointAlong(st, s, ground), style.post.size + 4, height + 24, style.post.material, false);
      }
    } else {
      const style = FENCE_MODELS[spec.model] as FenceModelStyle;
      const yaw = modelYaw(style.axis, st.dir);
      for (const run of st.runs) {
        for (const { s, piece } of modelPieces(style, run)) {
          const mid = pointAlong(st, s, ground);
          const ends = [pointAlong(st, Math.max(0, s - piece.step / 2), ground), pointAlong(st, Math.min(st.length, s + piece.step / 2), ground)];
          const z = Math.min(mid.z, ...ends.map((e) => e.z));
          out.props.push({ classname: 'prop_static', origin: modelOrigin(piece, mid, z, yaw, style.sink), keys: { model: piece.model, angles: `0 ${yaw} 0`, solid: '6', skin: '0', disableshadows: '0' } });
          out.pieces++;
        }
      }
      for (const g of st.gaps) {
        if (!g.gate) continue;
        const gate = style.gate;
        if (!gate) {
          for (const s of [g.s0, g.s1]) post(st, pointAlong(st, s, ground), 10, height + 16, style.postMaterial, false);
          continue;
        }
        // Leaves swung open to the left of the fence, hinged at the sides of the opening (two when it is wide).
        const left = new Vector2(-st.dir.y, st.dir.x);
        const sides = g.s1 - g.s0 >= gate.step * 1.75 ? [g.s0, g.s1] : [g.s0];
        for (const s of sides) {
          const hinge = pointAlong(st, s, ground);
          const inward = s === g.s0 ? 1 : -1;
          const at = { x: hinge.x + left.x * (gate.step / 2) + st.dir.x * inward * 4, y: hinge.y + left.y * (gate.step / 2) + st.dir.y * inward * 4 };
          const leafYaw = modelYaw(style.axis, left);
          out.props.push({ classname: 'prop_static', origin: modelOrigin(gate, at, hinge.z, leafYaw, 0), keys: { model: gate.model, angles: `0 ${leafYaw} 0`, solid: '0', skin: '0' } });
        }
      }
    }
    if (spec.clip) {
      const w = Math.max(CLIP_WIDTH, fenceThickness(spec)) / 2;
      for (const run of st.runs) {
        const stations = postStations(run, 128).map((s) => pointAlong(st, s, ground));
        for (let j = 0; j + 1 < stations.length; j++) bar(st, stations[j], stations[j + 1], -w, w, -SINK, Math.max(64, height + 8), NPCCLIP, out.clip);
      }
    }
  }
  return out;
}

// --- Preview ---------------------------------------------------------------------------------------------------

/**
 * Lines for a planned fence (segments, flat x, y, z pairs): along the ground and the top of every run, an upright at
 * every post or model joint, and tall uprights with a crossbar at each doorway.
 */
export function fenceOutline(spec: FenceSpec, ground?: Ground): number[] {
  const out: number[] = [];
  const height = fenceHeight(spec);
  const seg = (a: Vector3, b: Vector3) => out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const up = (p: Vector3, h: number) => seg(p, new Vector3(p.x, p.y, p.z + h));
  for (const st of fenceLayout(spec)) {
    for (const run of st.runs) {
      const stations = spec.mode === 'brush' ? postStations(run, spec.spacing)
        : [run.s0, ...modelPieces(FENCE_MODELS[spec.model] as FenceModelStyle, run).map((p) => p.s + p.piece.step / 2).slice(0, -1), run.s1];
      const pts = stations.map((s) => pointAlong(st, s, ground));
      pts.forEach((p) => up(p, height));
      for (let j = 0; j + 1 < pts.length; j++) {
        seg(pts[j], pts[j + 1]);
        seg(new Vector3(pts[j].x, pts[j].y, pts[j].z + height), new Vector3(pts[j + 1].x, pts[j + 1].y, pts[j + 1].z + height));
      }
    }
    for (const g of st.gaps) {
      const a = pointAlong(st, g.s0, ground), b = pointAlong(st, g.s1, ground);
      up(a, height + 24);
      up(b, height + 24);
      seg(new Vector3(a.x, a.y, a.z + height + 24), new Vector3(b.x, b.y, b.z + height + 24));
    }
  }
  return out;
}

/** "3 stretches · 1,024 units · 2 doorways". */
export function fenceSummary(b: Pick<FenceBuild, 'length' | 'doors'>, stretches: number): string {
  return `${stretches} stretch${stretches === 1 ? '' : 'es'} · ${Math.round(b.length)} units · ${b.doors} doorway${b.doors === 1 ? '' : 's'}`;
}
