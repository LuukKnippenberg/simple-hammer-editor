import { Vector2, Vector3 } from 'three';
import { KVNode } from '../vmf/keyvalues.ts';
import { MapSolid, type TexAxis, type VmfDocument } from '../vmf/map.ts';
import { solidNode, type FaceSpec } from '../edit/brushes.ts';
import { buildBrushFaces } from '../geom/brush.ts';
import { Rng } from './rng.ts';
import { cleanPolygon, facadePrism, isConvexCcw, offsetPolygon, type FacadeTile } from './facade.ts';

export type RoofKind = 'flat' | 'hip' | 'mansard' | 'gable' | 'curved';
export type RoofOption = RoofKind | 'mixed';

/** Roof coverings from the game's materials. */
export const ROOF_MATERIALS = {
  tiles: ['TILE/TILEROOF004A', 'TILE/TILEROOF003A', 'TILE/TILEROOF002A'],
  copper: ['METAL/METALROOF003A'],
  slate: ['WOOD/WOODSHINGLES002A', 'METAL/METALROOF006A', 'WOOD/SHINGLES004'],
  metal: ['METAL/METALROOF005A', 'METAL/METALROOF002A'],
} as const;
export type RoofCovering = keyof typeof ROOF_MATERIALS;

const NODRAW = 'TOOLS/TOOLSNODRAW';
const FLASHING = 'METAL/METALROOF005A';
const CHIMNEY: FacadeTile = { material: 'BUILDING_TEMPLATE/BUILDING_TEMPLATE011B', bays: 0 };
const CHIMNEY_CAP = 'CONCRETE/CONCRETEFLOOR028C';

/** A brush plane: a point on it and its outward normal. */
interface PlaneSpec {
  point: Vector3;
  normal: Vector3;
  material: string;
  u?: TexAxis;
  v?: TexAxis;
}

/** Three points on the plane in Hammer's order, so the face normal comes out as `normal`. */
function planeFace(p: PlaneSpec): FaceSpec {
  const n = p.normal.clone().normalize();
  const t = Math.abs(n.z) > 0.999 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1).cross(n).normalize();
  const a = p.point.clone();
  const b = a.clone().addScaledVector(t, 128);
  const c = a.clone().addScaledVector(t.clone().cross(n), 128);
  return { points: [a, b, c], material: p.material, u: p.u, v: p.v };
}

/** Roof texture axes: rows along the eaves, running down the slope; 128 units per tile. */
function slopeAxes(edgeDir: Vector3, normal: Vector3): { u: TexAxis; v: TexAxis } {
  const u = edgeDir.clone().normalize();
  const v = new Vector3().crossVectors(normal, u).normalize();
  if (v.z > 0) v.negate();
  return { u: { axis: u, shift: 0, scale: 0.25 }, v: { axis: v, shift: 0, scale: 0.25 } };
}

/**
 * A convex brush from planes. Planes that end up with no face (they don't touch the volume) are dropped,
 * so the compiler never sees a redundant side.
 */
function planeBrush(doc: VmfDocument, planes: PlaneSpec[]): KVNode | null {
  const node = solidNode(doc, planes.map(planeFace));
  const solid = new MapSolid(node, null);
  const faces = buildBrushFaces(solid);
  if (faces.length < 4) return null;
  if (faces.length < planes.length) {
    const keep = new Set(faces.map((f) => f.side.node));
    node.items = node.items.filter((it) => !(it instanceof KVNode) || it.name !== 'side' || keep.has(it));
  }
  return node;
}

/** One slope per footprint edge, rising inwards at `rise` per unit, through the edge at height `z`. */
function slopePlanes(poly: Vector2[], z: number, rise: number, material: string): PlaneSpec[] {
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dir = new Vector3(b.x - a.x, b.y - a.y, 0).normalize();
    const out = new Vector3(dir.y, -dir.x, 0);
    // Outward and up: (out, rise) normalised.
    const normal = new Vector3(out.x * rise, out.y * rise, 1).normalize();
    return { point: new Vector3(a.x, a.y, z), normal, material, ...slopeAxes(dir, normal) };
  });
}

/** Largest distance from the polygon's edges reachable inside it (sampled), i.e. where a hip roof peaks. */
export function inradius(poly: Vector2[]): number {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const step = Math.max(4, Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 40);
  let best = 0;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) best = Math.max(best, edgeDistance(poly, new Vector2(x, y)));
  }
  return best;
}

/** Distance from `p` to the nearest edge line (negative outside a convex counter-clockwise polygon). */
export function edgeDistance(poly: Vector2[], p: Vector2): number {
  let d = Infinity;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dir = new Vector2().subVectors(b, a).normalize();
    // Inward normal of a counter-clockwise edge is the left side.
    d = Math.min(d, (p.x - a.x) * -dir.y + (p.y - a.y) * dir.x);
  });
  return d;
}

/** A tier: from the footprint at its own slope, up `height` units (or to the peak when omitted). */
interface Tier { rise: number; height?: number }

const TIERS: Record<Exclude<RoofKind, 'flat' | 'gable'>, Tier[]> = {
  hip: [{ rise: 0.75 }],
  // A steep attic storey with dormers, then a low cap.
  mansard: [{ rise: 4, height: 112 }, { rise: 0.3 }],
  // Bell curve: steep, then flatter, then a low cap (the copper roofs of image 5).
  curved: [{ rise: 3, height: 48 }, { rise: 1.3, height: 48 }, { rise: 0.35 }],
};

export interface RoofResult {
  solids: KVNode[];
  /** Roof surface height above a point inside the footprint. */
  heightAt: (p: Vector2) => number;
  /** Footprint edges with a steep lower slope (dormers can stand on them). */
  dormerZ: number | null;
}

/** Stacked slope tiers over a convex footprint: each tier is one convex brush. */
function tieredRoof(doc: VmfDocument, eaves: Vector2[], z0: number, tiers: Tier[], material: string): RoofResult {
  const solids: KVNode[] = [];
  let poly = eaves, z = z0;
  const bands: { poly: Vector2[]; z: number; rise: number }[] = [];
  for (const tier of tiers) {
    if (poly.length < 3 || !isConvexCcw(poly)) break;
    const peak = inradius(poly) * tier.rise;
    const h = tier.height !== undefined && tier.height < peak - 8 ? tier.height : null;
    const planes = [
      { point: new Vector3(poly[0].x, poly[0].y, z), normal: new Vector3(0, 0, -1), material: NODRAW },
      ...slopePlanes(poly, z, tier.rise, material),
    ];
    if (h !== null) planes.push({ point: new Vector3(poly[0].x, poly[0].y, z + h), normal: new Vector3(0, 0, 1), material });
    const brush = planeBrush(doc, planes);
    if (brush) solids.push(brush);
    bands.push({ poly, z, rise: tier.rise });
    if (h === null) break;
    poly = cleanPolygon(offsetPolygon(poly, -h / tier.rise));
    z += h;
  }
  // Each tier's slope holds from its own footprint inwards; where tiers overlap the flatter, higher one wins.
  const heightAt = (p: Vector2) => {
    let h = Infinity;
    for (const b of bands) {
      const d = edgeDistance(b.poly, p);
      if (d < 0) break;
      h = Math.min(h, b.z + d * b.rise);
    }
    return Number.isFinite(h) ? h : z0;
  };
  return { solids, heightAt, dormerZ: tiers[0].rise >= 1 ? z0 : null };
}

/**
 * Gable roof over a rectangle: slopes on the two long sides, vertical gable walls (in the facade's plain
 * material) on the short ones.
 */
function gableRoof(doc: VmfDocument, eaves: Vector2[], z0: number, rise: number, material: string, wall: FacadeTile): RoofResult | null {
  if (eaves.length !== 4) return null;
  const len = (i: number) => eaves[i].distanceTo(eaves[(i + 1) % 4]);
  const long = len(0) >= len(1) ? [0, 2] : [1, 3];
  const half = Math.min(len(0), len(1)) / 2;
  const slopes = slopePlanes(eaves, z0, rise, material);
  const planes: PlaneSpec[] = [{ point: new Vector3(eaves[0].x, eaves[0].y, z0), normal: new Vector3(0, 0, -1), material: NODRAW }];
  for (let i = 0; i < 4; i++) {
    if (long.includes(i)) { planes.push(slopes[i]); continue; }
    const a = eaves[i], b = eaves[(i + 1) % 4];
    const dir = new Vector3(b.x - a.x, b.y - a.y, 0).normalize();
    planes.push({
      point: new Vector3(a.x, a.y, z0), normal: new Vector3(dir.y, -dir.x, 0), material: wall.material,
      u: { axis: dir, shift: 0, scale: 0.25 }, v: { axis: new Vector3(0, 0, -1), shift: 0, scale: 0.25 },
    });
  }
  const brush = planeBrush(doc, planes);
  if (!brush) return null;
  const heightAt = (p: Vector2) => {
    const d = Math.min(...long.map((i) => {
      const a = eaves[i], b = eaves[(i + 1) % 4];
      const dir = new Vector2().subVectors(b, a).normalize();
      return (p.x - a.x) * -dir.y + (p.y - a.y) * dir.x;
    }));
    return z0 + Math.min(d, half) * rise;
  };
  return { solids: [brush], heightAt, dormerZ: rise >= 1 ? z0 : null };
}

export interface RoofOptions {
  kind: RoofKind;
  material: string;
  /** Wall tile, for gable ends and dormer cheeks. */
  wall: FacadeTile;
  /** Window tile, for dormer fronts. */
  window: FacadeTile;
  /** How far the eaves stand out from the wall. */
  overhang: number;
  dormers: boolean;
  chimneys: boolean;
}

/** A small gabled dormer on wall edge a→b at `along`, standing on the roof base. */
function dormer(doc: VmfDocument, a: Vector2, b: Vector2, along: number, z: number, o: RoofOptions): KVNode[] {
  const dir = new Vector2().subVectors(b, a).normalize();
  const out = new Vector2(dir.y, -dir.x);
  const w = 48, depth = 72, h = 80;
  const c = a.clone().addScaledVector(dir, along);
  // Front face just behind the eaves line, reaching back into the roof.
  const front = c.clone().addScaledVector(out, o.overhang - 2);
  z += 8;
  const back = front.clone().addScaledVector(out, -depth);
  const fp = [
    front.clone().addScaledVector(dir, -w / 2), front.clone().addScaledVector(dir, w / 2),
    back.clone().addScaledVector(dir, w / 2), back.clone().addScaledVector(dir, -w / 2),
  ].map((p) => new Vector2(Math.round(p.x * 8) / 8, Math.round(p.y * 8) / 8));
  // Counter-clockwise for the prism: walls with the window tile on the front edge.
  const poly = isConvexCcw(fp) ? fp : [...fp].reverse();
  const tiles = poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const mid = new Vector2().addVectors(p, q).multiplyScalar(0.5);
    return mid.distanceTo(front) < 1 ? o.window : o.wall;
  });
  const out2: KVNode[] = [solidNode(doc, facadePrism(poly, z, z + h, tiles, NODRAW, z - 32))];
  // Gable cap: two slopes along the dormer's depth.
  const capPlanes: PlaneSpec[] = [
    { point: new Vector3(front.x, front.y, z + h), normal: new Vector3(0, 0, -1), material: NODRAW },
    { point: new Vector3(front.x, front.y, z + h), normal: new Vector3(out.x, out.y, 0), material: o.wall.material },
    { point: new Vector3(back.x, back.y, z + h), normal: new Vector3(-out.x, -out.y, 0), material: NODRAW },
  ];
  for (const sgn of [-1, 1]) {
    const edge = front.clone().addScaledVector(dir, (sgn * (w + 8)) / 2);
    const side = new Vector3(dir.x * sgn, dir.y * sgn, 0);
    const normal = new Vector3(side.x, side.y, 1).normalize();
    capPlanes.push({ point: new Vector3(edge.x, edge.y, z + h), normal, material: o.material, ...slopeAxes(new Vector3(out.x, out.y, 0), normal) });
  }
  const cap = planeBrush(doc, capPlanes);
  if (cap) out2.push(cap);
  return out2;
}

/**
 * The roof over one wing: brushes for the covering, dormers on steep slopes and chimneys.
 * `poly` is the wall footprint, `top` the height of the wall top.
 */
export function roofSolids(doc: VmfDocument, poly: Vector2[], top: number, o: RoofOptions, rng: Rng): RoofResult {
  const eaves = cleanPolygon(offsetPolygon(poly, o.overhang + 2));
  let r: RoofResult | null = null;
  if (o.kind === 'gable') r = gableRoof(doc, eaves, top, 0.9, o.material, o.wall);
  if (!r && o.kind !== 'flat') r = tieredRoof(doc, eaves, top, TIERS[o.kind === 'gable' ? 'hip' : o.kind], o.material);
  if (!r) return { solids: [], heightAt: () => top, dormerZ: null };

  if (o.dormers && r.dormerZ !== null) {
    // One dormer per two window bays on long straight walls, kept clear of the corners.
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const len = a.distanceTo(b);
      if (len < 256) return;
      const count = Math.floor((len - 128) / 128);
      for (let k = 0; k < count; k++) r!.solids.push(...dormer(doc, a, b, 64 + (len - 128) * (k + 0.5) / count, r!.dormerZ!, o));
    });
  }
  if (o.chimneys) {
    const inner = cleanPolygon(offsetPolygon(poly, -72));
    const n = isConvexCcw(inner) ? rng.int(1, 3) : 0;
    const xs = inner.map((p) => p.x), ys = inner.map((p) => p.y);
    for (let k = 0; k < n; k++) {
      const p = new Vector2(Math.round(rng.range(Math.min(...xs), Math.max(...xs))), Math.round(rng.range(Math.min(...ys), Math.max(...ys))));
      if (edgeDistance(inner, p) < 0) continue;
      const zTop = Math.round(r.heightAt(p) + rng.pick([40, 56, 72]));
      const w = rng.pick([24, 32]), d = rng.pick([40, 56]);
      const fp = [new Vector2(p.x - w / 2, p.y - d / 2), new Vector2(p.x + w / 2, p.y - d / 2), new Vector2(p.x + w / 2, p.y + d / 2), new Vector2(p.x - w / 2, p.y + d / 2)];
      r.solids.push(solidNode(doc, facadePrism(fp, top, zTop, CHIMNEY, CHIMNEY_CAP, top)));
      const capFp = offsetPolygon(fp, 4);
      r.solids.push(solidNode(doc, facadePrism(capFp, zTop, zTop + 8, { material: FLASHING, bays: 0 }, CHIMNEY_CAP, zTop, FLASHING)));
    }
  }
  return r;
}

/** Picks a roof shape (by weight when mixed) and covering for a building. */
export function chooseRoof(
  rng: Rng, option: RoofOption, rectangular: boolean,
  weights: Partial<Record<RoofKind, number>> = { flat: 1, hip: 2, mansard: 2, gable: 1, curved: 1 },
): { kind: RoofKind; material: string } {
  let kind: RoofKind;
  if (option === 'mixed') {
    const entries = Object.entries(weights).filter(([, w]) => (w ?? 0) > 0) as [RoofKind, number][];
    let r = rng.next() * entries.reduce((s, [, w]) => s + w, 0);
    kind = entries[entries.length - 1][0];
    for (const [k, w] of entries) { if ((r -= w) < 0) { kind = k; break; } }
  } else kind = option;
  if (kind === 'gable' && !rectangular) kind = 'hip';
  const covering: RoofCovering = kind === 'mansard' ? rng.pick(['slate', 'slate', 'copper', 'metal'] as const)
    : kind === 'curved' ? rng.pick(['copper', 'copper', 'slate'] as const)
      : rng.pick(['tiles', 'tiles', 'slate', 'metal'] as const);
  return { kind, material: rng.pick(ROOF_MATERIALS[covering]) };
}
