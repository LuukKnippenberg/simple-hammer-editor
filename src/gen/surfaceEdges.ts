import { Vector3 } from 'three';
import { KVNode } from '../vmf/keyvalues.ts';
import { vecStr, type VmfDocument } from '../vmf/map.ts';
import { boxFaces, solidNode } from '../edit/brushes.ts';
import type { Rng } from './rng.ts';

/**
 * Where two surfaces of the sketch meet (a lawn and the paving round it, a dirt patch and a square), the change of
 * material reads as worn rather than cut: a low stone edging runs along the boundary, and leaves, dirt and stains lie
 * over it on both sides (overlays on the terrain).
 */

/** One straight piece of boundary between two cells' surfaces, in layout units. */
export interface SurfaceEdge {
  axis: 'x' | 'y';
  /** Where the boundary line is (y for a line along x, x for one along y), and its extent along it. */
  at: number;
  from: number;
  to: number;
  /** Which side the softer surface (lawn, dirt) is on: +1 the high side, -1 the low side. */
  soft: 1 | -1;
}

/**
 * The boundaries between soft and hard cells (`isSoft`, `isHard`: by cell), merged into runs. Cells where `skip`
 * holds (buildings, POIs, which edge themselves) break the runs.
 */
export function surfaceEdges(w: number, h: number, cell: number, isSoft: (x: number, y: number) => boolean, isHard: (x: number, y: number) => boolean, skip: (x: number, y: number) => boolean): SurfaceEdge[] {
  const out: SurfaceEdge[] = [];
  const pair = (ax: number, ay: number, bx: number, by: number): 0 | 1 | -1 => {
    if (bx >= w || by >= h || skip(ax, ay) || skip(bx, by)) return 0;
    if (isSoft(ax, ay) && isHard(bx, by)) return -1;
    if (isHard(ax, ay) && isSoft(bx, by)) return 1;
    return 0;
  };
  // Lines along y between columns x and x + 1.
  for (let x = 0; x + 1 < w; x++) {
    for (let y = 0; y < h;) {
      const s = pair(x, y, x + 1, y);
      if (!s) { y++; continue; }
      let e = y + 1;
      while (e < h && pair(x, e, x + 1, e) === s) e++;
      out.push({ axis: 'y', at: (x + 1) * cell, from: y * cell, to: e * cell, soft: s });
      y = e;
    }
  }
  // Lines along x between rows y and y + 1.
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x < w;) {
      const s = pair(x, y, x, y + 1);
      if (!s) { x++; continue; }
      let e = x + 1;
      while (e < w && pair(e, y, e, y + 1) === s) e++;
      out.push({ axis: 'x', at: (y + 1) * cell, from: x * cell, to: e * cell, soft: s });
      x = e;
    }
  }
  return out;
}

const EDGING = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: 'TOOLS/TOOLSNODRAW', sides: 'STONE/STONEWALL017A' };
const WEAR = ['decals/leaves_ground01', 'decals/leaves_ground02', 'overlays/leaves_ground03', 'overlays/dirt01a', 'overlays/stain_01', 'overlays/stains_05a'];

export interface EdgeDressing {
  /** Edging brushes (for a func_detail). */
  brushes: KVNode[];
  /** info_overlay entities. */
  overlays: KVNode[];
}

/**
 * The edging and the wear for a set of boundaries. `ground` is the terrain height, `patchSide` the id of the terrain
 * face under a point (the overlays lie on it), `shift` what the document will still be moved by (overlay bases are
 * written in world space).
 */
export function dressEdges(doc: VmfDocument, edges: SurfaceEdge[], ground: (x: number, y: number) => number, patchSide: (x: number, y: number) => string | null, shift: Vector3, rng: Rng, o: { every?: number; maxOverlays?: number } = {}): EdgeDressing {
  const brushes: KVNode[] = [], overlays: KVNode[] = [];
  const every = o.every ?? 320, max = o.maxOverlays ?? 160;
  for (const e of edges) {
    const at = (t: number, off: number) => (e.axis === 'x' ? [t, e.at + off] : [e.at + off, t]) as [number, number];
    // The edging: 12 wide on the line, 6 above the ground, in pieces of at most 512 so it follows the terrain.
    for (let t = e.from; t < e.to; t += 512) {
      const t1 = Math.min(e.to, t + 512);
      const [mx, my] = at((t + t1) / 2, 0);
      const z = Math.round(ground(mx, my));
      const min = e.axis === 'x' ? new Vector3(t, e.at - 6, z - 12) : new Vector3(e.at - 6, t, z - 12);
      const maxV = e.axis === 'x' ? new Vector3(t1, e.at + 6, z + 6) : new Vector3(e.at + 6, t1, z + 6);
      brushes.push(solidNode(doc, boxFaces(min, maxV, EDGING)));
    }
    // Wear over the line, mostly on the soft side.
    for (let t = e.from + rng.range(32, every); t < e.to - 32 && overlays.length < max; t += every * rng.range(0.7, 1.3)) {
      const off = e.soft * rng.range(-24, 80);
      const [x, y] = at(t, off);
      const size = Math.round(rng.range(112, 208));
      const sides = new Set<string>();
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
        const id = patchSide(x + (dx * size) / 2, y + (dy * size) / 2);
        if (id) sides.add(id);
      }
      if (!sides.size) continue;
      overlays.push(groundOverlay(doc, [...sides], rng.pick(WEAR), x, y, ground(x, y), size, rng.int(0, 359), shift));
    }
  }
  return { brushes, overlays };
}

/** An info_overlay lying flat on the ground faces `sides`, `size` across, turned `yaw`; origin in layout space. */
export function groundOverlay(doc: VmfDocument, sides: string[], material: string, x: number, y: number, z: number, size: number, yaw: number, shift: Vector3): KVNode {
  const a = (yaw * Math.PI) / 180;
  const U = new Vector3(Math.cos(a), Math.sin(a), 0), V = new Vector3(-Math.sin(a), Math.cos(a), 0);
  const r = (n: number) => String(Math.round(n * 1000) / 1000);
  const v3 = (p: Vector3) => vecStr(new Vector3(+r(p.x), +r(p.y), +r(p.z)));
  const h = size / 2;
  const e = new KVNode('entity');
  const set = (k: string, v: string) => e.set(k, v);
  set('id', String(doc.nextId()));
  set('classname', 'info_overlay');
  set('material', material.toLowerCase());
  set('sides', sides.slice(0, 32).join(' '));
  set('BasisOrigin', v3(new Vector3(x + shift.x, y + shift.y, z)));
  set('BasisNormal', '0 0 1');
  set('BasisU', v3(U));
  set('BasisV', v3(V));
  set('StartU', '0'); set('StartV', '0'); set('EndU', '1'); set('EndV', '1');
  set('uv0', `${r(-h)} ${r(-h)} 0`); set('uv1', `${r(-h)} ${r(h)} 0`); set('uv2', `${r(h)} ${r(h)} 0`); set('uv3', `${r(h)} ${r(-h)} 0`);
  set('fademindist', '-1');
  set('origin', vecStr(new Vector3(Math.round(x), Math.round(y), Math.round(z))));
  return e;
}
