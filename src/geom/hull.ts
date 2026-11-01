import { Vector3 } from 'three';

export interface HullFace {
  /** Outward unit normal. */
  normal: Vector3;
  dist: number;
  /** Corners of the face, counter-clockwise seen from outside (no collinear or inner points). */
  verts: Vector3[];
}

const EPS = 0.01;

/** Points with near-duplicates (closer than 0.01) dropped. */
export function uniquePoints(points: Vector3[]): Vector3[] {
  const out: Vector3[] = [];
  for (const p of points) if (!out.some((q) => q.distanceToSquared(p) < 1e-4)) out.push(p.clone());
  return out;
}

/** 2D convex hull (monotone chain) of points on a plane, counter-clockwise about `normal`. */
function planeHull(points: Vector3[], normal: Vector3): Vector3[] {
  const ref = Math.abs(normal.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(ref, normal).normalize();
  const w = new Vector3().crossVectors(normal, u);
  const pts = points.map((p) => ({ p, x: p.dot(u), y: p.dot(w) })).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: typeof pts[0], a: typeof pts[0], b: typeof pts[0]) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof pts = [], upper: typeof pts = [];
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-6) lower.pop();
    lower.push(q);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-6) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((q) => q.p);
}

/**
 * Convex hull of a small point set (brush corners), with coplanar triangles merged into one face. Brute force
 * over point triples, which is fine for the few dozen corners a brush has. Null when the points span no volume.
 */
export function convexHull(points: Vector3[]): HullFace[] | null {
  const pts = uniquePoints(points);
  if (pts.length < 4) return null;
  const faces: HullFace[] = [];
  const seen = new Set<string>();
  const n = new Vector3(), ab = new Vector3(), ac = new Vector3();
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      for (let k = j + 1; k < pts.length; k++) {
        n.crossVectors(ab.subVectors(pts[j], pts[i]), ac.subVectors(pts[k], pts[i]));
        const len = n.length();
        if (len < 1e-6) continue;
        n.divideScalar(len);
        let pos = false, neg = false;
        for (const p of pts) {
          const s = n.dot(p) - n.dot(pts[i]);
          if (s > EPS) pos = true;
          else if (s < -EPS) neg = true;
          if (pos && neg) break;
        }
        if (pos && neg) continue;
        if (!pos && !neg) return null;
        const normal = pos ? n.clone().negate() : n.clone();
        const dist = normal.dot(pts[i]);
        const on = pts.map((p, idx) => (Math.abs(normal.dot(p) - dist) <= EPS ? idx : -1)).filter((idx) => idx >= 0);
        const key = on.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const verts = planeHull(on.map((idx) => pts[idx]), normal);
        if (verts.length >= 3) faces.push({ normal, dist, verts });
      }
    }
  }
  return faces.length >= 4 && hullVolume(faces) > 1 ? faces : null;
}

/** Volume enclosed by convex faces. */
export function hullVolume(faces: { normal: Vector3; verts: Vector3[] }[]): number {
  const c = new Vector3();
  let count = 0;
  for (const f of faces) for (const v of f.verts) { c.add(v); count++; }
  c.divideScalar(count || 1);
  let vol = 0;
  for (const f of faces) {
    const area = polygonArea(f.verts, f.normal);
    vol += (area * (f.normal.dot(f.verts[0]) - f.normal.dot(c))) / 3;
  }
  return vol;
}

/** Area of a planar polygon. */
export function polygonArea(verts: Vector3[], normal: Vector3): number {
  const sum = new Vector3();
  for (let i = 0; i < verts.length; i++) sum.add(new Vector3().crossVectors(verts[i], verts[(i + 1) % verts.length]));
  return Math.abs(sum.dot(normal)) / 2;
}

/**
 * Three corners of a counter-clockwise face for a VMF plane: the largest triangle (most exact), ordered the way
 * Hammer stores them (clockwise seen from outside), so planeFromPoints gives the outward normal.
 */
export function planePoints(verts: Vector3[], normal: Vector3): [Vector3, Vector3, Vector3] {
  let best: [number, number, number] = [0, 1, 2], area = -1;
  const t = new Vector3();
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      for (let k = j + 1; k < verts.length; k++) {
        const a = t.crossVectors(new Vector3().subVectors(verts[j], verts[i]), new Vector3().subVectors(verts[k], verts[i])).length();
        if (a > area) { area = a; best = [i, j, k]; }
      }
    }
  }
  const [a, b, c] = best.map((i) => verts[i].clone());
  const ccw = new Vector3().crossVectors(new Vector3().subVectors(b, a), new Vector3().subVectors(c, a)).dot(normal) > 0;
  return ccw ? [a, c, b] : [a, b, c];
}
