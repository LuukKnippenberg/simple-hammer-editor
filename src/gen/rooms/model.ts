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
  const own = spec.links.find((link) => (link.a === a.id && link.b === b.id) || (link.a === b.id && link.b === a.id));
  if (own) return own.kind;
  const kindA = roomType(a.type).link, kindB = roomType(b.type).link;
  return LINK_RANK[kindA] <= LINK_RANK[kindB] ? kindA : kindB;
}

/** Ranges [from, to] minus holes (each widened by `pad`), keeping pieces at least `min` long. */
function subtract(ranges: [number, number][], holes: [number, number][], pad: number, min: number): [number, number][] {
  let out = ranges;
  for (const [holeFrom, holeTo] of holes) {
    const cutFrom = holeFrom - pad, cutTo = holeTo + pad;
    out = out.flatMap(([from, to]): [number, number][] => (cutTo <= from || cutFrom >= to ? [[from, to]] : [[from, cutFrom], [cutTo, to]]));
  }
  return out.filter(([from, to]) => to - from >= min);
}

/** Works out a building's walls, doorways, window bands and room floors from its spec, and what is wrong with it. */
export function roomLayout(spec: RoomBuildingSpec): RoomLayout {
  const issues: string[] = [];
  const base = spec.origin.z - WALL_SINK, floor = spec.origin.z + FLOOR_LIFT, top = floor + spec.height;
  const grid = cellGrid(spec, issues);
  const walls = [...wallsAlongX(grid), ...wallsAlongY(grid)];
  const doorways = [...roomDoorways(grid, issues), ...streetDoorways(grid, issues)];
  const threshold = floor - base;
  cutDoorways(walls, doorways, threshold);
  windowBands(spec, walls, threshold);
  const rooms = grid.rooms.map((room) => roomBox(grid, room, doorways));
  checkReachable(spec, grid.rooms, doorways, issues);
  const bounds = { x0: spec.origin.x, y0: spec.origin.y, x1: grid.worldX(grid.cols), y1: grid.worldY(grid.rows) };
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

const label = (room: RoomSpec) => room.name ?? room.id;

/** Lays the rooms on the grid, reporting rooms with no cells on it and rooms that overlap (the first keeps the cell). */
function cellGrid(spec: RoomBuildingSpec, issues: string[]): Grid {
  const rooms = spec.rooms.filter((room) => {
    const ok = room.cells.x1 > room.cells.x0 && room.cells.y1 > room.cells.y0 && room.cells.x0 >= 0 && room.cells.y0 >= 0;
    if (!ok) issues.push(`Room ${label(room)} has no cells on the grid`);
    return ok;
  });
  const cols = Math.max(0, ...rooms.map((room) => room.cells.x1)), rows = Math.max(0, ...rooms.map((room) => room.cells.y1));
  const owner = new Int32Array(cols * rows).fill(-1);
  rooms.forEach((room, i) => {
    for (let y = room.cells.y0; y < room.cells.y1; y++) for (let x = room.cells.x0; x < room.cells.x1; x++) {
      const existing = owner[y * cols + x];
      if (existing < 0) { owner[y * cols + x] = i; continue; }
      if (!issues.some((issue) => issue.includes(rooms[existing].id) && issue.includes(room.id))) issues.push(`Rooms ${label(rooms[existing])} and ${label(room)} overlap`);
    }
  });
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? -1 : owner[y * cols + x]);
  const kinds = new Map<string, LinkKind>();
  const kindOf = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let kind = kinds.get(key);
    if (!kind) { kind = linkKind(spec, rooms[a], rooms[b]); kinds.set(key, kind); }
    return kind;
  };
  const isWall = (lowRoom: number, highRoom: number) => lowRoom !== highRoom && !(lowRoom >= 0 && highRoom >= 0 && kindOf(lowRoom, highRoom) === 'open');
  return {
    spec, rooms, cols, rows, at, kindOf,
    hEdge: (i, j) => i >= 0 && i < cols && isWall(at(i, j - 1), at(i, j)),
    vEdge: (i, j) => j >= 0 && j < rows && isWall(at(i - 1, j), at(i, j)),
    worldX: (i) => spec.origin.x + i * spec.cell,
    worldY: (j) => spec.origin.y + j * spec.cell,
  };
}

const roomId = (grid: Grid, index: number) => (index >= 0 ? grid.rooms[index].id : null);

/**
 * Walls along x keep the corners: they reach half a wall past a corner to cover it, and walls along y stop
 * against them (so no two brushes overlap and every corner is closed). One run per stretch with the same rooms on
 * either side.
 */
function wallsAlongX(grid: Grid): WallRun[] {
  const { at, hEdge, vEdge } = grid;
  const walls: WallRun[] = [];
  for (let j = 0; j <= grid.rows; j++) {
    const wallAlongYAt = (x: number) => vEdge(x, j - 1) || vEdge(x, j);
    for (let i = 0; i < grid.cols;) {
      if (!hEdge(i, j)) { i++; continue; }
      const lowRoom = at(i, j - 1), highRoom = at(i, j);
      let end = i + 1;
      while (end < grid.cols && hEdge(end, j) && at(end, j - 1) === lowRoom && at(end, j) === highRoom) end++;
      const from = grid.worldX(i) - (!hEdge(i - 1, j) && wallAlongYAt(i) ? WALL / 2 : 0);
      const to = grid.worldX(end) + (!hEdge(end, j) && wallAlongYAt(end) ? WALL / 2 : 0);
      walls.push({ axis: 'x', at: grid.worldY(j), from, to, lo: roomId(grid, lowRoom), hi: roomId(grid, highRoom), openings: [] });
      i = end;
    }
  }
  return walls;
}

/** Walls along y, stopping half a wall short of every wall along x they meet (and split there). */
function wallsAlongY(grid: Grid): WallRun[] {
  const { at, hEdge, vEdge } = grid;
  const walls: WallRun[] = [];
  for (let i = 0; i <= grid.cols; i++) {
    const wallAlongXAt = (y: number) => hEdge(i - 1, y) || hEdge(i, y);
    for (let j = 0; j < grid.rows;) {
      if (!vEdge(i, j)) { j++; continue; }
      const lowRoom = at(i - 1, j), highRoom = at(i, j);
      let end = j + 1;
      while (end < grid.rows && vEdge(i, end) && at(i - 1, end) === lowRoom && at(i, end) === highRoom && !wallAlongXAt(end)) end++;
      const from = grid.worldY(j) + (wallAlongXAt(j) ? WALL / 2 : 0);
      const to = grid.worldY(end) - (wallAlongXAt(end) ? WALL / 2 : 0);
      if (to - from > 0.5) walls.push({ axis: 'y', at: grid.worldX(i), from, to, lo: roomId(grid, lowRoom), hi: roomId(grid, highRoom), openings: [] });
      j = end;
    }
  }
  return walls;
}

/** The grid line two rooms share, in world units. */
interface SharedWall { axis: 'x' | 'y'; at: number; from: number; to: number }

/** Where two rooms' cells touch along a side, or null when they don't. */
function sharedWall(grid: Grid, cellsA: Rect, cellsB: Rect): SharedWall | null {
  if (cellsA.x1 === cellsB.x0 || cellsB.x1 === cellsA.x0) {
    const y0 = Math.max(cellsA.y0, cellsB.y0), y1 = Math.min(cellsA.y1, cellsB.y1);
    return y1 > y0 ? { axis: 'y', at: grid.worldX(cellsA.x1 === cellsB.x0 ? cellsA.x1 : cellsA.x0), from: grid.worldY(y0), to: grid.worldY(y1) } : null;
  }
  if (cellsA.y1 === cellsB.y0 || cellsB.y1 === cellsA.y0) {
    const x0 = Math.max(cellsA.x0, cellsB.x0), x1 = Math.min(cellsA.x1, cellsB.x1);
    return x1 > x0 ? { axis: 'x', at: grid.worldY(cellsA.y1 === cellsB.y0 ? cellsA.y1 : cellsA.y0), from: grid.worldX(x0), to: grid.worldX(x1) } : null;
  }
  return null;
}

/** Between rooms: one doorway in the middle of the wall they share, a row of archways, or (open) the whole of it. */
function roomDoorways(grid: Grid, issues: string[]): Doorway[] {
  const { rooms } = grid;
  const out: Doorway[] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const shared = sharedWall(grid, rooms[i].cells, rooms[j].cells);
    if (!shared) continue;
    const kind = grid.kindOf(i, j);
    const ids = [rooms[i].id, rooms[j].id];
    if (kind === 'wall') continue;
    if (kind === 'open') { out.push({ kind: 'open', rooms: ids, ...shared, top: grid.spec.height }); continue; }
    // Doorways stay clear of the wall's ends.
    const lo = shared.from + WALL / 2 + DOOR_MARGIN, hi = shared.to - WALL / 2 - DOOR_MARGIN;
    if (kind === 'door' || hi - lo < ARCH_WIDTH + ARCH_SPARE) {
      const door = doorBetween(grid.spec, rooms[i], rooms[j], shared, lo, hi);
      if (door) out.push(door);
      else issues.push(`${label(rooms[i])} and ${label(rooms[j])} share too little wall for a door`);
    } else {
      out.push(...archesBetween(grid.spec, ids, shared, lo, hi));
    }
  }
  return out;
}

/** One door in the middle of lo..hi, as wide as the wider of the two rooms wants; null if it doesn't fit. */
function doorBetween(spec: RoomBuildingSpec, roomA: RoomSpec, roomB: RoomSpec, shared: SharedWall, lo: number, hi: number): Doorway | null {
  const width = Math.min(Math.max(roomType(roomA.type).doorWidth, roomType(roomB.type).doorWidth), hi - lo);
  if (width < MIN_DOOR) return null;
  const mid = Math.round((lo + hi) / 2);
  return { kind: 'door', rooms: [roomA.id, roomB.id], axis: shared.axis, at: shared.at, from: mid - width / 2, to: mid + width / 2, top: Math.min(DOOR_HEIGHT, spec.height - DOOR_HEADROOM) };
}

/** As many archways as fit in lo..hi, a pitch apart, centred. */
function archesBetween(spec: RoomBuildingSpec, ids: string[], shared: SharedWall, lo: number, hi: number): Doorway[] {
  const length = hi - lo;
  const count = Math.max(1, Math.floor((length + ARCH_PITCH - ARCH_WIDTH) / ARCH_PITCH));
  const first = Math.round((lo + hi) / 2 - ((count - 1) * ARCH_PITCH) / 2);
  return Array.from({ length: count }, (_, k): Doorway => {
    const mid = first + k * ARCH_PITCH;
    return { kind: 'arch', rooms: ids, axis: shared.axis, at: shared.at, from: mid - ARCH_WIDTH / 2, to: mid + ARCH_WIDTH / 2, top: Math.min(ARCH_HEIGHT, spec.height - ARCH_HEADROOM) };
  });
}

/** The step from a cell to its neighbour across each side. */
const OUTWARD: Record<Side, [number, number]> = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };

/** Street doors, on outer edges only. */
function streetDoorways(grid: Grid, issues: string[]): Doorway[] {
  const out: Doorway[] = [];
  for (const door of grid.spec.doors) {
    const doorway = streetDoorway(grid, door, issues);
    if (doorway) out.push(doorway);
  }
  return out;
}

function streetDoorway(grid: Grid, door: StreetDoor, issues: string[]): Doorway | null {
  const where = `The street door at cell ${door.x}, ${door.y} (${door.side})`;
  const widthInCells = Math.max(1, Math.round(door.width));
  const axis: 'x' | 'y' = door.side === 'n' || door.side === 's' ? 'x' : 'y';
  const cells = Array.from({ length: widthInCells }, (_, k): [number, number] => (axis === 'x' ? [door.x + k, door.y] : [door.x, door.y + k]));
  const [dx, dy] = OUTWARD[door.side];
  const room = grid.at(door.x, door.y);
  if (room < 0 || !cells.every(([x, y]) => grid.at(x, y) === room && grid.at(x + dx, y + dy) < 0)) {
    issues.push(`${where} is not on one room's outer wall`);
    return null;
  }
  const line = { n: grid.worldY(door.y + 1), s: grid.worldY(door.y), e: grid.worldX(door.x + 1), w: grid.worldX(door.x) }[door.side];
  const start = axis === 'x' ? grid.worldX(door.x) : grid.worldY(door.y);
  // Clear of the room's corners, so the wall keeps a jamb there.
  const roomCells = grid.rooms[room].cells;
  const [roomFrom, roomTo] = axis === 'x' ? [grid.worldX(roomCells.x0), grid.worldX(roomCells.x1)] : [grid.worldY(roomCells.y0), grid.worldY(roomCells.y1)];
  const from = Math.max(start + STREET_INSET, roomFrom + WALL / 2 + STREET_JAMB);
  const to = Math.min(start + widthInCells * grid.spec.cell - STREET_INSET, roomTo - WALL / 2 - STREET_JAMB);
  if (to - from < MIN_DOOR) {
    issues.push(`${where} is too close to a corner`);
    return null;
  }
  return { kind: 'street', rooms: [grid.rooms[room].id], axis, at: line, from, to, top: Math.min(STREET_DOOR_HEIGHT, grid.spec.height - DOOR_HEADROOM) };
}

/** Cuts every doorway that has a wall into the walls it crosses, down to the floor (`threshold` above the walls' foot). */
function cutDoorways(walls: WallRun[], doorways: Doorway[], threshold: number): void {
  for (const doorway of doorways) {
    if (doorway.kind === 'open') continue;
    for (const wall of walls) {
      if (wall.axis !== doorway.axis || Math.abs(wall.at - doorway.at) > 0.5 || doorway.to <= wall.from || doorway.from >= wall.to) continue;
      wall.openings.push({ from: Math.max(doorway.from, wall.from), to: Math.min(doorway.to, wall.to), z0: threshold, z1: threshold + doorway.top });
    }
  }
}

/** The way an outer wall faces; null for a partition. */
function outerFacing(wall: WallRun): Side | null {
  if (wall.lo !== null && wall.hi !== null) return null;
  return wall.axis === 'x' ? (wall.hi === null ? 'n' : 's') : (wall.hi === null ? 'e' : 'w');
}

/** Where walls running the other way meet `wall`. */
function junctions(walls: WallRun[], wall: WallRun): [number, number][] {
  return walls
    .filter((other) => other.axis !== wall.axis && other.from <= wall.at + WALL && other.to >= wall.at - WALL && other.at > wall.from && other.at < wall.to)
    .map((q): [number, number] => [q.at, q.at]);
}

/**
 * Window bands high up in the outer walls facing the band sides, clear of the corners, the doors and the
 * partitions that meet the wall (each band one slot: holes per window would cost vbsp too many t-junctions).
 */
function windowBands(spec: RoomBuildingSpec, walls: WallRun[], threshold: number): void {
  if (spec.height < BAND_MIN_HEIGHT) return;
  const z0 = threshold + Math.round(spec.height * BAND_FROM), z1 = threshold + spec.height - BAND_TOP_GAP;
  for (const wall of walls) {
    const facing = outerFacing(wall);
    if (!facing || !spec.bands.includes(facing)) continue;
    const doorRanges = wall.openings.map((opening): [number, number] => [opening.from, opening.to]);
    const clearOfDoors = subtract([[wall.from + BAND_END_CLEAR, wall.to - BAND_END_CLEAR]], doorRanges, BAND_DOOR_CLEAR, BAND_MIN);
    const pieces = subtract(clearOfDoors, junctions(walls, wall), WALL / 2 + BAND_JUNCTION_CLEAR, BAND_MIN);
    for (const [from, to] of pieces) wall.openings.push({ from, to, z0, z1 });
  }
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

/** A wall along the whole of a room's side (its `cells`), so its floor stops at the wall there. */
function sideShut(grid: Grid, cells: Rect, side: Side): boolean {
  if (side === 'n' || side === 's') return range(cells.x0, cells.x1).every((x) => grid.hEdge(x, side === 'n' ? cells.y1 : cells.y0));
  return range(cells.y0, cells.y1).every((y) => grid.vEdge(side === 'e' ? cells.x1 : cells.x0, y));
}

/** Some of a room's side (its `cells`) faces the outside. */
function sideOuter(grid: Grid, cells: Rect, side: Side): boolean {
  const [dx, dy] = OUTWARD[side];
  const edge: [number, number][] = side === 'n' || side === 's'
    ? range(cells.x0, cells.x1).map((x) => [x, side === 'n' ? cells.y1 - 1 : cells.y0])
    : range(cells.y0, cells.y1).map((y) => [side === 'e' ? cells.x1 - 1 : cells.x0, y]);
  return edge.some(([x, y]) => grid.at(x + dx, y + dy) < 0);
}

/** A room's world box: its floor stops at the walls around it, except along a side that opens onto the next room. */
function roomBox(grid: Grid, room: RoomSpec, doorways: Doorway[]): RoomBox {
  const cells = room.cells;
  const rect = { x0: grid.worldX(cells.x0), y0: grid.worldY(cells.y0), x1: grid.worldX(cells.x1), y1: grid.worldY(cells.y1) };
  const inset = (side: Side) => (sideShut(grid, cells, side) ? WALL / 2 : 0);
  const inner = { x0: rect.x0 + inset('w'), y0: rect.y0 + inset('s'), x1: rect.x1 - inset('e'), y1: rect.y1 - inset('n') };
  return {
    spec: room, rect, inner,
    outer: { n: sideOuter(grid, cells, 'n'), e: sideOuter(grid, cells, 'e'), s: sideOuter(grid, cells, 's'), w: sideOuter(grid, cells, 'w') },
    doorways: doorways.filter((doorway) => doorway.rooms.includes(room.id)),
  };
}

/** Every room has to be reachable from the street: reports the ones that are not. */
function checkReachable(spec: RoomBuildingSpec, rooms: RoomSpec[], doorways: Doorway[], issues: string[]): void {
  if (!spec.doors.length && rooms.length) {
    issues.push('The building has no street door');
    return;
  }
  const seen = new Set(doorways.filter((doorway) => doorway.kind === 'street').flatMap((doorway) => doorway.rooms));
  for (let grew = true; grew;) {
    grew = false;
    for (const doorway of doorways) {
      if (doorway.rooms.length !== 2 || !doorway.rooms.some((id) => seen.has(id)) || doorway.rooms.every((id) => seen.has(id))) continue;
      doorway.rooms.forEach((id) => seen.add(id));
      grew = true;
    }
  }
  if (seen.size) for (const room of rooms) if (!seen.has(room.id)) issues.push(`Room ${label(room)} can't be reached from the street`);
}
