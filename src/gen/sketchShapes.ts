import { Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { prismFaces, solidNode } from '../edit/brushes.ts';
import { centreline, defaultRoad, type RoadSpec } from './roads.ts';
import type { RoadMaterials } from './streetMaterials.ts';
import { groundOverlay } from './surfaceEdges.ts';
import type { Rng } from './rng.ts';

/**
 * Free shapes drawn over the sketch's cell grid, so a map isn't all squares: streets as polylines (diagonal, and
 * curved where `radius` rounds their bends) and areas as polygons (round squares, curved lawns). Points are in
 * cells (fractional), like markers. Streets are built by the road generator; both keep buildings off them (the
 * blocks' lots are cut along them, see `cut` in BuildingOptions), and areas paint their surface into the terrain
 * blend with a stone edging round them.
 */

export type ShapeSurface = 'grass' | 'dirt' | 'paved' | 'rubble';

export interface StreetShape {
  kind: 'street';
  points: [number, number][];
  /** Carriageway width and pavement on each side, in units. */
  width: number;
  pavement: number;
  /** How far bends are rounded (units); 0 for sharp corners. */
  radius?: number;
}

export interface AreaShape {
  kind: 'area';
  /** Outline; kept convex (its hull is used). */
  points: [number, number][];
  surface: ShapeSurface;
}

export type SketchShape = StreetShape | AreaShape;

export const SHAPE_SURFACES: { id: ShapeSurface; label: string; color: string }[] = [
  { id: 'grass', label: 'Grass', color: '#5d7a3e' },
  { id: 'dirt', label: 'Dirt', color: '#8a6d4a' },
  { id: 'paved', label: 'Paving', color: '#a19d96' },
  { id: 'rubble', label: 'Rubble', color: '#6e6258' },
];

const ccw = (p: Vector2[]) => {
  let a = 0;
  p.forEach((q, i) => { const r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; });
  return a < 0 ? [...p].reverse() : p;
};

/** Convex hull, counter-clockwise (monotone chain). */
export function hull(points: Vector2[]): Vector2[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Vector2, a: Vector2, b: Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vector2[] = [], upper: Vector2[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** An ellipse inscribed in a cell rectangle as a polygon of `n` points (cells). */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number, n = 20): [number, number][] {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  return Array.from({ length: n }, (_, i) => {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    return [Math.round((cx + Math.cos(a) * rx) * 100) / 100, Math.round((cy + Math.sin(a) * ry) * 100) / 100] as [number, number];
  });
}

/** An area's outline in layout units (convex, counter-clockwise). */
export function areaPolygon(a: AreaShape, cell: number): Vector2[] {
  return ccw(hull(a.points.map(([x, y]) => new Vector2(x * cell, y * cell))));
}

/** Point in a convex counter-clockwise polygon, with the distance to its outline (negative outside). */
export function insideDistance(poly: Vector2[], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const e = new Vector2().subVectors(b, a), len = e.length();
    d = Math.min(d, (e.x * (y - a.y) - e.y * (x - a.x)) / len);
  }
  return d;
}

/** The street shapes as roads (layout units). */
export function shapeRoads(shapes: SketchShape[] | undefined, cell: number, ground: (x: number, y: number) => number, materials?: RoadMaterials): RoadSpec[] {
  return (shapes ?? []).filter((s): s is StreetShape => s.kind === 'street' && s.points.length >= 2).map((s) => ({
    ...defaultRoad('asphalt', s.points.map(([x, y]) => new Vector3(x * cell, y * cell, ground(x * cell, y * cell)))),
    width: s.width, pavement: s.pavement, radius: s.radius ?? 0, lined: s.width >= 256, lift: 3,
    ...(materials ? { materials: { ...materials, corner: 0 } } : {}),
  }));
}

/**
 * Convex polygons (layout units) buildings keep off: each street's centre line in quads, as wide as the street with
 * its kerbs, pavements and a margin, with a disc at every bend; each area's outline grown by a margin.
 */
export function shapeCuts(shapes: SketchShape[] | undefined, cell: number, margin = 16): Vector2[][] {
  const out: Vector2[][] = [];
  for (const s of shapes ?? []) {
    if (s.kind === 'street' && s.points.length >= 2) {
      const pts = centreline(s.points.map(([x, y]) => new Vector3(x * cell, y * cell, 0)), s.radius ?? 0);
      const half = s.width / 2 + s.pavement + 8 + margin;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = new Vector2(pts[i].x, pts[i].y), b = new Vector2(pts[i + 1].x, pts[i + 1].y);
        const d = new Vector2().subVectors(b, a);
        if (d.length() < 1) continue;
        d.normalize();
        const n = new Vector2(-d.y, d.x).multiplyScalar(half);
        // Each quad runs a little past its ends, so neighbouring quads overlap at gentle bends.
        const a2 = a.clone().addScaledVector(d, -4), b2 = b.clone().addScaledVector(d, 4);
        out.push(ccw([a2.clone().sub(n), b2.clone().sub(n), b2.clone().add(n), a2.clone().add(n)]));
      }
      for (let i = 1; i + 1 < pts.length; i++) {
        out.push(ccw(Array.from({ length: 8 }, (_, k) => {
          const t = ((k + 0.5) / 8) * Math.PI * 2;
          return new Vector2(pts[i].x + Math.cos(t) * half * 1.08, pts[i].y + Math.sin(t) * half * 1.08);
        })));
      }
    } else if (s.kind === 'area' && s.points.length >= 3) {
      const poly = areaPolygon(s, cell);
      const c = poly.reduce((acc, p) => acc.add(p), new Vector2()).divideScalar(poly.length);
      out.push(poly.map((p) => p.clone().add(p.clone().sub(c).normalize().multiplyScalar(margin))));
    }
  }
  return out;
}

/** Cut polygons as a building option string (no `|;="`): `x:y/x:y/...` per polygon, polygons joined by `!`. */
export function encodeCuts(polys: Vector2[][]): string {
  return polys.map((p) => p.map((q) => `${Math.round(q.x)}:${Math.round(q.y)}`).join('/')).join('!');
}

export function decodeCuts(s: string | undefined): Vector2[][] {
  if (!s) return [];
  return s.split('!').map((p) => ccw(p.split('/').map((q) => { const [x, y] = q.split(':').map(Number); return new Vector2(x, y); }))).filter((p) => p.length >= 3 && p.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)));
}

/** Moves cut polygons in an option string by (dx, dy). */
export function shiftCuts(s: string | undefined, dx: number, dy: number): string | undefined {
  if (!s) return s;
  return encodeCuts(decodeCuts(s).map((p) => p.map((q) => new Vector2(q.x + dx, q.y + dy))));
}

const side = (p: Vector2, q: Vector2, x: Vector2) => (q.x - p.x) * (x.y - p.y) - (q.y - p.y) * (x.x - p.x);

/** The part of a convex polygon right of p→q (outside a counter-clockwise polygon's edge p→q). */
export function keepRight(poly: Vector2[], p: Vector2, q: Vector2): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(p, q, a), sb = side(p, q, b);
    if (sa <= 1e-6) out.push(a.clone());
    if ((sa < -1e-6 && sb > 1e-6) || (sa > 1e-6 && sb < -1e-6)) out.push(a.clone().lerp(b, sa / (sa - sb)));
  }
  return out;
}

/** Whether two convex counter-clockwise polygons overlap (more than touch). */
export function convexOverlap(a: Vector2[], b: Vector2[]): boolean {
  const apart = (p: Vector2[], q: Vector2[]) => p.some((u, i) => { const v = p[(i + 1) % p.length]; return q.every((x) => side(u, v, x) <= 1e-3); });
  return boxesOverlap(a, b) && !apart(a, b) && !apart(b, a);
}

const areaOf = (p: Vector2[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;

/**
 * A convex polygon cut back to clear of convex cuts, as convex pieces: it is cut along the one edge of each cut that
 * keeps the most of it (a street crossing it keeps both sides, the second as its own piece where the opposite edge
 * keeps enough). Lots round a round square get one straight front each, facing it.
 */
export function cutBack(poly: Vector2[], cuts: Vector2[][], minArea = 1): Vector2[][] {
  let pieces = [poly];
  for (const c of cuts) {
    const next: Vector2[][] = [];
    for (const piece of pieces) {
      if (!convexOverlap(piece, c)) { next.push(piece); continue; }
      const options = c.map((p, i) => {
        const q = c[(i + 1) % c.length];
        const kept = keepRight(piece, p, q);
        return { kept, area: kept.length >= 3 ? areaOf(kept) : 0, dir: new Vector2().subVectors(q, p).normalize() };
      }).sort((x, y) => y.area - x.area);
      const best = options[0];
      if (best && best.area > minArea) next.push(best.kept);
      const other = options.find((o) => o.area > minArea && best && o.dir.dot(best.dir) < -0.7);
      if (other) next.push(other.kept);
    }
    pieces = next;
  }
  return pieces;
}

/** Whether two convex polygons' bounding boxes overlap. */
export function boxesOverlap(a: Vector2[], b: Vector2[]): boolean {
  const bx = (p: Vector2[]) => [Math.min(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.x)), Math.max(...p.map((q) => q.y))];
  const [a0, a1, a2, a3] = bx(a), [b0, b1, b2, b3] = bx(b);
  return a0 < b2 && b0 < a2 && a1 < b3 && b1 < a3;
}

/**
 * The terrain blend inside areas: `alpha` of the area's surface inside, fading over `soft` units at the outline;
 * null where no area is.
 */
export function areaAlpha(shapes: SketchShape[] | undefined, cell: number, alphaOf: (s: ShapeSurface) => number, soft = 48): (x: number, y: number, base: number) => number {
  const areas = (shapes ?? []).filter((s): s is AreaShape => s.kind === 'area' && s.points.length >= 3).map((a) => ({ poly: areaPolygon(a, cell), alpha: alphaOf(a.surface) }));
  return (x, y, base) => {
    let out = base;
    for (const a of areas) {
      const d = insideDistance(a.poly, x, y);
      if (d <= -soft) continue;
      const t = Math.max(0, Math.min(1, (d + soft) / (2 * soft)));
      out = out * (1 - t) + a.alpha * t;
    }
    return out;
  };
}

const LAWN = 'NATURE/FOREST_GRASS_01';
const EDGING = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: 'TOOLS/TOOLSNODRAW', sides: 'STONE/STONEWALL017A' };
const WEAR = ['decals/leaves_ground01', 'decals/leaves_ground02', 'overlays/leaves_ground03', 'overlays/dirt01a', 'overlays/stain_01'];

/**
 * A low stone edging along every area's outline (one thin convex piece per edge) and leaves and dirt over it, like the
 * boundaries between painted cells (surfaceEdges.ts). Paved areas get the edging only.
 */
export function areaEdging(doc: VmfDocument, shapes: SketchShape[] | undefined, cell: number, ground: (x: number, y: number) => number, patchSide: (x: number, y: number) => string | null, shift: Vector3, rng: Rng): { brushes: KVNode[]; overlays: KVNode[] } {
  const brushes: KVNode[] = [], overlays: KVNode[] = [];
  for (const s of shapes ?? []) {
    if (s.kind !== 'area' || s.points.length < 3) continue;
    const poly = areaPolygon(s, cell);
    // Grass is a lawn laid in the edging (the city's terrain blend has no grass); the other surfaces are painted into
    // the terrain blend (areaAlpha).
    if (s.surface === 'grass') {
      const z = Math.round(Math.max(...poly.map((p) => ground(p.x, p.y))));
      brushes.push(solidNode(doc, prismFaces(poly.map((p) => p.clone()), z - 12, z + 3, { top: LAWN, bottom: 'TOOLS/TOOLSNODRAW', sides: 'TOOLS/TOOLSNODRAW' })));
    }
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const d = new Vector2().subVectors(b, a);
      const len = d.length();
      if (len < 8) return;
      d.normalize();
      const n = new Vector2(-d.y, d.x).multiplyScalar(6);
      // Overlapping a little at the corners keeps the ring closed; the pieces are detail, so overlaps are harmless.
      const a2 = a.clone().addScaledVector(d, -4), b2 = b.clone().addScaledVector(d, 4);
      const z = Math.round(Math.min(ground(a.x, a.y), ground(b.x, b.y)));
      brushes.push(solidNode(doc, prismFaces(ccw([a2.clone().sub(n), b2.clone().sub(n), b2.clone().add(n), a2.clone().add(n)]), z - 12, z + 6, EDGING)));
      if (s.surface === 'paved') return;
      for (let t = rng.range(24, 200); t < len - 24; t += rng.range(160, 300)) {
        const p = a.clone().addScaledVector(d, t).addScaledVector(n, rng.range(-2, 10));
        const size = Math.round(rng.range(96, 176));
        const sides = new Set<string>();
        for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) { const id = patchSide(p.x + (dx * size) / 2, p.y + (dy * size) / 2); if (id) sides.add(id); }
        if (sides.size) overlays.push(groundOverlay(doc, [...sides], rng.pick(WEAR), p.x, p.y, ground(p.x, p.y), size, rng.int(0, 359), shift));
      }
    });
  }
  return { brushes, overlays };
}
