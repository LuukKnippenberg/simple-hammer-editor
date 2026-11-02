import { Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { solidNode, type FaceSpec } from '../edit/brushes.ts';
import { hideCoveredFaces, NODRAW } from '../geom/hidden.ts';

/**
 * Generated stairs: points A, B, C… each with its own height, joined by flights. Every point after A that another
 * flight leaves from is a landing, so a chain turns there and a point with three flights is a T junction (a fourth
 * makes a cross). Pure geometry: `buildStairs` turns a spec into func_detail brushes (steps, landings, beams, posts,
 * hand rails) and world brushes (an NPC clip ramp on each flight's nosings, which the navmesh sees as one slope).
 *
 * Walkable for every unit hull: Lambda Wars' Recast meshes climb 18 units and walk slopes under 45°
 * (`recast_mesh.cpp`), so no rise is over 16 and a flight shorter than its height is flagged as too steep.
 */

/** The highest step a flight gets (Recast's walkable climb is 18 for every hull). */
export const MAX_RISE = 16;
/** Recast's `recast_maxslope`: steeper slopes (the clip ramp, a ramp profile) are not walkable. */
export const MAX_SLOPE = 45;
/** Width a large unit (Recast radius 58, an antlion guard) needs to get up a flight between rails. */
export const LARGE_WIDTH = 192;
const NPCCLIP = 'TOOLS/TOOLSNPCCLIP';
const COMBINE_PANEL = 'METAL/METALCOMBINE001';
/** Thickness of open treads, of floating treads and landing slabs, and of the slab under sloped steps. */
const TREAD = 6, SLAB = 8, UNDER = 16;
/** How far the clip ramp reaches in front of a flight. */
const CLIP_LEAD = 24;
/** Square posts (under every other step on posts): their size, and how far in from the flight's sides. */
const POST = 8, POST_INSET = 12;
/** Side stringers: thickness, and how far they reach below and above the nosings. */
const STRINGER = 6, STRINGER_DROP = 24, STRINGER_LIP = 4;
/** The beam down the middle underneath: half its width, and its depth under the treads. */
const SPINE_HALF = 8, SPINE_DEPTH = 14;
/** A flight comes in through a landing's edge when it leaves within about 50° (cos 0.64) of the edge's outward normal. */
const THROUGH_EDGE = 0.64;

export type StairsPlan = 'blocky' | 'angle';
export type StairsProfile = 'steps' | 'ramp';
export type StairsStructure = 'solid' | 'sloped' | 'open' | 'floating' | 'posts';
export type SideBeams = 'none' | 'both' | 'under';
export type RailSides = 'none' | 'left' | 'right' | 'both';
export type RailStyle = 'pipe' | 'balusters' | 'parapet' | 'combine';

export interface StairsOptions {
  /** Blocky: every flight square to the grid; any angle: flights follow the points exactly. */
  plan: StairsPlan;
  profile: StairsProfile;
  structure: StairsStructure;
  beams: SideBeams;
  /** An NPC clip ramp on the nosings (steps only). */
  clip: boolean;
  width: number;
  /** Flat run at the top and the foot of a flight that ends at a point without a landing. */
  landingTop: number;
  landingBottom: number;
  rails: RailSides;
  railStyle: RailStyle;
  railHeight: number;
  postSpacing: number;
  stepMaterial: string;
  sideMaterial: string;
  railMaterial: string;
}

export const DEFAULT_STAIRS: StairsOptions = {
  plan: 'blocky', profile: 'steps', structure: 'solid', beams: 'none', clip: true, width: 128, landingTop: 0, landingBottom: 0,
  rails: 'both', railStyle: 'pipe', railHeight: 40, postSpacing: 64,
  stepMaterial: 'CONCRETE/CONCRETEFLOOR028C', sideMaterial: 'CONCRETE/CONCRETEWALL001A', railMaterial: 'METAL/METALPIPE001A',
};

export const STRUCTURES: [StairsStructure, string, string][] = [
  ['solid', 'Solid', 'One massive block down to the ground'],
  ['sloped', 'Sloped under', 'Solid steps on a slab; the underside follows the slope'],
  ['open', 'Open', 'Thin treads with gaps, carried by side beams'],
  ['floating', 'Floating', 'Separate slabs, nothing below'],
  ['posts', 'On posts', 'Slabs on posts to the ground, every other step'],
];
export const RAIL_STYLES: [RailStyle, string][] = [['pipe', 'Metal pipe'], ['balusters', 'Wooden balusters'], ['parapet', 'Concrete parapet'], ['combine', 'Combine panel']];
export const STEP_MATERIALS = ['CONCRETE/CONCRETEFLOOR028C', 'CONCRETE/CONCRETEFLOOR027A', 'CONCRETE/CONCRETEFLOOR033A', 'WOOD/WOODSTAIR002A', 'WOOD/WOODFLOOR005A', 'METAL/METALFLOOR001A'];
export const SIDE_MATERIALS = ['CONCRETE/CONCRETEWALL001A', 'CONCRETE/CONCRETEWALL019A', 'CONCRETE/CONCRETEFLOOR028A', 'WOOD/WOODWALL009A', 'WOOD/WOODBEAM001A', 'METAL/METALWALL003A'];
export const RAIL_MATERIALS = ['METAL/METALPIPE001A', 'METAL/METALRAIL001A', 'METAL/METALBAR001C_WHITE', 'WOOD/WOODBEAM001A', 'METAL/METALCOMBINE001'];

export interface StairsNode { x: number; y: number; z: number }
/** A flight between two points; `steps` and `width` override the automatic count and the stairs' width. */
export interface StairsFlight { from: number; to: number; steps?: number; width?: number }

export interface StairsSpec {
  uid: string;
  /** A first, then one point per flight (each flight's `to` is a new point). */
  nodes: StairsNode[];
  flights: StairsFlight[];
  options: StairsOptions;
}

export interface FlightInfo {
  from: number;
  to: number;
  steps: number;
  rise: number;
  tread: number;
  /** Climb from `from` to `to` (negative goes down). */
  height: number;
  /** Plan length between the points. */
  length: number;
  width: number;
  /** Steeper than units can walk (the clip ramp or the ramp over 45°), or no room for the steps at all. */
  steep: boolean;
}

export interface StairsResult {
  /** Steps, landings, beams, posts and rails: one func_detail. */
  detail: KVNode[];
  /** NPC clip ramps (world brushes). */
  clip: KVNode[];
  flights: FlightInfo[];
  /** Points that are landings, with their size. */
  landings: { node: number; size: [number, number]; joins: number }[];
  /** Plan rectangle round everything, and the lowest point (the handle sits there). */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  base: number;
}

// --- Spec helpers ------------------------------------------------------------------------------------------

/** Steps a climb needs so no rise is over `MAX_RISE`. */
export const autoSteps = (height: number): number => Math.max(1, Math.ceil(Math.abs(height) / MAX_RISE - 1e-9));

/** Flights touching each point. */
function joins(spec: StairsSpec): number[][] {
  const out = spec.nodes.map(() => [] as number[]);
  spec.flights.forEach((f, i) => { out[f.from]?.push(i); out[f.to]?.push(i); });
  return out;
}

/**
 * The points as they are built: with the blocky plan each flight is squared to the nearest axis from the point it
 * leaves (in flight order, so a whole chain stays square).
 */
export function plannedNodes(spec: StairsSpec): StairsNode[] {
  const nodes = spec.nodes.map((n) => ({ ...n }));
  if (spec.options.plan !== 'blocky') return nodes;
  for (const f of spec.flights) {
    const a = nodes[f.from], b = nodes[f.to];
    if (!a || !b) continue;
    const dx = spec.nodes[f.to].x - spec.nodes[f.from].x, dy = spec.nodes[f.to].y - spec.nodes[f.from].y;
    if (Math.abs(dx) >= Math.abs(dy)) { b.x = a.x + dx; b.y = a.y; } else { b.x = a.x; b.y = a.y + dy; }
  }
  return nodes;
}

/** Squares a point to the nearest axis from another (the blocky plan, while placing). */
export function squareTo(from: { x: number; y: number }, p: { x: number; y: number }): { x: number; y: number } {
  return Math.abs(p.x - from.x) >= Math.abs(p.y - from.y) ? { x: p.x, y: from.y } : { x: from.x, y: p.y };
}

const flightWidth = (spec: StairsSpec, f: StairsFlight) => Math.max(32, f.width ?? spec.options.width);

// --- Brushes -------------------------------------------------------------------------------------------------

/** A height over the plan, linear in x and y. */
type Lin = (p: Vector2) => number;
const flat = (z: number): Lin => () => z;
/** A height that rises linearly along `dir` from `z0` at `origin`. */
const along = (origin: Vector2, dir: Vector2, z0: number, slope: number): Lin => (p) => z0 + (p.x - origin.x) * dir.x * slope + (p.y - origin.y) * dir.y * slope;

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * A convex brush over a convex footprint between a bottom and a top plane. Sides
 * with no height at either end are left out (a wedge's thin edge), so wedges and ramps stay valid solids.
 * `mat` picks a material from the face's outward normal.
 */
export function prismBrush(doc: VmfDocument, foot: Vector2[], bottom: Lin, top: Lin, mat: (n: Vector3) => string): KVNode | null {
  const pts = foot.map((p) => new Vector2(round(p.x), round(p.y)));
  const lo = pts.map((p) => new Vector3(p.x, p.y, round(bottom(p)))), hi = pts.map((p) => new Vector3(p.x, p.y, round(top(p))));
  if (hi.some((h, i) => h.z < lo[i].z - 0.01) || !hi.some((h, i) => h.z - lo[i].z > 0.5)) return null;
  const centre = new Vector3();
  for (const p of [...lo, ...hi]) centre.add(p);
  centre.divideScalar(lo.length * 2);
  const faces: FaceSpec[] = [];
  const face = (a: Vector3, b: Vector3, c: Vector3) => {
    // solidNode's normal is (c - a) × (b - a); it has to point away from the brush.
    let n = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(b, a));
    if (n.lengthSq() < 1e-6) return;
    if (n.dot(new Vector3().subVectors(a, centre)) < 0) { [b, c] = [c, b]; n = n.negate(); }
    faces.push({ points: [a, b, c], material: mat(n.normalize()) });
  };
  face(hi[0], hi[1], hi[2]);
  face(lo[0], lo[1], lo[2]);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const hj = hi[j].z - lo[j].z > 0.01, hiI = hi[i].z - lo[i].z > 0.01;
    if (!hj && !hiI) continue;
    face(lo[i], lo[j], hj ? hi[j] : hi[i]);
  }
  return solidNode(doc, faces);
}

/** A strip along a direction: the footprint s0..s1 along `u`, t0..t1 across (`n` is `u` turned left). */
function strip(o: Vector2, u: Vector2, s0: number, s1: number, t0: number, t1: number): Vector2[] {
  const n = new Vector2(-u.y, u.x);
  const P = (s: number, t: number) => o.clone().addScaledVector(u, s).addScaledVector(n, t);
  return [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)];
}

/** Convex hull of points in the plan, counter-clockwise (monotone chain). */
function hull2(points: Vector2[]): Vector2[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vector2, a: Vector2, b: Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vector2[] = [], upper: Vector2[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-6) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-6) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

interface Ctx {
  doc: VmfDocument;
  o: StairsOptions;
  base: number;
  detail: KVNode[];
  clip: KVNode[];
}

const add = (list: KVNode[], n: KVNode | null) => { if (n) list.push(n); };
/** Tops get the step material, everything else the side material. */
const stepMat = (o: StairsOptions) => (n: Vector3) => (n.z > 0.5 ? o.stepMaterial : o.sideMaterial);

/**
 * One rail along a run from `p0` to `p1` (its outer edge), the walking surface under it rising linearly from `z0`
 * to `z1`; `inward` points onto the walkway. `surface` is the height under a point along the run (steps), for the
 * feet of posts and spindles.
 */
function rail(c: Ctx, p0: Vector2, p1: Vector2, z0: number, z1: number, inward: Vector2, surface: (f: number) => number, low: Lin | null): void {
  const { o, doc } = c;
  const len = p0.distanceTo(p1);
  if (len < 4) return;
  const u = p1.clone().sub(p0).divideScalar(len);
  const left = new Vector2(-u.y, u.x).dot(inward) > 0 ? 1 : -1;
  const slope = (z1 - z0) / len;
  const H = Math.max(16, o.railHeight);
  const line = (dz: number): Lin => along(p0, u, z0 + dz, slope);
  const band = (t0: number, t1: number) => strip(p0, u, 0, len, left * t0, left * t1);
  const railMat = () => o.railMaterial;
  const bar = (t0: number, t1: number, zLo: number, zHi: number, m = railMat) => add(c.detail, prismBrush(doc, band(t0, t1), line(zLo), line(zHi), m));
  const posts = (every: number, size: number, topAt: number, from = 0) => {
    const n = Math.max(1, Math.round(len / every));
    for (let k = from; k <= n; k++) {
      const f = k / n;
      const s = Math.min(len - size / 2, Math.max(size / 2, f * len));
      const centre = p0.clone().addScaledVector(u, s);
      const zb = surface(s / len), zt = z0 + slope * s + topAt;
      add(c.detail, prismBrush(doc, strip(centre, u, -size / 2, size / 2, left * 0.5, left * (0.5 + size)), flat(zb), flat(zt), railMat));
    }
  };
  if (o.railStyle === 'pipe') {
    bar(0.5, 3.5, H - 3, H);
    bar(0.5, 3.5, H - 19, H - 16);
    posts(Math.max(32, o.postSpacing), 3, H - 1.5);
  } else if (o.railStyle === 'balusters') {
    bar(0, 4, H - 4, H);
    posts(14, 2, H - 2);
  } else if (o.railStyle === 'parapet') {
    const sideMat = () => o.sideMaterial;
    add(c.detail, prismBrush(doc, band(0, 8), low ?? line(-24), line(H), sideMat));
  } else {
    bar(0, 4, H - 4, H);
    bar(1, 3, 4, H - 4, () => COMBINE_PANEL);
    posts(Math.max(32, o.postSpacing), 3, H - 2);
  }
}

/** A landing: the plan polygon at height z, by structure (solid to the ground, else a slab, on posts with `posts`). */
function landingBrushes(c: Ctx, poly: Vector2[], z: number): void {
  const { o, doc } = c;
  const solid = o.structure === 'solid' || o.structure === 'sloped';
  add(c.detail, prismBrush(doc, poly, flat(solid ? Math.min(c.base, z - SLAB) : z - SLAB), flat(z), stepMat(o)));
  if (o.structure === 'posts' && z - SLAB > c.base + 1) {
    const centre = poly.reduce((s, p) => s.add(p), new Vector2()).divideScalar(poly.length);
    for (const p of poly) {
      const q = p.clone().lerp(centre, 12 / Math.max(24, p.distanceTo(centre)));
      add(c.detail, prismBrush(doc, strip(q, new Vector2(1, 0), -4, 4, -4, 4), flat(c.base), flat(z - SLAB), () => o.sideMaterial));
    }
  }
}

/** The points as built, and which flights and points they make up. */
interface StairsLayout {
  spec: StairsSpec;
  nodes: StairsNode[];
  /** Flights touching each point. */
  touch: number[][];
  /** Flights between two points that are apart in the plan. */
  valid: StairsFlight[];
}

const xy = (layout: StairsLayout, i: number) => new Vector2(layout.nodes[i].x, layout.nodes[i].y);
/** The valid flights touching a point. */
const flightsAt = (layout: StairsLayout, i: number) => layout.touch[i].map((k) => layout.spec.flights[k]).filter((f) => layout.valid.includes(f));
/** A point where two or more flights meet. */
const isLanding = (layout: StairsLayout, i: number) => flightsAt(layout, i).length >= 2;

/** Builds stairs from a spec. Brushes are numbered in `doc` (not added to it). */
export function buildStairs(doc: VmfDocument, spec: StairsSpec): StairsResult {
  const o = { ...DEFAULT_STAIRS, ...spec.options };
  const nodes = plannedNodes({ ...spec, options: o });
  const base = Math.min(...nodes.map((n) => n.z));
  const c: Ctx = { doc, o, base, detail: [], clip: [] };
  const layout: StairsLayout = { spec, nodes, touch: joins(spec), valid: [] };
  layout.valid = spec.flights.filter((f) => nodes[f.from] && nodes[f.to] && xy(layout, f.from).distanceTo(xy(layout, f.to)) >= 1);

  const landings = planLandings(layout, o);
  const landingHalf = new Map(landings.map((l) => [l.node, l.half]));
  const flights = spec.flights.map((f) => buildFlight(c, layout, landingHalf, f));
  for (const l of landings) buildLanding(c, layout, l);

  // Faces against each other and the bottoms on the ground are never seen.
  hideCoveredFaces(c.detail, { groundAt: () => base });
  return { detail: c.detail, clip: c.clip, flights, landings: landings.map(landingInfo), bounds: stairsBounds(spec, nodes, o), base };
}

/** A landing's plan polygon, half its size (where the flights stop), and how many flights it joins. */
interface LandingPlan { node: number; poly: Vector2[]; half: number; joins: number }

/** Landings: one stair width square at a turn (round each flight's own square when they come in at angles). */
function planLandings(layout: StairsLayout, o: StairsOptions): LandingPlan[] {
  const out: LandingPlan[] = [];
  layout.nodes.forEach((_, i) => {
    if (!isLanding(layout, i)) return;
    const fl = flightsAt(layout, i);
    const w = Math.max(...fl.map((f) => flightWidth(layout.spec, f)));
    const p = xy(layout, i);
    const squares = o.plan === 'blocky' ? [new Vector2(1, 0)] : fl.map((f) => xy(layout, f.from === i ? f.to : f.from).sub(p).normalize());
    const poly = hull2(squares.flatMap((u) => strip(p, u, -w / 2, w / 2, -w / 2, w / 2)));
    out.push({ node: i, poly, half: w / 2, joins: fl.length });
  });
  return out;
}

function landingInfo(l: LandingPlan): StairsResult['landings'][number] {
  const xs = l.poly.map((q) => q.x), ys = l.poly.map((q) => q.y);
  return { node: l.node, size: [Math.round(Math.max(...xs) - Math.min(...xs)), Math.round(Math.max(...ys) - Math.min(...ys))], joins: l.joins };
}

/** A buildable flight, laid out from its low end up: s runs along it from the low point `O`, t across it (left positive). */
interface FlightRun {
  /** The low point, the way up the flight, and its left. */
  O: Vector2;
  u: Vector2;
  n: Vector2;
  width: number;
  /** Plan length between the points. */
  length: number;
  /** Heights of the low and the high end, and the climb between them. */
  zl: number;
  zh: number;
  H: number;
  /** Where the walkway starts and ends along s, its length, and the flat run past a top with no landing. */
  sa: number;
  sb: number;
  run: number;
  topRun: number;
  /** No climb: a flat walkway. */
  level: boolean;
  steps: number;
  tread: number;
  rise: number;
  /** The low end is the flight's `from` point. */
  lowIsFrom: boolean;
}

function flightRun(layout: StairsLayout, o: StairsOptions, landingHalf: Map<number, number>, f: StairsFlight, width: number, height: number): FlightRun {
  const up = height >= 0;
  const lowI = up ? f.from : f.to, highI = up ? f.to : f.from;
  const O = xy(layout, lowI), length = O.distanceTo(xy(layout, highI));
  const u = xy(layout, highI).sub(O).divideScalar(length), n = new Vector2(-u.y, u.x);
  const zl = layout.nodes[lowI].z, zh = layout.nodes[highI].z, H = zh - zl;
  const leafLow = !isLanding(layout, lowI), leafHigh = !isLanding(layout, highI);
  const sa = (landingHalf.get(lowI) ?? 0) + (leafLow ? Math.max(0, o.landingBottom) : 0);
  const topRun = leafHigh ? Math.max(0, o.landingTop) : 0;
  const sb = length - (landingHalf.get(highI) ?? 0) - topRun;
  const run = sb - sa;
  const level = H < 0.5;
  const steps = level ? 0 : Math.max(autoSteps(H), Math.round(f.steps ?? 0));
  const tread = steps ? run / steps : run, rise = steps ? H / steps : 0;
  return { O, u, n, width, length, zl, zh, H, sa, sb, run, topRun, level, steps, tread, rise, lowIsFrom: lowI === f.from };
}

/** The footprint between s0 and s1 along a flight, t0..t1 across it (its full width by default). */
const footprint = (fr: FlightRun, s0: number, s1: number, t0 = -fr.width / 2, t1 = fr.width / 2) => strip(fr.O, fr.u, s0, s1, t0, t1);
/** The point at s along a flight's centre line. */
const atS = (fr: FlightRun, s: number) => fr.O.clone().addScaledVector(fr.u, s);

/** One flight: its walkway, a flat run past a top with no landing, and its hand rails. */
function buildFlight(c: Ctx, layout: StairsLayout, landingHalf: Map<number, number>, f: StairsFlight): FlightInfo {
  const { nodes } = layout;
  const width = flightWidth(layout.spec, f);
  const height = nodes[f.to] && nodes[f.from] ? nodes[f.to].z - nodes[f.from].z : 0;
  if (!layout.valid.includes(f)) return { from: f.from, to: f.to, steps: 0, rise: 0, tread: 0, height, length: 0, width, steep: true };
  const fr = flightRun(layout, c.o, landingHalf, f, width, height);
  const { steps, rise, tread, length, run, level } = fr;
  const steep = run <= 1 || (!level && Math.atan2(fr.H, run) * 180 / Math.PI >= MAX_SLOPE - 0.01);
  if (run > 1) {
    walkway(c, fr);
    if (fr.topRun > 0) landingBrushes(c, footprint(fr, fr.sb, fr.sb + fr.topRun), fr.zh);
    if (c.o.rails !== 'none' && !level) flightRails(c, fr);
  }
  return { from: f.from, to: f.to, steps, rise, tread, height, length, width, steep };
}

/** The walkway: flat, a ramp, or steps (with their beams and the NPC clip ramp). */
function walkway(c: Ctx, fr: FlightRun): void {
  const { o, doc, base } = c;
  if (fr.level) {
    landingBrushes(c, footprint(fr, fr.sa, fr.sb), fr.zl);
  } else if (o.profile === 'ramp') {
    const topLin = along(atS(fr, fr.sa), fr.u, fr.zl, fr.H / fr.run);
    const bottom = o.structure === 'solid' ? flat(Math.min(base, fr.zl - SLAB)) : (p: Vector2) => topLin(p) - SLAB;
    add(c.detail, prismBrush(doc, footprint(fr, fr.sa, fr.sb), bottom, topLin, stepMat(o)));
  } else {
    stepBrushes(c, fr);
    beamBrushes(c, fr);
    if (o.clip) clipRamp(c, fr);
  }
}

/** The steps, by structure; with `posts`, a pair of posts under every other step. */
function stepBrushes(c: Ctx, fr: FlightRun): void {
  const { o, doc, base } = c;
  const { sa, zl, steps, tread, rise, width: w } = fr;
  const mat = stepMat(o);
  const backLine = along(atS(fr, sa), fr.u, zl, rise / tread);
  for (let k = 0; k < steps; k++) {
    const s0 = sa + k * tread, s1 = s0 + tread, top = zl + (k + 1) * rise;
    const foot = footprint(fr, s0, s1);
    if (o.structure === 'solid') add(c.detail, prismBrush(doc, foot, flat(base), flat(top), mat));
    else if (o.structure === 'sloped') add(c.detail, prismBrush(doc, foot, (p) => backLine(p) - UNDER, flat(top), mat));
    else add(c.detail, prismBrush(doc, foot, flat(top - (o.structure === 'open' ? TREAD : SLAB)), flat(top), mat));
    if (o.structure === 'posts' && k % 2 === 0 && top - SLAB > base + 1) {
      const mid = (s0 + s1) / 2;
      for (const t of [-w / 2 + POST_INSET, w / 2 - POST_INSET]) {
        add(c.detail, prismBrush(doc, footprint(fr, mid - POST / 2, mid + POST / 2, t - POST / 2, t + POST / 2), flat(base), flat(top - SLAB), () => o.sideMaterial));
      }
    }
  }
}

/** Beams: stringers beside the treads (open treads always have them), or one down the middle underneath. */
function beamBrushes(c: Ctx, fr: FlightRun): void {
  const { o, doc } = c;
  const { sa, sb, zl, rise, tread, width: w } = fr;
  const beams = o.structure === 'open' && o.beams === 'none' ? 'both' : o.beams;
  if (beams === 'none' || o.structure === 'solid') return;
  const sideMat = () => o.sideMaterial;
  if (beams === 'both') {
    const nose = along(atS(fr, sa), fr.u, zl + rise, rise / tread);
    for (const [t0, t1] of [[w / 2 - STRINGER, w / 2], [-w / 2, -w / 2 + STRINGER]]) {
      add(c.detail, prismBrush(doc, footprint(fr, sa, sb, t0, t1), (p) => nose(p) - STRINGER_DROP, (p) => nose(p) + STRINGER_LIP, sideMat));
    }
  } else {
    const backLine = along(atS(fr, sa), fr.u, zl, rise / tread);
    add(c.detail, prismBrush(doc, footprint(fr, sa, sb, -SPINE_HALF, SPINE_HALF), (p) => backLine(p) - TREAD - SPINE_DEPTH, (p) => backLine(p) - TREAD, sideMat));
  }
}

/**
 * The NPC clip ramp touches every step's front edge up to the top at the last step, so the navmesh sees one
 * smooth slope whatever the structure. It meets the floor one tread before the flight, or starts with a
 * small lip (under a step's rise) so long treads don't tilt the landing in front.
 */
function clipRamp(c: Ctx, fr: FlightRun): void {
  const { sa, sb, zl, tread, rise } = fr;
  const lead = Math.min(tread, CLIP_LEAD);
  add(c.clip, prismBrush(c.doc, footprint(fr, sa - lead, sb - tread), flat(zl), along(atS(fr, sa - tread), fr.u, zl, rise / tread), () => NPCCLIP));
}

/** Hand rails along the flight's sides (and along its top run), stopping where it joins a landing. */
function flightRails(c: Ctx, fr: FlightRun): void {
  const { o, base } = c;
  const { u, n, sa, sb, run, zl, zh, H, steps, tread, rise, topRun, width: w } = fr;
  const solid = o.structure === 'solid';
  const sides = o.rails === 'both' ? [1, -1] : [(o.rails === 'left') === fr.lowIsFrom ? 1 : -1];
  const surface = (s: number) => (o.profile === 'ramp' ? zl + H * Math.max(0, Math.min(1, (s - sa) / run)) : zl + Math.min(steps, Math.floor((s - sa) / tread) + 1) * rise);
  for (const side of sides) {
    const p0 = atS(fr, sa).addScaledVector(n, side * w / 2);
    const p1 = atS(fr, sb).addScaledVector(n, side * w / 2);
    const inward = n.clone().multiplyScalar(-side);
    const z0 = o.profile === 'ramp' ? zl : zl + rise;
    const low = solid ? flat(base) : o.profile === 'ramp' ? along(p0, u, zl - SLAB, H / run) : along(p0, u, zl - UNDER, rise / tread);
    rail(c, p0, p1, z0, zh, inward, (frac) => surface(sa + frac * run), low);
    if (topRun > 0) {
      const q1 = p1.clone().addScaledVector(u, topRun);
      rail(c, p1, q1, zh, zh, inward, () => zh, solid ? flat(base) : flat(zh - SLAB));
    }
  }
}

/** A landing, with rails round every edge no flight comes in through. */
function buildLanding(c: Ctx, layout: StairsLayout, l: LandingPlan): void {
  const { o, base } = c;
  const z = layout.nodes[l.node].z;
  landingBrushes(c, l.poly, z);
  if (o.rails === 'none') return;
  const p = xy(layout, l.node);
  const outs = flightsAt(layout, l.node).map((f) => xy(layout, f.from === l.node ? f.to : f.from).sub(p).normalize());
  const solid = o.structure === 'solid' || o.structure === 'sloped';
  for (let k = 0; k < l.poly.length; k++) {
    const a = l.poly[k], b = l.poly[(k + 1) % l.poly.length];
    const e = b.clone().sub(a).normalize();
    const out = new Vector2(e.y, -e.x);
    if (outs.some((d) => d.dot(out) > THROUGH_EDGE)) continue;
    rail(c, a, b, z, z, out.clone().negate(), () => z, solid ? flat(Math.min(base, z - SLAB)) : flat(z - SLAB));
  }
}

/** Plan rectangle round the points, padded by half the widest flight. */
function stairsBounds(spec: StairsSpec, nodes: StairsNode[], o: StairsOptions): StairsResult['bounds'] {
  const pad = Math.max(...spec.flights.map((f) => flightWidth(spec, f)), o.width) / 2;
  const xs = nodes.map((q) => q.x), ys = nodes.map((q) => q.y);
  return { x0: Math.round(Math.min(...xs) - pad), y0: Math.round(Math.min(...ys) - pad), x1: Math.round(Math.max(...xs) + pad), y1: Math.round(Math.max(...ys) + pad) };
}

/** The Tune step's summary: one flight in full, a chain as its flights and landings. */
export function stairsSummary(r: StairsResult): string {
  const f = r.flights.filter((x) => x.length > 0);
  if (!f.length) return 'No flights yet';
  const warn = f.some((x) => x.steep) ? ' · too steep for units: make it longer' : '';
  if (f.length === 1) {
    const x = f[0];
    if (!x.steps) return `Flat walkway · ${Math.round(x.length)} × ${x.width}${warn}`;
    return `${x.steps} steps · rise ${fmt1(x.rise)} · tread ${fmt1(x.tread)} · ${Math.round(x.length)} × ${x.width}${warn}`;
  }
  const t = r.landings.filter((l) => l.joins >= 3).length;
  return `${f.length} flights · ${r.landings.length} landing${r.landings.length === 1 ? '' : 's'}${t ? ` · ${t} junction${t > 1 ? 's' : ''}` : ''} · ${f.reduce((s, x) => s + x.steps, 0)} steps${warn}`;
}

const fmt1 = (v: number) => String(Math.round(v * 10) / 10);

/** Points named the way the boards do: A, B, C…, and a branch's points C1, C2. */
export function pointNames(spec: StairsSpec): string[] {
  const names: string[] = spec.nodes.map(() => '');
  if (!spec.nodes.length) return names;
  names[0] = 'A';
  const depth = spec.nodes.map(() => 0);
  const children = new Map<number, number[]>();
  for (const f of spec.flights) {
    depth[f.to] = depth[f.from] + 1;
    children.set(f.from, [...(children.get(f.from) ?? []), f.to]);
  }
  const letter = (d: number) => String.fromCharCode(65 + Math.min(25, d));
  for (const f of spec.flights) {
    const sib = children.get(f.from)!;
    names[f.to] = letter(depth[f.to]) + (sib.length > 1 ? String(sib.indexOf(f.to) + 1) : '');
  }
  return names;
}

// --- Storing ----------------------------------------------------------------------------------------------

const OPTION_KEYS = Object.keys(DEFAULT_STAIRS) as (keyof StairsOptions)[];
const clean = (s: string) => s.replace(/[|;=,"]/g, ' ').trim();

/** The spec as one key value: `uid|x,y,z;…|from,to,steps,width;…|key=value;…` (options left out at their defaults). */
export function encodeStairs(s: StairsSpec): string {
  const r = (v: number) => String(Math.round(v * 100) / 100);
  const opts = OPTION_KEYS.filter((k) => s.options[k] !== DEFAULT_STAIRS[k]).map((k) => {
    const v = s.options[k];
    return `${k}=${typeof v === 'boolean' ? (v ? '1' : '0') : clean(String(v))}`;
  });
  return [
    clean(s.uid),
    s.nodes.map((n) => `${r(n.x)},${r(n.y)},${r(n.z)}`).join(';'),
    s.flights.map((f) => `${f.from},${f.to},${f.steps ?? ''},${f.width ?? ''}`).join(';'),
    opts.join(';'),
  ].join('|');
}

export function decodeStairs(v: string): StairsSpec | null {
  const p = v.split('|');
  if (p.length < 4) return null;
  const [uid, ns, fs, os] = p;
  const nodes = ns.split(';').filter(Boolean).map((t) => { const [x, y, z] = t.split(',').map(Number); return { x, y, z }; });
  if (!uid || !nodes.length || nodes.some((n) => ![n.x, n.y, n.z].every(Number.isFinite))) return null;
  const opt = (s: string) => (s === '' ? undefined : Number(s));
  const flights = fs.split(';').filter(Boolean).map((t) => {
    const [a, b, st, w] = t.split(',');
    const f: StairsFlight = { from: Number(a), to: Number(b) };
    if (opt(st ?? '') !== undefined) f.steps = opt(st);
    if (opt(w ?? '') !== undefined) f.width = opt(w);
    return f;
  }).filter((f) => Number.isInteger(f.from) && Number.isInteger(f.to) && f.from < nodes.length && f.to < nodes.length && f.from !== f.to);
  const options: StairsOptions = { ...DEFAULT_STAIRS };
  for (const kv of os.split(';')) {
    const i = kv.indexOf('=');
    if (i < 0) continue;
    const k = kv.slice(0, i) as keyof StairsOptions, val = kv.slice(i + 1);
    if (!OPTION_KEYS.includes(k)) continue;
    const d = DEFAULT_STAIRS[k];
    (options as unknown as Record<string, unknown>)[k] = typeof d === 'boolean' ? val === '1' : typeof d === 'number' ? Number(val) || d : val;
  }
  return { uid, nodes, flights, options };
}

/** A fresh short id for new stairs. */
export const newStairsUid = (): string => Math.random().toString(36).slice(2, 8);

export { NODRAW };
