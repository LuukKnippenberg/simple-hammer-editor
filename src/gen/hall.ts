import { Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { boxFaces, solidNode, worldAlignedAxes, type FaceSpec } from '../edit/brushes.ts';
import { BLOCKLIGHT } from './interiorShell.ts';

/**
 * A large hall (a station concourse, a train shed, a market hall) as brushes: straight walls with doors and
 * window holes, an invisible roof that blocks the sun like a real one (open over its skylights, so shafts of
 * sunlight fall in), glass in the windows and girders across the top. Like the generated interiors, the roof
 * is not drawn: the RTS camera looks in from above.
 */

export type Rect = [number, number, number, number];

/** A hole in a wall: from / to along the wall (from its start), z0 / z1 above the floor. */
export interface HallOpening { from: number; to: number; z0: number; z1: number }

/** A straight, axis-aligned wall along its centre line. */
export interface HallWall {
  a: Vector2;
  b: Vector2;
  thickness: number;
  /** Which side faces into the hall: the side the left-hand normal of a→b points to (1), the other (-1), or both (0, a partition). */
  inside: 1 | -1 | 0;
  openings: HallOpening[];
  /** Inner finishes for this wall's left / right face (left of a→b), instead of the hall's `inner`. */
  faces?: { left?: string; right?: string };
}

export interface HallMaterials {
  inner: string;
  outer: string;
  cap: string;
  glass: string;
  /** World units per texel for the outer finish (facades are drawn larger than plaster). */
  outerScale?: number;
  /**
   * The outside of the window panes: a window texture (512 texels tall) fitted to the window's height and repeated
   * along it, so from the street a band reads as a row of windows. Glass on both sides when not given.
   */
  windows?: string;
}

export interface HallSpec {
  floorZ: number;
  height: number;
  walls: HallWall[];
  materials: HallMaterials;
  /** Roof areas and the skylights left open in them (overhang the walls: the roof floats ROOF_GAP above them). */
  roofs: { rect: Rect; skylights: Rect[] }[];
  /** Girders across each roof: along y (`x`: every `every` units along x) or along x. */
  girders?: { rect: Rect; along: 'x' | 'y'; every: number; size: number; material: string }[];
}

export interface HallBrushes {
  /** Walls (world brushes). */
  world: KVNode[];
  /**
   * The light-blocking roof, for a func_brush with vrad_brush_cast_shadows 1 (vrad blocks light with it all the
   * same). As world brushes its faces count towards vbsp's t-junction limit even though they are never drawn.
   */
  roof: KVNode[];
  /** Glass panes in the window holes (for one never-solid func_brush). */
  glass: KVNode[];
  /** Girders (for a func_detail). */
  girders: KVNode[];
}

const NODRAW = 'TOOLS/TOOLSNODRAW';
const ROOF_THICKNESS = 8;
/**
 * The roof floats this far above the wall tops: touching them, its edges (and the corners of the skylight rows)
 * would put t-junctions on every wall cap, which in a big map is more than vbsp can fix. Let the roof overhang
 * the walls a little (24 blocks the sun down to 18° above the horizon) so it can't slip in through the gap, but
 * keep it, and the walls, off the buildings next door for the same reason.
 */
export const ROOF_GAP = 8;

/** Solid z ranges of a wall between floor and top, with the holes taken out. */
function solidSpans(z0: number, z1: number, holes: [number, number][]): [number, number][] {
  let spans: [number, number][] = [[z0, z1]];
  for (const [h0, h1] of holes) {
    spans = spans.flatMap(([s0, s1]): [number, number][] => (h1 <= s0 || h0 >= s1 ? [[s0, s1]] : [...(h0 > s0 ? [[s0, h0] as [number, number]] : []), ...(h1 < s1 ? [[h1, s1] as [number, number]] : [])]));
  }
  return spans.filter(([s0, s1]) => s1 - s0 > 0.5);
}

/** The pieces of a wall: one box per run along it and solid z range, so the openings stay open. */
export function wallPieces(w: HallWall, floorZ: number, height: number): { min: Vector3; max: Vector3; window: boolean }[] {
  const len = w.a.distanceTo(w.b);
  const cuts = [...new Set([0, len, ...w.openings.flatMap((o) => [Math.max(0, Math.min(len, o.from)), Math.max(0, Math.min(len, o.to))])])].sort((p, q) => p - q);
  const dir = new Vector2().subVectors(w.b, w.a).normalize();
  const half = w.thickness / 2;
  const out: { min: Vector3; max: Vector3; window: boolean }[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const s0 = cuts[i], s1 = cuts[i + 1];
    if (s1 - s0 < 0.5) continue;
    const holes = w.openings.filter((o) => o.from <= s0 + 0.01 && o.to >= s1 - 0.01).map((o): [number, number] => [floorZ + o.z0, floorZ + o.z1]);
    const p0 = w.a.clone().addScaledVector(dir, s0), p1 = w.a.clone().addScaledVector(dir, s1);
    for (const [z0, z1] of solidSpans(floorZ, floorZ + height, holes)) {
      out.push({
        min: new Vector3(Math.min(p0.x, p1.x) - (dir.x === 0 ? half : 0), Math.min(p0.y, p1.y) - (dir.y === 0 ? half : 0), z0),
        max: new Vector3(Math.max(p0.x, p1.x) + (dir.x === 0 ? half : 0), Math.max(p0.y, p1.y) + (dir.y === 0 ? half : 0), z1),
        window: false,
      });
    }
    // A hole that doesn't reach the floor is a window: it gets a pane.
    for (const [z0, z1] of holes) if (z0 > floorZ + 1) {
      out.push({
        min: new Vector3(Math.min(p0.x, p1.x) - (dir.x === 0 ? 2 : 0), Math.min(p0.y, p1.y) - (dir.y === 0 ? 2 : 0), z0),
        max: new Vector3(Math.max(p0.x, p1.x) + (dir.x === 0 ? 2 : 0), Math.max(p0.y, p1.y) + (dir.y === 0 ? 2 : 0), z1),
        window: true,
      });
    }
  }
  return out;
}

/** Splits a rectangle minus some holes into rectangles (rows of the grid the hole edges make, merged along x). */
export function rectMinus(r: Rect, holes: Rect[]): Rect[] {
  const xs = [...new Set([r[0], r[2], ...holes.flatMap((h) => [h[0], h[2]]).filter((x) => x > r[0] && x < r[2])])].sort((p, q) => p - q);
  const ys = [...new Set([r[1], r[3], ...holes.flatMap((h) => [h[1], h[3]]).filter((y) => y > r[1] && y < r[3])])].sort((p, q) => p - q);
  const out: Rect[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    let run: Rect | null = null;
    for (let i = 0; i + 1 < xs.length; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      const open = holes.some((h) => cx > h[0] && cx < h[2] && cy > h[1] && cy < h[3]);
      if (open) { if (run) { out.push(run); run = null; } continue; }
      if (run) run[2] = xs[i + 1];
      else run = [xs[i], ys[j], xs[i + 1], ys[j + 1]];
    }
    if (run) out.push(run);
  }
  return out;
}

/** The hall's brushes. */
export function hallBrushes(doc: VmfDocument, spec: HallSpec): HallBrushes {
  const { floorZ, height, materials: m } = spec;
  const world: KVNode[] = [], roof: KVNode[] = [], glass: KVNode[] = [], girders: KVNode[] = [];
  for (const w of spec.walls) {
    const dir = new Vector2().subVectors(w.b, w.a).normalize();
    // Left-hand normal of a→b, as a box side: 2 (-y), 3 (+x), 4 (+y), 5 (-x).
    const left = new Vector2(-dir.y, dir.x);
    const sideOf = (n: Vector2) => (n.y < -0.5 ? 2 : n.x > 0.5 ? 3 : n.y > 0.5 ? 4 : 5);
    const outerSide = w.inside === 0 ? -1 : sideOf(w.inside === 1 ? left.clone().negate() : left);
    /** Texture axes on the outer face, world-aligned at `scale`, the texture's top on `top`. */
    const outerAxes = (scale: number, top: number) => {
      const n = [new Vector3(0, -1, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(-1, 0, 0)][outerSide - 2];
      const ax = worldAlignedAxes(n, scale);
      return { u: ax.u, v: { ...ax.v, shift: (top / scale) % 512 } };
    };
    for (const piece of wallPieces(w, floorZ, height)) {
      if (piece.window) {
        const faces = boxFaces(piece.min, piece.max, m.glass);
        if (m.windows && outerSide >= 0) Object.assign(faces[outerSide], { material: m.windows, ...outerAxes((piece.max.z - piece.min.z) / 512, piece.max.z) });
        glass.push(solidNode(doc, faces));
        continue;
      }
      const faces: FaceSpec[] = boxFaces(piece.min, piece.max, { top: m.cap, bottom: NODRAW, sides: m.inner });
      if (w.faces?.left) faces[sideOf(left)].material = w.faces.left;
      if (w.faces?.right) faces[sideOf(left.clone().negate())].material = w.faces.right;
      if (outerSide >= 0) {
        Object.assign(faces[outerSide], { material: m.outer, ...outerAxes(m.outerScale ?? 0.25, floorZ + height) });
        // The reveals of the openings in an outer wall (the piece's ends) are the outer stone, not the room's plaster,
        // and the underside over a window or door is the cap's.
        for (const i of dir.x !== 0 ? [3, 5] : [2, 4]) faces[i].material = m.outer;
      }
      if (piece.min.z > floorZ + 1) faces[1].material = m.cap;
      world.push(solidNode(doc, faces));
    }
  }
  for (const r of spec.roofs) {
    for (const [x0, y0, x1, y1] of rectMinus(r.rect, r.skylights)) {
      roof.push(solidNode(doc, boxFaces(new Vector3(x0, y0, floorZ + height + ROOF_GAP), new Vector3(x1, y1, floorZ + height + ROOF_GAP + ROOF_THICKNESS), BLOCKLIGHT)));
    }
  }
  for (const g of spec.girders ?? []) {
    const [x0, y0, x1, y1] = g.rect;
    const z1 = floorZ + height - 2, z0 = z1 - g.size;
    const h = g.size / 2;
    if (g.along === 'y') for (let x = x0 + g.every; x < x1 - g.every / 4; x += g.every) girders.push(solidNode(doc, boxFaces(new Vector3(x - h, y0, z0), new Vector3(x + h, y1, z1), g.material)));
    else for (let y = y0 + g.every; y < y1 - g.every / 4; y += g.every) girders.push(solidNode(doc, boxFaces(new Vector3(x0, y - h, z0), new Vector3(x1, y + h, z1), g.material)));
  }
  return { world, roof, glass, girders };
}
