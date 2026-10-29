import { Vector3 } from 'three';
import type { MapSide, MapSolid } from '../vmf/map.ts';

export interface Plane {
  normal: Vector3;
  dist: number;
}

export interface BrushFace {
  side: MapSide;
  plane: Plane;
  /** Polygon vertices, counter-clockwise when seen from outside the brush. */
  verts: Vector3[];
}

const EPS = 0.01;
const HUGE = 65536;

/** Outward plane through three VMF plane points (Hammer stores them clockwise seen from outside). */
export function planeFromPoints(a: Vector3, b: Vector3, c: Vector3): Plane | null {
  const n = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(b, a));
  const len = n.length();
  if (len < 1e-9) return null;
  n.divideScalar(len);
  return { normal: n, dist: n.dot(a) };
}

function basePolygon(p: Plane): Vector3[] {
  const n = p.normal;
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  const ref = az >= ax && az >= ay ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
  const u = new Vector3().crossVectors(ref, n).normalize();
  const v = new Vector3().crossVectors(n, u);
  const c = n.clone().multiplyScalar(p.dist);
  u.multiplyScalar(HUGE);
  v.multiplyScalar(HUGE);
  return [
    c.clone().add(u).add(v),
    c.clone().sub(u).add(v),
    c.clone().sub(u).sub(v),
    c.clone().add(u).sub(v),
  ];
}

/** Keeps the part of the polygon behind the plane (inside the brush). */
export function clipPolygon(poly: Vector3[], p: Plane): Vector3[] {
  const out: Vector3[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const da = p.normal.dot(a) - p.dist;
    const db = p.normal.dot(b) - p.dist;
    if (da <= EPS) out.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      out.push(new Vector3().lerpVectors(a, b, t));
    }
  }
  return out;
}

function snap(v: Vector3): Vector3 {
  const r = (x: number) => {
    const ri = Math.round(x);
    return Math.abs(x - ri) < 0.005 ? ri : x;
  };
  return v.set(r(v.x), r(v.y), r(v.z));
}

function dedupe(poly: Vector3[]): Vector3[] {
  const out: Vector3[] = [];
  for (const v of poly) {
    if (!out.length || out[out.length - 1].distanceToSquared(v) > 1e-4) out.push(v);
  }
  while (out.length > 1 && out[0].distanceToSquared(out[out.length - 1]) <= 1e-4) out.pop();
  return out;
}

/** Turns a brush's planes into convex face polygons. Faces clipped away entirely are omitted. */
export function buildBrushFaces(solid: MapSolid): BrushFace[] {
  const planes = solid.sides.map((s) => planeFromPoints(s.plane[0], s.plane[1], s.plane[2]));
  const faces: BrushFace[] = [];
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    if (!p) continue;
    let poly = basePolygon(p);
    for (let j = 0; j < planes.length && poly.length >= 3; j++) {
      const q = planes[j];
      if (j === i || !q) continue;
      // Duplicate coplanar planes: keep only the first occurrence.
      if (q.normal.dot(p.normal) > 0.9999 && Math.abs(q.dist - p.dist) < EPS) {
        if (j < i) poly = [];
        continue;
      }
      poly = clipPolygon(poly, q);
    }
    poly = dedupe(poly.map(snap));
    if (poly.length >= 3) faces.push({ side: solid.sides[i], plane: p, verts: poly });
  }
  return faces;
}

/** Texture coordinates in texels (divide by texture size for UVs). */
export function texelUV(side: MapSide, pos: Vector3): [number, number] {
  const u = side.uaxis, v = side.vaxis;
  return [pos.dot(u.axis) / (u.scale || 1) + u.shift, pos.dot(v.axis) / (v.scale || 1) + v.shift];
}
