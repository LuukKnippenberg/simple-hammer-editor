import { Box2, Vector2 } from 'three';
import { Rng } from './rng.ts';
import { FLOOR, cleanPolygon } from './facade.ts';

export type CornerShape = 'square' | 'chamfer' | 'round';
export type CornerOption = CornerShape | 'mixed';

/** One convex wing of a building: a prism from the ground to its own number of floors. */
export interface Part {
  /** Footprint, counter-clockwise, whole units. */
  poly: Vector2[];
  floors: number;
  kind: 'main' | 'annex';
  /** Edge indices of shaped corners (cut or rounded faces), which get an entrance on the ground floor. */
  cornerEdges: number[];
  /** The block corner this building turns, if any: where a corner tower can stand. */
  corner?: StreetCorner;
}

export interface StreetCorner {
  shape: CornerShape;
  /** The original (square) corner point. */
  at: Vector2;
  /** Unit steps from the corner into the building along x and y (±1). */
  inward: Vector2;
  /** Cut leg or rounding radius (0 for square). */
  size: number;
}

export interface BuildingPlan {
  parts: Part[];
  /** Index into the block's style rotation, so neighbours differ. */
  styleSlot: number;
}

/** A free-standing wall (courtyard closure), with an optional gateway in the middle. */
export interface WallPlan {
  a: Vector2;
  b: Vector2;
  height: number;
  gate: boolean;
}

export interface BlockPlan {
  buildings: BuildingPlan[];
  walls: WallPlan[];
  /** Rectangles of the main buildings, for sky bridges between neighbours. */
  lots: { box: Box2; floors: number }[];
  /** Open courtyards and back yards, and the sheds standing in them. */
  yards: Box2[];
  sheds: Box2[];
  /** A perimeter block: a ring of buildings around a courtyard. */
  ring?: boolean;
}

export interface PlanOptions {
  minFloors: number;
  maxFloors: number;
  alleys: boolean;
  corners: CornerOption;
  courtyards: boolean;
  annexes: boolean;
  /** Share of a ring's side lots left open (0–1), so the courtyard opens onto the street (default 0). */
  openings?: number;
  /**
   * One building on the whole lot instead of a block: `building` may still be an L round a back yard,
   * `house` is a plain rectangle (for an enterable house).
   */
  single?: 'building' | 'house';
}

const G = 64;
const snap = (x: number) => Math.round(x / G) * G;

/** Counter-clockwise rectangle. */
export function rectPoly(b: Box2): Vector2[] {
  return [new Vector2(b.min.x, b.min.y), new Vector2(b.max.x, b.min.y), new Vector2(b.max.x, b.max.y), new Vector2(b.min.x, b.max.y)];
}

/**
 * Replaces corner `i` of a convex polygon with a 45° cut of leg `size` or a quarter-round of radius `size`
 * (segments about one 64-unit window bay long). Returns the new polygon and the edges that form the corner.
 */
export function shapeCorner(poly: Vector2[], i: number, shape: CornerShape, size: number): { poly: Vector2[]; edges: number[] } {
  if (shape === 'square') return { poly, edges: [] };
  const n = poly.length;
  const c = poly[i], prev = poly[(i + n - 1) % n], next = poly[(i + 1) % n];
  const toPrev = new Vector2().subVectors(prev, c).normalize();
  const toNext = new Vector2().subVectors(next, c).normalize();
  const p1 = c.clone().addScaledVector(toPrev, size);
  const p2 = c.clone().addScaledVector(toNext, size);
  let pts: Vector2[];
  if (shape === 'chamfer') pts = [p1, p2];
  else {
    // Arc centre: inside the corner, `size` from both edges (corners here are right angles).
    const centre = c.clone().addScaledVector(toPrev, size).addScaledVector(toNext, size);
    const a0 = Math.atan2(p1.y - centre.y, p1.x - centre.x);
    let a1 = Math.atan2(p2.y - centre.y, p2.x - centre.x);
    // Counter-clockwise from p1 to p2.
    while (a1 < a0) a1 += Math.PI * 2;
    const segs = Math.max(2, Math.round(((a1 - a0) * size) / G));
    pts = [];
    for (let k = 0; k <= segs; k++) {
      const t = a0 + ((a1 - a0) * k) / segs;
      pts.push(new Vector2(centre.x + Math.cos(t) * size, centre.y + Math.sin(t) * size));
    }
  }
  const out = cleanPolygon([...poly.slice(0, i), ...pts, ...poly.slice(i + 1)]);
  // Edges whose both ends lie on the new corner points.
  const isCorner = (p: Vector2) => pts.some((q) => Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1);
  const edges: number[] = [];
  out.forEach((p, k) => { if (isCorner(p) && isCorner(out[(k + 1) % out.length])) edges.push(k); });
  return { poly: out, edges };
}

/** Splits [a, b] into pieces between `min` and `max` long on the 64-unit grid. */
function splitSpan(a: number, b: number, rng: Rng, min: number, max: number): number[] {
  const len = b - a;
  if (len <= max || len < min * 2) return [a, b];
  const cut = a + snap(rng.range(min, len - min));
  const at = Math.min(b - min, Math.max(a + min, cut));
  return [...splitSpan(a, at, rng, min, max).slice(0, -1), ...splitSpan(at, b, rng, min, max)];
}

/** Lots and blocks narrower than this are not built on. */
const MIN_LOT = 128;
/** A building shapes its block corner only when both its sides are at least this long. */
const MIN_SHAPED_LOT = 256;
/** What a shaped corner leaves of the lot's shorter side. */
const CORNER_ROOM = 128;
/** A block whose shorter side is at least this long can be a ring of buildings around a courtyard. */
const MIN_RING_SIDE = 896;
/** Lot lengths along a ring's sides, and along a row block. */
const RING_LOT_MIN = 192, RING_LOT_MAX = 640;
const ROW_LOT_MIN = 256, ROW_LOT_MAX = 768;
/** A ring lot at least this long can be a wall with a gateway (the gateway is 128 wide). */
const MIN_GATE_LOT = 256;
const COURT_WALL_HEIGHT = 192;
/** A courtyard gets sheds when both its sides are at least this long. */
const MIN_SHED_COURT = 384;
/** Half of the 64-unit alley between row lots. */
const HALF_ALLEY = 32;
/** A row lot is deep enough for an L (front range, wing, back yard) from these sizes across and along the row. */
const L_MIN_DEPTH = 448, L_MIN_WIDTH = 320;

const floorsFor = (rng: Rng, o: PlanOptions, corner: boolean) => Math.min(o.maxFloors, rng.int(o.minFloors, o.maxFloors) + (corner && rng.chance(0.6) ? 1 : 0));

const annex = (rng: Rng, box: Box2): Part => ({ poly: rectPoly(box), floors: rng.int(1, 2), kind: 'annex', cornerEdges: [] });

/** A rectangular lot's footprint, with at most one block corner it touches cut or rounded. */
function shapedLot(area: Box2, box: Box2, rng: Rng, corners: CornerOption): { poly: Vector2[]; cornerEdges: number[]; corner?: StreetCorner } {
  const poly = rectPoly(box);
  const blockCorners = rectPoly(area);
  // Shape at most one corner per building (the reference buildings turn one street corner).
  const touching = poly.map((p, i) => ({ p, i })).filter(({ p }) => blockCorners.some((c) => c.equals(p)));
  const bsize = box.getSize(new Vector2());
  if (!touching.length || Math.min(bsize.x, bsize.y) < MIN_SHAPED_LOT) return { poly, cornerEdges: [] };
  const { p, i } = rng.pick(touching);
  const shape: CornerShape = corners === 'mixed' ? rng.pick(['square', 'chamfer', 'chamfer', 'round', 'round'] as const) : corners;
  const room = Math.min(bsize.x, bsize.y) - CORNER_ROOM;
  const sizeFor = shape === 'round' ? Math.min(room, rng.pick([128, 192, 256])) : Math.min(room, rng.pick([64, 128]));
  const inward = new Vector2(Math.sign(box.getCenter(new Vector2()).x - p.x), Math.sign(box.getCenter(new Vector2()).y - p.y));
  if (sizeFor < G) return { poly, cornerEdges: [] };
  const r = shapeCorner(poly, i, shape, sizeFor);
  return { poly: r.poly, cornerEdges: [...r.edges], corner: { shape, at: p.clone(), inward, size: shape === 'square' ? 0 : sizeFor } };
}

/** A rectangular lot as a building; corners of the block it touches get shaped. */
function addLot(out: BlockPlan, area: Box2, rng: Rng, o: PlanOptions, box: Box2, floors: number, extra: Part[] = []): void {
  const { poly, cornerEdges, corner } = shapedLot(area, box, rng, o.corners);
  out.buildings.push({ parts: [{ poly, floors, kind: 'main', cornerEdges, corner }, ...extra], styleSlot: out.buildings.length });
  out.lots.push({ box, floors });
}

/** The boxes between consecutive cuts. */
const between = (cuts: number[], box: (lo: number, hi: number) => Box2) => cuts.slice(0, -1).map((c, i) => box(c, cuts[i + 1]));

/** The lots along a ring's four sides (bottom, top, left, right), between the corner buildings. */
function ringSides(area: Box2, inner: Box2, rng: Rng): Box2[][] {
  const xs = () => splitSpan(inner.min.x, inner.max.x, rng, RING_LOT_MIN, RING_LOT_MAX);
  const ys = () => splitSpan(inner.min.y, inner.max.y, rng, RING_LOT_MIN, RING_LOT_MAX);
  return [
    between(xs(), (x0, x1) => new Box2(new Vector2(x0, area.min.y), new Vector2(x1, inner.min.y))),
    between(xs(), (x0, x1) => new Box2(new Vector2(x0, inner.max.y), new Vector2(x1, area.max.y))),
    between(ys(), (y0, y1) => new Box2(new Vector2(area.min.x, y0), new Vector2(inner.min.x, y1))),
    between(ys(), (y0, y1) => new Box2(new Vector2(inner.max.x, y0), new Vector2(area.max.x, y1))),
  ];
}

/**
 * Which lot of a ring becomes a wall with a gateway into the courtyard: one on a random side, between two
 * buildings, or between the two corner buildings when a side holds one lot. -1 for none.
 */
function chooseGate(sides: Box2[][], rng: Rng, alleys: boolean): { side: number; lot: number } {
  const long = (b: Box2) => Math.max(b.max.x - b.min.x, b.max.y - b.min.y) >= MIN_GATE_LOT;
  const gateSides = [0, 1, 2, 3].filter((s) => sides[s].some(long));
  const side = gateSides.length ? rng.pick(gateSides) : -1;
  const gateLots = side >= 0 ? sides[side].map((b, i) => ({ b, i })).filter(({ b }) => long(b)) : [];
  const lot = gateLots.length && (alleys || rng.chance(0.75)) ? rng.pick(gateLots).i : -1;
  return { side, lot };
}

/** The courtyard wall with a gateway on lot `box` of ring side `side`, standing on the street line. */
function gateWall(box: Box2, side: number): WallPlan {
  const [a, b] = [
    [new Vector2(box.min.x, box.min.y + 8), new Vector2(box.max.x, box.min.y + 8)],
    [new Vector2(box.min.x, box.max.y - 8), new Vector2(box.max.x, box.max.y - 8)],
    [new Vector2(box.min.x + 8, box.min.y), new Vector2(box.min.x + 8, box.max.y)],
    [new Vector2(box.max.x - 8, box.min.y), new Vector2(box.max.x - 8, box.max.y)],
  ][side];
  return { a, b, height: COURT_WALL_HEIGHT, gate: true };
}

/** A shed `w` along and `d` deep against courtyard wall `side` (bottom, top, left, right), `along` from its start. */
function shedBox(inner: Box2, side: number, along: number, w: number, d: number): Box2 {
  const { min, max } = inner;
  if (side === 0) return new Box2(new Vector2(min.x + along, min.y), new Vector2(min.x + along + w, min.y + d));
  if (side === 1) return new Box2(new Vector2(min.x + along, max.y - d), new Vector2(min.x + along + w, max.y));
  if (side === 2) return new Box2(new Vector2(min.x, min.y + along), new Vector2(min.x + d, min.y + along + w));
  return new Box2(new Vector2(max.x - d, min.y + along), new Vector2(max.x, min.y + along + w));
}

/** Sheds against the courtyard walls; touching is fine (a row of sheds), overlapping is not. */
function courtyardSheds(out: BlockPlan, inner: Box2, rng: Rng): void {
  const n = rng.int(1, 3);
  const isize = inner.getSize(new Vector2());
  const sheds: Box2[] = [];
  for (let k = 0; k < n && isize.x >= MIN_SHED_COURT && isize.y >= MIN_SHED_COURT; k++) {
    const w = rng.pick([128, 192, 256]), d = rng.pick([128, 192]);
    const side = rng.int(0, 3);
    const along = snap(rng.range(0, (side < 2 ? isize.x : isize.y) - w));
    const box = shedBox(inner, side, along, w, d);
    const overlaps = sheds.some((s) => Math.min(s.max.x, box.max.x) > Math.max(s.min.x, box.min.x) && Math.min(s.max.y, box.max.y) > Math.max(s.min.y, box.min.y));
    if (overlaps) continue;
    sheds.push(box);
    out.sheds.push(box);
    out.buildings.push({ parts: [annex(rng, box)], styleSlot: out.buildings.length });
  }
}

/** Perimeter block: corner buildings, lots along each side, a courtyard in the middle. */
function planRing(out: BlockPlan, area: Box2, rng: Rng, o: PlanOptions, minSide: number): void {
  const depth = Math.min(rng.pick([256, 320, 384]), snap((minSide - 256) / 2));
  const inner = new Box2(area.min.clone().addScalar(depth), area.max.clone().subScalar(depth));
  const corners = [
    new Box2(area.min.clone(), inner.min.clone()),
    new Box2(new Vector2(inner.max.x, area.min.y), new Vector2(area.max.x, inner.min.y)),
    new Box2(inner.max.clone(), area.max.clone()),
    new Box2(new Vector2(area.min.x, inner.max.y), new Vector2(inner.min.x, area.max.y)),
  ];
  out.ring = true;
  for (const c of corners) addLot(out, area, rng, o, c, floorsFor(rng, o, true));
  out.yards.push(inner.clone());
  const sides = ringSides(area, inner, rng);
  const gate = chooseGate(sides, rng, o.alleys);
  sides.forEach((lots, s) => lots.forEach((box, i) => {
    if (s === gate.side && i === gate.lot) { out.walls.push(gateWall(box, s)); return; }
    // An open lot: the courtyard reaches the street there.
    if (o.openings && rng.chance(o.openings)) { out.yards.push(box.clone()); return; }
    addLot(out, area, rng, o, box, floorsFor(rng, o, false));
  }));
  if (o.annexes) courtyardSheds(out, inner, rng);
}

/** An L-shaped lot: the front range along one street, a wing along one side, a yard (maybe with a shed) in the back corner. */
function addLShapedLot(out: BlockPlan, area: Box2, rng: Rng, o: PlanOptions, box: Box2, axis: 'x' | 'y', floors: number): void {
  const other = axis === 'x' ? 'y' : 'x';
  const bsize = box.getSize(new Vector2());
  const front = box.clone(), wing = box.clone(), yard = box.clone();
  const frontDepth = rng.pick([256, 320]);
  const fromMin = rng.chance(0.5);
  if (fromMin) front.max[other] = box.min[other] + frontDepth;
  else front.min[other] = box.max[other] - frontDepth;
  const wingWidth = Math.min(bsize[axis] - 128, rng.pick([128, 192, 256]));
  const wingAtMin = rng.chance(0.5);
  if (fromMin) { wing.min[other] = front.max[other]; yard.min[other] = front.max[other]; }
  else { wing.max[other] = front.min[other]; yard.max[other] = front.min[other]; }
  if (wingAtMin) { wing.max[axis] = box.min[axis] + wingWidth; yard.min[axis] = wing.max[axis]; }
  else { wing.min[axis] = box.max[axis] - wingWidth; yard.max[axis] = wing.min[axis]; }
  const extra: Part[] = [{ poly: rectPoly(wing), floors: Math.max(1, floors - rng.int(0, 1)), kind: 'main', cornerEdges: [] }];
  const ysize = yard.getSize(new Vector2());
  out.yards.push(yard.clone());
  if (o.annexes && ysize.x >= 192 && ysize.y >= 192 && rng.chance(0.6)) {
    const shed = yard.clone();
    shed.max[axis] = Math.min(yard.max[axis], yard.min[axis] + rng.pick([128, 192]));
    if (fromMin) shed.min[other] = shed.max[other] - 128; else shed.max[other] = shed.min[other] + 128;
    extra.push(annex(rng, shed));
    out.sheds.push(shed);
  }
  addLot(out, area, rng, o, front, floors, extra);
}

/** Row block: lots along the long axis, some of them L-shaped. */
function planRow(out: BlockPlan, area: Box2, rng: Rng, o: PlanOptions): void {
  const size = area.getSize(new Vector2());
  const axis = size.x >= size.y ? 'x' : 'y';
  const other = axis === 'x' ? 'y' : 'x';
  const cuts = o.single ? [area.min[axis], area.max[axis]] : splitSpan(area.min[axis], area.max[axis], rng, ROW_LOT_MIN, ROW_LOT_MAX);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const box = area.clone();
    box.min[axis] = cuts[i];
    box.max[axis] = cuts[i + 1];
    if (o.alleys) {
      // Outer edges stay flush with the block.
      if (box.min[axis] > area.min[axis]) box.min[axis] += HALF_ALLEY;
      if (box.max[axis] < area.max[axis]) box.max[axis] -= HALF_ALLEY;
    }
    const bsize = box.getSize(new Vector2());
    if (bsize.x < MIN_LOT || bsize.y < MIN_LOT) continue;
    const floors = floorsFor(rng, o, i === 0 || i + 2 === cuts.length);
    const deep = bsize[other] >= L_MIN_DEPTH && bsize[axis] >= L_MIN_WIDTH;
    if (deep && o.single !== 'house' && rng.chance(0.55)) addLShapedLot(out, area, rng, o, box, axis, floors);
    else addLot(out, area, rng, o, box, floors);
  }
}

/**
 * Lays out a city block: a ring of buildings around a courtyard when the block is large enough, otherwise
 * a row of lots, some of them L-shaped around a back yard. Buildings on the block's corners get cut or
 * rounded corners and an extra floor; yards and courtyards get low annexes and walls with gateways.
 */
export function planBlock(area: Box2, rng: Rng, o: PlanOptions): BlockPlan {
  const out: BlockPlan = { buildings: [], walls: [], lots: [], yards: [], sheds: [] };
  const size = area.getSize(new Vector2());
  if (size.x < MIN_LOT || size.y < MIN_LOT) return out;
  const minSide = Math.min(size.x, size.y);
  if (!o.single && o.courtyards && minSide >= MIN_RING_SIDE && rng.chance(0.8)) planRing(out, area, rng, o, minSide);
  else planRow(out, area, rng, o);
  return out;
}

export { FLOOR };
