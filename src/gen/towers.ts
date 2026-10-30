import { Vector2 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { solidNode } from '../edit/brushes.ts';
import { ellipse, frustumFaces } from '../edit/shapes.ts';
import { Rng } from './rng.ts';
import { FLOOR, cleanPolygon, facadePrism, isConvexCcw, offsetPolygon, type FacadeTile } from './facade.ts';

export type CapKind = 'dome' | 'bell' | 'onion' | 'spire';

/** Cap outlines as (height, radius) fractions; each step becomes one convex frustum brush. */
const PROFILES: Record<CapKind, { height: number; points: [number, number][]; lantern: boolean }> = {
  dome: { height: 0.9, points: [[0, 1], [0.38, 0.92], [0.7, 0.71], [0.9, 0.42], [1, 0.2]], lantern: true },
  // Baroque helmet: an ogee that pulls in, swells and narrows to a lantern (City 17's corner towers).
  bell: { height: 1.35, points: [[0, 1], [0.16, 0.84], [0.36, 0.76], [0.56, 0.68], [0.76, 0.48], [0.92, 0.26], [1, 0.18]], lantern: true },
  onion: { height: 1.8, points: [[0, 0.82], [0.16, 1.1], [0.34, 1.12], [0.54, 0.86], [0.72, 0.46], [0.88, 0.16], [1, 0]], lantern: false },
  spire: { height: 3, points: [[0, 1], [1, 0]], lantern: false },
};

export const CAP_MATERIALS = ['METAL/METALROOF003A', 'METAL/METALROOF003A', 'WOOD/WOODSHINGLES002A', 'METAL/METALROOF005A'] as const;
const NODRAW = 'TOOLS/TOOLSNODRAW';

export interface TowerOptions {
  centre: Vector2;
  radius: number;
  sides: number;
  /** Bottom of the tower body (just under the building's cornice) and its top. */
  z0: number;
  z1: number;
  windows: FacadeTile;
  trim: FacadeTile;
  plain: FacadeTile;
  cap: CapKind;
  capMaterial: string;
}

/** Revolves a cap profile into stacked frustums standing on `z` around `c`. */
function revolve(doc: VmfDocument, c: Vector2, radius: number, z: number, kind: CapKind, sides: number, material: string): KVNode[] {
  const p = PROFILES[kind];
  const h = radius * p.height;
  const out: KVNode[] = [];
  const m = { top: material, bottom: NODRAW, sides: material };
  for (let i = 0; i + 1 < p.points.length; i++) {
    const [z0f, r0f] = p.points[i], [z1f, r1f] = p.points[i + 1];
    const za = Math.round(z + z0f * h), zb = Math.round(z + z1f * h);
    if (zb <= za) continue;
    const bottom = ellipse(c.x, c.y, Math.max(6, radius * r0f), Math.max(6, radius * r0f), sides);
    const top = r1f <= 0.02 ? new Vector2(Math.round(c.x), Math.round(c.y)) : ellipse(c.x, c.y, Math.max(6, radius * r1f), Math.max(6, radius * r1f), sides);
    out.push(solidNode(doc, frustumFaces(bottom, top, za, zb, m)));
  }
  return out;
}

/**
 * A corner tower: a polygonal body with windows rising above the roof, a cornice, then a dome, bell,
 * onion or spire, with a small lantern and a finial. Returns detail brushes and the overall top.
 */
export function towerSolids(doc: VmfDocument, o: TowerOptions): { solids: KVNode[]; top: number } {
  const out: KVNode[] = [];
  const body = cleanPolygon(ellipse(o.centre.x, o.centre.y, o.radius, o.radius, o.sides));
  if (!isConvexCcw(body)) return { solids: [], top: o.z1 };
  out.push(solidNode(doc, facadePrism(body, o.z0, o.z1, o.windows, NODRAW, o.z1 - FLOOR)));
  // Cornice ring and a short drum the cap stands on.
  const ring = cleanPolygon(offsetPolygon(body, 8));
  if (isConvexCcw(ring)) out.push(solidNode(doc, facadePrism(ring, o.z1, o.z1 + 12, o.trim, o.trim.material, o.z1, o.trim.material)));
  const drumTop = o.z1 + 12 + 16;
  out.push(solidNode(doc, facadePrism(body, o.z1 + 12, drumTop, o.plain, NODRAW, o.z1 + 12)));
  const capRadius = o.radius + 4;
  out.push(...revolve(doc, o.centre, capRadius, drumTop, o.cap, o.sides, o.capMaterial));
  const p = PROFILES[o.cap];
  let top = Math.round(drumTop + capRadius * p.height);
  if (p.lantern) {
    // Lantern: a small windowed drum with its own little dome.
    const lr = Math.max(16, Math.round(capRadius * 0.24));
    const lantern = cleanPolygon(ellipse(o.centre.x, o.centre.y, lr, lr, 8));
    const lh = Math.round(lr * 1.6);
    if (isConvexCcw(lantern)) out.push(solidNode(doc, facadePrism(lantern, top - 8, top + lh, o.plain, NODRAW, top)));
    out.push(...revolve(doc, o.centre, lr + 3, top + lh, 'dome', 8, o.capMaterial));
    top += lh + Math.round((lr + 3) * 0.9);
  }
  // Finial.
  const f = 3;
  const finial = [new Vector2(o.centre.x - f, o.centre.y - f), new Vector2(o.centre.x + f, o.centre.y - f), new Vector2(o.centre.x + f, o.centre.y + f), new Vector2(o.centre.x - f, o.centre.y + f)]
    .map((v) => new Vector2(Math.round(v.x), Math.round(v.y)));
  out.push(solidNode(doc, facadePrism(finial, top - 8, top + 40, { material: o.capMaterial, bays: 0 }, o.capMaterial, top)));
  return { solids: out, top: top + 40 };
}

/** Body sides for a tower of `radius`: about one 64-unit window bay per side, a multiple of 4. */
export function towerSides(radius: number): number {
  return Math.min(24, Math.max(8, Math.round((2 * Math.PI * radius) / 64 / 4) * 4));
}

export function chooseCap(rng: Rng): { cap: CapKind; material: string } {
  return { cap: rng.pick(['bell', 'bell', 'dome', 'onion', 'spire'] as const), material: rng.pick(CAP_MATERIALS) };
}
