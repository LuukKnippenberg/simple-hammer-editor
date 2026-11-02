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
  spec.flights.forEach((flight, i) => { out[flight.from]?.push(i); out[flight.to]?.push(i); });
  return out;
}

/**
 * The points as they are built: with the blocky plan each flight is squared to the nearest axis from the point it
 * leaves (in flight order, so a whole chain stays square).
 */
export function plannedNodes(spec: StairsSpec): StairsNode[] {
  const nodes = spec.nodes.map((node) => ({ ...node }));
  if (spec.options.plan !== 'blocky') return nodes;
  for (const flight of spec.flights) {
    const start = nodes[flight.from], end = nodes[flight.to];
    if (!start || !end) continue;
    const dx = spec.nodes[flight.to].x - spec.nodes[flight.from].x, dy = spec.nodes[flight.to].y - spec.nodes[flight.from].y;
    if (Math.abs(dx) >= Math.abs(dy)) { end.x = start.x + dx; end.y = start.y; } else { end.x = start.x; end.y = start.y + dy; }
  }
  return nodes;
}

/** Squares a point to the nearest axis from another (the blocky plan, while placing). */
export function squareTo(from: { x: number; y: number }, point: { x: number; y: number }): { x: number; y: number } {
  return Math.abs(point.x - from.x) >= Math.abs(point.y - from.y) ? { x: point.x, y: from.y } : { x: from.x, y: point.y };
}

const flightWidth = (spec: StairsSpec, flight: StairsFlight) => Math.max(32, flight.width ?? spec.options.width);

// --- Brushes -------------------------------------------------------------------------------------------------

/** A height over the plan, linear in x and y. */
type HeightAt = (p: Vector2) => number;
const flat = (z: number): HeightAt => () => z;
/** A height that rises linearly along `dir` from `z0` at `origin`. */
const along = (origin: Vector2, dir: Vector2, z0: number, slope: number): HeightAt => (p) => z0 + (p.x - origin.x) * dir.x * slope + (p.y - origin.y) * dir.y * slope;

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * A convex brush over a convex footprint between a bottom and a top plane. Sides
 * with no height at either end are left out (a wedge's thin edge), so wedges and ramps stay valid solids.
 * `materialFor` picks a material from the face's outward normal.
 */
export function prismBrush(doc: VmfDocument, foot: Vector2[], bottom: HeightAt, top: HeightAt, materialFor: (normal: Vector3) => string): KVNode | null {
  const points = foot.map((p) => new Vector2(round(p.x), round(p.y)));
  const bottoms = points.map((p) => new Vector3(p.x, p.y, round(bottom(p)))), tops = points.map((p) => new Vector3(p.x, p.y, round(top(p))));
  if (tops.some((corner, i) => corner.z < bottoms[i].z - 0.01) || !tops.some((corner, i) => corner.z - bottoms[i].z > 0.5)) return null;
  const centre = new Vector3();
  for (const p of [...bottoms, ...tops]) centre.add(p);
  centre.divideScalar(bottoms.length * 2);
  const faces: FaceSpec[] = [];
  const face = (a: Vector3, b: Vector3, c: Vector3) => {
    // solidNode's normal is (c - a) × (b - a); it has to point away from the brush.
    let normal = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(b, a));
    if (normal.lengthSq() < 1e-6) return;
    if (normal.dot(new Vector3().subVectors(a, centre)) < 0) { [b, c] = [c, b]; normal = normal.negate(); }
    faces.push({ points: [a, b, c], material: materialFor(normal.normalize()) });
  };
  face(tops[0], tops[1], tops[2]);
  face(bottoms[0], bottoms[1], bottoms[2]);
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const tallAtJ = tops[j].z - bottoms[j].z > 0.01, tallAtI = tops[i].z - bottoms[i].z > 0.01;
    if (!tallAtJ && !tallAtI) continue;
    face(bottoms[i], bottoms[j], tallAtJ ? tops[j] : tops[i]);
  }
  return solidNode(doc, faces);
}

/** A strip along a direction: the footprint s0..s1 along `dir`, t0..t1 across (to the left of `dir`). */
function strip(origin: Vector2, dir: Vector2, s0: number, s1: number, t0: number, t1: number): Vector2[] {
  const left = new Vector2(-dir.y, dir.x);
  const pointAt = (s: number, t: number) => origin.clone().addScaledVector(dir, s).addScaledVector(left, t);
  return [pointAt(s0, t0), pointAt(s1, t0), pointAt(s1, t1), pointAt(s0, t1)];
}

/** Convex hull of points in the plan, counter-clockwise (monotone chain). */
function hull2(points: Vector2[]): Vector2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vector2, a: Vector2, b: Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vector2[] = [], upper: Vector2[] = [];
  for (const point of sorted) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-6) lower.pop(); lower.push(point); }
  for (const point of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-6) upper.pop(); upper.push(point); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

interface BuildContext {
  doc: VmfDocument;
  options: StairsOptions;
  base: number;
  detail: KVNode[];
  clip: KVNode[];
}

const add = (list: KVNode[], node: KVNode | null) => { if (node) list.push(node); };
/** Tops get the step material, everything else the side material. */
const stepOrSideMaterial = (options: StairsOptions) => (normal: Vector3) => (normal.z > 0.5 ? options.stepMaterial : options.sideMaterial);

/**
 * One rail along a run from `p0` to `p1` (its outer edge), the walking surface under it rising linearly from `z0`
 * to `z1`; `inward` points onto the walkway. `surface` is the height under a point along the run (steps), for the
 * feet of posts and spindles.
 */
function rail(build: BuildContext, p0: Vector2, p1: Vector2, z0: number, z1: number, inward: Vector2, surface: (fraction: number) => number, low: HeightAt | null): void {
  const { options, doc } = build;
  const length = p0.distanceTo(p1);
  if (length < 4) return;
  const dir = p1.clone().sub(p0).divideScalar(length);
  const left = new Vector2(-dir.y, dir.x).dot(inward) > 0 ? 1 : -1;
  const slope = (z1 - z0) / length;
  const height = Math.max(16, options.railHeight);
  const line = (dz: number): HeightAt => along(p0, dir, z0 + dz, slope);
  const band = (t0: number, t1: number) => strip(p0, dir, 0, length, left * t0, left * t1);
  const railMaterial = () => options.railMaterial;
  const bar = (t0: number, t1: number, bottom: number, top: number, material = railMaterial) => add(build.detail, prismBrush(doc, band(t0, t1), line(bottom), line(top), material));
  const posts = (every: number, size: number, topAt: number, from = 0) => {
    const count = Math.max(1, Math.round(length / every));
    for (let k = from; k <= count; k++) {
      const fraction = k / count;
      const distance = Math.min(length - size / 2, Math.max(size / 2, fraction * length));
      const centre = p0.clone().addScaledVector(dir, distance);
      const postBottom = surface(distance / length), postTop = z0 + slope * distance + topAt;
      add(build.detail, prismBrush(doc, strip(centre, dir, -size / 2, size / 2, left * 0.5, left * (0.5 + size)), flat(postBottom), flat(postTop), railMaterial));
    }
  };
  if (options.railStyle === 'pipe') {
    bar(0.5, 3.5, height - 3, height);
    bar(0.5, 3.5, height - 19, height - 16);
    posts(Math.max(32, options.postSpacing), 3, height - 1.5);
  } else if (options.railStyle === 'balusters') {
    bar(0, 4, height - 4, height);
    posts(14, 2, height - 2);
  } else if (options.railStyle === 'parapet') {
    const sideMaterial = () => options.sideMaterial;
    add(build.detail, prismBrush(doc, band(0, 8), low ?? line(-24), line(height), sideMaterial));
  } else {
    bar(0, 4, height - 4, height);
    bar(1, 3, 4, height - 4, () => COMBINE_PANEL);
    posts(Math.max(32, options.postSpacing), 3, height - 2);
  }
}

/** A landing: the plan polygon at height z, by structure (solid to the ground, else a slab, on posts with `posts`). */
function landingBrushes(build: BuildContext, poly: Vector2[], z: number): void {
  const { options, doc } = build;
  const solid = options.structure === 'solid' || options.structure === 'sloped';
  add(build.detail, prismBrush(doc, poly, flat(solid ? Math.min(build.base, z - SLAB) : z - SLAB), flat(z), stepOrSideMaterial(options)));
  if (options.structure === 'posts' && z - SLAB > build.base + 1) {
    const centre = poly.reduce((sum, point) => sum.add(point), new Vector2()).divideScalar(poly.length);
    for (const corner of poly) {
      const postAt = corner.clone().lerp(centre, 12 / Math.max(24, corner.distanceTo(centre)));
      add(build.detail, prismBrush(doc, strip(postAt, new Vector2(1, 0), -4, 4, -4, 4), flat(build.base), flat(z - SLAB), () => options.sideMaterial));
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
  const options = { ...DEFAULT_STAIRS, ...spec.options };
  const nodes = plannedNodes({ ...spec, options });
  const base = Math.min(...nodes.map((node) => node.z));
  const build: BuildContext = { doc, options, base, detail: [], clip: [] };
  const layout: StairsLayout = { spec, nodes, touch: joins(spec), valid: [] };
  layout.valid = spec.flights.filter((flight) => nodes[flight.from] && nodes[flight.to] && xy(layout, flight.from).distanceTo(xy(layout, flight.to)) >= 1);

  const landings = planLandings(layout, options);
  const landingHalf = new Map(landings.map((landing) => [landing.node, landing.half]));
  const flights = spec.flights.map((flight) => buildFlight(build, layout, landingHalf, flight));
  for (const landing of landings) buildLanding(build, layout, landing);

  // Faces against each other and the bottoms on the ground are never seen.
  hideCoveredFaces(build.detail, { groundAt: () => base });
  return { detail: build.detail, clip: build.clip, flights, landings: landings.map(landingInfo), bounds: stairsBounds(spec, nodes, options), base };
}

/** A landing's plan polygon, half its size (where the flights stop), and how many flights it joins. */
interface LandingPlan { node: number; poly: Vector2[]; half: number; joins: number }

/** Landings: one stair width square at a turn (round each flight's own square when they come in at angles). */
function planLandings(layout: StairsLayout, options: StairsOptions): LandingPlan[] {
  const out: LandingPlan[] = [];
  layout.nodes.forEach((_, i) => {
    if (!isLanding(layout, i)) return;
    const joined = flightsAt(layout, i);
    const width = Math.max(...joined.map((flight) => flightWidth(layout.spec, flight)));
    const centre = xy(layout, i);
    const squares = options.plan === 'blocky' ? [new Vector2(1, 0)] : joined.map((flight) => xy(layout, flight.from === i ? flight.to : flight.from).sub(centre).normalize());
    const poly = hull2(squares.flatMap((dir) => strip(centre, dir, -width / 2, width / 2, -width / 2, width / 2)));
    out.push({ node: i, poly, half: width / 2, joins: joined.length });
  });
  return out;
}

function landingInfo(landing: LandingPlan): StairsResult['landings'][number] {
  const xs = landing.poly.map((point) => point.x), ys = landing.poly.map((point) => point.y);
  return { node: landing.node, size: [Math.round(Math.max(...xs) - Math.min(...xs)), Math.round(Math.max(...ys) - Math.min(...ys))], joins: landing.joins };
}

/** A buildable flight, laid out from its low end up: s runs along it from the low point `origin`, t across it (left positive). */
interface FlightRun {
  /** The low point, the way up the flight, and its left. */
  origin: Vector2;
  dir: Vector2;
  left: Vector2;
  width: number;
  /** Plan length between the points. */
  length: number;
  /** Heights of the low and the high end, and the climb between them. */
  lowZ: number;
  highZ: number;
  climb: number;
  /** Where the walkway starts and ends along s, its length, and the flat run past a top with no landing. */
  walkFrom: number;
  walkTo: number;
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

function layOutFlight(layout: StairsLayout, options: StairsOptions, landingHalf: Map<number, number>, flight: StairsFlight, width: number, height: number): FlightRun {
  const up = height >= 0;
  const lowNode = up ? flight.from : flight.to, highNode = up ? flight.to : flight.from;
  const origin = xy(layout, lowNode), length = origin.distanceTo(xy(layout, highNode));
  const dir = xy(layout, highNode).sub(origin).divideScalar(length), left = new Vector2(-dir.y, dir.x);
  const lowZ = layout.nodes[lowNode].z, highZ = layout.nodes[highNode].z, climb = highZ - lowZ;
  const leafLow = !isLanding(layout, lowNode), leafHigh = !isLanding(layout, highNode);
  const walkFrom = (landingHalf.get(lowNode) ?? 0) + (leafLow ? Math.max(0, options.landingBottom) : 0);
  const topRun = leafHigh ? Math.max(0, options.landingTop) : 0;
  const walkTo = length - (landingHalf.get(highNode) ?? 0) - topRun;
  const run = walkTo - walkFrom;
  const level = climb < 0.5;
  const steps = level ? 0 : Math.max(autoSteps(climb), Math.round(flight.steps ?? 0));
  const tread = steps ? run / steps : run, rise = steps ? climb / steps : 0;
  return { origin, dir, left, width, length, lowZ, highZ, climb, walkFrom, walkTo, run, topRun, level, steps, tread, rise, lowIsFrom: lowNode === flight.from };
}

/** The footprint between s0 and s1 along a flight, t0..t1 across it (its full width by default). */
const footprint = (flightRun: FlightRun, s0: number, s1: number, t0 = -flightRun.width / 2, t1 = flightRun.width / 2) => strip(flightRun.origin, flightRun.dir, s0, s1, t0, t1);
/** The point at s along a flight's centre line. */
const pointAlong = (flightRun: FlightRun, s: number) => flightRun.origin.clone().addScaledVector(flightRun.dir, s);

/** One flight: its walkway, a flat run past a top with no landing, and its hand rails. */
function buildFlight(build: BuildContext, layout: StairsLayout, landingHalf: Map<number, number>, flight: StairsFlight): FlightInfo {
  const { nodes } = layout;
  const width = flightWidth(layout.spec, flight);
  const height = nodes[flight.to] && nodes[flight.from] ? nodes[flight.to].z - nodes[flight.from].z : 0;
  if (!layout.valid.includes(flight)) return { from: flight.from, to: flight.to, steps: 0, rise: 0, tread: 0, height, length: 0, width, steep: true };
  const flightRun = layOutFlight(layout, build.options, landingHalf, flight, width, height);
  const { steps, rise, tread, length, run, level } = flightRun;
  const steep = run <= 1 || (!level && Math.atan2(flightRun.climb, run) * 180 / Math.PI >= MAX_SLOPE - 0.01);
  if (run > 1) {
    walkway(build, flightRun);
    if (flightRun.topRun > 0) landingBrushes(build, footprint(flightRun, flightRun.walkTo, flightRun.walkTo + flightRun.topRun), flightRun.highZ);
    if (build.options.rails !== 'none' && !level) flightRails(build, flightRun);
  }
  return { from: flight.from, to: flight.to, steps, rise, tread, height, length, width, steep };
}

/** The walkway: flat, a ramp, or steps (with their beams and the NPC clip ramp). */
function walkway(build: BuildContext, flightRun: FlightRun): void {
  const { options, doc, base } = build;
  if (flightRun.level) {
    landingBrushes(build, footprint(flightRun, flightRun.walkFrom, flightRun.walkTo), flightRun.lowZ);
  } else if (options.profile === 'ramp') {
    const topHeight = along(pointAlong(flightRun, flightRun.walkFrom), flightRun.dir, flightRun.lowZ, flightRun.climb / flightRun.run);
    const bottom = options.structure === 'solid' ? flat(Math.min(base, flightRun.lowZ - SLAB)) : (p: Vector2) => topHeight(p) - SLAB;
    add(build.detail, prismBrush(doc, footprint(flightRun, flightRun.walkFrom, flightRun.walkTo), bottom, topHeight, stepOrSideMaterial(options)));
  } else {
    stepBrushes(build, flightRun);
    beamBrushes(build, flightRun);
    if (options.clip) clipRamp(build, flightRun);
  }
}

/** The steps, by structure; with `posts`, a pair of posts under every other step. */
function stepBrushes(build: BuildContext, flightRun: FlightRun): void {
  const { options, doc, base } = build;
  const { walkFrom, lowZ, steps, tread, rise, width } = flightRun;
  const material = stepOrSideMaterial(options);
  const backLine = along(pointAlong(flightRun, walkFrom), flightRun.dir, lowZ, rise / tread);
  for (let k = 0; k < steps; k++) {
    const s0 = walkFrom + k * tread, s1 = s0 + tread, top = lowZ + (k + 1) * rise;
    const foot = footprint(flightRun, s0, s1);
    if (options.structure === 'solid') add(build.detail, prismBrush(doc, foot, flat(base), flat(top), material));
    else if (options.structure === 'sloped') add(build.detail, prismBrush(doc, foot, (p) => backLine(p) - UNDER, flat(top), material));
    else add(build.detail, prismBrush(doc, foot, flat(top - (options.structure === 'open' ? TREAD : SLAB)), flat(top), material));
    if (options.structure === 'posts' && k % 2 === 0 && top - SLAB > base + 1) {
      const mid = (s0 + s1) / 2;
      for (const across of [-width / 2 + POST_INSET, width / 2 - POST_INSET]) {
        add(build.detail, prismBrush(doc, footprint(flightRun, mid - POST / 2, mid + POST / 2, across - POST / 2, across + POST / 2), flat(base), flat(top - SLAB), () => options.sideMaterial));
      }
    }
  }
}

/** Beams: stringers beside the treads (open treads always have them), or one down the middle underneath. */
function beamBrushes(build: BuildContext, flightRun: FlightRun): void {
  const { options, doc } = build;
  const { walkFrom, walkTo, lowZ, rise, tread, width } = flightRun;
  const beams = options.structure === 'open' && options.beams === 'none' ? 'both' : options.beams;
  if (beams === 'none' || options.structure === 'solid') return;
  const sideMaterial = () => options.sideMaterial;
  if (beams === 'both') {
    const nose = along(pointAlong(flightRun, walkFrom), flightRun.dir, lowZ + rise, rise / tread);
    for (const [t0, t1] of [[width / 2 - STRINGER, width / 2], [-width / 2, -width / 2 + STRINGER]]) {
      add(build.detail, prismBrush(doc, footprint(flightRun, walkFrom, walkTo, t0, t1), (p) => nose(p) - STRINGER_DROP, (p) => nose(p) + STRINGER_LIP, sideMaterial));
    }
  } else {
    const backLine = along(pointAlong(flightRun, walkFrom), flightRun.dir, lowZ, rise / tread);
    add(build.detail, prismBrush(doc, footprint(flightRun, walkFrom, walkTo, -SPINE_HALF, SPINE_HALF), (p) => backLine(p) - TREAD - SPINE_DEPTH, (p) => backLine(p) - TREAD, sideMaterial));
  }
}

/**
 * The NPC clip ramp touches every step's front edge up to the top at the last step, so the navmesh sees one
 * smooth slope whatever the structure. It meets the floor one tread before the flight, or starts with a
 * small lip (under a step's rise) so long treads don't tilt the landing in front.
 */
function clipRamp(build: BuildContext, flightRun: FlightRun): void {
  const { walkFrom, walkTo, lowZ, tread, rise } = flightRun;
  const lead = Math.min(tread, CLIP_LEAD);
  add(build.clip, prismBrush(build.doc, footprint(flightRun, walkFrom - lead, walkTo - tread), flat(lowZ), along(pointAlong(flightRun, walkFrom - tread), flightRun.dir, lowZ, rise / tread), () => NPCCLIP));
}

/** Hand rails along the flight's sides (and along its top run), stopping where it joins a landing. */
function flightRails(build: BuildContext, flightRun: FlightRun): void {
  const { options, base } = build;
  const { dir, left, walkFrom, walkTo, run, lowZ, highZ, climb, steps, tread, rise, topRun, width } = flightRun;
  const solid = options.structure === 'solid';
  const sides = options.rails === 'both' ? [1, -1] : [(options.rails === 'left') === flightRun.lowIsFrom ? 1 : -1];
  const surface = (s: number) => (options.profile === 'ramp' ? lowZ + climb * Math.max(0, Math.min(1, (s - walkFrom) / run)) : lowZ + Math.min(steps, Math.floor((s - walkFrom) / tread) + 1) * rise);
  for (const side of sides) {
    const p0 = pointAlong(flightRun, walkFrom).addScaledVector(left, side * width / 2);
    const p1 = pointAlong(flightRun, walkTo).addScaledVector(left, side * width / 2);
    const inward = left.clone().multiplyScalar(-side);
    const z0 = options.profile === 'ramp' ? lowZ : lowZ + rise;
    const low = solid ? flat(base) : options.profile === 'ramp' ? along(p0, dir, lowZ - SLAB, climb / run) : along(p0, dir, lowZ - UNDER, rise / tread);
    rail(build, p0, p1, z0, highZ, inward, (frac) => surface(walkFrom + frac * run), low);
    if (topRun > 0) {
      const q1 = p1.clone().addScaledVector(dir, topRun);
      rail(build, p1, q1, highZ, highZ, inward, () => highZ, solid ? flat(base) : flat(highZ - SLAB));
    }
  }
}

/** A landing, with rails round every edge no flight comes in through. */
function buildLanding(build: BuildContext, layout: StairsLayout, landing: LandingPlan): void {
  const { options, base } = build;
  const z = layout.nodes[landing.node].z;
  landingBrushes(build, landing.poly, z);
  if (options.rails === 'none') return;
  const centre = xy(layout, landing.node);
  const flightDirs = flightsAt(layout, landing.node).map((flight) => xy(layout, flight.from === landing.node ? flight.to : flight.from).sub(centre).normalize());
  const solid = options.structure === 'solid' || options.structure === 'sloped';
  for (let k = 0; k < landing.poly.length; k++) {
    const edgeStart = landing.poly[k], edgeEnd = landing.poly[(k + 1) % landing.poly.length];
    const edgeDir = edgeEnd.clone().sub(edgeStart).normalize();
    const outward = new Vector2(edgeDir.y, -edgeDir.x);
    if (flightDirs.some((dir) => dir.dot(outward) > THROUGH_EDGE)) continue;
    rail(build, edgeStart, edgeEnd, z, z, outward.clone().negate(), () => z, solid ? flat(Math.min(base, z - SLAB)) : flat(z - SLAB));
  }
}

/** Plan rectangle round the points, padded by half the widest flight. */
function stairsBounds(spec: StairsSpec, nodes: StairsNode[], options: StairsOptions): StairsResult['bounds'] {
  const pad = Math.max(...spec.flights.map((flight) => flightWidth(spec, flight)), options.width) / 2;
  const xs = nodes.map((node) => node.x), ys = nodes.map((node) => node.y);
  return { x0: Math.round(Math.min(...xs) - pad), y0: Math.round(Math.min(...ys) - pad), x1: Math.round(Math.max(...xs) + pad), y1: Math.round(Math.max(...ys) + pad) };
}

/** The Tune step's summary: one flight in full, a chain as its flights and landings. */
export function stairsSummary(result: StairsResult): string {
  const flights = result.flights.filter((flight) => flight.length > 0);
  if (!flights.length) return 'No flights yet';
  const warn = flights.some((flight) => flight.steep) ? ' · too steep for units: make it longer' : '';
  if (flights.length === 1) {
    const flight = flights[0];
    if (!flight.steps) return `Flat walkway · ${Math.round(flight.length)} × ${flight.width}${warn}`;
    return `${flight.steps} steps · rise ${fmt1(flight.rise)} · tread ${fmt1(flight.tread)} · ${Math.round(flight.length)} × ${flight.width}${warn}`;
  }
  const junctions = result.landings.filter((landing) => landing.joins >= 3).length;
  return `${flights.length} flights · ${result.landings.length} landing${result.landings.length === 1 ? '' : 's'}${junctions ? ` · ${junctions} junction${junctions > 1 ? 's' : ''}` : ''} · ${flights.reduce((sum, flight) => sum + flight.steps, 0)} steps${warn}`;
}

const fmt1 = (v: number) => String(Math.round(v * 10) / 10);

/** Points named the way the boards do: A, B, C…, and a branch's points C1, C2. */
export function pointNames(spec: StairsSpec): string[] {
  const names: string[] = spec.nodes.map(() => '');
  if (!spec.nodes.length) return names;
  names[0] = 'A';
  const depth = spec.nodes.map(() => 0);
  const children = new Map<number, number[]>();
  for (const flight of spec.flights) {
    depth[flight.to] = depth[flight.from] + 1;
    children.set(flight.from, [...(children.get(flight.from) ?? []), flight.to]);
  }
  const letter = (level: number) => String.fromCharCode(65 + Math.min(25, level));
  for (const flight of spec.flights) {
    const siblings = children.get(flight.from)!;
    names[flight.to] = letter(depth[flight.to]) + (siblings.length > 1 ? String(siblings.indexOf(flight.to) + 1) : '');
  }
  return names;
}

// --- Storing ----------------------------------------------------------------------------------------------

const OPTION_KEYS = Object.keys(DEFAULT_STAIRS) as (keyof StairsOptions)[];
const clean = (text: string) => text.replace(/[|;=,"]/g, ' ').trim();

/** The spec as one key value: `uid|x,y,z;…|from,to,steps,width;…|key=value;…` (options left out at their defaults). */
export function encodeStairs(spec: StairsSpec): string {
  const rounded = (value: number) => String(Math.round(value * 100) / 100);
  const optionPairs = OPTION_KEYS.filter((key) => spec.options[key] !== DEFAULT_STAIRS[key]).map((key) => {
    const value = spec.options[key];
    return `${key}=${typeof value === 'boolean' ? (value ? '1' : '0') : clean(String(value))}`;
  });
  return [
    clean(spec.uid),
    spec.nodes.map((node) => `${rounded(node.x)},${rounded(node.y)},${rounded(node.z)}`).join(';'),
    spec.flights.map((flight) => `${flight.from},${flight.to},${flight.steps ?? ''},${flight.width ?? ''}`).join(';'),
    optionPairs.join(';'),
  ].join('|');
}

export function decodeStairs(encoded: string): StairsSpec | null {
  const parts = encoded.split('|');
  if (parts.length < 4) return null;
  const [uid, nodesPart, flightsPart, optionsPart] = parts;
  const nodes = nodesPart.split(';').filter(Boolean).map((item) => { const [x, y, z] = item.split(',').map(Number); return { x, y, z }; });
  if (!uid || !nodes.length || nodes.some((node) => ![node.x, node.y, node.z].every(Number.isFinite))) return null;
  const optionalNumber = (text: string) => (text === '' ? undefined : Number(text));
  const flights = flightsPart.split(';').filter(Boolean).map((item) => {
    const [from, to, steps, width] = item.split(',');
    const flight: StairsFlight = { from: Number(from), to: Number(to) };
    if (optionalNumber(steps ?? '') !== undefined) flight.steps = optionalNumber(steps);
    if (optionalNumber(width ?? '') !== undefined) flight.width = optionalNumber(width);
    return flight;
  }).filter((flight) => Number.isInteger(flight.from) && Number.isInteger(flight.to) && flight.from < nodes.length && flight.to < nodes.length && flight.from !== flight.to);
  const options: StairsOptions = { ...DEFAULT_STAIRS };
  for (const kv of optionsPart.split(';')) {
    const i = kv.indexOf('=');
    if (i < 0) continue;
    const key = kv.slice(0, i) as keyof StairsOptions, value = kv.slice(i + 1);
    if (!OPTION_KEYS.includes(key)) continue;
    const fallback = DEFAULT_STAIRS[key];
    (options as unknown as Record<string, unknown>)[key] = typeof fallback === 'boolean' ? value === '1' : typeof fallback === 'number' ? Number(value) || fallback : value;
  }
  return { uid, nodes, flights, options };
}

/** A fresh short id for new stairs. */
export const newStairsUid = (): string => Math.random().toString(36).slice(2, 8);

export { NODRAW };
