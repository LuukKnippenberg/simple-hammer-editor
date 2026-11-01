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

/**
 * Lays out a city block: a ring of buildings around a courtyard when the block is large enough, otherwise
 * a row of lots, some of them L-shaped around a back yard. Buildings on the block's corners get cut or
 * rounded corners and an extra floor; yards and courtyards get low annexes and walls with gateways.
 */
export function planBlock(area: Box2, rng: Rng, o: PlanOptions): BlockPlan {
  const out: BlockPlan = { buildings: [], walls: [], lots: [], yards: [], sheds: [] };
  const size = area.getSize(new Vector2());
  if (size.x < 128 || size.y < 128) return out;
  const blockCorners = rectPoly(area);
  let slot = 0;
  const floorsFor = (corner: boolean) => Math.min(o.maxFloors, rng.int(o.minFloors, o.maxFloors) + (corner && rng.chance(0.6) ? 1 : 0));

  /** A rectangular lot as a building; corners of the block it touches get shaped. */
  const addLot = (box: Box2, floors: number, extra: Part[] = []) => {
    let poly = rectPoly(box);
    const cornerEdges: number[] = [];
    let corner: StreetCorner | undefined;
    // Shape at most one corner per building (the reference buildings turn one street corner).
    const touching = poly.map((p, i) => ({ p, i })).filter(({ p }) => blockCorners.some((c) => c.equals(p)));
    const bsize = box.getSize(new Vector2());
    if (touching.length && Math.min(bsize.x, bsize.y) >= 256) {
      const { p, i } = rng.pick(touching);
      const shape: CornerShape = o.corners === 'mixed' ? rng.pick(['square', 'chamfer', 'chamfer', 'round', 'round'] as const) : o.corners;
      const room = Math.min(bsize.x, bsize.y) - 128;
      const sizeFor = shape === 'round' ? Math.min(room, rng.pick([128, 192, 256])) : Math.min(room, rng.pick([64, 128]));
      const inward = new Vector2(Math.sign(box.getCenter(new Vector2()).x - p.x), Math.sign(box.getCenter(new Vector2()).y - p.y));
      if (sizeFor >= 64) {
        const r = shapeCorner(poly, i, shape, sizeFor);
        poly = r.poly;
        cornerEdges.push(...r.edges);
        corner = { shape, at: p.clone(), inward, size: shape === 'square' ? 0 : sizeFor };
      }
    }
    out.buildings.push({ parts: [{ poly, floors, kind: 'main', cornerEdges, corner }, ...extra], styleSlot: slot++ });
    out.lots.push({ box, floors });
  };

  const annex = (box: Box2): Part => ({ poly: rectPoly(box), floors: rng.int(1, 2), kind: 'annex', cornerEdges: [] });

  const minSide = Math.min(size.x, size.y);
  if (!o.single && o.courtyards && minSide >= 896 && rng.chance(0.8)) {
    // Perimeter block: corner buildings, lots along each side, a courtyard in the middle.
    const depth = Math.min(rng.pick([256, 320, 384]), snap((minSide - 256) / 2));
    const inner = new Box2(area.min.clone().addScalar(depth), area.max.clone().subScalar(depth));
    const corners = [
      new Box2(area.min.clone(), inner.min.clone()),
      new Box2(new Vector2(inner.max.x, area.min.y), new Vector2(area.max.x, inner.min.y)),
      new Box2(inner.max.clone(), area.max.clone()),
      new Box2(new Vector2(area.min.x, inner.max.y), new Vector2(inner.min.x, area.max.y)),
    ];
    out.ring = true;
    for (const c of corners) addLot(c, floorsFor(true));
    out.yards.push(inner.clone());
    const sides: Box2[][] = [
      splitSpan(inner.min.x, inner.max.x, rng, 192, 640).map((x, i, xs) => xs[i + 1] === undefined ? null : new Box2(new Vector2(x, area.min.y), new Vector2(xs[i + 1], inner.min.y))).filter((b): b is Box2 => !!b),
      splitSpan(inner.min.x, inner.max.x, rng, 192, 640).map((x, i, xs) => xs[i + 1] === undefined ? null : new Box2(new Vector2(x, inner.max.y), new Vector2(xs[i + 1], area.max.y))).filter((b): b is Box2 => !!b),
      splitSpan(inner.min.y, inner.max.y, rng, 192, 640).map((y, i, ys) => ys[i + 1] === undefined ? null : new Box2(new Vector2(area.min.x, y), new Vector2(inner.min.x, ys[i + 1]))).filter((b): b is Box2 => !!b),
      splitSpan(inner.min.y, inner.max.y, rng, 192, 640).map((y, i, ys) => ys[i + 1] === undefined ? null : new Box2(new Vector2(inner.max.x, y), new Vector2(area.max.x, ys[i + 1]))).filter((b): b is Box2 => !!b),
    ];
    // One lot on a random side becomes a wall with a gateway into the courtyard.
    // A wall between two buildings, or between the two corner buildings when a side holds one lot.
    const gateSides = [0, 1, 2, 3].filter((s) => sides[s].some((b) => Math.max(b.max.x - b.min.x, b.max.y - b.min.y) >= 256));
    const gateSide = gateSides.length ? rng.pick(gateSides) : -1;
    const gateLots = gateSide >= 0 ? sides[gateSide].map((b, i) => ({ b, i })).filter(({ b }) => Math.max(b.max.x - b.min.x, b.max.y - b.min.y) >= 256) : [];
    const gateLot = gateLots.length && (o.alleys || rng.chance(0.75)) ? rng.pick(gateLots).i : -1;
    sides.forEach((lots, s) => lots.forEach((box, i) => {
      if (s === gateSide && i === gateLot) {
        // The wall stands on the street line.
        const a = s === 0 ? new Vector2(box.min.x, box.min.y + 8) : s === 1 ? new Vector2(box.min.x, box.max.y - 8) : s === 2 ? new Vector2(box.min.x + 8, box.min.y) : new Vector2(box.max.x - 8, box.min.y);
        const b = s === 0 ? new Vector2(box.max.x, box.min.y + 8) : s === 1 ? new Vector2(box.max.x, box.max.y - 8) : s === 2 ? new Vector2(box.min.x + 8, box.max.y) : new Vector2(box.max.x - 8, box.max.y);
        out.walls.push({ a, b, height: 192, gate: true });
        return;
      }
      // An open lot: the courtyard reaches the street there.
      if (o.openings && rng.chance(o.openings)) { out.yards.push(box.clone()); return; }
      addLot(box, floorsFor(false));
    }));
    if (o.annexes) {
      // Sheds against the courtyard walls.
      const n = rng.int(1, 3);
      const isize = inner.getSize(new Vector2());
      const sheds: Box2[] = [];
      for (let k = 0; k < n && isize.x >= 384 && isize.y >= 384; k++) {
        const w = rng.pick([128, 192, 256]), d = rng.pick([128, 192]);
        const side = rng.int(0, 3);
        const along = snap(rng.range(0, (side < 2 ? isize.x : isize.y) - w));
        const box = side === 0 ? new Box2(new Vector2(inner.min.x + along, inner.min.y), new Vector2(inner.min.x + along + w, inner.min.y + d))
          : side === 1 ? new Box2(new Vector2(inner.min.x + along, inner.max.y - d), new Vector2(inner.min.x + along + w, inner.max.y))
            : side === 2 ? new Box2(new Vector2(inner.min.x, inner.min.y + along), new Vector2(inner.min.x + d, inner.min.y + along + w))
              : new Box2(new Vector2(inner.max.x - d, inner.min.y + along), new Vector2(inner.max.x, inner.min.y + along + w));
        // Touching is fine (a row of sheds), overlapping is not.
        const overlaps = sheds.some((s) => Math.min(s.max.x, box.max.x) > Math.max(s.min.x, box.min.x) && Math.min(s.max.y, box.max.y) > Math.max(s.min.y, box.min.y));
        if (overlaps) continue;
        sheds.push(box);
        out.sheds.push(box);
        out.buildings.push({ parts: [annex(box)], styleSlot: slot++ });
      }
    }
    return out;
  }

  // Row block: lots along the long axis.
  const axis = size.x >= size.y ? 'x' : 'y';
  const other = axis === 'x' ? 'y' : 'x';
  const cuts = o.single ? [area.min[axis], area.max[axis]] : splitSpan(area.min[axis], area.max[axis], rng, 256, 768);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const box = area.clone();
    box.min[axis] = cuts[i];
    box.max[axis] = cuts[i + 1];
    if (o.alleys) {
      // A 64-unit alley between lots (outer edges stay flush with the block).
      if (box.min[axis] > area.min[axis]) box.min[axis] += 32;
      if (box.max[axis] < area.max[axis]) box.max[axis] -= 32;
    }
    const bsize = box.getSize(new Vector2());
    if (bsize.x < 128 || bsize.y < 128) continue;
    const corner = i === 0 || i + 2 === cuts.length;
    const floors = floorsFor(corner);
    const deep = bsize[other] >= 448 && bsize[axis] >= 320;
    if (deep && o.single !== 'house' && rng.chance(0.55)) {
      // L shape: the front range along one street, a wing along one side, a yard in the back corner.
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
        extra.push(annex(shed));
        out.sheds.push(shed);
      }
      addLot(front, floors, extra);
    } else {
      addLot(box, floors);
    }
  }
  return out;
}

export { FLOOR };
