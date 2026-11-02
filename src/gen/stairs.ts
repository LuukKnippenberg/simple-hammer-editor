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
const NPCCLIP = 'TOOLS/TOOLSNPCCLIP';
const COMBINE_PANEL = 'METAL/METALCOMBINE001';
/** Thickness of open treads, of floating treads and landing slabs, and of the slab under sloped steps. */
const TREAD = 6, SLAB = 8, UNDER = 16;

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

/** Builds stairs from a spec. Brushes are numbered in `doc` (not added to it). */
export function buildStairs(doc: VmfDocument, spec: StairsSpec): StairsResult {
  const o = { ...DEFAULT_STAIRS, ...spec.options };
  const nodes = plannedNodes({ ...spec, options: o });
  const touch = joins(spec);
  const base = Math.min(...nodes.map((n) => n.z));
  const c: Ctx = { doc, o, base, detail: [], clip: [] };
  const xy = (i: number) => new Vector2(nodes[i].x, nodes[i].y);
  const valid = spec.flights.filter((f) => nodes[f.from] && nodes[f.to] && xy(f.from).distanceTo(xy(f.to)) >= 1);
  const isLanding = (i: number) => touch[i].filter((k) => valid.includes(spec.flights[k])).length >= 2;
  const railsOn = o.rails !== 'none';

  // Landings: one stair width square at a turn (round each flight's own square when they come in at angles).
  const landings: StairsResult['landings'] = [];
  const landingPoly = new Map<number, Vector2[]>();
  const landingHalf = new Map<number, number>();
  nodes.forEach((_, i) => {
    if (!isLanding(i)) return;
    const fl = touch[i].map((k) => spec.flights[k]).filter((f) => valid.includes(f));
    const w = Math.max(...fl.map((f) => flightWidth(spec, f)));
    const p = xy(i);
    const squares = o.plan === 'blocky' ? [new Vector2(1, 0)] : fl.map((f) => xy(f.from === i ? f.to : f.from).sub(p).normalize());
    const poly = hull2(squares.flatMap((u) => strip(p, u, -w / 2, w / 2, -w / 2, w / 2)));
    landingPoly.set(i, poly);
    landingHalf.set(i, w / 2);
    const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y);
    landings.push({ node: i, size: [Math.round(Math.max(...xs) - Math.min(...xs)), Math.round(Math.max(...ys) - Math.min(...ys))], joins: fl.length });
  });

  const flights: FlightInfo[] = [];
  for (const f of spec.flights) {
    const w = flightWidth(spec, f);
    const height = nodes[f.to] && nodes[f.from] ? nodes[f.to].z - nodes[f.from].z : 0;
    if (!valid.includes(f)) {
      flights.push({ from: f.from, to: f.to, steps: 0, rise: 0, tread: 0, height, length: 0, width: w, steep: true });
      continue;
    }
    // Built from the low end up: s runs along the flight from the low point, t across it (left positive).
    const up = height >= 0;
    const lowI = up ? f.from : f.to, highI = up ? f.to : f.from;
    const O = xy(lowI), L = O.distanceTo(xy(highI));
    const u = xy(highI).sub(O).divideScalar(L), n = new Vector2(-u.y, u.x);
    const zl = nodes[lowI].z, zh = nodes[highI].z, H = zh - zl;
    const leafLow = !isLanding(lowI), leafHigh = !isLanding(highI);
    const sa = (landingHalf.get(lowI) ?? 0) + (leafLow ? Math.max(0, o.landingBottom) : 0);
    const topRun = leafHigh ? Math.max(0, o.landingTop) : 0;
    const sb = L - (landingHalf.get(highI) ?? 0) - topRun;
    const run = sb - sa;
    const level = H < 0.5;
    const steps = level ? 0 : Math.max(autoSteps(H), Math.round(f.steps ?? 0));
    const tread = steps ? run / steps : run, rise = steps ? H / steps : 0;
    const steep = run <= 1 || (!level && Math.atan2(H, run) * 180 / Math.PI >= MAX_SLOPE - 0.01);
    flights.push({ from: f.from, to: f.to, steps, rise, tread, height, length: L, width: w, steep });
    if (run <= 1) continue;
    const solid = o.structure === 'solid';
    const S = (s0: number, s1: number, t0 = -w / 2, t1 = w / 2) => strip(O, u, s0, s1, t0, t1);
    const mat = stepMat(o);

    // The walkway: flat, ramp or steps.
    if (level) {
      landingBrushes(c, S(sa, sb), zl);
    } else if (o.profile === 'ramp') {
      const slope = H / run;
      const topLin = along(O.clone().addScaledVector(u, sa), u, zl, slope);
      add(c.detail, prismBrush(doc, S(sa, sb), solid ? flat(Math.min(base, zl - SLAB)) : (p) => topLin(p) - SLAB, topLin, mat));
    } else {
      const slope = rise / tread;
      const backLine = along(O.clone().addScaledVector(u, sa), u, zl, slope);
      for (let k = 0; k < steps; k++) {
        const s0 = sa + k * tread, s1 = s0 + tread, top = zl + (k + 1) * rise;
        const foot = S(s0, s1);
        if (o.structure === 'solid') add(c.detail, prismBrush(doc, foot, flat(base), flat(top), mat));
        else if (o.structure === 'sloped') add(c.detail, prismBrush(doc, foot, (p) => backLine(p) - UNDER, flat(top), mat));
        else add(c.detail, prismBrush(doc, foot, flat(top - (o.structure === 'open' ? TREAD : SLAB)), flat(top), mat));
        if (o.structure === 'posts' && k % 2 === 0 && top - SLAB > base + 1) {
          for (const t of [-w / 2 + 12, w / 2 - 12]) add(c.detail, prismBrush(doc, S((s0 + s1) / 2 - 4, (s0 + s1) / 2 + 4, t - 4, t + 4), flat(base), flat(top - SLAB), () => o.sideMaterial));
        }
      }
      // Beams: stringers beside the treads (open treads always have them), or one down the middle underneath.
      const beams = o.structure === 'open' && o.beams === 'none' ? 'both' : o.beams;
      if (beams !== 'none' && o.structure !== 'solid') {
        const nose = along(O.clone().addScaledVector(u, sa), u, zl + rise, slope);
        if (beams === 'both') {
          for (const [t0, t1] of [[w / 2 - 6, w / 2], [-w / 2, -w / 2 + 6]]) add(c.detail, prismBrush(doc, S(sa, sb, t0, t1), (p) => nose(p) - 24, (p) => nose(p) + 4, () => o.sideMaterial));
        } else {
          add(c.detail, prismBrush(doc, S(sa, sb, -8, 8), (p) => backLine(p) - TREAD - 14, (p) => backLine(p) - TREAD, () => o.sideMaterial));
        }
      }
      // The NPC clip ramp touches every step's front edge: from the floor one tread before the flight to the top
      // at the last step, so the navmesh sees one smooth slope whatever the structure.
      if (o.clip) {
        const start = O.clone().addScaledVector(u, sa - tread);
        add(c.clip, prismBrush(doc, S(sa - tread, sb - tread), flat(zl), along(start, u, zl, slope), () => NPCCLIP));
      }
    }
    if (topRun > 0) landingBrushes(c, S(sb, sb + topRun), zh);

    // Hand rails along the flight's sides, stopping where it joins a landing.
    if (railsOn && !level) {
      const lowIsFrom = lowI === f.from;
      const sides = o.rails === 'both' ? [1, -1] : [(o.rails === 'left') === lowIsFrom ? 1 : -1];
      const surface = (s: number) => (o.profile === 'ramp' ? zl + H * Math.max(0, Math.min(1, (s - sa) / run)) : zl + Math.min(steps, Math.floor((s - sa) / tread) + 1) * rise);
      for (const side of sides) {
        const p0 = O.clone().addScaledVector(u, sa).addScaledVector(n, side * w / 2);
        const p1 = O.clone().addScaledVector(u, sb).addScaledVector(n, side * w / 2);
        const inward = n.clone().multiplyScalar(-side);
        const z0 = o.profile === 'ramp' ? zl : zl + rise;
        const low = solid ? flat(base) : o.profile === 'ramp' ? along(p0, u, zl - SLAB, H / run) : along(p0, u, zl - UNDER, rise / tread);
        rail(c, p0, p1, z0, zh, inward, (fr) => surface(sa + fr * run), low);
        if (topRun > 0) {
          const q1 = p1.clone().addScaledVector(u, topRun);
          rail(c, p1, q1, zh, zh, inward, () => zh, solid ? flat(base) : flat(zh - SLAB));
        }
      }
    }
  }

  // Landings, with rails round every edge no flight comes in through.
  for (const [i, poly] of landingPoly) {
    const z = nodes[i].z;
    landingBrushes(c, poly, z);
    if (!railsOn) continue;
    const p = xy(i);
    const outs = touch[i].map((k) => spec.flights[k]).filter((f) => valid.includes(f)).map((f) => xy(f.from === i ? f.to : f.from).sub(p).normalize());
    const solid = o.structure === 'solid' || o.structure === 'sloped';
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const e = b.clone().sub(a).normalize();
      const out = new Vector2(e.y, -e.x);
      if (outs.some((d) => d.dot(out) > 0.64)) continue;
      rail(c, a, b, z, z, out.clone().negate(), () => z, solid ? flat(Math.min(base, z - SLAB)) : flat(z - SLAB));
    }
  }

  // Faces against each other and the bottoms on the ground are never seen.
  hideCoveredFaces(c.detail, { groundAt: () => base });

  const pad = Math.max(...spec.flights.map((f) => flightWidth(spec, f)), o.width) / 2;
  const xs = nodes.map((q) => q.x), ys = nodes.map((q) => q.y);
  const bounds = { x0: Math.round(Math.min(...xs) - pad), y0: Math.round(Math.min(...ys) - pad), x1: Math.round(Math.max(...xs) + pad), y1: Math.round(Math.max(...ys) + pad) };
  return { detail: c.detail, clip: c.clip, flights, landings, bounds, base };
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
