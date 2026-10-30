import { Vector2, Vector3 } from 'three';
import type { TexAxis } from '../vmf/map.ts';
import { prismFaces, type FaceSpec } from '../edit/brushes.ts';

/** One storey; a facade tile covers exactly one floor. */
export const FLOOR = 128;
const TILE_PX = 512;
const NODRAW = 'TOOLS/TOOLSNODRAW';

/** A facade texture and how many window bays one 512px-wide tile holds (0: no windows, no fitting). */
export interface FacadeTile {
  material: string;
  bays: number;
  /** Texture width in pixels when it is not 512. */
  widthPx?: number;
}

const TEX_SCALE = 0.25;

/**
 * Texture axes for a wall face from `a` to `b` (counter-clockwise footprint, so the outside is on the right
 * of a→b seen from above). The texture starts at `a` and, for window tiles, is stretched slightly so the
 * face shows a whole number of bays: rounded and cut corners never show half a window.
 */
export function facadeAxes(a: Vector2, b: Vector2, tile: FacadeTile, alignZ: number): { u: TexAxis; v: TexAxis } {
  const d = new Vector2().subVectors(b, a);
  const len = d.length() || 1;
  const axis = new Vector3(d.x / len, d.y / len, 0);
  const width = tile.widthPx ?? TILE_PX;
  const tileUnits = width * TEX_SCALE;
  // Whole bays for window tiles; plain tiles keep their natural size.
  const tiles = tile.bays > 0 ? Math.max(1, Math.round(len / (tileUnits / tile.bays))) / tile.bays : len / tileUnits;
  const uScale = len / (tiles * width);
  const startU = (a.x * axis.x + a.y * axis.y) / uScale;
  return {
    u: { axis, shift: round3(mod(-startU, width)), scale: round5(uScale) },
    // One 512px tile per floor, starting at `alignZ`.
    v: { axis: new Vector3(0, 0, -1), shift: round3(mod(alignZ / TEX_SCALE, TILE_PX)), scale: TEX_SCALE },
  };
}

const mod = (x: number, m: number) => ((x % m) + m) % m;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const round5 = (x: number) => Math.round(x * 100000) / 100000;

/**
 * A vertical prism with facade-textured sides. `sides` is one tile for all walls or one per footprint edge
 * (edge i runs from footprint[i] to footprint[i+1]).
 */
export function facadePrism(
  footprint: Vector2[], zMin: number, zMax: number,
  sides: FacadeTile | FacadeTile[], top: string, alignZ: number, bottom = NODRAW,
): FaceSpec[] {
  const tiles = Array.isArray(sides) ? sides : footprint.map(() => sides);
  const faces = prismFaces(footprint, zMin, zMax, { top, bottom, sides: tiles.map((t) => t.material) });
  footprint.forEach((a, i) => {
    const b = footprint[(i + 1) % footprint.length];
    Object.assign(faces[i + 2], facadeAxes(a, b, tiles[i], alignZ));
  });
  return faces;
}

/**
 * Moves every edge of a convex counter-clockwise polygon outwards by `d` (inwards when negative)
 * and returns the new corners.
 */
export function offsetPolygon(poly: Vector2[], d: number): Vector2[] {
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const dir = new Vector2().subVectors(b, a).normalize();
    const normal = new Vector2(dir.y, -dir.x);
    return { p: a.clone().addScaledVector(normal, d), dir };
  });
  return lines.map((l, i) => {
    const prev = lines[(i + n - 1) % n];
    // Intersection of prev (p + t·dir) with l (p + s·dir).
    const cross = prev.dir.x * l.dir.y - prev.dir.y * l.dir.x;
    if (Math.abs(cross) < 1e-9) return l.p.clone();
    const w = new Vector2().subVectors(l.p, prev.p);
    const t = (w.x * l.dir.y - w.y * l.dir.x) / cross;
    return prev.p.clone().addScaledVector(prev.dir, t);
  });
}

/** Rounds to whole units and drops repeated or collinear corners, so the prism stays a valid brush. */
export function cleanPolygon(poly: Vector2[]): Vector2[] {
  let pts = poly.map((p) => new Vector2(Math.round(p.x), Math.round(p.y)));
  pts = pts.filter((p, i) => !p.equals(pts[(i + 1) % pts.length]));
  return pts.filter((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
    return Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) > 1e-6;
  });
}

/** True when the polygon is convex and counter-clockwise. */
export function isConvexCcw(poly: Vector2[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) return false;
  }
  return true;
}
