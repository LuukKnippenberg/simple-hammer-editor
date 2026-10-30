import { Box3, Vector3 } from 'three';
import { MapSolid } from '../src/vmf/map.ts';
import { buildBrushFaces, clipPolygon, type BrushFace } from '../src/geom/brush.ts';
import type { KVNode } from '../src/vmf/keyvalues.ts';

/** A brush with its faces and bounds, for overlap checks. */
export interface ScanBrush {
  index: number;
  faces: BrushFace[];
  box: Box3;
  materials: string[];
}

export function scanBrushes(nodes: KVNode[]): ScanBrush[] {
  return nodes.map((n, index) => {
    const faces = buildBrushFaces(new MapSolid(n, null));
    const box = new Box3().setFromPoints(faces.flatMap((f) => f.verts));
    return { index, faces, box, materials: [...new Set(faces.map((f) => f.side.material))] };
  });
}

/** Pairs of brushes whose bounding boxes overlap by more than `eps` on every axis. */
export function boxPairs(brushes: ScanBrush[], eps = 0.5): [ScanBrush, ScanBrush][] {
  const sorted = [...brushes].sort((a, b) => a.box.min.x - b.box.min.x);
  const out: [ScanBrush, ScanBrush][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length && sorted[j].box.min.x < a.box.max.x - eps; j++) {
      const b = sorted[j];
      const lo = a.box.min.clone().max(b.box.min), hi = a.box.max.clone().min(b.box.max);
      if (hi.x - lo.x > eps && hi.y - lo.y > eps && hi.z - lo.z > eps) out.push([a, b]);
    }
  }
  return out;
}

/** The bounds of two convex brushes' common volume, or null when they only touch (within `eps`). */
export function intersection(a: ScanBrush, b: ScanBrush, eps = 0.5): Box3 | null {
  const clipAll = (faces: BrushFace[], by: BrushFace[]) => faces.flatMap((f) => by.reduce((poly, g) => (poly.length ? clipPolygon(poly, g.plane) : poly), f.verts));
  const pts = [...clipAll(a.faces, b.faces), ...clipAll(b.faces, a.faces)];
  if (!pts.length) return null;
  const box = new Box3().setFromPoints(pts);
  const size = box.getSize(new Vector3());
  return size.x > eps && size.y > eps && size.z > eps ? box : null;
}

const NODRAW = 'TOOLS/TOOLSNODRAW';

/**
 * Drawn faces of two brushes on the same plane, facing the same way and overlapping by more than
 * `minArea`: they z-fight.
 */
export function coplanarOverlaps(a: ScanBrush, b: ScanBrush, minArea = 1): { normal: Vector3; area: number; at: Vector3; materials: string[] }[] {
  const out: { normal: Vector3; area: number; at: Vector3; materials: string[] }[] = [];
  for (const f of a.faces) {
    for (const g of b.faces) {
      if (f.side.material === NODRAW || g.side.material === NODRAW) continue;
      if (f.plane.normal.dot(g.plane.normal) < 0.9999 || Math.abs(f.plane.dist - g.plane.dist) > 0.05) continue;
      // Clip f by g's edge planes (each edge with the face normal gives an inward half-space).
      let poly = f.verts;
      const n = g.plane.normal;
      for (let i = 0; i < g.verts.length && poly.length >= 3; i++) {
        const p = g.verts[i], q = g.verts[(i + 1) % g.verts.length];
        const en = new Vector3().subVectors(q, p).cross(n).normalize();
        poly = clipPolygon(poly, { normal: en, dist: en.dot(p) });
      }
      if (poly.length < 3) continue;
      const area = poly.reduce((s, p, i) => s.add(new Vector3().crossVectors(p, poly[(i + 1) % poly.length])), new Vector3()).dot(n) / 2;
      if (Math.abs(area) > minArea) out.push({ normal: n.clone(), area: Math.abs(area), at: new Box3().setFromPoints(poly).getCenter(new Vector3()), materials: [f.side.material, g.side.material] });
    }
  }
  return out;
}
