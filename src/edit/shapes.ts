import { Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { prismFaces, solidNode, type FaceSpec } from './brushes.ts';

export type ShapeKind = 'box' | 'cylinder' | 'cone' | 'dome';

export interface ShapeMaterials {
  top: string;
  bottom: string;
  sides: string;
}

/** Regular polygon (counter-clockwise from above) inscribed in an ellipse, snapped to whole units. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, sides: number): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < sides; i++) {
    // Offset by half a step so a 4-sided shape is an axis-aligned box.
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    out.push(new Vector2(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry)));
  }
  return out;
}

/** A frustum between two horizontal convex polygons with the same vertex count (top may be a point). */
export function frustumFaces(bottom: Vector2[], top: Vector2[] | Vector2, z0: number, z1: number, m: ShapeMaterials): FaceSpec[] {
  const n = bottom.length;
  const b = (i: number) => new Vector3(bottom[i % n].x, bottom[i % n].y, z0);
  const faces: FaceSpec[] = [{ points: [b(0), b(1), b(2)], material: m.bottom }];
  if (top instanceof Vector2) {
    const apex = new Vector3(top.x, top.y, z1);
    for (let i = 0; i < n; i++) faces.push({ points: [apex, b(i + 1), b(i)], material: m.sides });
  } else {
    const t = (i: number) => new Vector3(top[i % n].x, top[i % n].y, z1);
    faces.push({ points: [t(0), t(2), t(1)], material: m.top });
    for (let i = 0; i < n; i++) faces.push({ points: [t(i), t(i + 1), b(i)], material: m.sides });
  }
  return faces;
}

/**
 * Brushes for a primitive shape filling the footprint rectangle from z0 to z1. Domes are stacked
 * frustums (each brush stays convex); cones end in a point.
 */
export function shapeSolids(doc: VmfDocument, kind: ShapeKind, min: Vector3, max: Vector3, m: ShapeMaterials, sides = 12): KVNode[] {
  const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2;
  const rx = (max.x - min.x) / 2, ry = (max.y - min.y) / 2;
  const z0 = min.z, z1 = max.z;
  if (kind === 'box') {
    const fp = [new Vector2(min.x, min.y), new Vector2(max.x, min.y), new Vector2(max.x, max.y), new Vector2(min.x, max.y)];
    return [solidNode(doc, prismFaces(fp, z0, z1, m))];
  }
  if (kind === 'cylinder') return [solidNode(doc, prismFaces(ellipse(cx, cy, rx, ry, sides), z0, z1, m))];
  if (kind === 'cone') return [solidNode(doc, frustumFaces(ellipse(cx, cy, rx, ry, sides), new Vector2(Math.round(cx), Math.round(cy)), z0, z1, m))];
  // Dome: rings at increasing elevation angles; the last segment closes with a small flat cap.
  const rings = Math.max(3, Math.round(sides / 3));
  const out: KVNode[] = [];
  let prev = ellipse(cx, cy, rx, ry, sides);
  let prevZ = z0;
  for (let k = 1; k <= rings; k++) {
    const a = (k / rings) * (Math.PI / 2);
    const s = k === rings ? 0.18 : Math.cos(a);
    const z = Math.round(z0 + (z1 - z0) * Math.sin(Math.min(a, Math.PI / 2 - 0.12)));
    if (z <= prevZ) continue;
    const ring = ellipse(cx, cy, Math.max(8, rx * s), Math.max(8, ry * s), sides);
    out.push(solidNode(doc, frustumFaces(prev, ring, prevZ, z, m)));
    prev = ring;
    prevZ = z;
  }
  return out;
}
