import { Vector2 } from 'three';
import type { KVNode } from '../../vmf/keyvalues.ts';
import type { VmfDocument } from '../../vmf/map.ts';
import { hallBrushes, ROOF_GAP, type HallWall, type Rect as HallRect } from '../hall.ts';
import type { Rect } from '../poi/types.ts';
import { roomType } from './types.ts';
import { WALL, type RoomBox, type RoomLayout, type WallRun } from './model.ts';

/** Finishes the whole building shares (each room's type gives its inner walls and floor). */
export interface RoomStyle {
  outer: string;
  /** World units per texel of the outer finish. */
  outerScale: number;
  cap: string;
  glass: string;
}

/** The City 17 station's stone front. */
export const STATION_STYLE: RoomStyle = {
  outer: 'BUILDING_TEMPLATE/BUILDING_TRAINSTATION_TEMPLATE002R', outerScale: 0.5, cap: 'CONCRETE/CONCRETEFLOOR028A', glass: 'GLASS/GLASSWINDOW029A',
};

export interface RoomShell {
  /** Walls (world brushes). */
  world: KVNode[];
  /** The light-blocking roof, for a func_brush that casts vrad shadows (see `HallBrushes.roof`). */
  roof: KVNode[];
  /** Glass in the window bands, for a never-solid func_brush. */
  glass: KVNode[];
}

/** The skylights over a room: strips along its long side, one strip down the middle, or none. */
export function skylights(room: RoomBox, cell: number): HallRect[] {
  const kind = roomType(room.spec.type).skylights;
  if (kind === 'none') return [];
  const r = room.inner;
  const alongX = r.x1 - r.x0 >= r.y1 - r.y0;
  const [a0, a1] = alongX ? [r.x0 + cell, r.x1 - cell] : [r.y0 + cell, r.y1 - cell];
  const [b0, b1] = alongX ? [r.y0, r.y1] : [r.x0, r.x1];
  if (a1 - a0 < cell) return [];
  // Broken by a cell of roof every six cells or so.
  const n = Math.max(1, Math.round((a1 - a0) / (cell * 7)));
  const piece = (a1 - a0 - (n - 1) * cell) / n;
  const across = kind === 'strips' && b1 - b0 >= cell * 4 ? [0.3, 0.7] : [0.5];
  const half = kind === 'strips' ? 48 : 64;
  const out: HallRect[] = [];
  for (const f of across) {
    const m = Math.round(b0 + (b1 - b0) * f);
    for (let k = 0; k < n; k++) {
      const s0 = Math.round(a0 + k * (piece + cell)), s1 = Math.round(s0 + piece);
      out.push(alongX ? [s0, m - half, s1, m + half] : [m - half, s0, m + half, s1]);
    }
  }
  return out;
}

/** A wall run as a hall wall: a→b along its axis, the inside on the side its room is on. */
function hallWall(w: WallRun, inner: (id: string | null) => string | undefined): HallWall {
  const a = w.axis === 'x' ? new Vector2(w.from, w.at) : new Vector2(w.at, w.from);
  const b = w.axis === 'x' ? new Vector2(w.to, w.at) : new Vector2(w.at, w.to);
  // Left of a→b is the high side (north) for a wall along x, the low side (west) for a wall along y.
  const [left, right] = w.axis === 'x' ? [w.hi, w.lo] : [w.lo, w.hi];
  const inside: 1 | -1 | 0 = left !== null && right !== null ? 0 : left !== null ? 1 : -1;
  return {
    a, b, thickness: WALL, inside,
    openings: w.openings.map((o) => ({ from: o.from - w.from, to: o.to - w.from, z0: o.z0, z1: o.z1 })),
    faces: { left: inner(left), right: inner(right) },
  };
}

/** Walls, roof and window glass of a laid-out building. */
export function roomShell(doc: VmfDocument, layout: RoomLayout, style: RoomStyle = STATION_STYLE): RoomShell {
  const byId = new Map(layout.rooms.map((r) => [r.spec.id, r]));
  const inner = (id: string | null) => (id ? roomType(byId.get(id)!.spec.type).walls : undefined);
  const over = WALL / 2 + 24;
  const roofs = layout.rooms.map((r) => {
    const g = (s: keyof RoomBox['outer']) => (r.outer[s] ? over : 0);
    const rect: Rect = { x0: r.rect.x0 - g('w'), y0: r.rect.y0 - g('s'), x1: r.rect.x1 + g('e'), y1: r.rect.y1 + g('n') };
    return { rect: [rect.x0, rect.y0, rect.x1, rect.y1] as HallRect, skylights: skylights(r, layout.spec.cell) };
  });
  const hall = hallBrushes(doc, {
    floorZ: layout.base, height: layout.top - layout.base,
    walls: layout.walls.map((w) => hallWall(w, inner)),
    materials: { inner: roomType(layout.rooms[0]?.spec.type ?? '').walls, outer: style.outer, outerScale: style.outerScale, cap: style.cap, glass: style.glass },
    roofs,
  });
  return { world: hall.world, roof: hall.roof, glass: hall.glass };
}

/** The roof's height (it floats a little above the walls). */
export const roofZ = (layout: RoomLayout) => layout.top + ROOF_GAP;
