import { Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { solidNode, prismFaces, worldAlignedAxes, type FaceSpec } from '../edit/brushes.ts';
import { frustumFaces } from '../edit/shapes.ts';
import { Rng } from './rng.ts';
import type { RoadSpec } from './roads.ts';

/**
 * What lies beyond the playable area, so the map doesn't end in a void at its edge (the RTS camera at the edge looks
 * well past it): the city going on, hills rising, or a Combine wall with the city's skyline behind it. Everything here
 * is outside the map boundary and the NPC clip around it, built as brush entities and props, so it costs vbsp's
 * t-junction buffer nothing.
 */

export type SurroundStyle = 'none' | 'city' | 'hills' | 'wall';
export type EdgeSide = 'n' | 'e' | 's' | 'w';

export interface SurroundSpec {
  style: SurroundStyle;
  /** A different style on some sides. */
  sides?: Partial<Record<EdgeSide, SurroundStyle>>;
  /** Width of the band around the map (default 2048). */
  width?: number;
}

export const SURROUND_STYLES: { id: SurroundStyle; label: string; hint: string }[] = [
  { id: 'city', label: 'City', hint: 'The streets run on past the edge between rows of plain buildings that grow taller outward' },
  { id: 'hills', label: 'Hills', hint: 'The ground rises away from the edge into wooded hills' },
  { id: 'wall', label: 'Combine wall', hint: 'A Combine wall just outside the edge, the city skyline behind it' },
  { id: 'none', label: 'None', hint: 'Flat ground for a short way, then the sky' },
];

/** The band where there is nothing to build: the old 512-unit apron. */
export const PLAIN_APRON = 512;
const DEFAULT_WIDTH = 2048;
/** How high hills rise at the band's outer edge. */
export const HILL_HEIGHT = 1100;
/** Distance from the map edge to the Combine wall's centre line. */
const WALL_AT = 352;
/**
 * The wall clusters City16 is closed with: about 1024 long along their y, 322 to 722 thick, their origin halfway up
 * their 1064 to 1122 height. Alternated and overlapped, so the panels of one fill the gaps of the next.
 */
const WALL_MODELS = [1, 2, 3].map((i) => `models/props_combine/combineinnerwallcluster1024_00${i}a.mdl`);
const WALL_HALF_H = [532, 537, 561];
const WALL_STEP = 640;

export const styleOf = (spec: SurroundSpec | undefined, side: EdgeSide): SurroundStyle => spec?.sides?.[side] ?? spec?.style ?? 'none';
const anyBuilt = (spec: SurroundSpec | undefined) => (['n', 'e', 's', 'w'] as EdgeSide[]).some((s) => styleOf(spec, s) !== 'none');
/** The band's width: the old apron when nothing is built. */
export const bandWidth = (spec: SurroundSpec | undefined) => (anyBuilt(spec) ? spec?.width ?? DEFAULT_WIDTH : PLAIN_APRON);

/** The side of the map a point outside it belongs to (corners go to the side it is further out from), or null inside. */
export function sideOf(x: number, y: number, w: number, h: number): EdgeSide | null {
  const dx = x < 0 ? -x : x > w ? x - w : 0, dy = y < 0 ? -y : y > h ? y - h : 0;
  if (!dx && !dy) return null;
  if (dy >= dx) return y < 0 ? 's' : 'n';
  return x < 0 ? 'w' : 'e';
}

/** Distance outside the map (0 inside). */
export const outside = (x: number, y: number, w: number, h: number) => Math.max(x < 0 ? -x : x > w ? x - w : 0, y < 0 ? -y : y > h ? y - h : 0);

const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/**
 * Extra terrain height beyond the edge: on hill sides the ground rises from 192 out to the band's outer edge, with
 * rolling bumps; nothing elsewhere. Points close to a corner blend the two sides.
 */
export function surroundRise(spec: SurroundSpec | undefined, w: number, h: number, seed: number): (x: number, y: number) => number {
  const band = bandWidth(spec);
  const hillsAt = (x: number, y: number) => {
    const d = outside(x, y, w, h);
    if (d <= 0) return 0;
    const sides: EdgeSide[] = [];
    if (y < 0) sides.push('s');
    if (y > h) sides.push('n');
    if (x < 0) sides.push('w');
    if (x > w) sides.push('e');
    return sides.some((s) => styleOf(spec, s) === 'hills') ? 1 : 0;
  };
  return (x, y) => {
    const d = outside(x, y, w, h);
    if (d <= 0 || !hillsAt(x, y)) return 0;
    const ramp = smooth((d - 192) / (band * 0.85));
    const bumps = Math.sin(x * 0.0021 + seed) * Math.cos(y * 0.0017 - seed) * 180 + Math.sin((x - y) * 0.0043 + seed * 2) * 70;
    return Math.round(ramp * (HILL_HEIGHT + bumps * Math.min(1, d / 800)));
  };
}

/** Facade textures for filler buildings, each covering two floors at scale 0.5. */
const FACADES = [
  'BUILDING_TEMPLATE/BUILDING_TEMPLATE002B', 'BUILDING_TEMPLATE/BUILDING_TEMPLATE003E', 'BUILDING_TEMPLATE/BUILDING_TEMPLATE012B',
  'BUILDING_TEMPLATE/BUILDING_TEMPLATE014E', 'BUILDING_TEMPLATE/BUILDING_TEMPLATE019C', 'BUILDING_TEMPLATE/BUILDING_TEMPLATE013B',
  'BUILDING_TEMPLATE/BUILDING_TEMPLATE021C', 'BUILDING_TEMPLATE/BUILDING_TEMPLATE003D',
];
const ROOF_TILE = 'TILE/TILEROOF002A';
const ROOF_FLAT = 'CONCRETE/CONCRETEFLOOR028A';
const NODRAW = 'TOOLS/TOOLSNODRAW';
const TREES = ['models/props_foliage/tree_pine04.mdl', 'models/props_foliage/tree_pine05.mdl', 'models/props_foliage/tree_pine06.mdl', 'models/props_foliage/tree_deciduous_01a.mdl'];
const FLOOR = 128;

export interface SurroundInput {
  doc: VmfDocument;
  spec: SurroundSpec | undefined;
  /** The playable area, layout space from (0, 0). */
  w: number;
  h: number;
  seed: number;
  /** Terrain height (with the hills' rise). */
  ground: (x: number, y: number) => number;
  /** The map's roads (layout space), extended by extendEdgeRoads. */
  roads: RoadSpec[];
}

export interface SurroundOutput {
  /** Brushes for one func_brush (buildings, roofs). */
  brushes: KVNode[];
  /** Point entities as plain descriptions (the caller makes the nodes). */
  props: { model: string; origin: Vector3; yaw: number; solid: string }[];
  /** The tallest thing built, for the sky shell. */
  top: number;
}

interface Strip { side: EdgeSide; a0: number; a1: number; d0: number; d1: number }

/** World rectangle of a strip piece: `a` along the edge, `d` out from it. */
function stripRect(w: number, h: number, side: EdgeSide, a0: number, a1: number, d0: number, d1: number): [number, number, number, number] {
  if (side === 's') return [a0, -d1, a1, -d0];
  if (side === 'n') return [a0, h + d0, a1, h + d1];
  if (side === 'w') return [-d1, a0, -d0, a1];
  return [w + d0, a0, w + d1, a1];
}

/** A plain filler building: walls with a facade texture lined up on the ground, a hipped tile roof or a flat one. */
function fillerBuilding(doc: VmfDocument, rect: [number, number, number, number], z0: number, floors: number, rng: Rng, out: KVNode[]): number {
  const [x0, y0, x1, y1] = rect.map(Math.round) as [number, number, number, number];
  if (x1 - x0 < 128 || y1 - y0 < 128) return z0;
  const top = z0 + floors * FLOOR + 32;
  const facade = rng.pick(FACADES);
  const fp = [new Vector2(x0, y0), new Vector2(x1, y0), new Vector2(x1, y1), new Vector2(x0, y1)];
  const faces = prismFaces(fp, z0 - 32, top, { top: ROOF_FLAT, bottom: NODRAW, sides: facade });
  for (const f of faces) {
    if (f.material !== facade) continue;
    const [a, b, c] = f.points;
    const n = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(b, a)).normalize();
    const ax = worldAlignedAxes(n, 0.5);
    f.u = ax.u;
    // The texture's foot (two floors of 128 at scale 0.5) on the ground.
    f.v = { ...ax.v, shift: (((-(z0) / 0.5) % 512) + 512) % 512 };
  }
  out.push(solidNode(doc, faces as FaceSpec[], '120 120 120'));
  if (rng.chance(0.65)) {
    // A hipped roof: up to a short ridge along the long side.
    const wx = x1 - x0, wy = y1 - y0, alongX = wx >= wy, half = Math.min(wx, wy) / 2;
    const rise = Math.round(Math.min(256, half * 0.8));
    const inset = Math.max(8, half - 8);
    const ridge = alongX
      ? [new Vector2(x0 + inset, y0 + half - 8), new Vector2(x1 - inset, y0 + half - 8), new Vector2(x1 - inset, y0 + half + 8), new Vector2(x0 + inset, y0 + half + 8)]
      : [new Vector2(x0 + half - 8, y0 + inset), new Vector2(x0 + half + 8, y0 + inset), new Vector2(x0 + half + 8, y1 - inset), new Vector2(x0 + half - 8, y1 - inset)];
    if (ridge[1].x > ridge[0].x && ridge[2].y > ridge[1].y) {
      out.push(solidNode(doc, frustumFaces(fp, ridge, top, top + rise, { top: ROOF_TILE, bottom: NODRAW, sides: ROOF_TILE }), '120 120 120'));
      return top + rise;
    }
  }
  return top;
}

/**
 * Streets that end at a city or wall side carry on out: across the whole band on a city side, up to the wall on a
 * wall side. The road is lengthened (not continued by a new one), so no kerb crosses it at the map's edge.
 */
export function extendEdgeRoads(roads: RoadSpec[], spec: SurroundSpec | undefined, w: number, h: number, ground: (x: number, y: number) => number): number {
  const band = bandWidth(spec);
  let n = 0;
  for (const r of roads) {
    if (r.points.length < 2) continue;
    for (const [i, j] of [[0, 1], [r.points.length - 1, r.points.length - 2]]) {
      const p = r.points[i], q = r.points[j];
      const side: EdgeSide | null = p.y <= 1 && q.y > p.y ? 's' : p.y >= h - 1 && q.y < p.y ? 'n' : p.x <= 1 && q.x > p.x ? 'w' : p.x >= w - 1 && q.x < p.x ? 'e' : null;
      if (!side) continue;
      const st = styleOf(spec, side);
      if (st !== 'city' && st !== 'wall') continue;
      const dir = new Vector3().subVectors(p, q).setZ(0).normalize();
      p.addScaledVector(dir, st === 'city' ? band - 64 : WALL_AT - 176);
      p.z = ground(p.x, p.y);
      n++;
    }
  }
  return n;
}

export function buildSurroundings(o: SurroundInput): SurroundOutput {
  const { doc, spec, w, h } = o;
  const out: SurroundOutput = { brushes: [], props: [], top: 0 };
  if (!anyBuilt(spec)) return out;
  const band = bandWidth(spec);
  const rng = new Rng(o.seed * 71 + 13);
  const sides: EdgeSide[] = ['s', 'e', 'n', 'w'];
  const along = (side: EdgeSide) => (side === 's' || side === 'n' ? w : h);

  // Where the (already extended, see extendEdgeRoads) streets cross the band, the rows of buildings leave a gap.
  const crossings: Record<EdgeSide, [number, number][]> = { n: [], e: [], s: [], w: [] };
  for (const r of o.roads) {
    for (const p of [r.points[0], r.points[r.points.length - 1]]) {
      const side = sideOf(p.x, p.y, w, h);
      if (!side) continue;
      const a = side === 's' || side === 'n' ? p.x : p.y;
      const half = r.width / 2 + r.pavement + 48;
      crossings[side].push([a - half, a + half]);
    }
  }

  // City and wall sides: rows of filler buildings in strips along the edge, cut where the streets carry on. Strips
  // run past the corners on the south and north sides, so the corners are built too.
  const strips: Strip[] = [];
  for (const side of sides) {
    const st = styleOf(spec, side);
    if (st !== 'city' && st !== 'wall') continue;
    const corner = side === 's' || side === 'n';
    const a0 = corner ? -band : 0, a1 = corner ? along(side) + band : along(side);
    const near = st === 'city' ? 256 : WALL_AT + 440;
    let pieces: [number, number][] = [[a0, a1]];
    for (const [c0, c1] of crossings[side]) pieces = pieces.flatMap(([p0, p1]): [number, number][] => (c1 <= p0 || c0 >= p1 ? [[p0, p1]] : [[p0, c0], [c1, p1]]));
    for (const [p0, p1] of pieces) if (p1 - p0 >= 192) strips.push({ side, a0: p0, a1: p1, d0: near, d1: band - 64 });
  }
  for (const s of strips) {
    // Two rows: a lower one along the edge, a taller one behind it (the skyline), with a lane between.
    const deep = s.d1 - s.d0;
    const rows: [number, number, [number, number]][] = deep > 1100
      ? [[s.d0, s.d0 + 640, [4, 6]], [s.d0 + 768, s.d1, [7, 11]]]
      : [[s.d0, s.d1, styleOf(spec, s.side) === 'wall' ? [7, 11] : [4, 7]]];
    for (const [d0, d1, [f0, f1]] of rows) {
      for (let a = s.a0; a < s.a1 - 128;) {
        const wd = Math.min(s.a1 - a, rng.int(3, 6) * 96 + 32);
        const rect = stripRect(w, h, s.side, a, a + wd, d0, d1);
        const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
        const z = Math.min(o.ground(rect[0], rect[1]), o.ground(rect[2], rect[3]), o.ground(cx, cy));
        out.top = Math.max(out.top, fillerBuilding(doc, rect, Math.round(z), rng.int(f0, f1), rng, out.brushes));
        // Now and then a narrow alley between buildings.
        a += wd + (rng.chance(0.18) ? 128 : 0);
      }
    }
  }

  // Combine wall: wall clusters end to end along each wall side, past the corners.
  for (const side of sides) {
    if (styleOf(spec, side) !== 'wall') continue;
    let k = 0;
    for (let a = -WALL_AT; a < along(side) + WALL_AT + WALL_STEP; a += WALL_STEP, k++) {
      const [x0, y0, x1, y1] = stripRect(w, h, side, a - 1, a + 1, WALL_AT - 1, WALL_AT + 1);
      const p = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, 0);
      const v = k % 3;
      p.z = Math.round(o.ground(p.x, p.y) - 24 + WALL_HALF_H[v]);
      // The cluster's length runs along its y: turned 90° along the south and north sides.
      out.props.push({ model: WALL_MODELS[v], origin: p.round(), yaw: (side === 's' || side === 'n' ? 90 : 0) + (k % 2 ? 180 : 0), solid: '6' });
    }
    out.top = Math.max(out.top, 2 * Math.max(...WALL_HALF_H));
  }

  // Hills: trees scattered over the slopes, thicker further out.
  for (const side of sides) {
    if (styleOf(spec, side) !== 'hills') continue;
    const corner = side === 's' || side === 'n';
    const a0 = corner ? -band : 0, a1 = corner ? along(side) + band : along(side);
    const n = Math.round(((a1 - a0) * band) / (300 * 300));
    for (let i = 0; i < n; i++) {
      const d = 256 + Math.pow(rng.next(), 0.7) * (band - 320);
      const [x0, y0] = stripRect(w, h, side, a0 + rng.next() * (a1 - a0), a0, d, d);
      const p = new Vector3(Math.round(x0), Math.round(y0), 0);
      p.z = Math.round(o.ground(p.x, p.y)) - 8;
      out.props.push({ model: rng.pick(TREES), origin: p, yaw: rng.int(0, 359), solid: '0' });
    }
    out.top = Math.max(out.top, HILL_HEIGHT + 800);
  }
  return out;
}
