import { Box2, Vector2 } from 'three';
import { Rng } from './rng.ts';

/**
 * Floor plans for open-top interior houses (docs/interior-buildings-plan.md): rooms on the 64 grid, walls
 * with door and window openings, entrances, stairs and an upper floor. Pure data; `interiorShell.ts` turns
 * it into brushes. Heights are measured from the house's ground level z0.
 */

/** One storey. The upper floor's slab top is one storey above the ground floor's. */
export const STOREY = 128;
/** Top of the ground floor slab: units step up 8 from the terrain (max climb 18). */
export const FLOOR_TOP = 8;
export const EXTERIOR_WALL = 16;
export const PARTITION = 8;
/** Width of the clear paths between doors that furniture must not block. */
export const LANE = 48;
/** Depth of the clear zone in front of every door, on both sides. */
export const DOOR_ZONE = 64;
const G = 64;
/** Openings keep this far from wall ends and from walls joining this one. */
const DOOR_MARGIN = 16;
const WINDOW_MARGIN = 32;
const EPS = 0.01;
/** Wall height above z0 unless `InteriorPlanOptions.cut` says otherwise. */
const DEFAULT_CUT = 112;
/** Smallest room side, and with wide doors (room for the large hulls). */
const MIN_ROOM = 128;
const MIN_ROOM_WIDE = 192;
/** Door widths: narrow, normal, and every door with wide doors. */
const DOOR_NARROW = 64;
const DOOR = 96;
const DOOR_WIDE = 128;
/** Door heights above the floor, normal and with wide doors. */
const DOOR_HEIGHT = 96;
const DOOR_HEIGHT_WIDE = 112;
/** Width of the open archways between hall, living room and kitchen. */
const GAP_WIDTH = 160;
/** Window sill and lintel above the storey's base. */
const WINDOW_SILL = 40;
const WINDOW_LINTEL = 96;
/** Window widths (one per house), the wall between two windows, and the wall length per window. */
const WINDOW_WIDTHS = [64, 96];
const WINDOW_GAP = 32;
const WINDOW_SPACINGS = [128, 160, 192];
/** Stairs: 8 steps of 16 rise one storey (units climb at most 18), on 24 deep treads. */
const STAIR_STEPS = 8;
const STAIR_RISE = 16;
const STAIR_TREAD = 24;
const STAIR_RUN = STAIR_STEPS * STAIR_TREAD; // 192
/** Flight widths, normal and with wide doors. */
const STAIR_WIDTH = 96;
const STAIR_WIDTH_WIDE = 128;
/** The flight's foot point lies this far in front of the lowest step, its head point this far past the top step. */
const STAIR_FOOT = 32;
const STAIR_HEAD = 40;
/**
 * Length the open part beside the upper floor needs along the flight: half the partition at the boundary, the
 * flight, a grid cell of floor in front of it, the far outside wall and 32 to spare.
 */
const STAIR_OPEN_LENGTH = PARTITION / 2 + STAIR_RUN + G + EXTERIOR_WALL + 32;
/** Rooms split by chance: never below SPLIT_MIN_AREA, always above SPLIT_MAX_AREA; a SPLIT_LENGTH wing always once. */
const SPLIT_MIN_AREA = 160 * 160;
const SPLIT_MAX_AREA = 320 * 320;
const SPLIT_LENGTH = 384;
/** Houses longer than this get a second entrance. */
const LONG_HOUSE = 384;
/** A front room this narrow is a hall (in a house of three rooms or more). */
const HALL_WIDTH = 192;
/** The kitchen is the room nearest this size; a bath at most BATH_MAX_AREA (the last free room only up to LAST_BATH_AREA). */
const KITCHEN_AREA = 192 * 192;
const BATH_MAX_AREA = 256 * 256;
const LAST_BATH_AREA = 160 * 192;
/** Leftover rooms this big are bedrooms, smaller ones storage. */
const BEDROOM_AREA = 128 * 192;
/** Porch depths, and how far the porch reaches past the main door on each side. */
const PORCH_DEPTHS = [64, 96];
const PORCH_OVERHANGS = [32, 64, 96];

export type RoomType = 'hall' | 'living' | 'kitchen' | 'bedroom' | 'bath' | 'storage' | 'workshop';

export interface Room {
  /** Rectangle on the grid, measured to the wall centre lines (exterior walls: the footprint edge). */
  box: Box2;
  type: RoomType;
  storey: 1 | 2;
  /**
   * A ground room under the upper floor: the RTS camera can't see into it, so no unit may enter it. Its
   * doorways are closed off (see `Opening.blocked`) and it stays empty.
   */
  sealed?: boolean;
}

export type OpeningKind = 'door' | 'window' | 'gap';

/** How a doorway into a sealed room is closed off: a closed door, boards nailed across, or furniture pushed against it. */
export type Blocker = 'door' | 'boarded' | 'furniture';

export interface Opening {
  /** Distances along the wall from `a`. */
  from: number;
  to: number;
  kind: OpeningKind;
  /** Bottom and top of the hole above z0 (a gap or door with its lintel at the wall top has none). */
  sill: number;
  lintel: number;
  /** A doorway into a sealed room, closed off: units can't pass it. */
  blocked?: Blocker;
}

export interface PlanWall {
  /** Centre line, axis-aligned, `a` before `b` along the axis. */
  a: Vector2;
  b: Vector2;
  axis: 'x' | 'y';
  thickness: number;
  exterior: boolean;
  storey: 1 | 2;
  /** Rooms on the left and right of a→b (-1: outside). */
  left: number;
  right: number;
  /** Bottom and top above z0. */
  bottom: number;
  top: number;
  openings: Opening[];
}

export interface Entrance {
  wall: number;
  opening: number;
  /** Middle of the doorway on the outer face, and the outward direction. */
  centre: Vector2;
  out: Vector2;
  room: number;
}

export interface Stairs {
  /** Footprint of the flight (treads and stringer). */
  box: Box2;
  /** Unit direction the flight rises in. */
  dir: Vector2;
  /** Points in front of the lowest step and on the upper floor past the top step. */
  foot: Vector2;
  head: Vector2;
  room: number;
  steps: number;
  rise: number;
  tread: number;
  width: number;
}

export interface InteriorPlan {
  footprint: Vector2[];
  storeys: 1 | 2;
  cut: number;
  rooms: Room[];
  walls: PlanWall[];
  entrances: Entrance[];
  /** A deck strip in front of the main door. */
  porch?: Box2;
  stairs?: Stairs;
  /** The part of the house with a second storey (outer rectangle). */
  upperFloor?: Box2;
  /** Paths between doors (and stairs) through each room, `LANE` wide. */
  lanes: Box2[];
  /** `DOOR_ZONE` deep on both sides of every door and gap. */
  doorZones: Box2[];
  /** Areas that must stay free of furniture besides lanes and door zones (the stairs and their foot). */
  keepClear: Box2[];
}

export interface InteriorPlanOptions {
  storeys?: 1 | 2;
  /** Wall height above z0 (default 112). */
  cut?: number;
  /** 128-wide doors for the large hulls (rooms get at least 192). */
  wideDoors?: boolean;
  /** Footprint edges (edge i runs from footprint[i] to footprint[i+1]) that must get an entrance. */
  entranceEdges?: number[];
  /** A deck in front of the main door (default: half of the houses). */
  porch?: boolean;
  /** Room types: a dwelling, or workshop and storage rooms (default house). */
  use?: 'house' | 'workshop';
  /** Areas next to the house where no entrance may open (neighbouring buildings). */
  noEntrance?: Box2[];
}

type Axis = 'x' | 'y';
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');

/** Grid lines through the polygon's corners, every 64 units between them (the last cell takes the rest). */
function gridLines(values: number[]): number[] {
  const v = [...new Set(values.map((x) => Math.round(x)))].sort((a, b) => a - b);
  const out: number[] = [v[0]];
  for (let k = 0; k + 1 < v.length; k++) {
    let x = v[k] + G;
    while (v[k + 1] - x >= G) { out.push(x); x += G; }
    out.push(v[k + 1]);
  }
  return out;
}

function pointInPolygon(poly: Vector2[], p: Vector2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A rectangle of grid cells [i0, i1) × [j0, j1). */
interface CellRect { i0: number; i1: number; j0: number; j1: number }

class Grid {
  readonly nx: number;
  readonly ny: number;
  readonly room: Int32Array;
  readonly inside: boolean[];
  constructor(readonly xs: number[], readonly ys: number[], poly: Vector2[]) {
    this.nx = xs.length - 1;
    this.ny = ys.length - 1;
    this.room = new Int32Array(this.nx * this.ny).fill(-1);
    this.inside = [];
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      this.inside.push(pointInPolygon(poly, new Vector2((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)));
    }
  }
  isIn(i: number, j: number): boolean { return i >= 0 && j >= 0 && i < this.nx && j < this.ny && this.inside[j * this.nx + i]; }
  roomOf(i: number, j: number): number { return i >= 0 && j >= 0 && i < this.nx && j < this.ny ? this.room[j * this.nx + i] : -1; }
  cellAt(p: Vector2): [number, number] {
    const find = (lines: number[], v: number) => {
      if (v < lines[0] || v >= lines[lines.length - 1]) return -1;
      let k = 0;
      while (k + 1 < lines.length && lines[k + 1] <= v) k++;
      return k;
    };
    return [find(this.xs, p.x), find(this.ys, p.y)];
  }
  roomAt(p: Vector2): number { const [i, j] = this.cellAt(p); return i < 0 || j < 0 ? -1 : this.roomOf(i, j); }
  inAt(p: Vector2): boolean { const [i, j] = this.cellAt(p); return i >= 0 && j >= 0 && this.isIn(i, j); }
  box(r: CellRect): Box2 { return new Box2(new Vector2(this.xs[r.i0], this.ys[r.j0]), new Vector2(this.xs[r.i1], this.ys[r.j1])); }
}

const cellsRect = (cs: [number, number][]): CellRect | null => {
  if (!cs.length) return null;
  const i0 = Math.min(...cs.map((c) => c[0])), i1 = Math.max(...cs.map((c) => c[0])) + 1;
  const j0 = Math.min(...cs.map((c) => c[1])), j1 = Math.max(...cs.map((c) => c[1])) + 1;
  return cs.length === (i1 - i0) * (j1 - j0) ? { i0, i1, j0, j1 } : null;
};

/** Every straight cut that splits the cells into two rectangles (an L has two). */
function rectPairs(cells: [number, number][]): [CellRect, CellRect][] {
  const out: [CellRect, CellRect][] = [];
  const i1 = Math.max(...cells.map((c) => c[0])) + 1, j1 = Math.max(...cells.map((c) => c[1])) + 1;
  for (let k = 1; k < i1; k++) {
    const a = cellsRect(cells.filter((c) => c[0] < k)), b = cellsRect(cells.filter((c) => c[0] >= k));
    if (a && b) out.push([a, b]);
  }
  for (let k = 1; k < j1; k++) {
    const a = cellsRect(cells.filter((c) => c[1] < k)), b = cellsRect(cells.filter((c) => c[1] >= k));
    if (a && b) out.push([a, b]);
  }
  return out;
}

/** Splits a set of cells into rectangles: cuts through inner corners until every piece is a rectangle. */
function decompose(grid: Grid, cells: [number, number][], rng: Rng): CellRect[] {
  if (!cells.length) return [];
  const i0 = Math.min(...cells.map((c) => c[0])), i1 = Math.max(...cells.map((c) => c[0])) + 1;
  const j0 = Math.min(...cells.map((c) => c[1])), j1 = Math.max(...cells.map((c) => c[1])) + 1;
  if (cells.length === (i1 - i0) * (j1 - j0)) return [{ i0, i1, j0, j1 }];
  const isRect = (cs: [number, number][]) => {
    if (!cs.length) return false;
    const a = Math.min(...cs.map((c) => c[0])), b = Math.max(...cs.map((c) => c[0])) + 1;
    const c0 = Math.min(...cs.map((c) => c[1])), c1 = Math.max(...cs.map((c) => c[1])) + 1;
    return cs.length === (b - a) * (c1 - c0);
  };
  let best: { score: number; parts: [number, number][][] }[] = [];
  let bestScore = -1;
  const consider = (parts: [number, number][][]) => {
    if (parts.some((p) => !p.length)) return;
    const score = parts.filter(isRect).length;
    if (score > bestScore) { bestScore = score; best = []; }
    if (score === bestScore) best.push({ score, parts });
  };
  for (let k = i0 + 1; k < i1; k++) consider([cells.filter((c) => c[0] < k), cells.filter((c) => c[0] >= k)]);
  for (let k = j0 + 1; k < j1; k++) consider([cells.filter((c) => c[1] < k), cells.filter((c) => c[1] >= k)]);
  const pick = rng.pick(best);
  return pick.parts.flatMap((p) => decompose(grid, p, rng));
}

/** A wall box during planning. */
interface Box { box: Box2; axis: Axis; exterior: boolean }

const overlapArea = (a: Box2, b: Box2) => Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)) * Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y));
const len = (b: Box2, ax: Axis) => b.max[ax] - b.min[ax];

/** Higher wins a corner: exterior over partitions, then walls along x over walls along y. */
const priority = (w: Box) => (w.exterior ? 2 : 0) + (w.axis === 'x' ? 1 : 0);

/**
 * Makes wall boxes disjoint. A wall that ends inside another is cut back to its face; at corners where both
 * end, the higher priority one keeps the corner; where two walls cross, the lower priority one is split.
 */
function resolveOverlaps(walls: Box[]): Box[] {
  let list = walls.filter((w) => len(w.box, w.axis) > EPS);
  for (let guard = 0; guard < 10000; guard++) {
    let found = false;
    outer: for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        const A = list[p], B = list[q];
        if (overlapArea(A.box, B.box) <= EPS) continue;
        found = true;
        const ov = A.box.clone().intersect(B.box);
        const ends = (w: Box) => ({ start: ov.min[w.axis] <= w.box.min[w.axis] + EPS, end: ov.max[w.axis] >= w.box.max[w.axis] - EPS });
        const ea = ends(A), eb = ends(B);
        const atEndA = ea.start || ea.end, atEndB = eb.start || eb.end;
        let loser: Box;
        if (atEndA && !atEndB) loser = A;
        else if (atEndB && !atEndA) loser = B;
        else loser = priority(A) >= priority(B) ? B : A;
        const e = loser === A ? ea : eb;
        const ax = loser.axis;
        const rest: Box[] = [];
        if (e.start && e.end) { /* entirely inside: drop */ } else if (e.start) {
          loser.box.min[ax] = ov.max[ax]; rest.push(loser);
        } else if (e.end) {
          loser.box.max[ax] = ov.min[ax]; rest.push(loser);
        } else {
          const b1 = loser.box.clone(), b2 = loser.box.clone();
          b1.max[ax] = ov.min[ax];
          b2.min[ax] = ov.max[ax];
          rest.push({ ...loser, box: b1 }, { ...loser, box: b2 });
        }
        list = [...list.filter((w) => w !== loser), ...rest.filter((w) => len(w.box, w.axis) > EPS)];
        break outer;
      }
    }
    if (!found) break;
  }
  return list;
}

/** Free intervals of [lo, hi] after removing `blocked` ranges. */
function freeIntervals(lo: number, hi: number, blocked: [number, number][]): [number, number][] {
  let out: [number, number][] = hi > lo ? [[lo, hi]] : [];
  for (const [b0, b1] of blocked) {
    out = out.flatMap(([s, e]): [number, number][] => {
      if (b1 <= s || b0 >= e) return [[s, e]];
      const parts: [number, number][] = [];
      if (b0 > s) parts.push([s, b0]);
      if (b1 < e) parts.push([b1, e]);
      return parts;
    });
  }
  return out;
}

/** Height of the storey a wall stands on, above z0. */
export const storeyBase = (w: { storey: 1 | 2 }) => (w.storey - 1) * STOREY;

export function wallLength(w: PlanWall): number {
  return w.b.distanceTo(w.a);
}

/** The wall's box seen from above. */
export function wallBox(w: PlanWall): Box2 {
  const h = w.thickness / 2;
  return w.axis === 'x'
    ? new Box2(new Vector2(w.a.x, w.a.y - h), new Vector2(w.b.x, w.a.y + h))
    : new Box2(new Vector2(w.a.x - h, w.a.y), new Vector2(w.a.x + h, w.b.y));
}

/** Unit direction a→b and its left normal. */
export function wallDirs(w: PlanWall): { dir: Vector2; left: Vector2 } {
  return w.axis === 'x' ? { dir: new Vector2(1, 0), left: new Vector2(0, 1) } : { dir: new Vector2(0, 1), left: new Vector2(-1, 0) };
}

/** Point at distance `t` along the wall's centre line. */
export function wallPoint(w: PlanWall, t: number): Vector2 {
  return w.a.clone().addScaledVector(wallDirs(w).dir, t);
}

/**
 * The outline of a union of axis-aligned rectangles that share edges (an L-shaped lot of two wings), counter-
 * clockwise.
 */
export function outlineOf(rects: Box2[]): Vector2[] {
  const xs = [...new Set(rects.flatMap((r) => [r.min.x, r.max.x]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.min.y, r.max.y]))].sort((a, b) => a - b);
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i + 1 < xs.length && j + 1 < ys.length
    && rects.some((r) => r.containsPoint(new Vector2((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)));
  // Boundary edges with the inside on their left, keyed by their start.
  const next = new Map<string, Vector2>();
  const key = (p: Vector2) => `${p.x},${p.y}`;
  for (let j = 0; j + 1 < ys.length; j++) for (let i = 0; i + 1 < xs.length; i++) {
    if (!inside(i, j)) continue;
    const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
    if (!inside(i, j - 1)) next.set(key(new Vector2(x0, y0)), new Vector2(x1, y0));
    if (!inside(i + 1, j)) next.set(key(new Vector2(x1, y0)), new Vector2(x1, y1));
    if (!inside(i, j + 1)) next.set(key(new Vector2(x1, y1)), new Vector2(x0, y1));
    if (!inside(i - 1, j)) next.set(key(new Vector2(x0, y1)), new Vector2(x0, y0));
  }
  const start = [...next.keys()][0];
  const out: Vector2[] = [];
  let at = start;
  for (let guard = 0; guard <= next.size; guard++) {
    const [x, y] = at.split(',').map(Number);
    out.push(new Vector2(x, y));
    at = key(next.get(at)!);
    if (at === start) break;
  }
  // Drop the corners in the middle of straight runs.
  return out.filter((p, i) => {
    const a = out[(i + out.length - 1) % out.length], b = out[(i + 1) % out.length];
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
  });
}

/** Rooms that share a wall with an opening of kind door or gap between them. */
export function doorGraph(plan: InteriorPlan): Map<number, Set<number>> {
  const g = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!g.has(a)) g.set(a, new Set());
    g.get(a)!.add(b);
  };
  for (const w of plan.walls) {
    if (!w.openings.some((o) => o.kind !== 'window' && !o.blocked)) continue;
    link(w.left, w.right);
    link(w.right, w.left);
  }
  if (plan.stairs) {
    const up = plan.rooms.findIndex((r) => r.storey === 2);
    if (up >= 0) { link(plan.stairs.room, up); link(up, plan.stairs.room); }
  }
  return g;
}

/** Area of a box seen from above. */
const boxArea = (b: Box2) => (b.max.x - b.min.x) * (b.max.y - b.min.y);

// Cell rectangles along an axis: grid lines, first and past-the-end cell index, a sub-range, the length in units.
const lines = (grid: Grid, axis: Axis) => (axis === 'x' ? grid.xs : grid.ys);
const lo = (r: CellRect, axis: Axis) => (axis === 'x' ? r.i0 : r.j0);
const hi = (r: CellRect, axis: Axis) => (axis === 'x' ? r.i1 : r.j1);
const withRange = (r: CellRect, axis: Axis, a: number, b: number): CellRect => (axis === 'x' ? { ...r, i0: a, i1: b } : { ...r, j0: a, j1: b });
const rlen = (grid: Grid, r: CellRect, axis: Axis) => lines(grid, axis)[hi(r, axis)] - lines(grid, axis)[lo(r, axis)];

/** Whether a point lies under the upper floor (within EPS). */
const underUpper = (upperBox: Box2 | undefined, p: Vector2) => !!upperBox && p.x >= upperBox.min.x - EPS && p.x <= upperBox.max.x + EPS && p.y >= upperBox.min.y - EPS && p.y <= upperBox.max.y + EPS;

/** The upper floor over `up` and the open part with the stairs, beside it on the `side` (+1/-1) of `up` along `axis`. */
interface UpperChoice { up: CellRect; open: CellRect; axis: Axis; side: 1 | -1 }

/**
 * Two storeys: picks an upper floor over one end of the house (at most half of it, preferably at least a third)
 * whose open part beside it is long and wide enough for a flight.
 */
function chooseUpperFloor(grid: Grid, regions: CellRect[], cells: [number, number][], minRoom: number, stairWidth: number, rng: Rng): UpperChoice | undefined {
  const area = regions.reduce((s, r) => s + boxArea(grid.box(r)), 0);
  const choices: UpperChoice[] = [];
  const tryPair = (up: CellRect, open: CellRect, axis: Axis, side: 1 | -1) => {
    if (boxArea(grid.box(up)) > area / 2 + EPS) return;
    if (rlen(grid, up, axis) < minRoom || rlen(grid, open, axis) < STAIR_OPEN_LENGTH) return;
    if (rlen(grid, open, other(axis)) < stairWidth + EXTERIOR_WALL + G) return;
    choices.push({ up, open, axis, side });
  };
  if (regions.length === 1) {
    const whole = regions[0];
    for (const axis of ['x', 'y'] as const) {
      for (let k = lo(whole, axis) + 1; k < hi(whole, axis); k++) {
        // Upper floor at the low end (open part beyond, side +1) or at the high end.
        tryPair(withRange(whole, axis, lo(whole, axis), k), withRange(whole, axis, k, hi(whole, axis)), axis, 1);
        tryPair(withRange(whole, axis, k, hi(whole, axis)), withRange(whole, axis, lo(whole, axis), k), axis, -1);
      }
    }
  } else if (regions.length === 2) {
    for (const [up, open] of rectPairs(cells).flatMap(([p, q]) => [[p, q], [q, p]])) {
      for (const axis of ['x', 'y'] as const) {
        if (lines(grid, axis)[hi(up, axis)] === lines(grid, axis)[lo(open, axis)]) tryPair(up, open, axis, 1);
        if (lines(grid, axis)[lo(up, axis)] === lines(grid, axis)[hi(open, axis)]) tryPair(up, open, axis, -1);
      }
    }
  }
  const good = choices.filter((p) => boxArea(grid.box(p.up)) >= area / 3);
  return good.length ? rng.pick(good) : choices.length ? rng.pick(choices) : undefined;
}

/** A placed upper storey: the stairs, and the zone in front of them that room splits must not cross. */
interface UpperStorey { up: CellRect; open: CellRect; stairs: Stairs; zone: Box2 }

/**
 * The flight runs along an outside wall of the open part, rising towards the upper floor, and has to land on it.
 * Undefined when neither outside wall works (the house then gets one storey).
 */
function placeStairs(grid: Grid, choice: UpperChoice, stairWidth: number, rng: Rng): UpperStorey | undefined {
  const { up, open, axis, side } = choice;
  const across = other(axis);
  const ob = grid.box(open), ub = grid.box(up);
  const boundary = side === 1 ? ob.min[axis] : ob.max[axis];
  const wallSides = ([-1, 1] as const).filter((s) => {
    // Just past the open part's side, a little way from the boundary, must be outside the house.
    const probe = new Vector2();
    probe[axis] = boundary + side * 8;
    probe[across] = s === -1 ? ob.min[across] - 1 : ob.max[across] + 1;
    const near = s === -1 ? ob.min[across] + EXTERIOR_WALL : ob.max[across] - EXTERIOR_WALL;
    const far = near - s * stairWidth;
    const lands = Math.min(near, far) >= ub.min[across] + EXTERIOR_WALL - EPS && Math.max(near, far) <= ub.max[across] - EXTERIOR_WALL + EPS;
    return !grid.inAt(probe) && lands;
  });
  if (!wallSides.length) return undefined;
  const wallSide = rng.pick(wallSides);
  const wallFace = wallSide === -1 ? ob.min[across] + EXTERIOR_WALL : ob.max[across] - EXTERIOR_WALL;
  const top = boundary + side * PARTITION / 2;
  const bottom = top + side * STAIR_RUN;
  const box = new Box2();
  box.min[axis] = Math.min(top, bottom); box.max[axis] = Math.max(top, bottom);
  box.min[across] = Math.min(wallFace, wallFace - wallSide * stairWidth); box.max[across] = Math.max(wallFace, wallFace - wallSide * stairWidth);
  const dir = new Vector2(); dir[axis] = -side;
  const mid = (box.min[across] + box.max[across]) / 2;
  const foot = new Vector2(); foot[axis] = bottom + side * STAIR_FOOT; foot[across] = mid;
  const head = new Vector2(); head[axis] = boundary - side * STAIR_HEAD; head[across] = mid;
  const stairs: Stairs = { box, dir, foot, head, room: -1, steps: STAIR_STEPS, rise: STAIR_RISE, tread: STAIR_TREAD, width: stairWidth };
  // The stairs, the floor in front of their foot and the strip to the outside wall.
  const zone = box.clone();
  if (side === 1) zone.max[axis] += G; else zone.min[axis] -= G;
  if (wallSide === -1) zone.min[across] = ob.min[across]; else zone.max[across] = ob.max[across];
  return { up, open, stairs, zone };
}

/** Whether to split a w × h rectangle: wings of SPLIT_LENGTH always at the top level, else by chance growing with the area. */
const wantsSplit = (w: number, h: number, depth: number, rng: Rng) => (depth === 0 && Math.max(w, h) >= SPLIT_LENGTH)
  || rng.chance(Math.min(1, Math.max(0, (w * h - SPLIT_MIN_AREA) / (SPLIT_MAX_AREA - SPLIT_MIN_AREA))));

/** Grid lines across `axis` where `r` may be split: both rooms at least `minRoom`, never through the stairs and the space in front of them. */
function splitLines(grid: Grid, r: CellRect, axis: Axis, zone: Box2 | undefined, minRoom: number): number[] {
  const across = other(axis);
  const at = lines(grid, axis);
  const cuts: number[] = [];
  for (let k = lo(r, axis) + 1; k < hi(r, axis); k++) {
    const c = at[k];
    if (c - at[lo(r, axis)] < minRoom || at[hi(r, axis)] - c < minRoom) continue;
    if (zone) {
      const b = grid.box(r);
      const crosses = c > zone.min[axis] - EPS && c < zone.max[axis] + EPS
        && Math.min(zone.max[across], b.max[across]) > Math.max(zone.min[across], b.min[across]);
      if (crosses) continue;
    }
    cuts.push(k);
  }
  return cuts;
}

/**
 * Rooms: splits each rectangle along its longer side until the pieces are room sized. The part under the upper
 * floor stays one sealed room: nobody sees its partitions.
 */
function splitRooms(grid: Grid, rects: CellRect[], upper: CellRect | undefined, zone: Box2 | undefined, minRoom: number, rng: Rng): CellRect[] {
  const roomRects: CellRect[] = [];
  const split = (r: CellRect, depth: number) => {
    const w = rlen(grid, r, 'x'), h = rlen(grid, r, 'y');
    if (wantsSplit(w, h, depth, rng)) {
      const axes: Axis[] = w >= h ? ['x', 'y'] : ['y', 'x'];
      for (const axis of axes) {
        const cuts = splitLines(grid, r, axis, zone, minRoom);
        if (!cuts.length) continue;
        const k = rng.pick(cuts);
        split(withRange(r, axis, lo(r, axis), k), depth + 1);
        split(withRange(r, axis, k, hi(r, axis)), depth + 1);
        return;
      }
    }
    roomRects.push(r);
  };
  for (const r of rects) if (r === upper) roomRects.push(r); else split(r, 0);
  return roomRects;
}

/**
 * One ground room per rectangle, marked on the grid. Ground rooms under the upper floor are out of the camera's
 * sight: sealed off. The upper floor is the last room.
 */
function makeRooms(grid: Grid, roomRects: CellRect[], upperBox: Box2 | undefined): Room[] {
  const rooms: Room[] = roomRects.map((r) => ({ box: grid.box(r), type: 'living', storey: 1 }));
  roomRects.forEach((r, n) => {
    for (let j = r.j0; j < r.j1; j++) for (let i = r.i0; i < r.i1; i++) grid.room[j * grid.nx + i] = n;
  });
  for (const room of rooms) if (underUpper(upperBox, room.box.getCenter(new Vector2()))) room.sealed = true;
  if (upperBox) rooms.push({ box: upperBox.clone(), type: 'bedroom', storey: 2 });
  return rooms;
}

/** What lies on either side of a grid line: the same room (none), two rooms (a partition), or the outside below or above it. */
type EdgeKind = 'none' | 'part' | 'ext-' | 'ext+';

/** The edge kind at cell `t` along `axis`, between cells k-1 and k across it. */
function edgeKind(grid: Grid, axis: Axis, t: number, k: number): EdgeKind {
  const roomOf = (kk: number) => (axis === 'x' ? grid.roomOf(t, kk) : grid.roomOf(kk, t));
  const isIn = (kk: number) => (axis === 'x' ? grid.isIn(t, kk) : grid.isIn(kk, t));
  const below = roomOf(k - 1), above = roomOf(k);
  if (below === above) return 'none';
  if (below === -1 && !isIn(k - 1)) return 'ext+';
  if (above === -1 && !isIn(k)) return 'ext-';
  return 'part';
}

/** The box of a wall from s0 to s1 along `axis` on the grid line at `c`. */
function wallRun(grid: Grid, axis: Axis, c: number, s0: number, s1: number, kind: EdgeKind): Box {
  const across = other(axis);
  const box = new Box2();
  if (kind === 'part') {
    box.min[across] = c - PARTITION / 2; box.max[across] = c + PARTITION / 2;
  } else {
    const inward = kind === 'ext+' ? 1 : -1;
    box.min[across] = Math.min(c, c + inward * EXTERIOR_WALL); box.max[across] = Math.max(c, c + inward * EXTERIOR_WALL);
    // Inner corners: reach across the corner so the two walls close it.
    const probe = (at: number, beyond: number) => {
      const p = new Vector2(); p[axis] = at + beyond; p[across] = c - inward;
      return grid.inAt(p);
    };
    if (probe(s0, -1)) s0 -= EXTERIOR_WALL;
    if (probe(s1, 1)) s1 += EXTERIOR_WALL;
  }
  box.min[axis] = s0; box.max[axis] = s1;
  return { box, axis, exterior: kind !== 'part' };
}

/** Walls from the cell edges: runs along each grid line where the room changes. */
function wallRuns(grid: Grid): Box[] {
  const boxes: Box[] = [];
  for (const axis of ['x', 'y'] as const) {
    const along = lines(grid, axis), across = lines(grid, other(axis));
    const n = along.length - 1;
    for (let k = 0; k < across.length; k++) {
      let t = 0;
      while (t < n) {
        const kind = edgeKind(grid, axis, t, k);
        if (kind === 'none') { t++; continue; }
        let e = t + 1;
        while (e < n && edgeKind(grid, axis, e, k) === kind) e++;
        boxes.push(wallRun(grid, axis, across[k], along[t], along[e], kind));
        t = e;
      }
    }
  }
  return boxes;
}

/** The rooms on the left and right of a→b of a wall box, at `at` along its axis. */
function sideRooms(grid: Grid, b: Box2, axis: Axis, at: number): [number, number] {
  const across = other(axis);
  const c = (b.min[across] + b.max[across]) / 2, h = (b.max[across] - b.min[across]) / 2 + 1;
  const p = (offset: number) => { const v = new Vector2(); v[axis] = at; v[across] = c + offset; return v; };
  // Left of a→b: +y for walls along x, -x for walls along y.
  const leftSign = axis === 'x' ? 1 : -1;
  return [grid.roomAt(p(leftSign * h)), grid.roomAt(p(-leftSign * h))];
}

/**
 * Ground floor walls: splits the wall boxes where the room on either side changes, so every piece faces one room
 * per side. Walls under the upper floor reach up to it.
 */
function cutWalls(grid: Grid, boxes: Box[], upperBox: Box2 | undefined, cut: number): PlanWall[] {
  const walls: PlanWall[] = [];
  for (const w of boxes) {
    const axis = w.axis, across = other(axis);
    const cuts = [w.box.min[axis]];
    for (const line of lines(grid, axis)) {
      if (line <= w.box.min[axis] + EPS || line >= w.box.max[axis] - EPS) continue;
      const [l0, r0] = sideRooms(grid, w.box, axis, line - 1), [l1, r1] = sideRooms(grid, w.box, axis, line + 1);
      if (l0 !== l1 || r0 !== r1) cuts.push(line);
    }
    cuts.push(w.box.max[axis]);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const c = (w.box.min[across] + w.box.max[across]) / 2;
      const a = new Vector2(), b = new Vector2();
      a[axis] = cuts[k]; a[across] = c; b[axis] = cuts[k + 1]; b[across] = c;
      const [left, right] = sideRooms(grid, w.box, axis, (cuts[k] + cuts[k + 1]) / 2);
      const under = underUpper(upperBox, a.clone().add(b).multiplyScalar(0.5));
      walls.push({
        a, b, axis, thickness: w.exterior ? EXTERIOR_WALL : PARTITION, exterior: w.exterior, storey: 1,
        left, right, bottom: FLOOR_TOP, top: under ? STOREY : cut, openings: [],
      });
    }
  }
  return walls;
}

/** Upper storey: the outside walls around the upper floor (the side facing the open part gets a railing). */
function upperWalls(ground: PlanWall[], upperBox: Box2, upperRoom: number, cut: number): PlanWall[] {
  return ground.filter((x) => x.exterior && underUpper(upperBox, x.a.clone().add(x.b).multiplyScalar(0.5))).map((w) => ({
    ...w, a: w.a.clone(), b: w.b.clone(), storey: 2,
    left: w.left === -1 ? -1 : upperRoom, right: w.right === -1 ? -1 : upperRoom,
    bottom: STOREY, top: STOREY + cut, openings: [],
  }));
}

/** The plan once the rooms and walls stand, shared by the steps that place openings and type the rooms. */
interface Draft {
  footprint: Vector2[];
  opts: InteriorPlanOptions;
  rng: Rng;
  rooms: Room[];
  walls: PlanWall[];
  /** The ground floor's walls. */
  ground: PlanWall[];
  entrances: Entrance[];
  stairs?: Stairs;
  /** Index of the upper floor room, -1 for one storey. */
  upperRoom: number;
  /** Narrowest door. */
  minDoor: number;
}

/** Places on a wall where openings can't go: walls joining it, and the stairs. */
function blockedOn(draft: Draft, w: PlanWall, margin: number): [number, number][] {
  const wb = wallBox(w), axis = w.axis, across = other(axis);
  const out: [number, number][] = [];
  const add = (b: Box2) => {
    const touches = (b.min[across] <= wb.max[across] + EPS && b.max[across] >= wb.min[across] - EPS)
      && Math.min(b.max[axis], wb.max[axis]) - Math.max(b.min[axis], wb.min[axis]) > -EPS;
    if (touches) out.push([b.min[axis] - wb.min[axis] - margin, b.max[axis] - wb.min[axis] + margin]);
  };
  for (const x of draft.walls) {
    if (x === w || x.storey !== w.storey || x.axis === w.axis) continue;
    add(wallBox(x));
  }
  if (draft.stairs && w.storey === 1) add(draft.stairs.box);
  return out;
}

/** Stretches of a wall where an opening may go, `margin` clear of its ends, joining walls and other openings. */
const freeOn = (draft: Draft, w: PlanWall, margin: number) => freeIntervals(margin, wallLength(w) - margin, [
  ...blockedOn(draft, w, margin),
  ...w.openings.map((x): [number, number] => [x.from - margin * 2, x.to + margin * 2]),
]);
const fits = (draft: Draft, w: PlanWall, width: number) => freeOn(draft, w, DOOR_MARGIN).some(([s, e]) => e - s >= width);
const snap8 = (x: number) => Math.round(x / 8) * 8;
const longest = (list: PlanWall[]) => list.reduce((a, b) => (wallLength(b) > wallLength(a) ? b : a));
const groundRooms = (rooms: Room[]) => rooms.map((_, i) => i).filter((i) => rooms[i].storey === 1);

/** Adds an opening to a wall: in the widest free stretch's middle if `centred`, else anywhere free (snapped to 8). */
function placeOpening(draft: Draft, w: PlanWall, width: number, kind: OpeningKind, margin: number, centred = false): Opening | null {
  const { rng } = draft;
  const free = freeOn(draft, w, margin).filter(([s, e]) => e - s >= width);
  if (!free.length) return null;
  const [s, e] = centred ? free.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a)) : rng.pick(free);
  let from = centred ? (s + e) / 2 - width / 2 : s + rng.range(0, e - s - width);
  from = Math.min(e - width, Math.max(s, snap8(from)));
  const op: Opening = kind === 'window'
    ? { from, to: from + width, kind, sill: storeyBase(w) + WINDOW_SILL, lintel: storeyBase(w) + WINDOW_LINTEL }
    : { from, to: from + width, kind, sill: w.bottom, lintel: Math.min(w.top, w.bottom + (draft.opts.wideDoors ? DOOR_HEIGHT_WIDE : DOOR_HEIGHT)) };
  // Gaps, and doors with only a sliver of wall above them, reach the wall top.
  if (kind === 'gap' || op.lintel > w.top - 8) op.lintel = w.top;
  w.openings.push(op);
  w.openings.sort((p, q) => p.from - q.from);
  return op;
}

/** An inside door: wide doors, or mostly the normal width where it fits, else narrow. */
const doorWidth = (draft: Draft, w: PlanWall) => (draft.opts.wideDoors ? DOOR_WIDE : fits(draft, w, DOOR) && draft.rng.chance(0.6) ? DOOR : DOOR_NARROW);
/** An outside door: wide doors, or the normal width where it fits, else narrow. */
const outerDoorWidth = (draft: Draft, w: PlanWall) => (draft.opts.wideDoors ? DOOR_WIDE : fits(draft, w, DOOR) ? DOOR : DOOR_NARROW);

const outNormal = (w: PlanWall) => { const { left } = wallDirs(w); return w.left === -1 ? left : left.clone().negate(); };
/** The room inside an outside wall. */
const insideRoom = (w: PlanWall) => (w.left === -1 ? w.right : w.left);
const sealedSide = (draft: Draft, w: PlanWall) => [w.left, w.right].some((r) => r >= 0 && draft.rooms[r].sealed);

function facesNeighbour(draft: Draft, w: PlanWall): boolean {
  const face = wallBox(w).translate(outNormal(w).multiplyScalar(w.thickness / 2 + 1));
  return (draft.opts.noEntrance ?? []).some((b) => Math.min(b.max.x, face.max.x) - Math.max(b.min.x, face.min.x) > 0 && Math.min(b.max.y, face.max.y) - Math.max(b.min.y, face.min.y) > 0);
}

/** Whether an outside wall's outer face lies on footprint edge `edge`. */
function onEdge(footprint: Vector2[], w: PlanWall, edge: number): boolean {
  const p = footprint[edge], q = footprint[(edge + 1) % footprint.length];
  const n = outNormal(w), mid = w.a.clone().add(w.b).multiplyScalar(0.5).addScaledVector(n, w.thickness / 2);
  const along = new Vector2().subVectors(q, p), l = along.length();
  if (l < EPS) return false;
  const t = new Vector2().subVectors(mid, p).dot(along) / l;
  const off = Math.abs(new Vector2().subVectors(mid, p).cross(along) / l);
  return off < 1 && t > -EPS && t < l + EPS;
}

/** Outside walls an entrance may open in: not into a sealed room, and away from neighbouring buildings unless that leaves no way in. */
function entranceWalls(draft: Draft): PlanWall[] {
  const allOutside = draft.ground.filter((w) => w.exterior && !sealedSide(draft, w));
  const facingOut = allOutside.filter((w) => !facesNeighbour(draft, w));
  return facingOut.some((w) => fits(draft, w, draft.minDoor)) ? facingOut : allOutside;
}

const usable = (draft: Draft, list: PlanWall[], width: number) => list.filter((w) => fits(draft, w, width));

function addEntrance(draft: Draft, w: PlanWall): void {
  const op = placeOpening(draft, w, outerDoorWidth(draft, w), 'door', DOOR_MARGIN, draft.rng.chance(0.5));
  if (!op) return;
  const n = outNormal(w);
  draft.entrances.push({
    wall: draft.walls.indexOf(w), opening: w.openings.indexOf(op), out: n, room: insideRoom(w),
    centre: wallPoint(w, (op.from + op.to) / 2).addScaledVector(n, w.thickness / 2),
  });
}

/** Entrances: the requested edges, or one door (two on long houses) on different sides. */
function placeEntrances(draft: Draft, outside: PlanWall[]): void {
  const { opts, rng, entrances } = draft;
  if (opts.entranceEdges?.length) {
    for (const edge of opts.entranceEdges) {
      const c = usable(draft, outside.filter((w) => onEdge(draft.footprint, w, edge)), draft.minDoor);
      if (c.length) addEntrance(draft, rng.pick(c));
    }
  }
  if (!entrances.length) {
    const c = usable(draft, outside, draft.minDoor);
    // Longer walls first: the front door is on a main side.
    c.sort((p, q) => wallLength(q) - wallLength(p));
    if (c.length) addEntrance(draft, rng.pick(c.slice(0, Math.max(1, Math.ceil(c.length / 2)))));
  }
  const size = new Box2().setFromPoints(draft.footprint).getSize(new Vector2());
  if (entrances.length !== 1 || Math.max(size.x, size.y) <= LONG_HOUSE) return;
  // The second one on another side, as far from the first as possible and preferably into another room.
  const first = draft.walls[entrances[0].wall];
  const firstN = outNormal(first);
  const c = usable(draft, outside.filter((w) => !outNormal(w).equals(firstN)), draft.minDoor);
  if (!c.length) return;
  const dist = (w: PlanWall) => w.a.clone().add(w.b).distanceTo(first.a.clone().add(first.b)) + (insideRoom(w) === entrances[0].room ? -10000 : 0);
  c.sort((p, q) => dist(q) - dist(p));
  addEntrance(draft, c[0]);
}

/** Room types: hall or living room at the front door, kitchen next to it, bath next to the kitchen, bedrooms. */
function typeRooms(draft: Draft): void {
  const { rooms, stairs } = draft;
  const neighbours = (r: number) => new Set(draft.ground.filter((w) => !w.exterior && (w.left === r || w.right === r)).map((w) => (w.left === r ? w.right : w.left)));
  const areaOf = (r: number) => boxArea(rooms[r].box);
  const ground = groundRooms(rooms);
  const untyped = new Set(ground);
  const assign = (r: number, t: RoomType) => { rooms[r].type = t; untyped.delete(r); };
  const front = draft.entrances.length ? draft.entrances[0].room : ground[0];
  // The untyped room next to `near` (or anywhere) that passes `pred`, first in `order`.
  const pickNear = (near: number[], pred: (r: number) => boolean, order: (a: number, b: number) => number) => {
    const set = new Set(near.flatMap((r) => [...neighbours(r)]));
    const c = [...untyped].filter((r) => set.has(r) && pred(r)).sort(order);
    return c.length ? c[0] : [...untyped].filter(pred).sort(order)[0];
  };
  if (draft.opts.use === 'workshop') {
    const biggest = [...ground].sort((a, b) => areaOf(b) - areaOf(a))[0];
    assign(biggest, 'workshop');
    for (const r of [...untyped]) assign(r, 'storage');
  } else if (ground.length === 1) {
    assign(front, 'living');
  } else {
    const s = rooms[front].box.getSize(new Vector2());
    assign(front, ground.length > 2 && Math.min(s.x, s.y) <= HALL_WIDTH ? 'hall' : 'living');
    if (!ground.some((r) => rooms[r].type === 'living' && !untyped.has(r))) {
      const big = [...untyped].sort((a, b) => areaOf(b) - areaOf(a))[0];
      if (big !== undefined) assign(big, 'living');
    }
    const lived = ground.filter((r) => !untyped.has(r));
    const kitchen = pickNear(lived, () => true, (a, b) => Math.abs(areaOf(a) - KITCHEN_AREA) - Math.abs(areaOf(b) - KITCHEN_AREA));
    if (kitchen !== undefined) assign(kitchen, 'kitchen');
    if (kitchen !== undefined && untyped.size) {
      const bath = pickNear([kitchen], (r) => areaOf(r) <= BATH_MAX_AREA, (a, b) => areaOf(a) - areaOf(b));
      if (bath !== undefined && (untyped.size > 1 || areaOf(bath) <= LAST_BATH_AREA)) assign(bath, 'bath');
    }
    for (const r of [...untyped]) assign(r, areaOf(r) >= BEDROOM_AREA ? 'bedroom' : 'storage');
  }
  if (stairs && rooms[stairs.room].type === 'bath') rooms[stairs.room].type = 'living';
}

/** Inside walls between two rooms units may enter, by room pair ("a:b", a < b). */
function wallsByRoomPair(draft: Draft): Map<string, PlanWall[]> {
  const pairs = new Map<string, PlanWall[]>();
  for (const w of draft.ground) {
    if (w.exterior || w.left < 0 || w.right < 0 || w.left === w.right || sealedSide(draft, w)) continue;
    const key = `${Math.min(w.left, w.right)}:${Math.max(w.left, w.right)}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key)!.push(w);
  }
  return pairs;
}

/** Shuffles a list in place (Fisher–Yates). */
function shuffle<T>(list: T[], rng: Rng): T[] {
  for (let k = list.length - 1; k > 0; k--) { const j = rng.int(0, k); [list[k], list[j]] = [list[j], list[k]]; }
  return list;
}

/** Opens the longest of the walls between two rooms: a door, or between social rooms now and then a wide gap. */
function openDoorway(draft: Draft, between: PlanWall[]): boolean {
  const list = between.filter((w) => fits(draft, w, draft.minDoor));
  if (!list.length) return false;
  const w = longest(list);
  const types = [draft.rooms[w.left].type, draft.rooms[w.right].type];
  const social = types.every((t) => t === 'hall' || t === 'living' || t === 'kitchen');
  const wide = freeOn(draft, w, DOOR_MARGIN).reduce((m, [s, e]) => Math.max(m, e - s), 0);
  if (social && !draft.opts.wideDoors && wide >= GAP_WIDTH && draft.rng.chance(0.35)) return !!placeOpening(draft, w, Math.min(GAP_WIDTH, snap8(wide - 16)), 'gap', DOOR_MARGIN, true);
  return !!placeOpening(draft, w, doorWidth(draft, w), 'door', DOOR_MARGIN);
}

/**
 * Doors between rooms: a spanning tree (every room reachable), then a few more for loops. Rooms the inside doors
 * can't reach (walls too short beside the stairs) get their own door outside.
 */
function placeDoors(draft: Draft, outside: PlanWall[]): void {
  const { rooms, rng, stairs } = draft;
  const parent = rooms.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const pairs = wallsByRoomPair(draft);
  const keys = shuffle([...pairs.keys()], rng);
  const doored = new Set<string>();
  if (stairs) parent[find(stairs.room)] = find(draft.upperRoom);
  for (const key of keys) {
    const [a, b] = key.split(':').map(Number);
    if (find(a) === find(b)) continue;
    if (openDoorway(draft, pairs.get(key)!)) { parent[find(a)] = find(b); doored.add(key); }
  }
  for (const key of keys) if (!doored.has(key) && rng.chance(0.2)) openDoorway(draft, pairs.get(key)!);
  for (const r of groundRooms(rooms)) {
    if (rooms[r].sealed || draft.entrances.some((e) => find(e.room) === find(r))) continue;
    const c = usable(draft, outside.filter((w) => w.left === r || w.right === r), draft.minDoor);
    if (c.length) addEntrance(draft, rng.pick(c));
  }
}

/** A closed-off doorway of a kind picked from `kinds` ('wall': none at all). */
function blockedDoor(draft: Draft, w: PlanWall, kinds: (Blocker | 'wall')[]): void {
  const kind = draft.rng.pick(kinds);
  if (kind === 'wall' || !fits(draft, w, draft.minDoor)) return;
  const op = placeOpening(draft, w, w.exterior ? outerDoorWidth(draft, w) : doorWidth(draft, w), 'door', DOOR_MARGIN, draft.rng.chance(0.5));
  if (op) op.blocked = kind;
}

/**
 * Sealed rooms still show a doorway now and then, closed off: on the wall to a room units can reach, and
 * sometimes on the outside. A plain wall is the fourth choice (no doorway at all).
 */
function placeBlockedDoors(draft: Draft): void {
  const { rooms } = draft;
  for (const r of groundRooms(rooms)) {
    if (!rooms[r].sealed) continue;
    const inner = draft.ground.filter((w) => !w.exterior && (w.left === r || w.right === r) && w.left >= 0 && w.right >= 0 && !(rooms[w.left].sealed && rooms[w.right].sealed));
    if (inner.length) blockedDoor(draft, longest(inner), ['door', 'boarded', 'furniture', 'furniture', 'wall']);
    const outer = draft.ground.filter((w) => w.exterior && (w.left === r || w.right === r));
    if (outer.length && draft.rng.chance(0.35)) blockedDoor(draft, draft.rng.pick(outer), ['door', 'boarded']);
  }
}

/** Windows on outside walls: one width per house, about one per 128–192 units of wall. */
function placeWindows(draft: Draft): void {
  const width = draft.rng.pick(WINDOW_WIDTHS);
  for (const w of draft.walls.filter((x) => x.exterior)) {
    for (const [s, e] of freeOn(draft, w, WINDOW_MARGIN)) {
      const l = e - s;
      const n = Math.min(Math.floor((l + WINDOW_GAP) / (width + WINDOW_GAP)), Math.round(l / draft.rng.pick(WINDOW_SPACINGS)));
      for (let k = 0; k < n; k++) {
        const c = snap8(s + ((k + 0.5) * l) / n);
        const from = Math.max(s, Math.min(e - width, c - width / 2));
        w.openings.push({ from, to: from + width, kind: 'window', sill: storeyBase(w) + WINDOW_SILL, lintel: Math.min(w.top, storeyBase(w) + WINDOW_LINTEL) });
      }
      w.openings.sort((p, q) => p.from - q.from);
    }
  }
}

/** Lanes from each door into the middle of its room, zones in front of doors on both sides, and the stairs kept clear. */
function planLanes(draft: Draft): { lanes: Box2[]; doorZones: Box2[]; keepClear: Box2[] } {
  const { rooms, stairs } = draft;
  const lanes: Box2[] = [], doorZones: Box2[] = [], keepClear: Box2[] = [];
  const centreOf = (r: number) => rooms[r].box.getCenter(new Vector2());
  const lane = (p: Vector2, q: Vector2, firstAxis: Axis) => {
    const corner = p.clone();
    corner[firstAxis] = q[firstAxis];
    for (const [s, e] of [[p, corner], [corner, q]]) {
      const b = new Box2().setFromPoints([s, e]).expandByScalar(LANE / 2);
      if (b.getSize(new Vector2()).length() > LANE * 1.5) lanes.push(b);
    }
  };
  for (const w of draft.walls) {
    if (w.storey !== 1) continue;
    const { dir, left } = wallDirs(w);
    for (const op of w.openings) {
      if (op.kind === 'window') continue;
      const c = wallPoint(w, (op.from + op.to) / 2);
      for (const [r, n] of [[w.left, left], [w.right, left.clone().negate()]] as const) {
        // A closed-off doorway keeps the floor in front of it clear (for its blocker) but leads nowhere.
        if (op.blocked && r >= 0 && rooms[r].sealed) continue;
        const face = c.clone().addScaledVector(n, w.thickness / 2);
        doorZones.push(new Box2().setFromPoints([
          face.clone().addScaledVector(dir, -(op.to - op.from) / 2), face.clone().addScaledVector(dir, (op.to - op.from) / 2).addScaledVector(n, DOOR_ZONE),
        ]));
        if (r >= 0 && !op.blocked) lane(face, centreOf(r), w.axis === 'x' ? 'y' : 'x');
      }
    }
  }
  if (stairs) {
    const axis: Axis = stairs.dir.x !== 0 ? 'x' : 'y';
    lane(stairs.foot, centreOf(stairs.room), axis);
    lane(stairs.head, centreOf(draft.upperRoom), axis);
    keepClear.push(stairs.box.clone().union(new Box2().setFromPoints([stairs.foot]).expandByScalar(stairs.width / 2)));
    keepClear.push(new Box2().setFromPoints([stairs.head]).expandByScalar(stairs.width / 2));
  }
  return { lanes, doorZones, keepClear };
}

/** Porch: a deck along the wall in front of the main door (by default on half of the houses). */
function planPorch(draft: Draft): Box2 | undefined {
  const { rng } = draft;
  if (!draft.entrances.length || !(draft.opts.porch ?? rng.chance(0.5))) return undefined;
  const e = draft.entrances[0], w = draft.walls[e.wall], op = w.openings[e.opening];
  const depth = rng.pick(PORCH_DEPTHS);
  const half = Math.min(wallLength(w) / 2 + 32, (op.to - op.from) / 2 + rng.pick(PORCH_OVERHANGS));
  const a = e.centre.clone(), b = e.centre.clone().addScaledVector(e.out, depth);
  a[w.axis] -= half; b[w.axis] += half;
  return new Box2().setFromPoints([a, b]);
}

/**
 * Plans the rooms, walls, openings, entrances and (for two storeys) the stairs and upper floor of a house on
 * an axis-aligned footprint (a rectangle, an L or any rectilinear outline; other edges are stepped on the
 * 64 grid).
 */
export function planInterior(footprint: Vector2[], rng: Rng, opts: InteriorPlanOptions = {}): InteriorPlan {
  const cut = opts.cut ?? DEFAULT_CUT;
  const minRoom = opts.wideDoors ? MIN_ROOM_WIDE : MIN_ROOM;
  const grid = new Grid(gridLines(footprint.map((p) => p.x)), gridLines(footprint.map((p) => p.y)), footprint);
  const cells: [number, number][] = [];
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) if (grid.isIn(i, j)) cells.push([i, j]);
  const regions = decompose(grid, cells, rng);

  // Two storeys: an upper floor over one end and stairs in the open part beside it.
  const stairWidth = opts.wideDoors ? STAIR_WIDTH_WIDE : STAIR_WIDTH;
  const choice = opts.storeys === 2 ? chooseUpperFloor(grid, regions, cells, minRoom, stairWidth, rng) : undefined;
  const upper = choice && placeStairs(grid, choice, stairWidth, rng);
  const roomRects = splitRooms(grid, upper ? [upper.up, upper.open] : regions, upper?.up, upper?.zone, minRoom, rng);
  const upperBox = upper && grid.box(upper.up);
  const rooms = makeRooms(grid, roomRects, upperBox);
  const upperRoom = upperBox ? rooms.length - 1 : -1;
  const stairs = upper?.stairs;
  if (stairs) stairs.room = grid.roomAt(stairs.box.getCenter(new Vector2()));

  const walls = cutWalls(grid, resolveOverlaps(wallRuns(grid)), upperBox, cut);
  if (upperBox) walls.push(...upperWalls(walls, upperBox, upperRoom, cut));

  const draft: Draft = {
    footprint, opts, rng, rooms, walls, ground: walls.filter((w) => w.storey === 1), entrances: [], stairs, upperRoom,
    minDoor: opts.wideDoors ? DOOR_WIDE : DOOR_NARROW,
  };
  const outside = entranceWalls(draft);
  placeEntrances(draft, outside);
  typeRooms(draft);
  placeDoors(draft, outside);
  placeBlockedDoors(draft);
  placeWindows(draft);
  const { lanes, doorZones, keepClear } = planLanes(draft);
  const porch = planPorch(draft);
  return {
    footprint, storeys: upper ? 2 : 1, cut, rooms, walls, entrances: draft.entrances, porch, stairs, upperFloor: upperBox, lanes, doorZones, keepClear,
  };
}
