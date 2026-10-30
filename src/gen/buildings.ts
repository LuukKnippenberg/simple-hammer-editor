import { Box2, Box3, Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { solidNode } from '../edit/brushes.ts';
import { Rng } from './rng.ts';
import { FLOOR, cleanPolygon, facadePrism, isConvexCcw, offsetPolygon, type FacadeTile } from './facade.ts';
import { planBlock, type CornerOption, type Part, type WallPlan } from './buildingPlan.ts';

const t = (name: string, bays: number, widthPx?: number): FacadeTile => ({ material: `BUILDING_TEMPLATE/${name.toUpperCase()}`, bays, widthPx });

/**
 * Facade sets from the game's building_template materials: one 512px tile is one 128-unit floor and
 * holds `bays` windows across.
 */
export const FACADE_STYLES = {
  stucco: { windows: [t('building_template002b', 2), t('building_template002c', 2)], ground: [t('building_template002e', 1), t('building_template002f', 1)], door: t('building_template002e', 1), plain: t('building_template002h', 0), trim: t('building_template002k', 0) },
  stone: { windows: [t('building_template003e', 2), t('building_template003d', 2)], ground: [t('building_template003c', 2)], door: t('building_template002e', 1), plain: t('building_template003a', 0), trim: t('building_template003a', 0) },
  brown: { windows: [t('building_template001b', 2)], ground: [t('building_template001d', 2)], door: t('building_template002e', 1), plain: t('building_template001d', 0), trim: t('building_template001f', 0, 256) },
  brick: { windows: [t('building_template011c', 1)], ground: [t('building_template011g', 1)], door: t('building_template011g', 1), plain: t('building_template011b', 0), trim: t('building_template011b', 0) },
  pale: { windows: [t('building_template002o', 2), t('building_template002p', 2)], ground: [t('building_template002f', 1)], door: t('building_template002e', 1), plain: t('building_template004h', 0), trim: t('building_template002k', 0) },
} as const;
export type FacadeStyle = keyof typeof FACADE_STYLES;
type Style = (typeof FACADE_STYLES)[FacadeStyle];

const ROOF = 'CONCRETE/CONCRETEFLOOR028C';
const NODRAW = 'TOOLS/TOOLSNODRAW';
const ROOF_PROPS = [
  'models/props_rooftop/roof_vent003.mdl', 'models/props_rooftop/roof_vent004.mdl', 'models/props_rooftop/chimneypipe01a.mdl',
  'models/props_rooftop/antenna01a.mdl', 'models/props_rooftop/roof_dish001.mdl', 'models/props_rooftop/rooftopcluser01a.mdl',
];

export interface BuildingOptions {
  seed: number;
  minFloors: number;
  maxFloors: number;
  /** Leave alleys between buildings and link some of them with sky bridges. */
  alleys: boolean;
  /** Restrict to one facade style; mixed when omitted. */
  style?: FacadeStyle;
  roofProps: boolean;
  /** Corners of buildings on the block's corners: square, cut, rounded, or a mix (default). */
  corners?: CornerOption;
  /** Build large blocks as a ring of buildings around a courtyard (default on). */
  courtyards?: boolean;
  /** Low sheds in yards and courtyards (default on). */
  annexes?: boolean;
}

export interface GeneratedBuildings {
  solids: KVNode[];
  /** Point entities (rooftop props). */
  entities: { classname: string; origin: Vector3; keys: Record<string, string> }[];
  buildings: number;
}

const inside = (poly: Vector2[], p: Vector2) => poly.every((a, i) => {
  const b = poly[(i + 1) % poly.length];
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
});

/** Brushes of one wing: ground floor, upper floors, cornice and (for main buildings) a parapet. */
function partSolids(doc: VmfDocument, part: Part, s: Style, z0: number, rng: Rng): KVNode[] {
  const out: KVNode[] = [];
  const poly = part.poly;
  const top = z0 + part.floors * FLOOR;
  const ground = rng.pick(s.ground);
  const groundTiles = poly.map((_, i) => (part.cornerEdges.includes(i) ? s.door : ground));
  // Ground floor, sunk a little so the building sits on uneven ground.
  out.push(solidNode(doc, facadePrism(poly, z0 - 32, Math.min(top, z0 + FLOOR), groundTiles, part.floors > 1 ? NODRAW : ROOF, z0)));
  if (part.floors > 1) out.push(solidNode(doc, facadePrism(poly, z0 + FLOOR, top, rng.pick(s.windows), ROOF, z0)));
  // Cornice band sticking out 8 units.
  const cornice = cleanPolygon(offsetPolygon(poly, 8));
  if (isConvexCcw(cornice)) out.push(solidNode(doc, facadePrism(cornice, top - 16, top, s.trim, ROOF, top - 16, s.trim.material)));
  if (part.kind === 'main') {
    // Parapet: one brush per edge between the cornice line and 4 units inside the wall.
    const inner = cleanPolygon(offsetPolygon(poly, -4));
    if (inner.length === cornice.length && isConvexCcw(inner)) {
      cornice.forEach((a, i) => {
        const b = cornice[(i + 1) % cornice.length];
        const quad = [a, b, inner[(i + 1) % inner.length], inner[i]];
        if (isConvexCcw(quad)) out.push(solidNode(doc, facadePrism(quad, top, top + 32, s.plain, s.plain.material, top, NODRAW)));
      });
    }
  }
  return out;
}

/** A 16-unit wall along a→b; a gateway leaves a 128-unit opening under a lintel. */
function wallSolids(doc: VmfDocument, w: WallPlan, s: Style, z0: number): KVNode[] {
  const dir = new Vector2().subVectors(w.b, w.a);
  const len = dir.length();
  dir.normalize();
  const side = new Vector2(dir.y, -dir.x).multiplyScalar(8);
  const seg = (from: number, to: number, zMin: number, zMax: number) => {
    const p = w.a.clone().addScaledVector(dir, from), q = w.a.clone().addScaledVector(dir, to);
    // Counter-clockwise: along the outer side, back along the inner side.
    const poly = cleanPolygon([p.clone().add(side), q.clone().add(side), q.clone().sub(side), p.clone().sub(side)]);
    return isConvexCcw(poly) ? [solidNode(doc, facadePrism(poly, zMin, zMax, s.plain, s.trim.material, z0))] : [];
  };
  const top = z0 + w.height;
  if (!w.gate || len < 256) return seg(0, len, z0 - 32, top);
  const g0 = Math.round((len / 2 - 64) / 16) * 16, g1 = g0 + 128;
  return [...seg(0, g0, z0 - 32, top), ...seg(g1, len, z0 - 32, top), ...seg(g0, g1, z0 + 160, top)];
}

/**
 * Fills a footprint with a block of buildings: a ring around a courtyard or a row of lots (some L-shaped),
 * shaped corners with entrances on the block corners, varying heights, annexes, walls with gateways,
 * cornices, parapets, optional rooftop props and (with alleys) sky bridges.
 */
export function generateBuildings(doc: VmfDocument, footprint: Box3, opts: BuildingOptions): GeneratedBuildings {
  const rng = new Rng(opts.seed);
  const g = FLOOR;
  const area = new Box2(
    new Vector2(Math.ceil(footprint.min.x / 64) * 64, Math.ceil(footprint.min.y / 64) * 64),
    new Vector2(Math.floor(footprint.max.x / 64) * 64, Math.floor(footprint.max.y / 64) * 64),
  );
  const out: GeneratedBuildings = { solids: [], entities: [], buildings: 0 };
  const z0 = footprint.min.z;
  const plan = planBlock(area, rng, {
    minFloors: opts.minFloors, maxFloors: opts.maxFloors, alleys: opts.alleys,
    corners: opts.corners ?? 'mixed', courtyards: opts.courtyards ?? true, annexes: opts.annexes ?? true,
  });
  const styles = Object.keys(FACADE_STYLES) as FacadeStyle[];
  const first = rng.int(0, styles.length - 1);
  const styleOf = (slot: number) => FACADE_STYLES[opts.style ?? styles[(first + slot) % styles.length]];

  for (const b of plan.buildings) {
    const s = styleOf(b.styleSlot);
    for (const part of b.parts) out.solids.push(...partSolids(doc, part, s, z0, rng));
    const main = b.parts[0];
    if (main.kind === 'main') out.buildings++;
    if (opts.roofProps && main.kind === 'main') {
      const box = new Box2().setFromPoints(main.poly);
      const size = box.getSize(new Vector2());
      const n = Math.min(3, Math.floor((size.x * size.y) / (256 * 256)));
      const top = z0 + main.floors * g;
      for (let i = 0; i < n; i++) {
        const p = new Vector2(Math.round(rng.range(box.min.x + 48, box.max.x - 48)), Math.round(rng.range(box.min.y + 48, box.max.y - 48)));
        if (!inside(cleanPolygon(offsetPolygon(main.poly, -40)), p)) continue;
        out.entities.push({
          classname: 'prop_static',
          origin: new Vector3(p.x, p.y, top),
          keys: { model: rng.pick(ROOF_PROPS), angles: `0 ${rng.int(0, 3) * 90} 0`, solid: '6' },
        });
      }
    }
  }
  for (const w of plan.walls) out.solids.push(...wallSolids(doc, w, styleOf(rng.int(0, 4)), z0));

  if (opts.alleys) {
    // Sky bridges between neighbours that are both at least three floors high.
    const placed = plan.lots;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const floor = Math.min(a.floors, b.floors) - 1;
        if (floor < 2 || !rng.chance(0.6)) continue;
        for (const axis of ['x', 'y'] as const) {
          const other = axis === 'x' ? 'y' : 'x';
          const gap = b.box.min[axis] - a.box.max[axis];
          const gap2 = a.box.min[axis] - b.box.max[axis];
          const lo2 = Math.max(a.box.min[other], b.box.min[other]), hi2 = Math.min(a.box.max[other], b.box.max[other]);
          if (hi2 - lo2 < 160) continue;
          let from: number, to: number;
          if (gap > 0 && gap <= 96) { from = a.box.max[axis]; to = b.box.min[axis]; }
          else if (gap2 > 0 && gap2 <= 96) { from = b.box.max[axis]; to = a.box.min[axis]; }
          else continue;
          const mid = Math.round((lo2 + hi2) / 2 / 16) * 16;
          const zb = z0 + floor * g;
          const min = new Vector2(), max = new Vector2();
          min[axis] = from; max[axis] = to;
          min[other] = mid - 64; max[other] = mid + 64;
          const poly = [new Vector2(min.x, min.y), new Vector2(max.x, min.y), new Vector2(max.x, max.y), new Vector2(min.x, max.y)];
          out.solids.push(solidNode(doc, facadePrism(poly, zb, zb + g, FACADE_STYLES.stone.windows[0], ROOF, z0, FACADE_STYLES.stone.plain.material)));
        }
      }
    }
  }
  return out;
}
