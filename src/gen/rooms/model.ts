import type { Rect } from '../poi/types.ts';
import { LINK_RANK, roomType, type LinkKind } from './types.ts';

/**
 * Interior buildings made of rooms. The building is a grid of cells; each room is a rectangle of cells with a
 * type, and the rooms together are the building's shape (an L, a T, anything made of rectangles). Walls stand on
 * every edge where a room meets the outside (outer walls) or another room (partitions); rooms meet through a
 * doorway, a row of archways, or no wall at all, as their types prefer. Street doors go on outer walls.
 *
 * `roomLayout` works out the walls, doorways and window bands in world units; `roomShell` (shell.ts) turns them
 * into brushes.
 */

export type Side = 'n' | 'e' | 's' | 'w';

/** A room: cells [x0, x1) × [y0, y1) of the building's grid. */
export interface RoomSpec {
  id: string;
  type: string;
  cells: Rect;
  name?: string;
}

/**
 * A door to the street: the `side` edge of cell (x, y) and the `width - 1` cells after it (east along a north or
 * south edge, north along an east or west edge).
 */
export interface StreetDoor { x: number; y: number; side: Side; width: number }

/** How two rooms meet, instead of what their types prefer. */
export interface RoomLink { a: string; b: string; kind: LinkKind }

export interface RoomBuildingSpec {
  uid: string;
  seed: number;
  /** World position of the grid's south-west corner, and the ground height. */
  origin: { x: number; y: number; z: number };
  cell: number;
  /** Wall height above the floor. */
  height: number;
  rooms: RoomSpec[];
  doors: StreetDoor[];
  links: RoomLink[];
  /** Outer walls (by the way they face) that get a band of windows high up. */
  bands: Side[];
}

/** Wall thickness. */
export const WALL = 32;
/** Walls start this far below the ground, so no gap shows on a slope. */
export const WALL_SINK = 16;
/** The floor's top above the ground (the room's floor pad). */
export const FLOOR_LIFT = 2;
export const DOOR_HEIGHT = 224;
export const STREET_DOOR_HEIGHT = 256;
export const ARCH_HEIGHT = 304;
const ARCH_WIDTH = 256;
const ARCH_PITCH = 512;
/** Doorways keep this far from the ends of the wall they are in. */
const DOOR_MARGIN = 48;
/** A shared wall takes a row of archways only when it is this much longer than one; else it gets a door. */
const ARCH_SPARE = 64;
/** The narrowest doorway worth cutting, between rooms or onto the street. */
const MIN_DOOR = 96;
/** Doors and archways stay this far below the wall top. */
const DOOR_HEADROOM = 64;
const ARCH_HEADROOM = 96;
/** Street doors stay this far inside their cells, and this far past the half wall at a room's corner (its jamb). */
const STREET_INSET = 16;
const STREET_JAMB = 24;
/** Window bands: only in walls at least this high, from this share of the height up to this far below the top. */
const BAND_MIN_HEIGHT = 320;
const BAND_FROM = 0.55;
const BAND_TOP_GAP = 32;
/** Bands keep clear of a wall's ends, of its doors, and (past the half wall) of partitions meeting it; no slot is shorter than BAND_MIN. */
const BAND_END_CLEAR = 128;
const BAND_DOOR_CLEAR = 64;
const BAND_JUNCTION_CLEAR = 48;
const BAND_MIN = 128;

export type DoorwayKind = 'door' | 'arch' | 'street' | 'open';

/** An opening between two rooms or onto the street. `axis` is the way its wall runs, `at` where that wall stands. */
export interface Doorway {
  kind: DoorwayKind;
  /** The rooms it joins (one for a street door). */
  rooms: string[];
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
  /** Height above the floor. */
  top: number;
}

/** A hole in a wall run: from / to along the wall (world), z0 / z1 above the wall's foot. */
export interface WallOpening { from: number; to: number; z0: number; z1: number }

/** A straight piece of wall on a grid line, with the room on each side of it (null: the outside). */
export interface WallRun {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
  /** The room on the low side (south of a wall along x, west of one along y) and on the high side. */
  lo: string | null;
  hi: string | null;
  openings: WallOpening[];
}

export interface RoomBox {
  spec: RoomSpec;
  /** World rectangle of its cells. */
  rect: Rect;
  /** Its floor: inside the walls around it (up to the next room's floor where it opens onto it). */
  inner: Rect;
  /** Sides with an outer wall on them. */
  outer: Record<Side, boolean>;
  doorways: Doorway[];
}

export interface RoomLayout {
  spec: RoomBuildingSpec;
  /** World z of the walls' foot, the floor's top, and the wall tops. */
  base: number;
  floor: number;
  top: number;
  rooms: RoomBox[];
  walls: WallRun[];
  doorways: Doorway[];
  /** World rectangle around all rooms. */
  bounds: Rect;
  /** What is wrong with the spec (overlapping rooms, doors not on an outer wall, rooms you can't get to). */
  issues: string[];
}

/** How two rooms meet: the spec's link for them, else the less open of what their types prefer. */
export function linkKind(spec: RoomBuildingSpec, a: RoomSpec, b: RoomSpec): LinkKind {
  const own = spec.links.find((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id));
  if (own) return own.kind;
  const ka = roomType(a.type).link, kb = roomType(b.type).link;
  return LINK_RANK[ka] <= LINK_RANK[kb] ? ka : kb;
}

/** Ranges [from, to] minus holes (each widened by `pad`), keeping pieces at least `min` long. */
function subtract(ranges: [number, number][], holes: [number, number][], pad: number, min: number): [number, number][] {
  let out = ranges;
  for (const [h0, h1] of holes) {
    const k0 = h0 - pad, k1 = h1 + pad;
    out = out.flatMap(([a, b]): [number, number][] => (k1 <= a || k0 >= b ? [[a, b]] : [[a, k0], [k1, b]]));
  }
  return out.filter(([a, b]) => b - a >= min);
}

/** Works out a building's walls, doorways, window bands and room floors from its spec, and what is wrong with it. */
export function roomLayout(spec: RoomBuildingSpec): RoomLayout {
  const issues: string[] = [];
  const base = spec.origin.z - WALL_SINK, floor = spec.origin.z + FLOOR_LIFT, top = floor + spec.height;
  const g = cellGrid(spec, issues);
  const walls = [...wallsAlongX(g), ...wallsAlongY(g)];
  const doorways = [...roomDoorways(g, issues), ...streetDoorways(g, issues)];
  const threshold = floor - base;
  cutDoorways(walls, doorways, threshold);
  windowBands(spec, walls, threshold);
  const rooms = g.rooms.map((r) => roomBox(g, r, doorways));
  checkReachable(spec, g.rooms, doorways, issues);
  const bounds = { x0: spec.origin.x, y0: spec.origin.y, x1: g.worldX(g.cols), y1: g.worldY(g.rows) };
  return { spec, base, floor, top, rooms, walls, doorways, bounds, issues };
}

/** The building's cells: which room owns each one, and which unit edges of the grid carry a wall. */
interface Grid {
  spec: RoomBuildingSpec;
  /** The rooms that have cells on the grid. */
  rooms: RoomSpec[];
  cols: number;
  rows: number;
  /** The index of the room that owns a cell, -1 outside the building. */
  at(x: number, y: number): number;
  /** How two rooms (by index) meet. */
  kindOf(a: number, b: number): LinkKind;
  /** A wall on the unit edge along x on grid line y = j, between cells (i, j-1) and (i, j). */
  hEdge(i: number, j: number): boolean;
  /** A wall on the unit edge along y on grid line x = i, between cells (i-1, j) and (i, j). */
  vEdge(i: number, j: number): boolean;
  /** World x of grid line i, world y of grid line j. */
  worldX(i: number): number;
  worldY(j: number): number;
}

const label = (r: RoomSpec) => r.name ?? r.id;

/** Lays the rooms on the grid, reporting rooms with no cells on it and rooms that overlap (the first keeps the cell). */
function cellGrid(spec: RoomBuildingSpec, issues: string[]): Grid {
  const rooms = spec.rooms.filter((r) => {
    const ok = r.cells.x1 > r.cells.x0 && r.cells.y1 > r.cells.y0 && r.cells.x0 >= 0 && r.cells.y0 >= 0;
    if (!ok) issues.push(`Room ${label(r)} has no cells on the grid`);
    return ok;
  });
  const cols = Math.max(0, ...rooms.map((r) => r.cells.x1)), rows = Math.max(0, ...rooms.map((r) => r.cells.y1));
  const owner = new Int32Array(cols * rows).fill(-1);
  rooms.forEach((r, i) => {
    for (let y = r.cells.y0; y < r.cells.y1; y++) for (let x = r.cells.x0; x < r.cells.x1; x++) {
      const o = owner[y * cols + x];
      if (o < 0) { owner[y * cols + x] = i; continue; }
      if (!issues.some((s) => s.includes(rooms[o].id) && s.includes(r.id))) issues.push(`Rooms ${label(rooms[o])} and ${label(r)} overlap`);
    }
  });
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? -1 : owner[y * cols + x]);
  const kinds = new Map<string, LinkKind>();
  const kindOf = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let k = kinds.get(key);
    if (!k) { k = linkKind(spec, rooms[a], rooms[b]); kinds.set(key, k); }
    return k;
  };
  const isWall = (lo: number, hi: number) => lo !== hi && !(lo >= 0 && hi >= 0 && kindOf(lo, hi) === 'open');
  return {
    spec, rooms, cols, rows, at, kindOf,
    hEdge: (i, j) => i >= 0 && i < cols && isWall(at(i, j - 1), at(i, j)),
    vEdge: (i, j) => j >= 0 && j < rows && isWall(at(i - 1, j), at(i, j)),
    worldX: (i) => spec.origin.x + i * spec.cell,
    worldY: (j) => spec.origin.y + j * spec.cell,
  };
}

const roomId = (g: Grid, o: number) => (o >= 0 ? g.rooms[o].id : null);

/**
 * Walls along x keep the corners: they reach half a wall past a corner to cover it, and walls along y stop
 * against them (so no two brushes overlap and every corner is closed). One run per stretch with the same rooms on
 * either side.
 */
function wallsAlongX(g: Grid): WallRun[] {
  const { at, hEdge, vEdge } = g;
  const walls: WallRun[] = [];
  for (let j = 0; j <= g.rows; j++) {
    const vAt = (x: number) => vEdge(x, j - 1) || vEdge(x, j);
    for (let i = 0; i < g.cols;) {
      if (!hEdge(i, j)) { i++; continue; }
      const lo = at(i, j - 1), hi = at(i, j);
      let e = i + 1;
      while (e < g.cols && hEdge(e, j) && at(e, j - 1) === lo && at(e, j) === hi) e++;
      const from = g.worldX(i) - (!hEdge(i - 1, j) && vAt(i) ? WALL / 2 : 0);
      const to = g.worldX(e) + (!hEdge(e, j) && vAt(e) ? WALL / 2 : 0);
      walls.push({ axis: 'x', at: g.worldY(j), from, to, lo: roomId(g, lo), hi: roomId(g, hi), openings: [] });
      i = e;
    }
  }
  return walls;
}

/** Walls along y, stopping half a wall short of every wall along x they meet (and split there). */
function wallsAlongY(g: Grid): WallRun[] {
  const { at, hEdge, vEdge } = g;
  const walls: WallRun[] = [];
  for (let i = 0; i <= g.cols; i++) {
    const hAt = (y: number) => hEdge(i - 1, y) || hEdge(i, y);
    for (let j = 0; j < g.rows;) {
      if (!vEdge(i, j)) { j++; continue; }
      const lo = at(i - 1, j), hi = at(i, j);
      let e = j + 1;
      while (e < g.rows && vEdge(i, e) && at(i - 1, e) === lo && at(i, e) === hi && !hAt(e)) e++;
      const from = g.worldY(j) + (hAt(j) ? WALL / 2 : 0);
      const to = g.worldY(e) - (hAt(e) ? WALL / 2 : 0);
      if (to - from > 0.5) walls.push({ axis: 'y', at: g.worldX(i), from, to, lo: roomId(g, lo), hi: roomId(g, hi), openings: [] });
      j = e;
    }
  }
  return walls;
}

/** The grid line two rooms share, in world units. */
interface SharedWall { axis: 'x' | 'y'; at: number; from: number; to: number }

/** Where two rooms' cells touch along a side, or null when they don't. */
function sharedWall(g: Grid, ra: Rect, rb: Rect): SharedWall | null {
  if (ra.x1 === rb.x0 || rb.x1 === ra.x0) {
    const y0 = Math.max(ra.y0, rb.y0), y1 = Math.min(ra.y1, rb.y1);
    return y1 > y0 ? { axis: 'y', at: g.worldX(ra.x1 === rb.x0 ? ra.x1 : ra.x0), from: g.worldY(y0), to: g.worldY(y1) } : null;
  }
  if (ra.y1 === rb.y0 || rb.y1 === ra.y0) {
    const x0 = Math.max(ra.x0, rb.x0), x1 = Math.min(ra.x1, rb.x1);
    return x1 > x0 ? { axis: 'x', at: g.worldY(ra.y1 === rb.y0 ? ra.y1 : ra.y0), from: g.worldX(x0), to: g.worldX(x1) } : null;
  }
  return null;
}

/** Between rooms: one doorway in the middle of the wall they share, a row of archways, or (open) the whole of it. */
function roomDoorways(g: Grid, issues: string[]): Doorway[] {
  const { rooms } = g;
  const out: Doorway[] = [];
  for (let a = 0; a < rooms.length; a++) for (let b = a + 1; b < rooms.length; b++) {
    const shared = sharedWall(g, rooms[a].cells, rooms[b].cells);
    if (!shared) continue;
    const kind = g.kindOf(a, b);
    const ids = [rooms[a].id, rooms[b].id];
    if (kind === 'wall') continue;
    if (kind === 'open') { out.push({ kind: 'open', rooms: ids, ...shared, top: g.spec.height }); continue; }
    // Doorways stay clear of the wall's ends.
    const lo = shared.from + WALL / 2 + DOOR_MARGIN, hi = shared.to - WALL / 2 - DOOR_MARGIN;
    if (kind === 'door' || hi - lo < ARCH_WIDTH + ARCH_SPARE) {
      const d = doorBetween(g.spec, rooms[a], rooms[b], shared, lo, hi);
      if (d) out.push(d);
      else issues.push(`${label(rooms[a])} and ${label(rooms[b])} share too little wall for a door`);
    } else {
      out.push(...archesBetween(g.spec, ids, shared, lo, hi));
    }
  }
  return out;
}

/** One door in the middle of lo..hi, as wide as the wider of the two rooms wants; null if it doesn't fit. */
function doorBetween(spec: RoomBuildingSpec, ra: RoomSpec, rb: RoomSpec, shared: SharedWall, lo: number, hi: number): Doorway | null {
  const w = Math.min(Math.max(roomType(ra.type).doorWidth, roomType(rb.type).doorWidth), hi - lo);
  if (w < MIN_DOOR) return null;
  const mid = Math.round((lo + hi) / 2);
  return { kind: 'door', rooms: [ra.id, rb.id], axis: shared.axis, at: shared.at, from: mid - w / 2, to: mid + w / 2, top: Math.min(DOOR_HEIGHT, spec.height - DOOR_HEADROOM) };
}

/** As many archways as fit in lo..hi, a pitch apart, centred. */
function archesBetween(spec: RoomBuildingSpec, ids: string[], shared: SharedWall, lo: number, hi: number): Doorway[] {
  const room = hi - lo;
  const n = Math.max(1, Math.floor((room + ARCH_PITCH - ARCH_WIDTH) / ARCH_PITCH));
  const first = Math.round((lo + hi) / 2 - ((n - 1) * ARCH_PITCH) / 2);
  return Array.from({ length: n }, (_, k): Doorway => {
    const mid = first + k * ARCH_PITCH;
    return { kind: 'arch', rooms: ids, axis: shared.axis, at: shared.at, from: mid - ARCH_WIDTH / 2, to: mid + ARCH_WIDTH / 2, top: Math.min(ARCH_HEIGHT, spec.height - ARCH_HEADROOM) };
  });
}

/** The step from a cell to its neighbour across each side. */
const OUTWARD: Record<Side, [number, number]> = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };

/** Street doors, on outer edges only. */
function streetDoorways(g: Grid, issues: string[]): Doorway[] {
  const out: Doorway[] = [];
  for (const sd of g.spec.doors) {
    const d = streetDoorway(g, sd, issues);
    if (d) out.push(d);
  }
  return out;
}

function streetDoorway(g: Grid, sd: StreetDoor, issues: string[]): Doorway | null {
  const where = `The street door at cell ${sd.x}, ${sd.y} (${sd.side})`;
  const n = Math.max(1, Math.round(sd.width));
  const axis: 'x' | 'y' = sd.side === 'n' || sd.side === 's' ? 'x' : 'y';
  const cells = Array.from({ length: n }, (_, k): [number, number] => (axis === 'x' ? [sd.x + k, sd.y] : [sd.x, sd.y + k]));
  const [dx, dy] = OUTWARD[sd.side];
  const room = g.at(sd.x, sd.y);
  if (room < 0 || !cells.every(([x, y]) => g.at(x, y) === room && g.at(x + dx, y + dy) < 0)) {
    issues.push(`${where} is not on one room's outer wall`);
    return null;
  }
  const line = { n: g.worldY(sd.y + 1), s: g.worldY(sd.y), e: g.worldX(sd.x + 1), w: g.worldX(sd.x) }[sd.side];
  const start = axis === 'x' ? g.worldX(sd.x) : g.worldY(sd.y);
  // Clear of the room's corners, so the wall keeps a jamb there.
  const rc = g.rooms[room].cells;
  const [r0, r1] = axis === 'x' ? [g.worldX(rc.x0), g.worldX(rc.x1)] : [g.worldY(rc.y0), g.worldY(rc.y1)];
  const from = Math.max(start + STREET_INSET, r0 + WALL / 2 + STREET_JAMB);
  const to = Math.min(start + n * g.spec.cell - STREET_INSET, r1 - WALL / 2 - STREET_JAMB);
  if (to - from < MIN_DOOR) {
    issues.push(`${where} is too close to a corner`);
    return null;
  }
  return { kind: 'street', rooms: [g.rooms[room].id], axis, at: line, from, to, top: Math.min(STREET_DOOR_HEIGHT, g.spec.height - DOOR_HEADROOM) };
}

/** Cuts every doorway that has a wall into the walls it crosses, down to the floor (`threshold` above the walls' foot). */
function cutDoorways(walls: WallRun[], doorways: Doorway[], threshold: number): void {
  for (const d of doorways) {
    if (d.kind === 'open') continue;
    for (const w of walls) {
      if (w.axis !== d.axis || Math.abs(w.at - d.at) > 0.5 || d.to <= w.from || d.from >= w.to) continue;
      w.openings.push({ from: Math.max(d.from, w.from), to: Math.min(d.to, w.to), z0: threshold, z1: threshold + d.top });
    }
  }
}

/** The way an outer wall faces; null for a partition. */
function outerFacing(w: WallRun): Side | null {
  if (w.lo !== null && w.hi !== null) return null;
  return w.axis === 'x' ? (w.hi === null ? 'n' : 's') : (w.hi === null ? 'e' : 'w');
}

/** Where walls running the other way meet `w`. */
function junctions(walls: WallRun[], w: WallRun): [number, number][] {
  return walls
    .filter((q) => q.axis !== w.axis && q.from <= w.at + WALL && q.to >= w.at - WALL && q.at > w.from && q.at < w.to)
    .map((q): [number, number] => [q.at, q.at]);
}

/**
 * Window bands high up in the outer walls facing the band sides, clear of the corners, the doors and the
 * partitions that meet the wall (each band one slot: holes per window would cost vbsp too many t-junctions).
 */
function windowBands(spec: RoomBuildingSpec, walls: WallRun[], threshold: number): void {
  if (spec.height < BAND_MIN_HEIGHT) return;
  const z0 = threshold + Math.round(spec.height * BAND_FROM), z1 = threshold + spec.height - BAND_TOP_GAP;
  for (const w of walls) {
    const facing = outerFacing(w);
    if (!facing || !spec.bands.includes(facing)) continue;
    const doorRanges = w.openings.map((o): [number, number] => [o.from, o.to]);
    const clearOfDoors = subtract([[w.from + BAND_END_CLEAR, w.to - BAND_END_CLEAR]], doorRanges, BAND_DOOR_CLEAR, BAND_MIN);
    const pieces = subtract(clearOfDoors, junctions(walls, w), WALL / 2 + BAND_JUNCTION_CLEAR, BAND_MIN);
    for (const [a, b] of pieces) w.openings.push({ from: a, to: b, z0, z1 });
  }
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

/** A wall along the whole of a room's side (cells r), so its floor stops at the wall there. */
function sideShut(g: Grid, r: Rect, side: Side): boolean {
  if (side === 'n' || side === 's') return range(r.x0, r.x1).every((x) => g.hEdge(x, side === 'n' ? r.y1 : r.y0));
  return range(r.y0, r.y1).every((y) => g.vEdge(side === 'e' ? r.x1 : r.x0, y));
}

/** Some of a room's side (cells r) faces the outside. */
function sideOuter(g: Grid, r: Rect, side: Side): boolean {
  const [dx, dy] = OUTWARD[side];
  const edge: [number, number][] = side === 'n' || side === 's'
    ? range(r.x0, r.x1).map((x) => [x, side === 'n' ? r.y1 - 1 : r.y0])
    : range(r.y0, r.y1).map((y) => [side === 'e' ? r.x1 - 1 : r.x0, y]);
  return edge.some(([x, y]) => g.at(x + dx, y + dy) < 0);
}

/** A room's world box: its floor stops at the walls around it, except along a side that opens onto the next room. */
function roomBox(g: Grid, r: RoomSpec, doorways: Doorway[]): RoomBox {
  const cr = r.cells;
  const rect = { x0: g.worldX(cr.x0), y0: g.worldY(cr.y0), x1: g.worldX(cr.x1), y1: g.worldY(cr.y1) };
  const inset = (s: Side) => (sideShut(g, cr, s) ? WALL / 2 : 0);
  const inner = { x0: rect.x0 + inset('w'), y0: rect.y0 + inset('s'), x1: rect.x1 - inset('e'), y1: rect.y1 - inset('n') };
  return {
    spec: r, rect, inner,
    outer: { n: sideOuter(g, cr, 'n'), e: sideOuter(g, cr, 'e'), s: sideOuter(g, cr, 's'), w: sideOuter(g, cr, 'w') },
    doorways: doorways.filter((d) => d.rooms.includes(r.id)),
  };
}

/** Every room has to be reachable from the street: reports the ones that are not. */
function checkReachable(spec: RoomBuildingSpec, rooms: RoomSpec[], doorways: Doorway[], issues: string[]): void {
  if (!spec.doors.length && rooms.length) {
    issues.push('The building has no street door');
    return;
  }
  const seen = new Set(doorways.filter((d) => d.kind === 'street').flatMap((d) => d.rooms));
  for (let grew = true; grew;) {
    grew = false;
    for (const d of doorways) {
      if (d.rooms.length !== 2 || !d.rooms.some((r) => seen.has(r)) || d.rooms.every((r) => seen.has(r))) continue;
      d.rooms.forEach((r) => seen.add(r));
      grew = true;
    }
  }
  if (seen.size) for (const r of rooms) if (!seen.has(r.id)) issues.push(`Room ${label(r)} can't be reached from the street`);
}
