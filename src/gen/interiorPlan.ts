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
const GRID = 64;
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
const STAIR_OPEN_LENGTH = PARTITION / 2 + STAIR_RUN + GRID + EXTERIOR_WALL + 32;
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
const other = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');

/** Grid lines through the polygon's corners, every 64 units between them (the last cell takes the rest). */
function gridLines(values: number[]): number[] {
  const sorted = [...new Set(values.map((x) => Math.round(x)))].sort((a, b) => a - b);
  const out: number[] = [sorted[0]];
  for (let k = 0; k + 1 < sorted.length; k++) {
    let x = sorted[k] + GRID;
    while (sorted[k + 1] - x >= GRID) { out.push(x); x += GRID; }
    out.push(sorted[k + 1]);
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
    const find = (lines: number[], value: number) => {
      if (value < lines[0] || value >= lines[lines.length - 1]) return -1;
      let k = 0;
      while (k + 1 < lines.length && lines[k + 1] <= value) k++;
      return k;
    };
    return [find(this.xs, p.x), find(this.ys, p.y)];
  }
  roomAt(p: Vector2): number { const [i, j] = this.cellAt(p); return i < 0 || j < 0 ? -1 : this.roomOf(i, j); }
  inAt(p: Vector2): boolean { const [i, j] = this.cellAt(p); return i >= 0 && j >= 0 && this.isIn(i, j); }
  box(rect: CellRect): Box2 { return new Box2(new Vector2(this.xs[rect.i0], this.ys[rect.j0]), new Vector2(this.xs[rect.i1], this.ys[rect.j1])); }
}

const cellsRect = (cells: [number, number][]): CellRect | null => {
  if (!cells.length) return null;
  const i0 = Math.min(...cells.map((c) => c[0])), i1 = Math.max(...cells.map((c) => c[0])) + 1;
  const j0 = Math.min(...cells.map((c) => c[1])), j1 = Math.max(...cells.map((c) => c[1])) + 1;
  return cells.length === (i1 - i0) * (j1 - j0) ? { i0, i1, j0, j1 } : null;
};

/** Every straight cut that splits the cells into two rectangles (an L has two). */
function rectPairs(cells: [number, number][]): [CellRect, CellRect][] {
  const out: [CellRect, CellRect][] = [];
  const i1 = Math.max(...cells.map((c) => c[0])) + 1, j1 = Math.max(...cells.map((c) => c[1])) + 1;
  for (let k = 1; k < i1; k++) {
    const before = cellsRect(cells.filter((c) => c[0] < k)), after = cellsRect(cells.filter((c) => c[0] >= k));
    if (before && after) out.push([before, after]);
  }
  for (let k = 1; k < j1; k++) {
    const before = cellsRect(cells.filter((c) => c[1] < k)), after = cellsRect(cells.filter((c) => c[1] >= k));
    if (before && after) out.push([before, after]);
  }
  return out;
}

/** Splits a set of cells into rectangles: cuts through inner corners until every piece is a rectangle. */
function decompose(grid: Grid, cells: [number, number][], rng: Rng): CellRect[] {
  if (!cells.length) return [];
  const i0 = Math.min(...cells.map((c) => c[0])), i1 = Math.max(...cells.map((c) => c[0])) + 1;
  const j0 = Math.min(...cells.map((c) => c[1])), j1 = Math.max(...cells.map((c) => c[1])) + 1;
  if (cells.length === (i1 - i0) * (j1 - j0)) return [{ i0, i1, j0, j1 }];
  const isRect = (group: [number, number][]) => {
    if (!group.length) return false;
    const minI = Math.min(...group.map((c) => c[0])), endI = Math.max(...group.map((c) => c[0])) + 1;
    const minJ = Math.min(...group.map((c) => c[1])), endJ = Math.max(...group.map((c) => c[1])) + 1;
    return group.length === (endI - minI) * (endJ - minJ);
  };
  let best: { score: number; parts: [number, number][][] }[] = [];
  let bestScore = -1;
  const consider = (parts: [number, number][][]) => {
    if (parts.some((part) => !part.length)) return;
    const score = parts.filter(isRect).length;
    if (score > bestScore) { bestScore = score; best = []; }
    if (score === bestScore) best.push({ score, parts });
  };
  for (let k = i0 + 1; k < i1; k++) consider([cells.filter((c) => c[0] < k), cells.filter((c) => c[0] >= k)]);
  for (let k = j0 + 1; k < j1; k++) consider([cells.filter((c) => c[1] < k), cells.filter((c) => c[1] >= k)]);
  const chosen = rng.pick(best);
  return chosen.parts.flatMap((part) => decompose(grid, part, rng));
}

/** A wall box during planning. */
interface WallBox { box: Box2; axis: Axis; exterior: boolean }

const overlapArea = (a: Box2, b: Box2) => Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)) * Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y));
const lengthAlong = (box: Box2, axis: Axis) => box.max[axis] - box.min[axis];

/** Higher wins a corner: exterior over partitions, then walls along x over walls along y. */
const priority = (wall: WallBox) => (wall.exterior ? 2 : 0) + (wall.axis === 'x' ? 1 : 0);

/**
 * Makes wall boxes disjoint. A wall that ends inside another is cut back to its face; at corners where both
 * end, the higher priority one keeps the corner; where two walls cross, the lower priority one is split.
 */
function resolveOverlaps(walls: WallBox[]): WallBox[] {
  let remaining = walls.filter((wall) => lengthAlong(wall.box, wall.axis) > EPS);
  for (let guard = 0; guard < 10000; guard++) {
    let found = false;
    outer: for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const first = remaining[i], second = remaining[j];
        if (overlapArea(first.box, second.box) <= EPS) continue;
        found = true;
        const overlap = first.box.clone().intersect(second.box);
        const ends = (wall: WallBox) => ({ start: overlap.min[wall.axis] <= wall.box.min[wall.axis] + EPS, end: overlap.max[wall.axis] >= wall.box.max[wall.axis] - EPS });
        const firstEnds = ends(first), secondEnds = ends(second);
        const firstAtEnd = firstEnds.start || firstEnds.end, secondAtEnd = secondEnds.start || secondEnds.end;
        let loser: WallBox;
        if (firstAtEnd && !secondAtEnd) loser = first;
        else if (secondAtEnd && !firstAtEnd) loser = second;
        else loser = priority(first) >= priority(second) ? second : first;
        const loserEnds = loser === first ? firstEnds : secondEnds;
        const axis = loser.axis;
        const rest: WallBox[] = [];
        if (loserEnds.start && loserEnds.end) { /* entirely inside: drop */ } else if (loserEnds.start) {
          loser.box.min[axis] = overlap.max[axis]; rest.push(loser);
        } else if (loserEnds.end) {
          loser.box.max[axis] = overlap.min[axis]; rest.push(loser);
        } else {
          const before = loser.box.clone(), after = loser.box.clone();
          before.max[axis] = overlap.min[axis];
          after.min[axis] = overlap.max[axis];
          rest.push({ ...loser, box: before }, { ...loser, box: after });
        }
        remaining = [...remaining.filter((wall) => wall !== loser), ...rest.filter((wall) => lengthAlong(wall.box, wall.axis) > EPS)];
        break outer;
      }
    }
    if (!found) break;
  }
  return remaining;
}

/** Free intervals of [lo, hi] after removing `blocked` ranges. */
function freeIntervals(lo: number, hi: number, blocked: [number, number][]): [number, number][] {
  let out: [number, number][] = hi > lo ? [[lo, hi]] : [];
  for (const [blockFrom, blockTo] of blocked) {
    out = out.flatMap(([from, to]): [number, number][] => {
      if (blockTo <= from || blockFrom >= to) return [[from, to]];
      const parts: [number, number][] = [];
      if (blockFrom > from) parts.push([from, blockFrom]);
      if (blockTo < to) parts.push([blockTo, to]);
      return parts;
    });
  }
  return out;
}

/** Height of the storey a wall stands on, above z0. */
export const storeyBase = (wall: { storey: 1 | 2 }) => (wall.storey - 1) * STOREY;

export function wallLength(wall: PlanWall): number {
  return wall.b.distanceTo(wall.a);
}

/** The wall's box seen from above. */
export function wallBox(wall: PlanWall): Box2 {
  const half = wall.thickness / 2;
  return wall.axis === 'x'
    ? new Box2(new Vector2(wall.a.x, wall.a.y - half), new Vector2(wall.b.x, wall.a.y + half))
    : new Box2(new Vector2(wall.a.x - half, wall.a.y), new Vector2(wall.a.x + half, wall.b.y));
}

/** Unit direction a→b and its left normal. */
export function wallDirs(wall: PlanWall): { dir: Vector2; left: Vector2 } {
  return wall.axis === 'x' ? { dir: new Vector2(1, 0), left: new Vector2(0, 1) } : { dir: new Vector2(0, 1), left: new Vector2(-1, 0) };
}

/** Point `along` units along the wall's centre line. */
export function wallPoint(wall: PlanWall, along: number): Vector2 {
  return wall.a.clone().addScaledVector(wallDirs(wall).dir, along);
}

/**
 * The outline of a union of axis-aligned rectangles that share edges (an L-shaped lot of two wings), counter-
 * clockwise.
 */
export function outlineOf(rects: Box2[]): Vector2[] {
  const xs = [...new Set(rects.flatMap((rect) => [rect.min.x, rect.max.x]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((rect) => [rect.min.y, rect.max.y]))].sort((a, b) => a - b);
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i + 1 < xs.length && j + 1 < ys.length
    && rects.some((rect) => rect.containsPoint(new Vector2((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)));
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
  return out.filter((point, i) => {
    const before = out[(i + out.length - 1) % out.length], after = out[(i + 1) % out.length];
    return (point.x - before.x) * (after.y - point.y) - (point.y - before.y) * (after.x - point.x) !== 0;
  });
}

/** Rooms that share a wall with an opening of kind door or gap between them. */
export function doorGraph(plan: InteriorPlan): Map<number, Set<number>> {
  const graph = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!graph.has(a)) graph.set(a, new Set());
    graph.get(a)!.add(b);
  };
  for (const wall of plan.walls) {
    if (!wall.openings.some((opening) => opening.kind !== 'window' && !opening.blocked)) continue;
    link(wall.left, wall.right);
    link(wall.right, wall.left);
  }
  if (plan.stairs) {
    const up = plan.rooms.findIndex((room) => room.storey === 2);
    if (up >= 0) { link(plan.stairs.room, up); link(up, plan.stairs.room); }
  }
  return graph;
}

/** Area of a box seen from above. */
const boxArea = (box: Box2) => (box.max.x - box.min.x) * (box.max.y - box.min.y);

// Cell rectangles along an axis: grid lines, first and past-the-end cell index, a sub-range, the length in units.
const lines = (grid: Grid, axis: Axis) => (axis === 'x' ? grid.xs : grid.ys);
const firstCell = (rect: CellRect, axis: Axis) => (axis === 'x' ? rect.i0 : rect.j0);
const endCell = (rect: CellRect, axis: Axis) => (axis === 'x' ? rect.i1 : rect.j1);
const withRange = (rect: CellRect, axis: Axis, from: number, to: number): CellRect => (axis === 'x' ? { ...rect, i0: from, i1: to } : { ...rect, j0: from, j1: to });
const rectLength = (grid: Grid, rect: CellRect, axis: Axis) => lines(grid, axis)[endCell(rect, axis)] - lines(grid, axis)[firstCell(rect, axis)];

/** Whether a point lies under the upper floor (within EPS). */
const underUpper = (upperBox: Box2 | undefined, point: Vector2) => !!upperBox && point.x >= upperBox.min.x - EPS && point.x <= upperBox.max.x + EPS && point.y >= upperBox.min.y - EPS && point.y <= upperBox.max.y + EPS;

/** The upper floor over `up` and the open part with the stairs, beside it on the `side` (+1/-1) of `up` along `axis`. */
interface UpperChoice { up: CellRect; open: CellRect; axis: Axis; side: 1 | -1 }

/**
 * Two storeys: picks an upper floor over one end of the house (at most half of it, preferably at least a third)
 * whose open part beside it is long and wide enough for a flight.
 */
function chooseUpperFloor(grid: Grid, regions: CellRect[], cells: [number, number][], minRoom: number, stairWidth: number, rng: Rng): UpperChoice | undefined {
  const area = regions.reduce((sum, region) => sum + boxArea(grid.box(region)), 0);
  const choices: UpperChoice[] = [];
  const tryPair = (up: CellRect, open: CellRect, axis: Axis, side: 1 | -1) => {
    if (boxArea(grid.box(up)) > area / 2 + EPS) return;
    if (rectLength(grid, up, axis) < minRoom || rectLength(grid, open, axis) < STAIR_OPEN_LENGTH) return;
    if (rectLength(grid, open, other(axis)) < stairWidth + EXTERIOR_WALL + GRID) return;
    choices.push({ up, open, axis, side });
  };
  if (regions.length === 1) {
    const whole = regions[0];
    for (const axis of ['x', 'y'] as const) {
      for (let k = firstCell(whole, axis) + 1; k < endCell(whole, axis); k++) {
        // Upper floor at the low end (open part beyond, side +1) or at the high end.
        tryPair(withRange(whole, axis, firstCell(whole, axis), k), withRange(whole, axis, k, endCell(whole, axis)), axis, 1);
        tryPair(withRange(whole, axis, k, endCell(whole, axis)), withRange(whole, axis, firstCell(whole, axis), k), axis, -1);
      }
    }
  } else if (regions.length === 2) {
    for (const [up, open] of rectPairs(cells).flatMap(([p, q]) => [[p, q], [q, p]])) {
      for (const axis of ['x', 'y'] as const) {
        if (lines(grid, axis)[endCell(up, axis)] === lines(grid, axis)[firstCell(open, axis)]) tryPair(up, open, axis, 1);
        if (lines(grid, axis)[firstCell(up, axis)] === lines(grid, axis)[endCell(open, axis)]) tryPair(up, open, axis, -1);
      }
    }
  }
  const good = choices.filter((candidate) => boxArea(grid.box(candidate.up)) >= area / 3);
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
  const openBox = grid.box(open), upperBox = grid.box(up);
  const boundary = side === 1 ? openBox.min[axis] : openBox.max[axis];
  const wallSides = ([-1, 1] as const).filter((facing) => {
    // Just past the open part's side, a little way from the boundary, must be outside the house.
    const probe = new Vector2();
    probe[axis] = boundary + side * 8;
    probe[across] = facing === -1 ? openBox.min[across] - 1 : openBox.max[across] + 1;
    const near = facing === -1 ? openBox.min[across] + EXTERIOR_WALL : openBox.max[across] - EXTERIOR_WALL;
    const far = near - facing * stairWidth;
    const lands = Math.min(near, far) >= upperBox.min[across] + EXTERIOR_WALL - EPS && Math.max(near, far) <= upperBox.max[across] - EXTERIOR_WALL + EPS;
    return !grid.inAt(probe) && lands;
  });
  if (!wallSides.length) return undefined;
  const wallSide = rng.pick(wallSides);
  const wallFace = wallSide === -1 ? openBox.min[across] + EXTERIOR_WALL : openBox.max[across] - EXTERIOR_WALL;
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
  if (side === 1) zone.max[axis] += GRID; else zone.min[axis] -= GRID;
  if (wallSide === -1) zone.min[across] = openBox.min[across]; else zone.max[across] = openBox.max[across];
  return { up, open, stairs, zone };
}

/** Whether to split a width × height rectangle: wings of SPLIT_LENGTH always at the top level, else by chance growing with the area. */
const wantsSplit = (width: number, height: number, depth: number, rng: Rng) => (depth === 0 && Math.max(width, height) >= SPLIT_LENGTH)
  || rng.chance(Math.min(1, Math.max(0, (width * height - SPLIT_MIN_AREA) / (SPLIT_MAX_AREA - SPLIT_MIN_AREA))));

/** Grid lines across `axis` where `rect` may be split: both rooms at least `minRoom`, never through the stairs and the space in front of them. */
function splitLines(grid: Grid, rect: CellRect, axis: Axis, zone: Box2 | undefined, minRoom: number): number[] {
  const across = other(axis);
  const positions = lines(grid, axis);
  const cuts: number[] = [];
  for (let k = firstCell(rect, axis) + 1; k < endCell(rect, axis); k++) {
    const position = positions[k];
    if (position - positions[firstCell(rect, axis)] < minRoom || positions[endCell(rect, axis)] - position < minRoom) continue;
    if (zone) {
      const rectBox = grid.box(rect);
      const crosses = position > zone.min[axis] - EPS && position < zone.max[axis] + EPS
        && Math.min(zone.max[across], rectBox.max[across]) > Math.max(zone.min[across], rectBox.min[across]);
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
  const split = (rect: CellRect, depth: number) => {
    const width = rectLength(grid, rect, 'x'), height = rectLength(grid, rect, 'y');
    if (wantsSplit(width, height, depth, rng)) {
      const axes: Axis[] = width >= height ? ['x', 'y'] : ['y', 'x'];
      for (const axis of axes) {
        const cuts = splitLines(grid, rect, axis, zone, minRoom);
        if (!cuts.length) continue;
        const k = rng.pick(cuts);
        split(withRange(rect, axis, firstCell(rect, axis), k), depth + 1);
        split(withRange(rect, axis, k, endCell(rect, axis)), depth + 1);
        return;
      }
    }
    roomRects.push(rect);
  };
  for (const rect of rects) if (rect === upper) roomRects.push(rect); else split(rect, 0);
  return roomRects;
}

/**
 * One ground room per rectangle, marked on the grid. Ground rooms under the upper floor are out of the camera's
 * sight: sealed off. The upper floor is the last room.
 */
function makeRooms(grid: Grid, roomRects: CellRect[], upperBox: Box2 | undefined): Room[] {
  const rooms: Room[] = roomRects.map((rect) => ({ box: grid.box(rect), type: 'living', storey: 1 }));
  roomRects.forEach((rect, index) => {
    for (let j = rect.j0; j < rect.j1; j++) for (let i = rect.i0; i < rect.i1; i++) grid.room[j * grid.nx + i] = index;
  });
  for (const room of rooms) if (underUpper(upperBox, room.box.getCenter(new Vector2()))) room.sealed = true;
  if (upperBox) rooms.push({ box: upperBox.clone(), type: 'bedroom', storey: 2 });
  return rooms;
}

/** What lies on either side of a grid line: the same room (none), two rooms (a partition), or the outside below or above it. */
type EdgeKind = 'none' | 'part' | 'ext-' | 'ext+';

/** The edge kind at cell `along` (counted along `axis`), between cells k-1 and k across it. */
function edgeKind(grid: Grid, axis: Axis, along: number, k: number): EdgeKind {
  const roomOf = (index: number) => (axis === 'x' ? grid.roomOf(along, index) : grid.roomOf(index, along));
  const isIn = (index: number) => (axis === 'x' ? grid.isIn(along, index) : grid.isIn(index, along));
  const below = roomOf(k - 1), above = roomOf(k);
  if (below === above) return 'none';
  if (below === -1 && !isIn(k - 1)) return 'ext+';
  if (above === -1 && !isIn(k)) return 'ext-';
  return 'part';
}

/** The box of a wall from `from` to `to` along `axis` on the grid line at `line`. */
function wallRun(grid: Grid, axis: Axis, line: number, from: number, to: number, kind: EdgeKind): WallBox {
  const across = other(axis);
  const box = new Box2();
  if (kind === 'part') {
    box.min[across] = line - PARTITION / 2; box.max[across] = line + PARTITION / 2;
  } else {
    const inward = kind === 'ext+' ? 1 : -1;
    box.min[across] = Math.min(line, line + inward * EXTERIOR_WALL); box.max[across] = Math.max(line, line + inward * EXTERIOR_WALL);
    // Inner corners: reach across the corner so the two walls close it.
    const probe = (at: number, beyond: number) => {
      const point = new Vector2(); point[axis] = at + beyond; point[across] = line - inward;
      return grid.inAt(point);
    };
    if (probe(from, -1)) from -= EXTERIOR_WALL;
    if (probe(to, 1)) to += EXTERIOR_WALL;
  }
  box.min[axis] = from; box.max[axis] = to;
  return { box, axis, exterior: kind !== 'part' };
}

/** Walls from the cell edges: runs along each grid line where the room changes. */
function wallRuns(grid: Grid): WallBox[] {
  const boxes: WallBox[] = [];
  for (const axis of ['x', 'y'] as const) {
    const along = lines(grid, axis), across = lines(grid, other(axis));
    const cellCount = along.length - 1;
    for (let k = 0; k < across.length; k++) {
      let start = 0;
      while (start < cellCount) {
        const kind = edgeKind(grid, axis, start, k);
        if (kind === 'none') { start++; continue; }
        let end = start + 1;
        while (end < cellCount && edgeKind(grid, axis, end, k) === kind) end++;
        boxes.push(wallRun(grid, axis, across[k], along[start], along[end], kind));
        start = end;
      }
    }
  }
  return boxes;
}

/** The rooms on the left and right of a→b of a wall box, at `at` along its axis. */
function sideRooms(grid: Grid, box: Box2, axis: Axis, at: number): [number, number] {
  const across = other(axis);
  const centre = (box.min[across] + box.max[across]) / 2, reach = (box.max[across] - box.min[across]) / 2 + 1;
  const pointAt = (offset: number) => { const point = new Vector2(); point[axis] = at; point[across] = centre + offset; return point; };
  // Left of a→b: +y for walls along x, -x for walls along y.
  const leftSign = axis === 'x' ? 1 : -1;
  return [grid.roomAt(pointAt(leftSign * reach)), grid.roomAt(pointAt(-leftSign * reach))];
}

/**
 * Ground floor walls: splits the wall boxes where the room on either side changes, so every piece faces one room
 * per side. Walls under the upper floor reach up to it.
 */
function cutWalls(grid: Grid, boxes: WallBox[], upperBox: Box2 | undefined, cut: number): PlanWall[] {
  const walls: PlanWall[] = [];
  for (const run of boxes) {
    const axis = run.axis, across = other(axis);
    const cuts = [run.box.min[axis]];
    for (const line of lines(grid, axis)) {
      if (line <= run.box.min[axis] + EPS || line >= run.box.max[axis] - EPS) continue;
      const [leftBefore, rightBefore] = sideRooms(grid, run.box, axis, line - 1), [leftAfter, rightAfter] = sideRooms(grid, run.box, axis, line + 1);
      if (leftBefore !== leftAfter || rightBefore !== rightAfter) cuts.push(line);
    }
    cuts.push(run.box.max[axis]);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const centre = (run.box.min[across] + run.box.max[across]) / 2;
      const a = new Vector2(), b = new Vector2();
      a[axis] = cuts[k]; a[across] = centre; b[axis] = cuts[k + 1]; b[across] = centre;
      const [left, right] = sideRooms(grid, run.box, axis, (cuts[k] + cuts[k + 1]) / 2);
      const under = underUpper(upperBox, a.clone().add(b).multiplyScalar(0.5));
      walls.push({
        a, b, axis, thickness: run.exterior ? EXTERIOR_WALL : PARTITION, exterior: run.exterior, storey: 1,
        left, right, bottom: FLOOR_TOP, top: under ? STOREY : cut, openings: [],
      });
    }
  }
  return walls;
}

/** Upper storey: the outside walls around the upper floor (the side facing the open part gets a railing). */
function upperWalls(ground: PlanWall[], upperBox: Box2, upperRoom: number, cut: number): PlanWall[] {
  return ground.filter((candidate) => candidate.exterior && underUpper(upperBox, candidate.a.clone().add(candidate.b).multiplyScalar(0.5))).map((wall) => ({
    ...wall, a: wall.a.clone(), b: wall.b.clone(), storey: 2,
    left: wall.left === -1 ? -1 : upperRoom, right: wall.right === -1 ? -1 : upperRoom,
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
function blockedOn(draft: Draft, wall: PlanWall, margin: number): [number, number][] {
  const wallRect = wallBox(wall), axis = wall.axis, across = other(axis);
  const blocked: [number, number][] = [];
  const add = (box: Box2) => {
    const touches = (box.min[across] <= wallRect.max[across] + EPS && box.max[across] >= wallRect.min[across] - EPS)
      && Math.min(box.max[axis], wallRect.max[axis]) - Math.max(box.min[axis], wallRect.min[axis]) > -EPS;
    if (touches) blocked.push([box.min[axis] - wallRect.min[axis] - margin, box.max[axis] - wallRect.min[axis] + margin]);
  };
  for (const joining of draft.walls) {
    if (joining === wall || joining.storey !== wall.storey || joining.axis === wall.axis) continue;
    add(wallBox(joining));
  }
  if (draft.stairs && wall.storey === 1) add(draft.stairs.box);
  return blocked;
}

/** Stretches of a wall where an opening may go, `margin` clear of its ends, joining walls and other openings. */
const freeOn = (draft: Draft, wall: PlanWall, margin: number) => freeIntervals(margin, wallLength(wall) - margin, [
  ...blockedOn(draft, wall, margin),
  ...wall.openings.map((opening): [number, number] => [opening.from - margin * 2, opening.to + margin * 2]),
]);
const fits = (draft: Draft, wall: PlanWall, width: number) => freeOn(draft, wall, DOOR_MARGIN).some(([from, to]) => to - from >= width);
const snap8 = (x: number) => Math.round(x / 8) * 8;
const longest = (list: PlanWall[]) => list.reduce((a, b) => (wallLength(b) > wallLength(a) ? b : a));
const groundRooms = (rooms: Room[]) => rooms.map((_, i) => i).filter((i) => rooms[i].storey === 1);

/** Adds an opening to a wall: in the widest free stretch's middle if `centred`, else anywhere free (snapped to 8). */
function placeOpening(draft: Draft, wall: PlanWall, width: number, kind: OpeningKind, margin: number, centred = false): Opening | null {
  const { rng } = draft;
  const free = freeOn(draft, wall, margin).filter(([freeStart, freeEnd]) => freeEnd - freeStart >= width);
  if (!free.length) return null;
  const [start, end] = centred ? free.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a)) : rng.pick(free);
  let from = centred ? (start + end) / 2 - width / 2 : start + rng.range(0, end - start - width);
  from = Math.min(end - width, Math.max(start, snap8(from)));
  const opening: Opening = kind === 'window'
    ? { from, to: from + width, kind, sill: storeyBase(wall) + WINDOW_SILL, lintel: storeyBase(wall) + WINDOW_LINTEL }
    : { from, to: from + width, kind, sill: wall.bottom, lintel: Math.min(wall.top, wall.bottom + (draft.opts.wideDoors ? DOOR_HEIGHT_WIDE : DOOR_HEIGHT)) };
  // Gaps, and doors with only a sliver of wall above them, reach the wall top.
  if (kind === 'gap' || opening.lintel > wall.top - 8) opening.lintel = wall.top;
  wall.openings.push(opening);
  wall.openings.sort((p, q) => p.from - q.from);
  return opening;
}

/** An inside door: wide doors, or mostly the normal width where it fits, else narrow. */
const doorWidth = (draft: Draft, wall: PlanWall) => (draft.opts.wideDoors ? DOOR_WIDE : fits(draft, wall, DOOR) && draft.rng.chance(0.6) ? DOOR : DOOR_NARROW);
/** An outside door: wide doors, or the normal width where it fits, else narrow. */
const outerDoorWidth = (draft: Draft, wall: PlanWall) => (draft.opts.wideDoors ? DOOR_WIDE : fits(draft, wall, DOOR) ? DOOR : DOOR_NARROW);

const outNormal = (wall: PlanWall) => { const { left } = wallDirs(wall); return wall.left === -1 ? left : left.clone().negate(); };
/** The room inside an outside wall. */
const insideRoom = (wall: PlanWall) => (wall.left === -1 ? wall.right : wall.left);
const sealedSide = (draft: Draft, wall: PlanWall) => [wall.left, wall.right].some((room) => room >= 0 && draft.rooms[room].sealed);

function facesNeighbour(draft: Draft, wall: PlanWall): boolean {
  const face = wallBox(wall).translate(outNormal(wall).multiplyScalar(wall.thickness / 2 + 1));
  return (draft.opts.noEntrance ?? []).some((box) => Math.min(box.max.x, face.max.x) - Math.max(box.min.x, face.min.x) > 0 && Math.min(box.max.y, face.max.y) - Math.max(box.min.y, face.min.y) > 0);
}

/** Whether an outside wall's outer face lies on footprint edge `edge`. */
function onEdge(footprint: Vector2[], wall: PlanWall, edge: number): boolean {
  const edgeStart = footprint[edge], edgeEnd = footprint[(edge + 1) % footprint.length];
  const normal = outNormal(wall), mid = wall.a.clone().add(wall.b).multiplyScalar(0.5).addScaledVector(normal, wall.thickness / 2);
  const edgeVector = new Vector2().subVectors(edgeEnd, edgeStart), edgeLength = edgeVector.length();
  if (edgeLength < EPS) return false;
  const position = new Vector2().subVectors(mid, edgeStart).dot(edgeVector) / edgeLength;
  const distance = Math.abs(new Vector2().subVectors(mid, edgeStart).cross(edgeVector) / edgeLength);
  return distance < 1 && position > -EPS && position < edgeLength + EPS;
}

/** Outside walls an entrance may open in: not into a sealed room, and away from neighbouring buildings unless that leaves no way in. */
function entranceWalls(draft: Draft): PlanWall[] {
  const allOutside = draft.ground.filter((wall) => wall.exterior && !sealedSide(draft, wall));
  const facingOut = allOutside.filter((wall) => !facesNeighbour(draft, wall));
  return facingOut.some((wall) => fits(draft, wall, draft.minDoor)) ? facingOut : allOutside;
}

const usable = (draft: Draft, list: PlanWall[], width: number) => list.filter((wall) => fits(draft, wall, width));

function addEntrance(draft: Draft, wall: PlanWall): void {
  const opening = placeOpening(draft, wall, outerDoorWidth(draft, wall), 'door', DOOR_MARGIN, draft.rng.chance(0.5));
  if (!opening) return;
  const normal = outNormal(wall);
  draft.entrances.push({
    wall: draft.walls.indexOf(wall), opening: wall.openings.indexOf(opening), out: normal, room: insideRoom(wall),
    centre: wallPoint(wall, (opening.from + opening.to) / 2).addScaledVector(normal, wall.thickness / 2),
  });
}

/** Entrances: the requested edges, or one door (two on long houses) on different sides. */
function placeEntrances(draft: Draft, outside: PlanWall[]): void {
  const { opts, rng, entrances } = draft;
  if (opts.entranceEdges?.length) {
    for (const edge of opts.entranceEdges) {
      const candidates = usable(draft, outside.filter((wall) => onEdge(draft.footprint, wall, edge)), draft.minDoor);
      if (candidates.length) addEntrance(draft, rng.pick(candidates));
    }
  }
  if (!entrances.length) {
    const candidates = usable(draft, outside, draft.minDoor);
    // Longer walls first: the front door is on a main side.
    candidates.sort((p, q) => wallLength(q) - wallLength(p));
    if (candidates.length) addEntrance(draft, rng.pick(candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 2)))));
  }
  const size = new Box2().setFromPoints(draft.footprint).getSize(new Vector2());
  if (entrances.length !== 1 || Math.max(size.x, size.y) <= LONG_HOUSE) return;
  // The second one on another side, as far from the first as possible and preferably into another room.
  const first = draft.walls[entrances[0].wall];
  const firstNormal = outNormal(first);
  const otherSide = usable(draft, outside.filter((wall) => !outNormal(wall).equals(firstNormal)), draft.minDoor);
  if (!otherSide.length) return;
  const distance = (wall: PlanWall) => wall.a.clone().add(wall.b).distanceTo(first.a.clone().add(first.b)) + (insideRoom(wall) === entrances[0].room ? -10000 : 0);
  otherSide.sort((p, q) => distance(q) - distance(p));
  addEntrance(draft, otherSide[0]);
}

/** Room types: hall or living room at the front door, kitchen next to it, bath next to the kitchen, bedrooms. */
function typeRooms(draft: Draft): void {
  const { rooms, stairs } = draft;
  const neighbours = (room: number) => new Set(draft.ground.filter((wall) => !wall.exterior && (wall.left === room || wall.right === room)).map((wall) => (wall.left === room ? wall.right : wall.left)));
  const areaOf = (room: number) => boxArea(rooms[room].box);
  const ground = groundRooms(rooms);
  const untyped = new Set(ground);
  const assign = (room: number, type: RoomType) => { rooms[room].type = type; untyped.delete(room); };
  const front = draft.entrances.length ? draft.entrances[0].room : ground[0];
  // The untyped room next to `near` (or anywhere) that passes `pred`, first in `order`.
  const pickNear = (near: number[], accepts: (room: number) => boolean, order: (a: number, b: number) => number) => {
    const nearby = new Set(near.flatMap((room) => [...neighbours(room)]));
    const candidates = [...untyped].filter((room) => nearby.has(room) && accepts(room)).sort(order);
    return candidates.length ? candidates[0] : [...untyped].filter(accepts).sort(order)[0];
  };
  if (draft.opts.use === 'workshop') {
    const biggest = [...ground].sort((a, b) => areaOf(b) - areaOf(a))[0];
    assign(biggest, 'workshop');
    for (const room of [...untyped]) assign(room, 'storage');
  } else if (ground.length === 1) {
    assign(front, 'living');
  } else {
    const frontSize = rooms[front].box.getSize(new Vector2());
    assign(front, ground.length > 2 && Math.min(frontSize.x, frontSize.y) <= HALL_WIDTH ? 'hall' : 'living');
    if (!ground.some((room) => rooms[room].type === 'living' && !untyped.has(room))) {
      const big = [...untyped].sort((a, b) => areaOf(b) - areaOf(a))[0];
      if (big !== undefined) assign(big, 'living');
    }
    const lived = ground.filter((room) => !untyped.has(room));
    const kitchen = pickNear(lived, () => true, (a, b) => Math.abs(areaOf(a) - KITCHEN_AREA) - Math.abs(areaOf(b) - KITCHEN_AREA));
    if (kitchen !== undefined) assign(kitchen, 'kitchen');
    if (kitchen !== undefined && untyped.size) {
      const bath = pickNear([kitchen], (room) => areaOf(room) <= BATH_MAX_AREA, (a, b) => areaOf(a) - areaOf(b));
      if (bath !== undefined && (untyped.size > 1 || areaOf(bath) <= LAST_BATH_AREA)) assign(bath, 'bath');
    }
    for (const room of [...untyped]) assign(room, areaOf(room) >= BEDROOM_AREA ? 'bedroom' : 'storage');
  }
  if (stairs && rooms[stairs.room].type === 'bath') rooms[stairs.room].type = 'living';
}

/** Inside walls between two rooms units may enter, by room pair ("a:b", a < b). */
function wallsByRoomPair(draft: Draft): Map<string, PlanWall[]> {
  const pairs = new Map<string, PlanWall[]>();
  for (const wall of draft.ground) {
    if (wall.exterior || wall.left < 0 || wall.right < 0 || wall.left === wall.right || sealedSide(draft, wall)) continue;
    const key = `${Math.min(wall.left, wall.right)}:${Math.max(wall.left, wall.right)}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key)!.push(wall);
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
  const fitting = between.filter((candidate) => fits(draft, candidate, draft.minDoor));
  if (!fitting.length) return false;
  const wall = longest(fitting);
  const types = [draft.rooms[wall.left].type, draft.rooms[wall.right].type];
  const social = types.every((type) => type === 'hall' || type === 'living' || type === 'kitchen');
  const widestFree = freeOn(draft, wall, DOOR_MARGIN).reduce((widest, [from, to]) => Math.max(widest, to - from), 0);
  if (social && !draft.opts.wideDoors && widestFree >= GAP_WIDTH && draft.rng.chance(0.35)) return !!placeOpening(draft, wall, Math.min(GAP_WIDTH, snap8(widestFree - 16)), 'gap', DOOR_MARGIN, true);
  return !!placeOpening(draft, wall, doorWidth(draft, wall), 'door', DOOR_MARGIN);
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
    const [roomA, roomB] = key.split(':').map(Number);
    if (find(roomA) === find(roomB)) continue;
    if (openDoorway(draft, pairs.get(key)!)) { parent[find(roomA)] = find(roomB); doored.add(key); }
  }
  for (const key of keys) if (!doored.has(key) && rng.chance(0.2)) openDoorway(draft, pairs.get(key)!);
  for (const room of groundRooms(rooms)) {
    if (rooms[room].sealed || draft.entrances.some((entrance) => find(entrance.room) === find(room))) continue;
    const candidates = usable(draft, outside.filter((wall) => wall.left === room || wall.right === room), draft.minDoor);
    if (candidates.length) addEntrance(draft, rng.pick(candidates));
  }
}

/** A closed-off doorway of a kind picked from `kinds` ('wall': none at all). */
function blockedDoor(draft: Draft, wall: PlanWall, kinds: (Blocker | 'wall')[]): void {
  const kind = draft.rng.pick(kinds);
  if (kind === 'wall' || !fits(draft, wall, draft.minDoor)) return;
  const opening = placeOpening(draft, wall, wall.exterior ? outerDoorWidth(draft, wall) : doorWidth(draft, wall), 'door', DOOR_MARGIN, draft.rng.chance(0.5));
  if (opening) opening.blocked = kind;
}

/**
 * Sealed rooms still show a doorway now and then, closed off: on the wall to a room units can reach, and
 * sometimes on the outside. A plain wall is the fourth choice (no doorway at all).
 */
function placeBlockedDoors(draft: Draft): void {
  const { rooms } = draft;
  for (const room of groundRooms(rooms)) {
    if (!rooms[room].sealed) continue;
    const inner = draft.ground.filter((wall) => !wall.exterior && (wall.left === room || wall.right === room) && wall.left >= 0 && wall.right >= 0 && !(rooms[wall.left].sealed && rooms[wall.right].sealed));
    if (inner.length) blockedDoor(draft, longest(inner), ['door', 'boarded', 'furniture', 'furniture', 'wall']);
    const outer = draft.ground.filter((wall) => wall.exterior && (wall.left === room || wall.right === room));
    if (outer.length && draft.rng.chance(0.35)) blockedDoor(draft, draft.rng.pick(outer), ['door', 'boarded']);
  }
}

/** Windows on outside walls: one width per house, about one per 128–192 units of wall. */
function placeWindows(draft: Draft): void {
  const width = draft.rng.pick(WINDOW_WIDTHS);
  for (const wall of draft.walls.filter((candidate) => candidate.exterior)) {
    for (const [start, end] of freeOn(draft, wall, WINDOW_MARGIN)) {
      const length = end - start;
      const count = Math.min(Math.floor((length + WINDOW_GAP) / (width + WINDOW_GAP)), Math.round(length / draft.rng.pick(WINDOW_SPACINGS)));
      for (let k = 0; k < count; k++) {
        const centre = snap8(start + ((k + 0.5) * length) / count);
        const from = Math.max(start, Math.min(end - width, centre - width / 2));
        wall.openings.push({ from, to: from + width, kind: 'window', sill: storeyBase(wall) + WINDOW_SILL, lintel: Math.min(wall.top, storeyBase(wall) + WINDOW_LINTEL) });
      }
      wall.openings.sort((p, q) => p.from - q.from);
    }
  }
}

/** Lanes from each door into the middle of its room, zones in front of doors on both sides, and the stairs kept clear. */
function planLanes(draft: Draft): { lanes: Box2[]; doorZones: Box2[]; keepClear: Box2[] } {
  const { rooms, stairs } = draft;
  const lanes: Box2[] = [], doorZones: Box2[] = [], keepClear: Box2[] = [];
  const centreOf = (room: number) => rooms[room].box.getCenter(new Vector2());
  const lane = (from: Vector2, to: Vector2, firstAxis: Axis) => {
    const corner = from.clone();
    corner[firstAxis] = to[firstAxis];
    for (const [start, end] of [[from, corner], [corner, to]]) {
      const box = new Box2().setFromPoints([start, end]).expandByScalar(LANE / 2);
      if (box.getSize(new Vector2()).length() > LANE * 1.5) lanes.push(box);
    }
  };
  for (const wall of draft.walls) {
    if (wall.storey !== 1) continue;
    const { dir, left } = wallDirs(wall);
    for (const opening of wall.openings) {
      if (opening.kind === 'window') continue;
      const centre = wallPoint(wall, (opening.from + opening.to) / 2);
      for (const [room, normal] of [[wall.left, left], [wall.right, left.clone().negate()]] as const) {
        // A closed-off doorway keeps the floor in front of it clear (for its blocker) but leads nowhere.
        if (opening.blocked && room >= 0 && rooms[room].sealed) continue;
        const face = centre.clone().addScaledVector(normal, wall.thickness / 2);
        doorZones.push(new Box2().setFromPoints([
          face.clone().addScaledVector(dir, -(opening.to - opening.from) / 2), face.clone().addScaledVector(dir, (opening.to - opening.from) / 2).addScaledVector(normal, DOOR_ZONE),
        ]));
        if (room >= 0 && !opening.blocked) lane(face, centreOf(room), wall.axis === 'x' ? 'y' : 'x');
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
  const entrance = draft.entrances[0], wall = draft.walls[entrance.wall], opening = wall.openings[entrance.opening];
  const depth = rng.pick(PORCH_DEPTHS);
  const half = Math.min(wallLength(wall) / 2 + 32, (opening.to - opening.from) / 2 + rng.pick(PORCH_OVERHANGS));
  const nearCorner = entrance.centre.clone(), farCorner = entrance.centre.clone().addScaledVector(entrance.out, depth);
  nearCorner[wall.axis] -= half; farCorner[wall.axis] += half;
  return new Box2().setFromPoints([nearCorner, farCorner]);
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
    footprint, opts, rng, rooms, walls, ground: walls.filter((wall) => wall.storey === 1), entrances: [], stairs, upperRoom,
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
