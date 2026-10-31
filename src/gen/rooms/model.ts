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

export function roomLayout(spec: RoomBuildingSpec): RoomLayout {
  const issues: string[] = [];
  const c = spec.cell, ox = spec.origin.x, oy = spec.origin.y, T = WALL;
  const base = spec.origin.z - WALL_SINK, floor = spec.origin.z + FLOOR_LIFT, top = floor + spec.height;
  const rooms = spec.rooms.filter((r) => {
    const ok = r.cells.x1 > r.cells.x0 && r.cells.y1 > r.cells.y0 && r.cells.x0 >= 0 && r.cells.y0 >= 0;
    if (!ok) issues.push(`Room ${r.name ?? r.id} has no cells on the grid`);
    return ok;
  });
  const W = Math.max(0, ...rooms.map((r) => r.cells.x1)), H = Math.max(0, ...rooms.map((r) => r.cells.y1));
  const owner = new Int32Array(W * H).fill(-1);
  rooms.forEach((r, i) => {
    for (let y = r.cells.y0; y < r.cells.y1; y++) for (let x = r.cells.x0; x < r.cells.x1; x++) {
      const o = owner[y * W + x];
      if (o >= 0) { if (!issues.some((s) => s.includes(rooms[o].id) && s.includes(r.id))) issues.push(`Rooms ${rooms[o].name ?? rooms[o].id} and ${r.name ?? r.id} overlap`); continue; }
      owner[y * W + x] = i;
    }
  });
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : owner[y * W + x]);
  const kinds = new Map<string, LinkKind>();
  const kindOf = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let k = kinds.get(key);
    if (!k) { k = linkKind(spec, rooms[a], rooms[b]); kinds.set(key, k); }
    return k;
  };
  const isWall = (lo: number, hi: number) => lo !== hi && !(lo >= 0 && hi >= 0 && kindOf(lo, hi) === 'open');
  // Unit edges: along x on grid line y = j between cells (i, j-1) and (i, j); along y on x = i between (i-1, j) and (i, j).
  const hEdge = (i: number, j: number) => i >= 0 && i < W && isWall(at(i, j - 1), at(i, j));
  const vEdge = (i: number, j: number) => j >= 0 && j < H && isWall(at(i - 1, j), at(i, j));
  const id = (o: number) => (o >= 0 ? rooms[o].id : null);

  const walls: WallRun[] = [];
  // Walls along x keep the corners: they reach half a wall past a corner to cover it, and walls along y stop
  // against them (so no two brushes overlap and every corner is closed).
  for (let j = 0; j <= H; j++) {
    for (let i = 0; i < W;) {
      if (!hEdge(i, j)) { i++; continue; }
      const lo = at(i, j - 1), hi = at(i, j);
      let e = i + 1;
      while (e < W && hEdge(e, j) && at(e, j - 1) === lo && at(e, j) === hi) e++;
      const vAt = (x: number) => vEdge(x, j - 1) || vEdge(x, j);
      const from = ox + i * c - (!hEdge(i - 1, j) && vAt(i) ? T / 2 : 0);
      const to = ox + e * c + (!hEdge(e, j) && vAt(e) ? T / 2 : 0);
      walls.push({ axis: 'x', at: oy + j * c, from, to, lo: id(lo), hi: id(hi), openings: [] });
      i = e;
    }
  }
  for (let i = 0; i <= W; i++) {
    const hAt = (y: number) => hEdge(i - 1, y) || hEdge(i, y);
    for (let j = 0; j < H;) {
      if (!vEdge(i, j)) { j++; continue; }
      const lo = at(i - 1, j), hi = at(i, j);
      let e = j + 1;
      while (e < H && vEdge(i, e) && at(i - 1, e) === lo && at(i, e) === hi && !hAt(e)) e++;
      const from = oy + j * c + (hAt(j) ? T / 2 : 0);
      const to = oy + e * c - (hAt(e) ? T / 2 : 0);
      if (to - from > 0.5) walls.push({ axis: 'y', at: ox + i * c, from, to, lo: id(lo), hi: id(hi), openings: [] });
      j = e;
    }
  }

  const doorways: Doorway[] = [];
  const cut = (d: Doorway, z0: number) => {
    for (const w of walls) {
      if (w.axis !== d.axis || Math.abs(w.at - d.at) > 0.5 || d.to <= w.from || d.from >= w.to) continue;
      w.openings.push({ from: Math.max(d.from, w.from), to: Math.min(d.to, w.to), z0, z1: floor - base + d.top });
    }
  };
  const threshold = floor - base;
  // Between rooms: one doorway in the middle of the wall they share, a row of archways, or (open) the whole of it.
  for (let a = 0; a < rooms.length; a++) for (let b = a + 1; b < rooms.length; b++) {
    const ra = rooms[a].cells, rb = rooms[b].cells;
    let shared: { axis: 'x' | 'y'; at: number; from: number; to: number } | null = null;
    if (ra.x1 === rb.x0 || rb.x1 === ra.x0) {
      const y0 = Math.max(ra.y0, rb.y0), y1 = Math.min(ra.y1, rb.y1);
      if (y1 > y0) shared = { axis: 'y', at: ox + (ra.x1 === rb.x0 ? ra.x1 : ra.x0) * c, from: oy + y0 * c, to: oy + y1 * c };
    } else if (ra.y1 === rb.y0 || rb.y1 === ra.y0) {
      const x0 = Math.max(ra.x0, rb.x0), x1 = Math.min(ra.x1, rb.x1);
      if (x1 > x0) shared = { axis: 'x', at: oy + (ra.y1 === rb.y0 ? ra.y1 : ra.y0) * c, from: ox + x0 * c, to: ox + x1 * c };
    }
    if (!shared) continue;
    const kind = kindOf(a, b);
    const ids = [rooms[a].id, rooms[b].id];
    if (kind === 'wall') continue;
    if (kind === 'open') { doorways.push({ kind: 'open', rooms: ids, ...shared, top: spec.height }); continue; }
    const lo = shared.from + T / 2 + DOOR_MARGIN, hi = shared.to - T / 2 - DOOR_MARGIN;
    const room = hi - lo;
    if (kind === 'door' || room < ARCH_WIDTH + 64) {
      const w = Math.min(Math.max(roomType(rooms[a].type).doorWidth, roomType(rooms[b].type).doorWidth), room);
      if (w < 96) { issues.push(`${rooms[a].name ?? rooms[a].id} and ${rooms[b].name ?? rooms[b].id} share too little wall for a door`); continue; }
      const mid = Math.round((lo + hi) / 2);
      const d: Doorway = { kind: 'door', rooms: ids, axis: shared.axis, at: shared.at, from: mid - w / 2, to: mid + w / 2, top: Math.min(DOOR_HEIGHT, spec.height - 64) };
      doorways.push(d);
      cut(d, threshold);
      continue;
    }
    const n = Math.max(1, Math.floor((room + ARCH_PITCH - ARCH_WIDTH) / ARCH_PITCH));
    const first = Math.round((lo + hi) / 2 - ((n - 1) * ARCH_PITCH) / 2);
    for (let k = 0; k < n; k++) {
      const mid = first + k * ARCH_PITCH;
      const d: Doorway = { kind: 'arch', rooms: ids, axis: shared.axis, at: shared.at, from: mid - ARCH_WIDTH / 2, to: mid + ARCH_WIDTH / 2, top: Math.min(ARCH_HEIGHT, spec.height - 96) };
      doorways.push(d);
      cut(d, threshold);
    }
  }
  // Street doors, on outer edges only.
  for (const sd of spec.doors) {
    const n = Math.max(1, Math.round(sd.width));
    const cells = Array.from({ length: n }, (_, k): [number, number] => (sd.side === 'n' || sd.side === 's' ? [sd.x + k, sd.y] : [sd.x, sd.y + k]));
    const step: Record<Side, [number, number]> = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };
    const [dx, dy] = step[sd.side];
    const room = at(sd.x, sd.y);
    if (room < 0 || !cells.every(([x, y]) => at(x, y) === room && at(x + dx, y + dy) < 0)) {
      issues.push(`The street door at cell ${sd.x}, ${sd.y} (${sd.side}) is not on one room's outer wall`);
      continue;
    }
    const axis: 'x' | 'y' = sd.side === 'n' || sd.side === 's' ? 'x' : 'y';
    const line = sd.side === 'n' ? oy + (sd.y + 1) * c : sd.side === 's' ? oy + sd.y * c : sd.side === 'e' ? ox + (sd.x + 1) * c : ox + sd.x * c;
    const start = axis === 'x' ? ox + sd.x * c : oy + sd.y * c;
    const d: Doorway = { kind: 'street', rooms: [rooms[room].id], axis, at: line, from: start + 16, to: start + n * c - 16, top: Math.min(STREET_DOOR_HEIGHT, spec.height - 64) };
    doorways.push(d);
    cut(d, threshold);
  }
  // Window bands high up in the outer walls facing the band sides, clear of the corners, the doors and the
  // partitions that meet the wall (each band one slot: holes per window would cost vbsp too many t-junctions).
  if (spec.height >= 320) {
    const z0 = floor - base + Math.round(spec.height * 0.55), z1 = floor - base + spec.height - 32;
    for (const w of walls) {
      if (w.lo !== null && w.hi !== null) continue;
      const facing: Side = w.axis === 'x' ? (w.hi === null ? 'n' : 's') : (w.hi === null ? 'e' : 'w');
      if (!spec.bands.includes(facing)) continue;
      const junctions: [number, number][] = [];
      for (const q of walls) {
        if (q.axis === w.axis) continue;
        if (q.from <= w.at + T && q.to >= w.at - T && q.at > w.from && q.at < w.to) junctions.push([q.at, q.at]);
      }
      const doorRanges = w.openings.map((o): [number, number] => [o.from, o.to]);
      const pieces = subtract(subtract([[w.from + 128, w.to - 128]], doorRanges, 64, 128), junctions, T / 2 + 48, 128);
      for (const [a, b] of pieces) w.openings.push({ from: a, to: b, z0, z1 });
    }
  }
  // Rooms: their floors stop at the walls around them, except along a side that opens onto the next room.
  const sideWalls = (r: Rect, side: Side): boolean[] => {
    const out: boolean[] = [];
    if (side === 'n' || side === 's') for (let x = r.x0; x < r.x1; x++) out.push(hEdge(x, side === 'n' ? r.y1 : r.y0));
    else for (let y = r.y0; y < r.y1; y++) out.push(vEdge(side === 'e' ? r.x1 : r.x0, y));
    return out;
  };
  const sideOuter = (r: Rect, side: Side): boolean => {
    if (side === 'n') for (let x = r.x0; x < r.x1; x++) { if (at(x, r.y1) < 0) return true; }
    if (side === 's') for (let x = r.x0; x < r.x1; x++) { if (at(x, r.y0 - 1) < 0) return true; }
    if (side === 'e') for (let y = r.y0; y < r.y1; y++) { if (at(r.x1, y) < 0) return true; }
    if (side === 'w') for (let y = r.y0; y < r.y1; y++) { if (at(r.x0 - 1, y) < 0) return true; }
    return false;
  };
  const boxes: RoomBox[] = rooms.map((r) => {
    const cr = r.cells;
    const rect = { x0: ox + cr.x0 * c, y0: oy + cr.y0 * c, x1: ox + cr.x1 * c, y1: oy + cr.y1 * c };
    const shut = (s: Side) => sideWalls(cr, s).every(Boolean);
    const inner = {
      x0: rect.x0 + (shut('w') ? T / 2 : 0), y0: rect.y0 + (shut('s') ? T / 2 : 0),
      x1: rect.x1 - (shut('e') ? T / 2 : 0), y1: rect.y1 - (shut('n') ? T / 2 : 0),
    };
    return {
      spec: r, rect, inner,
      outer: { n: sideOuter(cr, 'n'), e: sideOuter(cr, 'e'), s: sideOuter(cr, 's'), w: sideOuter(cr, 'w') },
      doorways: doorways.filter((d) => d.rooms.includes(r.id)),
    };
  });
  // Every room has to be reachable from the street.
  if (!spec.doors.length && rooms.length) issues.push('The building has no street door');
  else {
    const seen = new Set(doorways.filter((d) => d.kind === 'street').flatMap((d) => d.rooms));
    for (let grew = true; grew;) {
      grew = false;
      for (const d of doorways) if (d.rooms.length === 2 && d.rooms.some((r) => seen.has(r)) && !d.rooms.every((r) => seen.has(r))) { d.rooms.forEach((r) => seen.add(r)); grew = true; }
    }
    if (seen.size) for (const r of rooms) if (!seen.has(r.id)) issues.push(`Room ${r.name ?? r.id} can't be reached from the street`);
  }
  const bounds = { x0: ox, y0: oy, x1: ox + W * c, y1: oy + H * c };
  return { spec, base, floor, top, rooms: boxes, walls, doorways, bounds, issues };
}
