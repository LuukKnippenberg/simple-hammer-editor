import { Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { solidNode } from '../edit/brushes.ts';
import { Rng } from './rng.ts';
import { FLOOR, bayCount, ccw, cleanPolygon, facadePrism, isConvexCcw, offsetPolygon, type FacadeTile } from './facade.ts';

const NODRAW: FacadeTile = { material: 'TOOLS/TOOLSNODRAW', bays: 0 };
/** Wrought-iron railing with see-through gaps (256×128: one 64×32 panel). */
const RAILING: FacadeTile = { material: 'METAL/METALRAIL001A', bays: 0, widthPx: 256 };
const STEP: FacadeTile = { material: 'BUILDING_TEMPLATE/BUILDING_TEMPLATE003A', bays: 0 };
const AWNINGS = [{ model: 'models/props_c17/awning001a.mdl', width: 130 }, { model: 'models/props_c17/awning002a.mdl', width: 66 }];
const VENT = 'decals/decalmetalvent005a';

export type OrielShape = 'rect' | 'angled' | 'round';

export interface Wall {
  a: Vector2;
  b: Vector2;
  dir: Vector2;
  /** Outward normal. */
  out: Vector2;
  len: number;
}

export function wallOf(a: Vector2, b: Vector2): Wall {
  const dir = new Vector2().subVectors(b, a);
  const len = dir.length();
  dir.divideScalar(len || 1);
  return { a, b, dir, out: new Vector2(dir.y, -dir.x), len };
}

export interface FeatureEntity { classname: string; origin: Vector3; keys: Record<string, string> }

/** A prism on the wall from a footprint given as (along, out) pairs relative to `centre`. */
function onWall(w: Wall, centre: number, pts: [number, number][]): Vector2[] {
  const c = w.a.clone().addScaledVector(w.dir, centre);
  return ccw(cleanPolygon(pts.map(([u, o]) => c.clone().addScaledVector(w.dir, u).addScaledVector(w.out, o))));
}

/** Oriel (bay window) footprint: rectangular, with 45° sides, or a half round. */
function orielFootprint(w: Wall, centre: number, width: number, depth: number, shape: OrielShape, scale = 1): Vector2[] {
  const h = width / 2, d = depth * scale;
  if (shape === 'rect') return onWall(w, centre, [[-h, -2], [h, -2], [h, d], [-h, d]]);
  if (shape === 'angled') return onWall(w, centre, [[-h, -2], [h, -2], [h - d, d], [-h + d, d]]);
  const pts: [number, number][] = [[-h, -2], [h, -2]];
  for (let k = 0; k <= 6; k++) {
    const t = (k / 6) * Math.PI;
    pts.push([Math.cos(t) * h, Math.max(0, Math.sin(t) * h * (d / h))]);
  }
  return onWall(w, centre, pts);
}

/**
 * An oriel spanning the upper floors: window walls fitted to whole bays, a stepped corbel under it and a
 * cap band on top. The wall-side face is hidden in the building.
 */
export function oriel(doc: VmfDocument, w: Wall, centre: number, o: {
  width: number; depth: number; shape: OrielShape; z0: number; zBottom: number; zTop: number; windows: FacadeTile; trim: FacadeTile; plain: FacadeTile;
}): KVNode[] {
  const out: KVNode[] = [];
  const fp = orielFootprint(w, centre, o.width, o.depth, o.shape);
  if (!isConvexCcw(fp)) return out;
  // The face on the wall line is the one whose midpoint lies behind the wall.
  const tiles = (poly: Vector2[], face: FacadeTile) => poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const mid = new Vector2().addVectors(p, q).multiplyScalar(0.5);
    return new Vector2().subVectors(mid, w.a).dot(w.out) < 0 ? NODRAW : face;
  });
  out.push(solidNode(doc, facadePrism(fp, o.zBottom, o.zTop, tiles(fp, o.windows), NODRAW.material, o.z0)));
  // Corbel: two steps narrowing back towards the wall.
  for (const [k, scale] of [[1, 0.66], [2, 0.33]] as const) {
    const step = orielFootprint(w, centre, o.width - 8 * k, o.depth, o.shape, scale);
    if (isConvexCcw(step)) out.push(solidNode(doc, facadePrism(step, o.zBottom - 12 * k, o.zBottom - 12 * (k - 1), tiles(step, o.trim), o.trim.material, o.zBottom, o.trim.material)));
  }
  // Cap band.
  const cap = cleanPolygon(offsetPolygon(fp, 4));
  if (isConvexCcw(cap)) out.push(solidNode(doc, facadePrism(cap, o.zTop, o.zTop + 10, tiles(cap, o.trim), o.trim.material, o.zTop, o.trim.material)));
  return out;
}

/** A balcony at floor level `z`: a slab on two brackets with a wrought-iron railing on three sides. */
export function balcony(doc: VmfDocument, w: Wall, centre: number, width: number, z: number, trim: FacadeTile): KVNode[] {
  const out: KVNode[] = [];
  const h = width / 2, depth = 28;
  const slab = onWall(w, centre, [[-h, -2], [h, -2], [h, depth], [-h, depth]]);
  if (isConvexCcw(slab)) out.push(solidNode(doc, facadePrism(slab, z - 8, z, trim, trim.material, z - 8, trim.material)));
  // Railing: 2 units thick, 32 high, see-through on both sides.
  const rails: [number, number][][] = [
    [[-h, depth - 2], [h, depth - 2], [h, depth], [-h, depth]],
    [[-h, 0], [-h + 2, 0], [-h + 2, depth - 2], [-h, depth - 2]],
    [[h - 2, 0], [h, 0], [h, depth - 2], [h - 2, depth - 2]],
  ];
  for (const r of rails) {
    const p = onWall(w, centre, r);
    if (isConvexCcw(p)) out.push(solidNode(doc, facadePrism(p, z, z + 32, RAILING, NODRAW.material, z + 32, NODRAW.material)));
  }
  for (const u of [-h + 12, h - 12]) {
    const b = onWall(w, centre, [[u - 4, -2], [u + 4, -2], [u + 4, depth - 6], [u - 4, depth - 6]]);
    if (isConvexCcw(b)) out.push(solidNode(doc, facadePrism(b, z - 24, z - 8, trim, trim.material, z - 24, trim.material)));
  }
  return out;
}

/** Two steps in front of an entrance face. */
export function entranceSteps(doc: VmfDocument, w: Wall, z0: number): KVNode[] {
  if (w.len < 48) return [];
  const h = w.len / 2 - 4;
  const out: KVNode[] = [];
  for (const [depth, top] of [[24, 8], [12, 16]] as const) {
    const p = onWall(w, w.len / 2, [[-h, -2], [h, -2], [h, depth], [-h, depth]]);
    if (isConvexCcw(p)) out.push(solidNode(doc, facadePrism(p, z0 - 8, z0 + top, STEP, STEP.material, z0, STEP.material)));
  }
  return out;
}

export interface StreetFacadeOptions {
  z0: number;
  floors: number;
  windows: FacadeTile;
  trim: FacadeTile;
  plain: FacadeTile;
  /** 2: oriels and balconies; 1: awnings and vents only. */
  level: number;
}

/**
 * Bays, balconies, shopfront awnings and basement vents along one street wall. Oriels and balconies sit
 * on whole window bays and never overlap each other.
 */
export function streetFacade(doc: VmfDocument, w: Wall, o: StreetFacadeOptions, rng: Rng): { solids: KVNode[]; entities: FeatureEntity[] } {
  const solids: KVNode[] = [], entities: FeatureEntity[] = [];
  const bays = bayCount(w.len, o.windows) || Math.max(1, Math.round(w.len / 64));
  const bay = w.len / bays;
  const top = o.z0 + o.floors * FLOOR;
  const used = new Set<number>();
  const free = (from: number, to: number) => { for (let k = from; k < to; k++) if (k < 1 || k >= bays - 1 || used.has(k)) return false; return true; };
  const take = (from: number, to: number) => { for (let k = from; k < to; k++) used.add(k); };

  if (o.level >= 2 && o.floors >= 4 && w.len >= 384) {
    // One or two oriels, two bays wide, from the first floor up to under the cornice.
    const shape = rng.pick(['rect', 'angled', 'round'] as const);
    const count = w.len >= 768 ? rng.int(1, 2) : 1;
    for (let n = 0; n < count; n++) {
      const k = rng.int(1, bays - 3);
      if (!free(k, k + 2)) continue;
      take(k - 1 < 0 ? 0 : k - 1, k + 3);
      solids.push(...oriel(doc, w, (k + 1) * bay, {
        width: 2 * bay - 8, depth: shape === 'round' ? bay - 4 : 32, shape, z0: o.z0,
        zBottom: o.z0 + FLOOR + 16, zTop: top - 24 - (rng.chance(0.4) ? FLOOR : 0), windows: o.windows, trim: o.trim, plain: o.plain,
      }));
    }
  }
  if (o.level >= 2 && o.floors >= 3 && w.len >= 256) {
    // Balconies: a long one on the first floor, or single-window ones stacked over several floors.
    if (rng.chance(0.5)) {
      const k = rng.int(1, Math.max(1, bays - 4));
      const n = Math.min(4, bays - 1 - k);
      if (n >= 2 && free(k, k + n)) { take(k, k + n); solids.push(...balcony(doc, w, (k + n / 2) * bay, n * bay - 8, o.z0 + FLOOR + 8, o.trim)); }
    } else {
      for (let tries = 0; tries < 2; tries++) {
        const k = rng.int(1, bays - 2);
        if (!free(k, k + 1)) continue;
        take(k, k + 1);
        // The slab sits just above the floor line, under the window sill.
        for (let f = 1; f < o.floors; f++) solids.push(...balcony(doc, w, (k + 0.5) * bay, bay - 8, o.z0 + f * FLOOR + 8, o.trim));
      }
    }
  }
  if (o.level >= 1) {
    // Awnings over some shop windows, vents at the foot of the wall.
    if (rng.chance(0.45)) {
      const wide = rng.chance(0.5);
      const a = AWNINGS[wide ? 0 : 1];
      const step = wide ? 2 : 1;
      const yaw = Math.round((Math.atan2(w.out.y, w.out.x) * 180) / Math.PI);
      for (let k = 1; k + step <= bays - 1; k += step + 1) {
        const p = w.a.clone().addScaledVector(w.dir, (k + step / 2) * bay).addScaledVector(w.out, 15);
        entities.push({ classname: 'prop_static', origin: new Vector3(Math.round(p.x), Math.round(p.y), o.z0 + 100), keys: { model: a.model, angles: `0 ${yaw} 0`, solid: '0' } });
      }
    }
    for (let k = 1; k < bays; k += 3) {
      const p = w.a.clone().addScaledVector(w.dir, (k + 0.5) * bay).addScaledVector(w.out, 6);
      entities.push({ classname: 'infodecal', origin: new Vector3(Math.round(p.x), Math.round(p.y), o.z0 + 10), keys: { texture: VENT } });
    }
  }
  return { solids, entities };
}
