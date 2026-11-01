import { Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import { MapSolid } from '../vmf/map.ts';
import { buildBrushFaces, type BrushFace, type Plane } from './brush.ts';
import { polygonArea } from './hull.ts';

/**
 * Faces nobody can see, set to nodraw: a face flush against (or buried in) other solid brushes, and the bottoms
 * of brushes that rest on or in the ground. vbsp leaves nodraw faces out of the drawn faces, which saves
 * lightmap space and t-junctions (vbsp culls faces between structural world brushes itself, but not between
 * func_detail or brush-entity brushes, which is most of what the generators make).
 */

export const NODRAW = 'TOOLS/TOOLSNODRAW';

/**
 * A brush with any of these materials lets the view through (glass, water, fences) or is no surface at all (clip,
 * trigger, light-blocking tool brushes): it hides nothing behind it. Black and sky faces are opaque.
 */
const SEE_THROUGH = /^glass\/|water|fence|grate|chainlink|^tools\/tools(?!nodraw|black|skybox)/i;
/** Faces of these materials keep them: tool textures stay as they are. */
const KEEP = /^tools\//i;

const EPS = 0.01;
/** A face counts as covered when less than this much of it (square units) is left showing. */
const SHOWING = 0.5;
const CELL = 512;

export interface HideOptions {
  /**
   * Brushes that hide faces of the others but keep their own materials (another generator's, walls the brushes
   * stand against). See-through and all-nodraw brushes in either list hide nothing.
   */
  cover?: KVNode[];
  /** Ground height: faces looking down whose corners all lie on or below it (bottoms) become nodraw. */
  groundAt?: (x: number, y: number) => number | null;
  /** Side ids that keep their material (faces an overlay lies on). */
  keep?: Iterable<number>;
}

interface Brush {
  solid: MapSolid;
  faces: BrushFace[];
  planes: Plane[];
  min: Vector3;
  max: Vector3;
  /** Solid to the eye: hides what lies in it or against it. */
  opaque: boolean;
}

function brushOf(node: KVNode): Brush | null {
  const solid = new MapSolid(node, null);
  if (solid.isDisplacement) return null;
  const faces = buildBrushFaces(solid);
  if (faces.length < 4) return null;
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const f of faces) for (const v of f.verts) { min.min(v); max.max(v); }
  const mats = solid.sides.map((s) => s.material);
  const opaque = !mats.some((m) => SEE_THROUGH.test(m)) && mats.some((m) => m.toUpperCase() !== NODRAW);
  return { solid, faces, planes: faces.map((f) => f.plane), min, max, opaque };
}

/** Splits a convex polygon by a plane into the part in front of it and the part behind it (both may be empty). */
function split(poly: Vector3[], p: Plane): [Vector3[], Vector3[]] {
  const front: Vector3[] = [], back: Vector3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = p.normal.dot(a) - p.dist, db = p.normal.dot(b) - p.dist;
    if (da >= -EPS) front.push(a);
    if (da <= EPS) back.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const x = new Vector3().lerpVectors(a, b, da / (da - db));
      front.push(x);
      back.push(x.clone());
    }
  }
  return [front, back];
}

/**
 * The parts of a face polygon outside a convex brush. A face lying in one of the brush's planes is inside the
 * brush when it looks into it (flush against it) and outside when it looks the same way (side by side with it).
 */
function outside(poly: Vector3[], normal: Vector3, planes: Plane[]): Vector3[][] {
  const out: Vector3[][] = [];
  let rest = poly;
  for (const q of planes) {
    const dot = q.normal.dot(normal);
    if (Math.abs(dot) > 0.9999 && Math.abs(q.normal.dot(poly[0]) - q.dist) < EPS) {
      if (dot > 0) return [poly];
      continue;
    }
    const [front, back] = split(rest, q);
    if (front.length >= 3 && polygonArea(front, normal) > 1e-3) out.push(front);
    rest = back;
    if (rest.length < 3 || polygonArea(rest, normal) <= 1e-3) return out;
  }
  return out;
}

/**
 * Sets the never-visible faces of `solids` to nodraw (see the top of the file) and returns how many changed.
 * Only faces that are wholly covered change: a face partly showing keeps its material. Displacements, tool
 * textures and `keep` sides are left alone, and displacements hide nothing (their surface is not the brush).
 */
export function hideCoveredFaces(solids: KVNode[], o: HideOptions = {}): number {
  const own = solids.map(brushOf);
  const all = [...own, ...(o.cover ?? []).map(brushOf)].filter((b): b is Brush => !!b && b.opaque);
  const grid = new Map<string, Brush[]>();
  const cells = (min: Vector3, max: Vector3, fn: (key: string) => void) => {
    for (let x = Math.floor(min.x / CELL); x <= Math.floor(max.x / CELL); x++)
      for (let y = Math.floor(min.y / CELL); y <= Math.floor(max.y / CELL); y++) fn(`${x},${y}`);
  };
  for (const b of all) cells(b.min, b.max, (k) => { const l = grid.get(k); if (l) l.push(b); else grid.set(k, [b]); });
  const keep = new Set(o.keep ?? []);
  const fmin = new Vector3(), fmax = new Vector3();
  let changed = 0;
  for (const b of own) {
    if (!b) continue;
    let dirty = false;
    for (const f of b.faces) {
      if (KEEP.test(f.side.material) || keep.has(f.side.id)) continue;
      if (!hidden(f, b)) continue;
      f.side.node.set('material', NODRAW);
      f.side.material = NODRAW;
      dirty = true;
      changed++;
    }
    if (dirty) b.solid.version++;
  }
  return changed;

  function hidden(f: BrushFace, self: Brush): boolean {
    if (o.groundAt && f.plane.normal.z < -0.7 && f.verts.every((v) => { const g = o.groundAt!(v.x, v.y); return g !== null && v.z <= g + 1; })) return true;
    fmin.set(Infinity, Infinity, Infinity); fmax.set(-Infinity, -Infinity, -Infinity);
    for (const v of f.verts) { fmin.min(v); fmax.max(v); }
    fmin.subScalar(0.1); fmax.addScalar(0.1);
    const near = new Set<Brush>();
    cells(fmin, fmax, (k) => { for (const c of grid.get(k) ?? []) near.add(c); });
    let pieces = [f.verts];
    for (const c of near) {
      if (c === self || c.max.x < fmin.x || c.min.x > fmax.x || c.max.y < fmin.y || c.min.y > fmax.y || c.max.z < fmin.z || c.min.z > fmax.z) continue;
      pieces = pieces.flatMap((p) => outside(p, f.plane.normal, c.planes));
      if (!pieces.length) return true;
    }
    return pieces.reduce((s, p) => s + polygonArea(p, f.plane.normal), 0) < SHOWING;
  }
}

/** Side ids the overlays among `entities` (nodes, or generator entities with `keys`) lie on: they keep their faces. */
export function overlaySides(entities: (KVNode | { classname: string; keys: Record<string, string> })[]): number[] {
  const ids: number[] = [];
  for (const e of entities) {
    const get = (k: string) => ('keys' in e ? (k === 'classname' ? e.classname : e.keys[k]) : e.get(k));
    if ((get('classname') ?? '').toLowerCase() !== 'info_overlay') continue;
    for (const s of (get('sides') ?? '').trim().split(/\s+/)) if (s) ids.push(Number(s));
  }
  return ids;
}

/** The brushes of generator brush entities that are drawn (func_detail, and func_brush unless rendermode 10). */
export function drawnEntitySolids(entities: { classname: string; keys: Record<string, string>; solids?: KVNode[] }[]): KVNode[] {
  return entities.filter((e) => /^func_(detail|brush)$/i.test(e.classname) && e.keys.rendermode !== '10').flatMap((e) => e.solids ?? []);
}
