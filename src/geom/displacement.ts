import { Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { BrushFace } from './brush.ts';
import { parseVec } from '../vmf/map.ts';

export interface DispGrid {
  /** Vertices per side (2^power + 1). */
  size: number;
  /** Displaced positions, row-major. */
  positions: Vector3[];
  /** Undisplaced positions on the base face, used for texture coordinates. */
  base: Vector3[];
  /** Blend alpha 0..1 per vertex (for two-texture blend materials). */
  alpha: Float32Array;
  /** Triangle indices into the grid, wound counter-clockwise seen from the face normal side. */
  indices: Uint32Array;
}

function rows(node: KVNode | undefined, size: number, stride: number): Float32Array {
  const out = new Float32Array(size * size * stride);
  if (!node) return out;
  for (let r = 0; r < size; r++) {
    const s = node.get('row' + r);
    if (!s) continue;
    const vals = s.trim().split(/\s+/);
    for (let k = 0; k < size * stride && k < vals.length; k++) out[r * size * stride + k] = parseFloat(vals[k]) || 0;
  }
  return out;
}

/**
 * Builds a displacement grid the way VBSP does: corners start at the vertex nearest
 * `startposition` (walking the face in Source's clockwise order), rows run along corner 0 → 1.
 */
export function buildDisplacement(face: BrushFace, disp: KVNode): DispGrid | null {
  if (face.verts.length !== 4) return null;
  const power = Math.min(4, Math.max(2, parseInt(disp.get('power') ?? '3', 10) || 3));
  const size = (1 << power) + 1;
  const elevation = parseFloat(disp.get('elevation') ?? '0') || 0;

  // Our polygons are CCW from outside; Source walks them clockwise.
  const v = face.verts;
  const src = [v[0], v[3], v[2], v[1]];
  const start = parseVec(disp.get('startposition'));
  let si = 0, best = Infinity;
  for (let k = 0; k < 4; k++) {
    const d = src[k].distanceToSquared(start);
    if (d < best) { best = d; si = k; }
  }
  const c = [0, 1, 2, 3].map((k) => src[(si + k) % 4]);

  const normals = rows(disp.child('normals'), size, 3);
  const dists = rows(disp.child('distances'), size, 1);
  const offsets = rows(disp.child('offsets'), size, 3);
  const alphas = rows(disp.child('alphas'), size, 1);

  const n = face.plane.normal;
  const positions: Vector3[] = [];
  const base: Vector3[] = [];
  const alpha = new Float32Array(size * size);
  const e0 = new Vector3(), e1 = new Vector3();
  for (let r = 0; r < size; r++) {
    const tv = r / (size - 1);
    e0.lerpVectors(c[0], c[1], tv);
    e1.lerpVectors(c[3], c[2], tv);
    for (let j = 0; j < size; j++) {
      const idx = r * size + j;
      const b = new Vector3().lerpVectors(e0, e1, j / (size - 1));
      const d = dists[idx];
      const p = b.clone()
        .add(new Vector3(normals[idx * 3] * d, normals[idx * 3 + 1] * d, normals[idx * 3 + 2] * d))
        .add(new Vector3(offsets[idx * 3], offsets[idx * 3 + 1], offsets[idx * 3 + 2]))
        .addScaledVector(n, elevation);
      base.push(b);
      positions.push(p);
      alpha[idx] = Math.min(1, Math.max(0, alphas[idx] / 255));
    }
  }

  const cells = size - 1;
  const idx: number[] = [];
  for (let r = 0; r < cells; r++) {
    for (let j = 0; j < cells; j++) {
      const a = r * size + j, b = a + 1, cc = a + size, d = cc + 1;
      if ((r + j) % 2 === 0) idx.push(a, cc, d, a, d, b);
      else idx.push(a, cc, b, b, cc, d);
    }
  }
  // Orient by the undisplaced grid so cliffs and overhangs keep the right facing.
  const t0 = new Vector3().subVectors(base[idx[1]], base[idx[0]]).cross(new Vector3().subVectors(base[idx[2]], base[idx[0]]));
  if (t0.dot(n) < 0) {
    for (let k = 0; k < idx.length; k += 3) {
      const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t;
    }
  }
  return { size, positions, base, alpha, indices: new Uint32Array(idx) };
}
