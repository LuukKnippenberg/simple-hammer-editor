import { Vector2, Vector3, type Camera } from 'three';
import type { MapSolid } from '../vmf/map.ts';
import { topology } from './brushEdit.ts';

/** What a click selects with the Select tool: whole objects, or faces, edges or corners of brushes. */
export type SelectMode = 'object' | 'face' | 'edge' | 'vertex';
export type PartMode = Exclude<SelectMode, 'object'>;

export const SELECT_MODES: { mode: SelectMode; label: string; key: string }[] = [
  { mode: 'object', label: 'Object', key: '1' },
  { mode: 'face', label: 'Face', key: '2' },
  { mode: 'edge', label: 'Edge', key: '3' },
  { mode: 'vertex', label: 'Vertex', key: '4' },
];

/** A face (side index), edge (two corners) or vertex (one corner) of a brush. */
export interface Part {
  solid: MapSolid;
  kind: PartMode;
  /** Side index, for faces. */
  side: number;
  /** Corner positions: one for a vertex, two for an edge, none for a face (see partVerts). */
  verts: Vector3[];
}

const near = (a: Vector3, b: Vector3) => a.distanceToSquared(b) < 1e-3;

export function samePart(a: Part, b: Part): boolean {
  if (a.solid !== b.solid || a.kind !== b.kind) return false;
  if (a.kind === 'face') return a.side === b.side;
  return a.verts.length === b.verts.length && a.verts.every((v) => b.verts.some((w) => near(v, w)));
}

/** The corners a part stands for (a face's polygon). Empty when the part no longer exists on its brush. */
export function partVerts(p: Part): Vector3[] {
  const t = topology(p.solid);
  if (p.kind === 'face') return t.faces.find((f) => f.side === p.side)?.verts ?? [];
  return p.verts.every((v) => t.verts.some((w) => near(v, w))) ? p.verts : [];
}

export function partCentre(p: Part): Vector3 {
  const vs = partVerts(p);
  const c = new Vector3();
  for (const v of vs) c.add(v);
  return c.divideScalar(vs.length || 1);
}

/** Every face, edge or vertex of a brush. */
export function partsOf(solid: MapSolid, kind: PartMode): Part[] {
  const t = topology(solid);
  if (kind === 'face') return t.faces.map((f) => ({ solid, kind, side: f.side, verts: [] }));
  if (kind === 'edge') return t.edges.map(([a, b]) => ({ solid, kind, side: -1, verts: [a.clone(), b.clone()] }));
  return t.verts.map((v) => ({ solid, kind, side: -1, verts: [v.clone()] }));
}

/** Converts a selection to another mode: the corners of the old parts, and what lies on them. */
export function convertParts(parts: Part[], kind: PartMode): Part[] {
  const corners = new Map<MapSolid, Vector3[]>();
  for (const p of parts) corners.set(p.solid, [...(corners.get(p.solid) ?? []), ...partVerts(p)]);
  const out: Part[] = [];
  for (const [solid, vs] of corners) {
    for (const q of partsOf(solid, kind)) if (partVerts(q).every((v) => vs.some((w) => near(v, w)))) out.push(q);
  }
  return out;
}

/** Projects world points to pixels on a canvas of `size`. */
export function toScreen(cam: Camera, size: Vector2, p: Vector3): Vector2 | null {
  const v = p.clone().project(cam);
  if (v.z > 1) return null;
  return new Vector2(((v.x + 1) / 2) * size.x, ((1 - v.y) / 2) * size.y);
}

function segDist(p: Vector2, a: Vector2, b: Vector2): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/**
 * The edge or vertex nearest the cursor (pixels): any of the hit face's, or one of `extra` brushes' within
 * `reach` pixels (so corners of brushes being edited can be picked at their silhouette or behind).
 */
export function nearestPart(kind: 'edge' | 'vertex', cursor: Vector2, cam: Camera, size: Vector2,
  hit: { solid: MapSolid; side: number } | null, extra: MapSolid[], reach = 12): Part | null {
  let best: Part | null = null, bestD = Infinity;
  const consider = (p: Part, limit: number) => {
    const s = p.verts.map((v) => toScreen(cam, size, v));
    if (s.some((x) => !x)) return;
    const d = kind === 'vertex' ? cursor.distanceTo(s[0]!) : segDist(cursor, s[0]!, s[1]!);
    if (d < bestD && d <= limit) { bestD = d; best = p; }
  };
  if (hit) {
    const face = topology(hit.solid).faces.find((f) => f.side === hit.side);
    if (face) {
      face.verts.forEach((a, i) => {
        const b = face.verts[(i + 1) % face.verts.length];
        consider({ solid: hit.solid, kind, side: -1, verts: kind === 'vertex' ? [a.clone()] : [a.clone(), b.clone()] }, Infinity);
      });
    }
  }
  for (const s of extra) if (s !== hit?.solid) for (const p of partsOf(s, kind)) consider(p, reach);
  if (hit) for (const p of partsOf(hit.solid, kind)) consider(p, Math.min(reach, bestD - 0.5));
  return best;
}
