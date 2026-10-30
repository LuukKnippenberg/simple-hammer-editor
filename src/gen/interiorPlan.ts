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

export type RoomType = 'hall' | 'living' | 'kitchen' | 'bedroom' | 'bath' | 'storage' | 'workshop';

export interface Room {
  /** Rectangle on the grid, measured to the wall centre lines (exterior walls: the footprint edge). */
  box: Box2;
  type: RoomType;
  storey: 1 | 2;
}

export type OpeningKind = 'door' | 'window' | 'gap';

export interface Opening {
  /** Distances along the wall from `a`. */
  from: number;
  to: number;
  kind: OpeningKind;
  /** Bottom and top of the hole above z0 (a gap or door with its lintel at the wall top has none). */
  sill: number;
  lintel: number;
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
    if (!w.openings.some((o) => o.kind !== 'window')) continue;
    link(w.left, w.right);
    link(w.right, w.left);
  }
  if (plan.stairs) {
    const up = plan.rooms.findIndex((r) => r.storey === 2);
    if (up >= 0) { link(plan.stairs.room, up); link(up, plan.stairs.room); }
  }
  return g;
}

/**
 * Plans the rooms, walls, openings, entrances and (for two storeys) the stairs and upper floor of a house on
 * an axis-aligned footprint (a rectangle, an L or any rectilinear outline; other edges are stepped on the
 * 64 grid).
 */
export function planInterior(footprint: Vector2[], rng: Rng, o: InteriorPlanOptions = {}): InteriorPlan {
  const cut = o.cut ?? 112;
  const minRoom = o.wideDoors ? 192 : 128;
  const grid = new Grid(gridLines(footprint.map((p) => p.x)), gridLines(footprint.map((p) => p.y)), footprint);
  const cells: [number, number][] = [];
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) if (grid.isIn(i, j)) cells.push([i, j]);
  const regions = decompose(grid, cells, rng);
  const area = regions.reduce((s, r) => { const b = grid.box(r); return s + (b.max.x - b.min.x) * (b.max.y - b.min.y); }, 0);
  const lines = (ax: Axis) => (ax === 'x' ? grid.xs : grid.ys);
  const lo = (r: CellRect, ax: Axis) => (ax === 'x' ? r.i0 : r.j0);
  const hi = (r: CellRect, ax: Axis) => (ax === 'x' ? r.i1 : r.j1);
  const withRange = (r: CellRect, ax: Axis, a: number, b: number): CellRect => (ax === 'x' ? { ...r, i0: a, i1: b } : { ...r, j0: a, j1: b });
  const rlen = (r: CellRect, ax: Axis) => lines(ax)[hi(r, ax)] - lines(ax)[lo(r, ax)];

  // Two storeys: an upper floor over one end (at most half the house) and stairs in the open part beside it.
  let storeys: 1 | 2 = 1;
  let upper: CellRect | undefined;
  let stairs: Stairs | undefined;
  let zone: Box2 | undefined;
  const rects: CellRect[] = [];
  if (o.storeys === 2) {
    const stairWidth = o.wideDoors ? 128 : 96;
    const run = 8 * 24;
    type Option = { up: CellRect; open: CellRect; ax: Axis; side: 1 | -1 };
    const options: Option[] = [];
    const tryPair = (up: CellRect, open: CellRect, ax: Axis, side: 1 | -1) => {
      const ub = grid.box(up);
      if ((ub.max.x - ub.min.x) * (ub.max.y - ub.min.y) > area / 2 + EPS) return;
      if (rlen(up, ax) < minRoom || rlen(open, ax) < run + 4 + G + EXTERIOR_WALL + 32) return;
      if (rlen(open, other(ax)) < stairWidth + EXTERIOR_WALL + G) return;
      options.push({ up, open, ax, side });
    };
    if (regions.length === 1) {
      const R = regions[0];
      for (const ax of ['x', 'y'] as const) {
        for (let k = lo(R, ax) + 1; k < hi(R, ax); k++) {
          // Upper floor at the low end (open part beyond, side +1) or at the high end.
          tryPair(withRange(R, ax, lo(R, ax), k), withRange(R, ax, k, hi(R, ax)), ax, 1);
          tryPair(withRange(R, ax, k, hi(R, ax)), withRange(R, ax, lo(R, ax), k), ax, -1);
        }
      }
    } else if (regions.length === 2) {
      for (const [up, open] of rectPairs(cells).flatMap(([p, q]) => [[p, q], [q, p]])) {
        for (const ax of ['x', 'y'] as const) {
          if (lines(ax)[hi(up, ax)] === lines(ax)[lo(open, ax)]) tryPair(up, open, ax, 1);
          if (lines(ax)[lo(up, ax)] === lines(ax)[hi(open, ax)]) tryPair(up, open, ax, -1);
        }
      }
    }
    // Prefer an upper floor of a third to a half of the house.
    const good = options.filter((p) => { const b = grid.box(p.up); return (b.max.x - b.min.x) * (b.max.y - b.min.y) >= area / 3; });
    const choice = good.length ? rng.pick(good) : options.length ? rng.pick(options) : undefined;
    if (choice) {
      const { up, open, ax, side } = choice;
      const oa = other(ax);
      const ob = grid.box(open);
      const boundary = side === 1 ? ob.min[ax] : ob.max[ax];
      // The flight runs along an outside wall of the open part, rising towards the upper floor.
      const ub = grid.box(up);
      const sides = ([-1, 1] as const).filter((s) => {
        const at = s === -1 ? ob.min[oa] - 1 : ob.max[oa] + 1;
        const p = new Vector2();
        p[ax] = boundary + side * 8;
        p[oa] = at;
        // The flight has to land on the upper floor.
        const near = s === -1 ? ob.min[oa] + EXTERIOR_WALL : ob.max[oa] - EXTERIOR_WALL;
        const far = near - s * stairWidth;
        const lands = Math.min(near, far) >= ub.min[oa] + EXTERIOR_WALL - EPS && Math.max(near, far) <= ub.max[oa] - EXTERIOR_WALL + EPS;
        return !grid.inAt(p) && lands;
      });
      if (sides.length) {
        const s = rng.pick(sides);
        const wallFace = s === -1 ? ob.min[oa] + EXTERIOR_WALL : ob.max[oa] - EXTERIOR_WALL;
        const top = boundary + side * PARTITION / 2;
        const bottom = top + side * run;
        const box = new Box2();
        box.min[ax] = Math.min(top, bottom); box.max[ax] = Math.max(top, bottom);
        box.min[oa] = Math.min(wallFace, wallFace - s * stairWidth); box.max[oa] = Math.max(wallFace, wallFace - s * stairWidth);
        const dir = new Vector2(); dir[ax] = -side;
        const mid = (box.min[oa] + box.max[oa]) / 2;
        const foot = new Vector2(); foot[ax] = bottom + side * 32; foot[oa] = mid;
        const head = new Vector2(); head[ax] = boundary - side * 40; head[oa] = mid;
        stairs = { box, dir, foot, head, room: -1, steps: 8, rise: 16, tread: 24, width: stairWidth };
        zone = box.clone();
        if (side === 1) zone.max[ax] += G; else zone.min[ax] -= G;
        if (s === -1) zone.min[oa] = ob.min[oa]; else zone.max[oa] = ob.max[oa];
        storeys = 2;
        upper = up;
        rects.push(up, open);
      }
    }
  }
  if (!rects.length) rects.push(...regions);

  // Rooms: split each rectangle along its longer side until the pieces are room sized.
  const roomRects: CellRect[] = [];
  const split = (r: CellRect, depth: number) => {
    const w = rlen(r, 'x'), h = rlen(r, 'y');
    const a = w * h;
    const wantSplit = depth === 0 && Math.max(w, h) >= 384 ? true : rng.chance(Math.min(1, Math.max(0, (a - 160 * 160) / (320 * 320 - 160 * 160))));
    if (wantSplit) {
      const axes: Axis[] = w >= h ? ['x', 'y'] : ['y', 'x'];
      for (const ax of axes) {
        const cuts: number[] = [];
        for (let k = lo(r, ax) + 1; k < hi(r, ax); k++) {
          const c = lines(ax)[k];
          if (c - lines(ax)[lo(r, ax)] < minRoom || lines(ax)[hi(r, ax)] - c < minRoom) continue;
          // Never through the stairs and the space in front of them.
          if (zone) {
            const b = grid.box(r);
            const crosses = c > zone.min[ax] - EPS && c < zone.max[ax] + EPS
              && Math.min(zone.max[other(ax)], b.max[other(ax)]) > Math.max(zone.min[other(ax)], b.min[other(ax)]);
            if (crosses) continue;
          }
          cuts.push(k);
        }
        if (!cuts.length) continue;
        const k = rng.pick(cuts);
        split(withRange(r, ax, lo(r, ax), k), depth + 1);
        split(withRange(r, ax, k, hi(r, ax)), depth + 1);
        return;
      }
    }
    roomRects.push(r);
  };
  for (const r of rects) split(r, 0);

  const rooms: Room[] = roomRects.map((r) => ({ box: grid.box(r), type: 'living', storey: 1 }));
  roomRects.forEach((r, n) => {
    for (let j = r.j0; j < r.j1; j++) for (let i = r.i0; i < r.i1; i++) grid.room[j * grid.nx + i] = n;
  });
  const upperBox = upper ? grid.box(upper) : undefined;
  const underUpper = (p: Vector2) => !!upperBox && p.x >= upperBox.min.x - EPS && p.x <= upperBox.max.x + EPS && p.y >= upperBox.min.y - EPS && p.y <= upperBox.max.y + EPS;
  let upperRoom = -1;
  if (upperBox) {
    upperRoom = rooms.length;
    rooms.push({ box: upperBox.clone(), type: 'bedroom', storey: 2 });
  }
  if (stairs) stairs.room = grid.roomAt(stairs.box.getCenter(new Vector2()));

  // Walls from the cell edges: runs along each grid line where the room changes.
  const boxes: Box[] = [];
  for (const ax of ['x', 'y'] as const) {
    const oa = other(ax);
    const along = lines(ax), across = lines(oa);
    const n = along.length - 1;
    for (let k = 0; k < across.length; k++) {
      const c = across[k];
      // Cell (index t along, k-1 / k across) on each side of the line.
      const cellOf = (t: number, kk: number) => (ax === 'x' ? grid.roomOf(t, kk) : grid.roomOf(kk, t));
      const inOf = (t: number, kk: number) => (ax === 'x' ? grid.isIn(t, kk) : grid.isIn(kk, t));
      type Kind = 'none' | 'part' | 'ext-' | 'ext+';
      const kindAt = (t: number): Kind => {
        const below = cellOf(t, k - 1), above = cellOf(t, k);
        if (below === above) return 'none';
        if (below === -1 && !inOf(t, k - 1)) return 'ext+';
        if (above === -1 && !inOf(t, k)) return 'ext-';
        return 'part';
      };
      let t = 0;
      while (t < n) {
        const kind = kindAt(t);
        if (kind === 'none') { t++; continue; }
        let e = t + 1;
        while (e < n && kindAt(e) === kind) e++;
        let s0 = along[t], s1 = along[e];
        const box = new Box2();
        if (kind === 'part') {
          box.min[oa] = c - PARTITION / 2; box.max[oa] = c + PARTITION / 2;
        } else {
          const inward = kind === 'ext+' ? 1 : -1;
          box.min[oa] = Math.min(c, c + inward * EXTERIOR_WALL); box.max[oa] = Math.max(c, c + inward * EXTERIOR_WALL);
          // Inner corners: reach across the corner so the two walls close it.
          const probe = (at: number, beyond: number) => {
            const p = new Vector2(); p[ax] = at + beyond; p[oa] = c - inward;
            return grid.inAt(p);
          };
          if (probe(s0, -1)) s0 -= EXTERIOR_WALL;
          if (probe(s1, 1)) s1 += EXTERIOR_WALL;
        }
        box.min[ax] = s0; box.max[ax] = s1;
        boxes.push({ box, axis: ax, exterior: kind !== 'part' });
        t = e;
      }
    }
  }
  const resolved = resolveOverlaps(boxes);

  // Split walls where the room on either side changes, so every piece faces one room per side.
  const walls: PlanWall[] = [];
  const sideRooms = (b: Box2, ax: Axis, at: number) => {
    const oa = other(ax);
    const c = (b.min[oa] + b.max[oa]) / 2, h = (b.max[oa] - b.min[oa]) / 2 + 1;
    const p = (d: number) => { const v = new Vector2(); v[ax] = at; v[oa] = c + d; return v; };
    // Left of a→b: +y for walls along x, -x for walls along y.
    const leftSign = ax === 'x' ? 1 : -1;
    return [grid.roomAt(p(leftSign * h)), grid.roomAt(p(-leftSign * h))];
  };
  for (const w of resolved) {
    const ax = w.axis, oa = other(ax);
    const cuts = [w.box.min[ax]];
    for (const g of lines(ax)) {
      if (g <= w.box.min[ax] + EPS || g >= w.box.max[ax] - EPS) continue;
      const [l0, r0] = sideRooms(w.box, ax, g - 1), [l1, r1] = sideRooms(w.box, ax, g + 1);
      if (l0 !== l1 || r0 !== r1) cuts.push(g);
    }
    cuts.push(w.box.max[ax]);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const c = (w.box.min[oa] + w.box.max[oa]) / 2;
      const a = new Vector2(), b = new Vector2();
      a[ax] = cuts[k]; a[oa] = c; b[ax] = cuts[k + 1]; b[oa] = c;
      const [left, right] = sideRooms(w.box, ax, (cuts[k] + cuts[k + 1]) / 2);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const under = underUpper(mid);
      walls.push({
        a, b, axis: ax, thickness: w.exterior ? EXTERIOR_WALL : PARTITION, exterior: w.exterior, storey: 1,
        left, right, bottom: FLOOR_TOP, top: under ? STOREY : cut, openings: [],
      });
    }
  }
  // Upper storey: the outside walls around the upper floor (the side facing the open part gets a railing).
  if (upperBox) {
    for (const w of walls.filter((x) => x.exterior && underUpper(x.a.clone().add(x.b).multiplyScalar(0.5)))) {
      walls.push({
        ...w, a: w.a.clone(), b: w.b.clone(), storey: 2,
        left: w.left === -1 ? -1 : upperRoom, right: w.right === -1 ? -1 : upperRoom,
        bottom: STOREY, top: STOREY + cut, openings: [],
      });
    }
  }

  // Places where openings can't go: walls joining this one, and the stairs.
  const blockedOn = (w: PlanWall, margin: number): [number, number][] => {
    const wb = wallBox(w), ax = w.axis, oa = other(ax);
    const out: [number, number][] = [];
    const add = (b: Box2) => {
      const touches = (b.min[oa] <= wb.max[oa] + EPS && b.max[oa] >= wb.min[oa] - EPS)
        && Math.min(b.max[ax], wb.max[ax]) - Math.max(b.min[ax], wb.min[ax]) > -EPS;
      if (touches) out.push([b.min[ax] - wb.min[ax] - margin, b.max[ax] - wb.min[ax] + margin]);
    };
    for (const x of walls) {
      if (x === w || x.storey !== w.storey || x.axis === w.axis) continue;
      add(wallBox(x));
    }
    if (stairs && w.storey === 1) add(stairs.box);
    return out;
  };
  const freeOn = (w: PlanWall, margin: number) => freeIntervals(margin, wallLength(w) - margin, [
    ...blockedOn(w, margin),
    ...w.openings.map((x): [number, number] => [x.from - margin * 2, x.to + margin * 2]),
  ]);
  const fits = (w: PlanWall, width: number) => freeOn(w, DOOR_MARGIN).some(([s, e]) => e - s >= width);
  const snap8 = (x: number) => Math.round(x / 8) * 8;
  const placeOpening = (w: PlanWall, width: number, kind: OpeningKind, margin: number, centred = false): Opening | null => {
    const free = freeOn(w, margin).filter(([s, e]) => e - s >= width);
    if (!free.length) return null;
    const [s, e] = centred ? free.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a)) : rng.pick(free);
    let from = centred ? (s + e) / 2 - width / 2 : s + rng.range(0, e - s - width);
    from = Math.min(e - width, Math.max(s, snap8(from)));
    const op: Opening = kind === 'window'
      ? { from, to: from + width, kind, sill: storeyBase(w) + 40, lintel: storeyBase(w) + 96 }
      : { from, to: from + width, kind, sill: w.bottom, lintel: Math.min(w.top, w.bottom + (o.wideDoors ? 112 : 96)) };
    if (kind === 'gap' || op.lintel > w.top - 8) op.lintel = w.top;
    w.openings.push(op);
    w.openings.sort((p, q) => p.from - q.from);
    return op;
  };
  const doorWidth = (w: PlanWall) => (o.wideDoors ? 128 : fits(w, 96) && rng.chance(0.6) ? 96 : 64);

  // Entrances: the requested edges, or one door (two on long houses) on different sides.
  const entrances: Entrance[] = [];
  const ground = walls.filter((w) => w.storey === 1);
  const outNormal = (w: PlanWall) => { const { left } = wallDirs(w); return w.left === -1 ? left : left.clone().negate(); };
  // Doors open away from neighbouring buildings, unless that leaves no way in.
  const minDoor = o.wideDoors ? 128 : 64;
  const facesNeighbour = (w: PlanWall) => {
    const face = wallBox(w).translate(outNormal(w).multiplyScalar(w.thickness / 2 + 1));
    return (o.noEntrance ?? []).some((b) => Math.min(b.max.x, face.max.x) - Math.max(b.min.x, face.min.x) > 0 && Math.min(b.max.y, face.max.y) - Math.max(b.min.y, face.min.y) > 0);
  };
  const allOutside = ground.filter((w) => w.exterior);
  const facingOut = allOutside.filter((w) => !facesNeighbour(w));
  const outside = facingOut.some((w) => fits(w, minDoor)) ? facingOut : allOutside;
  const onEdge = (w: PlanWall, e: number) => {
    const p = footprint[e], q = footprint[(e + 1) % footprint.length];
    const n = outNormal(w), mid = w.a.clone().add(w.b).multiplyScalar(0.5).addScaledVector(n, w.thickness / 2);
    const d = new Vector2().subVectors(q, p), l = d.length();
    if (l < EPS) return false;
    const t = new Vector2().subVectors(mid, p).dot(d) / l;
    const off = Math.abs(new Vector2().subVectors(mid, p).cross(d) / l);
    return off < 1 && t > -EPS && t < l + EPS;
  };
  const addEntrance = (w: PlanWall) => {
    const width = o.wideDoors ? 128 : fits(w, 96) ? 96 : 64;
    const op = placeOpening(w, width, 'door', DOOR_MARGIN, rng.chance(0.5));
    if (!op) return false;
    const n = outNormal(w);
    entrances.push({
      wall: walls.indexOf(w), opening: w.openings.indexOf(op), out: n, room: w.left === -1 ? w.right : w.left,
      centre: wallPoint(w, (op.from + op.to) / 2).addScaledVector(n, w.thickness / 2),
    });
    return true;
  };
  const usable = (list: PlanWall[], width: number) => list.filter((w) => fits(w, width));
  if (o.entranceEdges?.length) {
    for (const e of o.entranceEdges) {
      const c = usable(outside.filter((w) => onEdge(w, e)), minDoor);
      if (c.length) addEntrance(rng.pick(c));
    }
  }
  if (!entrances.length) {
    const c = usable(outside, minDoor);
    // Longer walls first: the front door is on a main side.
    c.sort((p, q) => wallLength(q) - wallLength(p));
    if (c.length) addEntrance(rng.pick(c.slice(0, Math.max(1, Math.ceil(c.length / 2)))));
  }
  const fb = new Box2().setFromPoints(footprint).getSize(new Vector2());
  if (entrances.length === 1 && Math.max(fb.x, fb.y) > 384) {
    const first = walls[entrances[0].wall];
    const firstN = outNormal(first);
    const c = usable(outside.filter((w) => !outNormal(w).equals(firstN)), minDoor);
    if (c.length) {
      const dist = (w: PlanWall) => w.a.clone().add(w.b).distanceTo(first.a.clone().add(first.b)) + ((w.left === -1 ? w.right : w.left) === entrances[0].room ? -10000 : 0);
      c.sort((p, q) => dist(q) - dist(p));
      addEntrance(c[0]);
    }
  }

  // Room types: hall or living room at the front door, kitchen next to it, bath next to the kitchen, bedrooms.
  const neighbours = (r: number) => new Set(ground.filter((w) => !w.exterior && (w.left === r || w.right === r)).map((w) => (w.left === r ? w.right : w.left)));
  const areaOf = (r: number) => { const s = rooms[r].box.getSize(new Vector2()); return s.x * s.y; };
  const groundRooms = rooms.map((_, i) => i).filter((i) => rooms[i].storey === 1);
  const untyped = new Set(groundRooms);
  const assign = (r: number, t: RoomType) => { rooms[r].type = t; untyped.delete(r); };
  const front = entrances.length ? entrances[0].room : groundRooms[0];
  if (o.use === 'workshop') {
    const biggest = [...groundRooms].sort((a, b) => areaOf(b) - areaOf(a))[0];
    assign(biggest, 'workshop');
    for (const r of [...untyped]) assign(r, 'storage');
  } else {
    if (groundRooms.length === 1) assign(front, 'living');
    else {
      const s = rooms[front].box.getSize(new Vector2());
      assign(front, groundRooms.length > 2 && Math.min(s.x, s.y) <= 192 ? 'hall' : 'living');
      if (!groundRooms.some((r) => rooms[r].type === 'living' && !untyped.has(r))) {
        const big = [...untyped].sort((a, b) => areaOf(b) - areaOf(a))[0];
        if (big !== undefined) assign(big, 'living');
      }
      const pickNear = (near: number[], pred: (r: number) => boolean, order: (a: number, b: number) => number) => {
        const set = new Set(near.flatMap((r) => [...neighbours(r)]));
        const c = [...untyped].filter((r) => set.has(r) && pred(r)).sort(order);
        return c.length ? c[0] : [...untyped].filter(pred).sort(order)[0];
      };
      const lived = groundRooms.filter((r) => !untyped.has(r));
      const kitchen = pickNear(lived, () => true, (a, b) => Math.abs(areaOf(a) - 192 * 192) - Math.abs(areaOf(b) - 192 * 192));
      if (kitchen !== undefined) assign(kitchen, 'kitchen');
      if (kitchen !== undefined && untyped.size) {
        const bath = pickNear([kitchen], (r) => areaOf(r) <= 256 * 256, (a, b) => areaOf(a) - areaOf(b));
        if (bath !== undefined && (untyped.size > 1 || areaOf(bath) <= 160 * 192)) assign(bath, 'bath');
      }
      for (const r of [...untyped]) assign(r, areaOf(r) >= 128 * 192 ? 'bedroom' : 'storage');
    }
  }
  if (stairs && rooms[stairs.room].type === 'bath') rooms[stairs.room].type = 'living';

  // Doors between rooms: a spanning tree (every room reachable), then a few more for loops.
  const parent = rooms.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const pairs = new Map<string, PlanWall[]>();
  for (const w of ground) {
    if (w.exterior || w.left < 0 || w.right < 0 || w.left === w.right) continue;
    const key = `${Math.min(w.left, w.right)}:${Math.max(w.left, w.right)}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key)!.push(w);
  }
  const keys = [...pairs.keys()];
  for (let k = keys.length - 1; k > 0; k--) { const j = rng.int(0, k); [keys[k], keys[j]] = [keys[j], keys[k]]; }
  const open = (key: string) => {
    const list = pairs.get(key)!.filter((w) => fits(w, minDoor));
    if (!list.length) return false;
    const w = list.reduce((a, b) => (wallLength(b) > wallLength(a) ? b : a));
    const types = [rooms[w.left].type, rooms[w.right].type];
    const social = types.every((t) => t === 'hall' || t === 'living' || t === 'kitchen');
    const wide = freeOn(w, DOOR_MARGIN).reduce((m, [s, e]) => Math.max(m, e - s), 0);
    if (social && !o.wideDoors && wide >= 160 && rng.chance(0.35)) return !!placeOpening(w, Math.min(160, snap8(wide - 16)), 'gap', DOOR_MARGIN, true);
    return !!placeOpening(w, doorWidth(w), 'door', DOOR_MARGIN);
  };
  const doored = new Set<string>();
  if (stairs) parent[find(stairs.room)] = find(upperRoom);
  for (const key of keys) {
    const [a, b] = key.split(':').map(Number);
    if (find(a) === find(b)) continue;
    if (open(key)) { parent[find(a)] = find(b); doored.add(key); }
  }
  for (const key of keys) if (!doored.has(key) && rng.chance(0.2)) open(key);
  // Rooms the inside doors can't reach (walls too short beside the stairs) get their own door outside.
  for (const r of groundRooms) {
    if (entrances.some((e) => find(e.room) === find(r))) continue;
    const c = usable(outside.filter((w) => w.left === r || w.right === r), minDoor);
    if (c.length) addEntrance(rng.pick(c));
  }

  // Windows on outside walls: 64 or 96 wide, about one per 128–192 units of wall.
  const winWidth = rng.pick([64, 96]);
  for (const w of walls.filter((x) => x.exterior)) {
    for (const [s, e] of freeOn(w, WINDOW_MARGIN)) {
      const l = e - s;
      const n = Math.min(Math.floor((l + 32) / (winWidth + 32)), Math.round(l / rng.pick([128, 160, 192])));
      for (let k = 0; k < n; k++) {
        const c = snap8(s + ((k + 0.5) * l) / n);
        const from = Math.max(s, Math.min(e - winWidth, c - winWidth / 2));
        w.openings.push({ from, to: from + winWidth, kind: 'window', sill: storeyBase(w) + 40, lintel: Math.min(w.top, storeyBase(w) + 96) });
      }
      w.openings.sort((p, q) => p.from - q.from);
    }
  }

  // Lanes: from each door into the middle of its room; zones in front of doors on both sides.
  const lanes: Box2[] = [], doorZones: Box2[] = [];
  const centreOf = (r: number) => rooms[r].box.getCenter(new Vector2());
  const lane = (p: Vector2, q: Vector2, firstAxis: Axis) => {
    const corner = p.clone();
    corner[firstAxis] = q[firstAxis];
    for (const [s, e] of [[p, corner], [corner, q]]) {
      const b = new Box2().setFromPoints([s, e]).expandByScalar(LANE / 2);
      if (b.getSize(new Vector2()).length() > LANE * 1.5) lanes.push(b);
    }
  };
  walls.forEach((w) => {
    if (w.storey !== 1) return;
    const { dir, left } = wallDirs(w);
    for (const op of w.openings) {
      if (op.kind === 'window') continue;
      const c = wallPoint(w, (op.from + op.to) / 2);
      for (const [r, n] of [[w.left, left], [w.right, left.clone().negate()]] as const) {
        const face = c.clone().addScaledVector(n, w.thickness / 2);
        const z = new Box2().setFromPoints([
          face.clone().addScaledVector(dir, -(op.to - op.from) / 2), face.clone().addScaledVector(dir, (op.to - op.from) / 2).addScaledVector(n, DOOR_ZONE),
        ]);
        doorZones.push(z);
        if (r >= 0) lane(face, centreOf(r), w.axis === 'x' ? 'y' : 'x');
      }
    }
  });
  const keepClear: Box2[] = [];
  if (stairs) {
    const ax: Axis = stairs.dir.x !== 0 ? 'x' : 'y';
    lane(stairs.foot, centreOf(stairs.room), ax);
    lane(stairs.head, centreOf(upperRoom), ax);
    keepClear.push(stairs.box.clone().union(new Box2().setFromPoints([stairs.foot]).expandByScalar(stairs.width / 2)));
    const headZone = new Box2().setFromPoints([stairs.head]).expandByScalar(stairs.width / 2);
    keepClear.push(headZone);
  }

  // Porch: a deck along the wall in front of the main door.
  let porch: Box2 | undefined;
  if (entrances.length && (o.porch ?? rng.chance(0.5))) {
    const e = entrances[0], w = walls[e.wall], op = w.openings[e.opening];
    const ax = w.axis;
    const depth = rng.pick([64, 96]);
    const half = Math.min(wallLength(w) / 2 + 32, (op.to - op.from) / 2 + rng.pick([32, 64, 96]));
    const c = e.centre;
    const a = c.clone(), b = c.clone().addScaledVector(e.out, depth);
    a[ax] -= half; b[ax] += half;
    porch = new Box2().setFromPoints([a, b]);
  }

  return {
    footprint, storeys, cut, rooms, walls, entrances, porch, stairs, upperFloor: upperBox, lanes, doorZones, keepClear,
  };
}
