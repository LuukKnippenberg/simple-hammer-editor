import { Vector3 } from 'three';
import type { KVNode } from '../../vmf/keyvalues.ts';
import { vecStr, type VmfDocument } from '../../vmf/map.ts';
import { boxFaces, boxSolid, solidNode, worldAlignedAxes } from '../../edit/brushes.ts';
import type { Rng } from '../rng.ts';
import type { PoiEntity } from '../poi/types.ts';
import { WALL, type RoomBox, type RoomLayout } from './model.ts';

/**
 * The walls the camera sees, dressed: it looks north-west, so in every room the inner faces of the north and west
 * walls get a stone plinth, a moulding ledge, pilasters with bases and capitals, a cornice, lanterns on every
 * other pilaster, posters and Combine propaganda between the pilasters and water stains under the cornice. The
 * relief is one func_brush per building (free for vbsp's t-junctions); posters and stains are overlays on the
 * wall brushes.
 */

export const TRIM = 'BUILDING_TEMPLATE/BUILDING_TEMPLATE003A';
export const PLINTH = 'STONE/STONEWALL029B';
/** A cornice moulding over a band of frieze, 128 texels tall. */
const CORNICE = 'BUILDING_TEMPLATE/BUILDING_TRAINSTATION_TEMPLATE002K';
/** The station's ashlar, for the pilasters and door surrounds outside. */
const ASHLAR = 'BUILDING_TEMPLATE/BUILDING_TRAINSTATION_TEMPLATE002J';
const CAP = 'CONCRETE/CONCRETEFLOOR028A';
const NODRAW = 'TOOLS/TOOLSNODRAW';

const POSTERS = [
  ...Array.from({ length: 15 }, (_, i) => `posters/poster${i + 1}`),
  'decals/decal_posterbreen', 'decals/decal_posters001a', 'decals/decal_posters003a', 'decals/decal_posters005a',
];
const PROPAGANDA = ['decals/combinepropaganda01a', 'decals/combinepropaganda01b', 'decals/combinepropaganda01c', 'decals/combinepropaganda01d'];
const STAINS = ['decals/decalstain001a', 'decals/decalstain002a', 'decals/decalstain005a', 'decals/decalstain010a', 'decals/decalstain012a', 'decals/decalstain014a', 'decals/wallstain01a'];
/** Height over width of a wall texture (posters are 2:1, the rest square). */
const aspect = (m: string) => (/^posters\//.test(m) ? 0.5 : 1);

/** A wall face inside a room that the camera sees. */
export interface RoomFace {
  room: RoomBox;
  side: 'n' | 'w';
  /** The face runs along x (north wall) or y (west wall), standing at `at`, facing into the room along `normal`. */
  axis: 'x' | 'y';
  at: number;
  normal: Vector3;
  from: number;
  to: number;
  /** Ranges along it with an opening down to the floor (doorways), and the window band ranges. */
  cuts: [number, number][];
  bands: [number, number][];
  pilasters: number[];
}

/** The north and west faces of every room that are wall all along. */
export function cameraFaces(layout: RoomLayout): RoomFace[] {
  const out: RoomFace[] = [];
  const threshold = layout.floor - layout.base;
  for (const room of layout.rooms) {
    const r = room.rect, i = room.inner;
    for (const side of ['n', 'w'] as const) {
      // Only a side that is wall all along has its floor stop short of it.
      if (side === 'n' ? i.y1 >= r.y1 : i.x0 <= r.x0) continue;
      const axis = side === 'n' ? 'x' : 'y';
      const line = side === 'n' ? r.y1 : r.x0;
      const at = side === 'n' ? i.y1 : i.x0;
      const [from, to] = axis === 'x' ? [i.x0, i.x1] : [i.y0, i.y1];
      const walls = layout.walls.filter((w) => w.axis === axis && Math.abs(w.at - line) < 0.5 && w.to > from && w.from < to);
      const cuts: [number, number][] = [], bands: [number, number][] = [];
      for (const w of walls) for (const o of w.openings) (o.z0 <= threshold + 1 ? cuts : bands).push([o.from, o.to]);
      const free = (c: number, pad: number) => !cuts.some(([a, b]) => c > a - pad && c < b + pad);
      const pilasters: number[] = [];
      const n = Math.max(0, Math.round((to - from - 320) / 384));
      for (let k = 0; k <= n; k++) {
        const c = Math.round(from + 160 + (n ? ((to - from - 320) * k) / n : (to - from - 320) / 2));
        if (free(c, 72)) pilasters.push(c);
      }
      out.push({ room, side, axis, at, normal: side === 'n' ? new Vector3(0, -1, 0) : new Vector3(1, 0, 0), from, to, cuts, bands, pilasters });
    }
  }
  return out;
}

/** Ranges [from, to] minus holes widened by `pad`. */
function minus(from: number, to: number, holes: [number, number][], pad: number): [number, number][] {
  let out: [number, number][] = [[from, to]];
  for (const [h0, h1] of holes) out = out.flatMap(([a, b]): [number, number][] => (h1 + pad <= a || h0 - pad >= b ? [[a, b]] : [[a, h0 - pad], [h1 + pad, b]]));
  return out.filter(([a, b]) => b - a > 8);
}

const light = (origin: Vector3, color: string, fifty: number, zero: number): PoiEntity => ({
  classname: 'light', origin: origin.round(),
  keys: { _light: color, _lightHDR: '-1 -1 -1 1', _quadratic_attn: '1', _fifty_percent_distance: String(fifty), _zero_percent_distance: String(zero) },
});

/** Relief brushes (for one func_brush) and the lanterns on the pilasters. */
export function wallRelief(doc: VmfDocument, layout: RoomLayout, faces: RoomFace[]): { relief: KVNode[]; entities: PoiEntity[] } {
  const relief: KVNode[] = [], entities: PoiEntity[] = [];
  const F = layout.floor, T = layout.top;
  for (const f of faces) {
    /** A box on the face from a0 to a1 along it, `out` proud of it, z0..z1. */
    const box = (a0: number, a1: number, out: number, z0: number, z1: number, mat: string) => {
      const w0 = f.at, w1 = f.at + (f.side === 'n' ? -out : out);
      const min = f.axis === 'x' ? new Vector3(a0, Math.min(w0, w1), z0) : new Vector3(Math.min(w0, w1), a0, z0);
      const max = f.axis === 'x' ? new Vector3(a1, Math.max(w0, w1), z1) : new Vector3(Math.max(w0, w1), a1, z1);
      relief.push(boxSolid(doc, min, max, { top: mat, bottom: NODRAW, sides: mat }));
    };
    const doorTop = Math.max(0, ...f.room.doorways.map((d) => d.top));
    for (const [a, b] of minus(f.from, f.to, f.cuts, 16)) {
      box(a, b, 8, F, F + 80, PLINTH);
      box(a, b, 12, F + 112, F + 124, TRIM);
    }
    // The cornice under the roof, short of the window band's top (and of any doorway reaching that high).
    const cornice = minus(f.from, f.to, F + doorTop > T - 32 ? f.cuts : [], 16);
    for (const [a, b] of cornice) box(a, b, 24, T - 28, T, TRIM);
    const bandZ = F + Math.round((T - F) * 0.55);
    f.pilasters.forEach((c, k) => {
      // Up to the cornice, or below the window band where it runs past one.
      const inBand = f.bands.some(([a, b]) => c + 36 > a && c - 36 < b);
      const top = inBand ? bandZ - 32 : T - 56;
      box(c - 36, c + 36, 24, F, F + 112, TRIM);
      box(c - 24, c + 24, 16, F + 112, top, TRIM);
      box(c - 36, c + 36, 24, top, top + 24, TRIM);
      if (k % 2 === 0) {
        const out = 28, yaw = f.side === 'n' ? 270 : 0;
        const p = f.axis === 'x' ? new Vector3(c, f.at - out, F + 190) : new Vector3(f.at + out, c, F + 190);
        entities.push({ classname: 'prop_static', origin: p.clone().round(), keys: { model: 'models/props_trainstation/column_light001a.mdl', angles: `0 ${yaw} 0`, solid: '0' } });
        entities.push(light(p.clone().addScaledVector(f.normal, 18), '255 196 140 90', 96, 384));
      }
    });
  }
  return { relief, entities };
}

/**
 * The outside of the building, dressed as the station front: a rusticated plinth, pilasters dividing the walls (and
 * the window bands) into bays, a cornice along the top and a surround (jambs and a lintel) at each street door.
 * Brushes for the relief func_brush; they run on round the building's corners.
 */
export function outerRelief(doc: VmfDocument, layout: RoomLayout): KVNode[] {
  const out: KVNode[] = [];
  const B = layout.base, T = layout.top;
  const threshold = layout.floor - layout.base;
  const PLINTH_H = 96, CORNICE_H = 32;
  for (const w of layout.walls) {
    if ((w.lo === null) === (w.hi === null)) continue;
    // Outwards: to the low side when the room is on the high side.
    const sign = w.lo === null ? -1 : 1;
    const face = w.at + sign * (WALL / 2);
    const doors = w.openings.filter((o) => o.z0 <= threshold + 1);
    /** A box on the outer face from a0 to a1 along it, `proud` out from it, z0..z1; `fit` textures its front face. */
    const box = (a0: number, a1: number, proud: number, z0: number, z1: number, mat: string, fit?: { material: string; scale: number }) => {
      const n0 = face, n1 = face + sign * proud;
      const lo = Math.min(n0, n1), hi = Math.max(n0, n1);
      const min = w.axis === 'x' ? new Vector3(a0, lo, z0) : new Vector3(lo, a0, z0);
      const max = w.axis === 'x' ? new Vector3(a1, hi, z1) : new Vector3(hi, a1, z1);
      const faces = boxFaces(min, max, { top: mat === PLINTH ? mat : CAP, bottom: NODRAW, sides: mat });
      if (fit) {
        const n = w.axis === 'x' ? new Vector3(0, sign, 0) : new Vector3(sign, 0, 0);
        const i = w.axis === 'x' ? (sign < 0 ? 2 : 4) : (sign < 0 ? 5 : 3);
        const ax = worldAlignedAxes(n, fit.scale);
        Object.assign(faces[i], { material: fit.material, u: ax.u, v: { ...ax.v, shift: (z1 / fit.scale) % 512 } });
      }
      out.push(solidNode(doc, faces));
    };
    // Round the corners: past the end of the run by the wall's half thickness and the relief's own depth.
    const ends = (proud: number): [number, number] => [w.from - WALL / 2 - proud, w.to + WALL / 2 + proud];
    const [p0, p1] = ends(8);
    for (const [a, b] of minus(p0, p1, doors.map((o): [number, number] => [o.from, o.to]), 0)) box(a, b, 8, B - 8, B + PLINTH_H, PLINTH);
    const [c0, c1] = ends(20);
    box(c0, c1, 20, T - CORNICE_H, T, ASHLAR, { material: CORNICE, scale: CORNICE_H / 128 });
    // Pilasters about every 384, clear of the doors and the corners (each corner gets one either way).
    const free = (c: number) => !doors.some((o) => c > o.from - 96 && c < o.to + 96);
    const n = Math.max(1, Math.round((w.to - w.from) / 384));
    for (let k = 0; k <= n; k++) {
      const c = w.from + ((w.to - w.from) * k) / n;
      const corner = k === 0 || k === n;
      if (!free(c)) continue;
      const half = corner ? 40 : 28;
      const a = corner ? (k === 0 ? w.from - WALL / 2 : w.to + WALL / 2 - 2 * half) : c - half;
      box(Math.round(a), Math.round(a + 2 * half), 14, B + PLINTH_H, T - CORNICE_H, ASHLAR);
    }
    // Door surrounds: jambs either side up past the opening, a lintel over it.
    for (const o of doors) {
      const top = B + o.z1;
      box(o.from - 36, o.from, 14, B, top + 24, ASHLAR);
      box(o.to, o.to + 36, 14, B, top + 24, ASHLAR);
      box(o.from - 52, o.to + 52, 18, top + 24, top + 56, ASHLAR);
    }
  }
  return out;
}

/** Bounds of a box brush node (its plane points are its corners). */
function nodeBounds(n: KVNode): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const s of n.childrenNamed('side')) {
    for (const m of (s.get('plane') ?? '').matchAll(/\(([^)]+)\)/g)) {
      const [x, y, z] = m[1].trim().split(/\s+/).map(Number);
      min.min(new Vector3(x, y, z)); max.max(new Vector3(x, y, z));
    }
  }
  return { min, max };
}

/** Ids of the wall sides facing `normal` that a rectangle on a face (along a0..a1, z0..z1) covers. */
function facesUnder(walls: KVNode[], f: RoomFace, a0: number, a1: number, z0: number, z1: number): string[] {
  const out: string[] = [];
  for (const n of walls) {
    const b = nodeBounds(n);
    const plane = f.side === 'n' ? b.min.y : b.max.x;
    if (Math.abs(plane - f.at) > 0.5) continue;
    const [lo, hi] = f.axis === 'x' ? [b.min.x, b.max.x] : [b.min.y, b.max.y];
    if (hi <= a0 || lo >= a1 || b.max.z <= z0 || b.min.z >= z1) continue;
    for (const s of n.childrenNamed('side')) {
      const pts = [...(s.get('plane') ?? '').matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
      if (pts.length === 3 && pts.every((p) => Math.abs((f.side === 'n' ? p[1] : p[0]) - f.at) < 0.5)) out.push(s.get('id')!);
    }
  }
  return out;
}

/** An info_overlay on a wall face, centred at `c` along it and at height z, `w` wide. */
function wallOverlay(f: RoomFace, walls: KVNode[], material: string, c: number, z: number, w: number): PoiEntity | null {
  const h = w * aspect(material);
  const sides = facesUnder(walls, f, c - w / 2, c + w / 2, z - h / 2, z + h / 2);
  if (!sides.length) return null;
  const n = f.normal;
  // As the editor's decal tool does on walls: U to the right seen from in front, V down (the texture's top up).
  const U = new Vector3().crossVectors(n, new Vector3(0, 0, -1)).normalize();
  const V = new Vector3().crossVectors(U, n).normalize();
  const centre = f.axis === 'x' ? new Vector3(c, f.at, z) : new Vector3(f.at, c, z);
  const r = (x: number) => String(Math.round(x * 1000) / 1000);
  const v3 = (p: Vector3) => vecStr(new Vector3(+r(p.x), +r(p.y), +r(p.z)));
  return {
    classname: 'info_overlay', origin: centre.clone().round(), keys: {
      material: material.toLowerCase(), sides: sides.slice(0, 32).join(' '),
      BasisOrigin: v3(centre), BasisNormal: v3(n), BasisU: v3(U), BasisV: v3(V),
      StartU: '0', StartV: '0', EndU: '1', EndV: '1',
      uv0: `${r(-w / 2)} ${r(-h / 2)} 0`, uv1: `${r(-w / 2)} ${r(h / 2)} 0`, uv2: `${r(w / 2)} ${r(h / 2)} 0`, uv3: `${r(w / 2)} ${r(-h / 2)} 0`,
      fademindist: '-1',
    },
  };
}

/** Posters in pairs or a propaganda banner between each two pilasters, and stains under the cornice. */
export function wallWear(layout: RoomLayout, faces: RoomFace[], walls: KVNode[], rng: Rng): PoiEntity[] {
  const out: PoiEntity[] = [];
  const F = layout.floor, T = layout.top;
  const push = (e: PoiEntity | null) => { if (e) out.push(e); };
  for (const f of faces) {
    const stops = [f.from, ...f.pilasters, f.to];
    for (let k = 0; k + 1 < stops.length; k++) {
      const a = stops[k] + 40, b = stops[k + 1] - 40;
      if (b - a < 160) continue;
      const mid = (a + b) / 2;
      if (f.cuts.some(([c0, c1]) => mid + 140 > c0 - 16 && mid - 140 < c1 + 16)) continue;
      if (rng.chance(0.35)) push(wallOverlay(f, walls, rng.pick(PROPAGANDA), mid, F + 180, rng.range(140, 170)));
      else for (const d of b - a >= 260 ? [-60, 60] : [0]) if (rng.chance(0.8)) push(wallOverlay(f, walls, rng.pick(POSTERS), mid + d, F + 168 + rng.range(-8, 8), rng.range(88, 112)));
    }
    // Stains running from under the cornice, not over the window bands.
    const z = T - 100;
    for (let c = f.from + 160; c < f.to - 160; c += 192) {
      const at = c + rng.range(-48, 48);
      if (!rng.chance(0.55) || f.bands.some(([b0, b1]) => at > b0 - 96 && at < b1 + 96) || f.cuts.some(([c0, c1]) => at > c0 - 96 && at < c1 + 96)) continue;
      if (f.pilasters.some((p) => Math.abs(p - at) < 96)) continue;
      push(wallOverlay(f, walls, rng.pick(STAINS), at, z, rng.range(96, 150)));
    }
  }
  return out;
}
