import { Box3, Vector3 } from 'three';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { MapSolid } from '../vmf/map.ts';
import { buildBrushFaces } from '../geom/brush.ts';
import { buildDisplacement } from '../geom/displacement.ts';

/**
 * Painting and sculpting displacement terrain. A brush stroke changes the alphas (which of a blend
 * material's two textures shows) or the distances (height) of every displacement vertex in its radius.
 * Vertices are found by world position, so the shared edges of neighbouring patches change alike and
 * no cracks open.
 */

export type GroundMode = 'paint' | 'erase' | 'raise' | 'lower' | 'smooth' | 'flatten';

/** Blend materials: alpha 0 shows the first texture, 255 the second. */
export const GROUND_SETS = [
  { material: 'NATURE/BLENDGRASSDIRT01A', label: 'Grass → dirt' },
  { material: 'NATURE/BLEND_GRASS01_MUD01', label: 'Grass → mud' },
  { material: 'NATURE/BLENDDIRTGRASS01', label: 'Gravel → dirt' },
  { material: 'NATURE/BLENDRUBBLEDIRT001A', label: 'Rubble → dirt' },
  { material: 'NATURE/BLENDSTONEDIRT001A', label: 'Cobble → dirt' },
  { material: 'NATURE/BLENDDEBRIS002A', label: 'Dirt → concrete debris' },
  { material: 'NATURE/BLENDROCKSAND004A', label: 'Rock → sand' },
  { material: 'NATURE/BLENDSNOWFLOOR005C', label: 'Snow → trodden snow' },
] as const;

/** One displacement, with its rows unpacked for editing. */
export interface Disp {
  solid: MapSolid;
  node: KVNode;
  size: number;
  normals: Float32Array;
  dists: Float32Array;
  alphas: Float32Array;
  /** Undisplaced positions plus offsets and elevation, so position = base + normal · distance. */
  base: Vector3[];
  /** Spacing between neighbouring vertices. */
  step: number;
  bounds: Box3;
}

function rows(node: KVNode | undefined, size: number, stride: number): Float32Array {
  const out = new Float32Array(size * size * stride);
  for (let r = 0; r < size && node; r++) {
    const vals = (node.get('row' + r) ?? '').trim().split(/\s+/);
    for (let k = 0; k < size * stride && k < vals.length; k++) out[r * size * stride + k] = parseFloat(vals[k]) || 0;
  }
  return out;
}

function writeRows(disp: KVNode, name: string, size: number, stride: number, data: Float32Array): void {
  let block = disp.child(name);
  if (!block) {
    block = new KVNode(name);
    disp.items.push(block);
  }
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  for (let r = 0; r < size; r++) {
    const vals: string[] = [];
    for (let k = 0; k < size * stride; k++) vals.push(fmt(data[r * size * stride + k]));
    block.set('row' + r, vals.join(' '));
  }
}

/** The editable displacement of a brush, or null. */
export function readDisp(solid: MapSolid): Disp | null {
  const faces = buildBrushFaces(solid);
  for (const face of faces) {
    const node = face.side.dispinfo;
    if (!node) continue;
    const grid = buildDisplacement(face, node);
    if (!grid) continue;
    const size = grid.size;
    const normals = rows(node.child('normals'), size, 3);
    const dists = rows(node.child('distances'), size, 1);
    const alphas = rows(node.child('alphas'), size, 1);
    // Vertices whose normal is unset (flat, never sculpted) move along the face normal.
    for (let i = 0; i < size * size; i++) {
      if (normals[i * 3] === 0 && normals[i * 3 + 1] === 0 && normals[i * 3 + 2] === 0) {
        normals[i * 3] = face.plane.normal.x; normals[i * 3 + 1] = face.plane.normal.y; normals[i * 3 + 2] = face.plane.normal.z;
      }
    }
    const base = grid.positions.map((p, i) => p.clone().addScaledVector(new Vector3(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]), -dists[i]));
    const bounds = new Box3().setFromPoints(grid.positions);
    return { solid, node, size, normals, dists, alphas, base, step: grid.base[0].distanceTo(grid.base[1]), bounds };
  }
  return null;
}

export const vertexPos = (d: Disp, i: number) =>
  d.base[i].clone().add(new Vector3(d.normals[i * 3], d.normals[i * 3 + 1], d.normals[i * 3 + 2]).multiplyScalar(d.dists[i]));

export interface BrushOptions {
  mode: GroundMode;
  radius: number;
  /** 0..1 per dab. */
  strength: number;
  /** Flatten: the height to level to. */
  level?: number;
}

/**
 * One dab of the brush at `centre`. Returns the displacements it changed (their nodes are already
 * updated; bump their solids' versions to redraw).
 */
export function dab(disps: Disp[], centre: Vector3, o: BrushOptions): Disp[] {
  const r2 = o.radius * o.radius;
  const near = disps.filter((d) => d.bounds.distanceToPoint(centre) <= o.radius);
  if (!near.length) return [];
  const fall = (p: Vector3) => {
    const dx = p.x - centre.x, dy = p.y - centre.y;
    const t = (dx * dx + dy * dy) / r2;
    return t >= 1 ? 0 : (1 - t) * (1 - t);
  };
  // Heights before this dab, by position, for smoothing across patch edges.
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  const heights = new Map<string, number>();
  if (o.mode === 'smooth') for (const d of near) for (let i = 0; i < d.size * d.size; i++) { const p = vertexPos(d, i); heights.set(key(p.x, p.y), p.z); }
  const changed: Disp[] = [];
  for (const d of near) {
    let touched = false;
    for (let i = 0; i < d.size * d.size; i++) {
      const p = vertexPos(d, i);
      const f = fall(p) * o.strength;
      if (f <= 0) continue;
      touched = true;
      const nz = d.normals[i * 3 + 2] || 1;
      if (o.mode === 'paint' || o.mode === 'erase') {
        const target = o.mode === 'paint' ? 255 : 0;
        d.alphas[i] += (target - d.alphas[i]) * f;
      } else if (o.mode === 'raise' || o.mode === 'lower') {
        d.dists[i] += ((o.mode === 'raise' ? 1 : -1) * o.radius * 0.08 * f) / nz;
      } else if (o.mode === 'flatten') {
        d.dists[i] += (((o.level ?? p.z) - p.z) * f) / nz;
      } else {
        const s = d.step;
        const around = [[s, 0], [-s, 0], [0, s], [0, -s]].map(([ox, oy]) => heights.get(key(p.x + ox, p.y + oy))).filter((z): z is number => z !== undefined);
        if (around.length) d.dists[i] += ((around.reduce((a, b) => a + b, 0) / around.length - p.z) * f) / nz;
      }
    }
    if (!touched) continue;
    if (o.mode === 'paint' || o.mode === 'erase') writeRows(d.node, 'alphas', d.size, 1, d.alphas);
    else {
      writeRows(d.node, 'distances', d.size, 1, d.dists);
      writeRows(d.node, 'normals', d.size, 3, d.normals);
      d.bounds = new Box3().setFromPoints(Array.from({ length: d.size * d.size }, (_, i) => vertexPos(d, i)));
    }
    changed.push(d);
  }
  return changed;
}

/** Sets a displacement brush's top material (the blend set), keeping its alphas. */
export function setGroundMaterial(d: Disp, material: string): boolean {
  const side = d.solid.sides.find((s) => s.dispinfo);
  if (!side || side.material.toUpperCase() === material.toUpperCase()) return false;
  side.material = material.toUpperCase();
  side.node.set('material', side.material);
  return true;
}

/** Turns a key/value list into a node, for building dispinfo blocks. */
export function rowsNode(name: string, size: number, row: (r: number) => string): KVNode {
  const n = new KVNode(name);
  for (let r = 0; r < size; r++) n.items.push(new KVPair(`row${r}`, row(r)));
  return n;
}
