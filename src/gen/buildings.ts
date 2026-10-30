import { Box3, Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { TexAxis, VmfDocument } from '../vmf/map.ts';
import { prismFaces, solidNode, type FaceSpec } from '../edit/brushes.ts';
import { Rng } from './rng.ts';

/** Facade sets from the game's building_template materials: one 512px tile is one 128-unit floor. */
export const FACADE_STYLES = {
  stucco: { windows: ['building_template002b', 'building_template002c'], ground: ['building_template002e', 'building_template002f'], plain: 'building_template002h', trim: 'building_template002k' },
  stone: { windows: ['building_template003e', 'building_template003d'], ground: ['building_template003c'], plain: 'building_template003a', trim: 'building_template003a' },
  brown: { windows: ['building_template001b'], ground: ['building_template001d'], plain: 'building_template001d', trim: 'building_template001f' },
  brick: { windows: ['building_template011c'], ground: ['building_template011g'], plain: 'building_template011b', trim: 'building_template011b' },
  pale: { windows: ['building_template002o', 'building_template002p'], ground: ['building_template002f'], plain: 'building_template004h', trim: 'building_template002k' },
} as const;
export type FacadeStyle = keyof typeof FACADE_STYLES;

const ROOF = 'CONCRETE/CONCRETEFLOOR028C';
const NODRAW = 'TOOLS/TOOLSNODRAW';
const FLOOR = 128;
const TEX_SCALE = 0.25;
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
}

export interface GeneratedBuildings {
  solids: KVNode[];
  /** Point entities (rooftop props). */
  entities: { classname: string; origin: Vector3; keys: Record<string, string> }[];
  buildings: number;
}

/** Texture axes so a facade tile starts at the building corner and each floor gets exactly one tile row. */
function facadeAxes(normal: Vector3, baseZ: number): { u: TexAxis; v: TexAxis } {
  const horizontal = Math.abs(normal.x) > Math.abs(normal.y) ? new Vector3(0, normal.x > 0 ? 1 : -1, 0) : new Vector3(normal.y > 0 ? -1 : 1, 0, 0);
  const tile = 512;
  return {
    u: { axis: horizontal, shift: 0, scale: TEX_SCALE },
    v: { axis: new Vector3(0, 0, -1), shift: (((baseZ / TEX_SCALE) % tile) + tile) % tile, scale: TEX_SCALE },
  };
}

/** A box whose four sides use a facade material aligned to `alignZ`, top and bottom given separately. */
function facadeBox(min: Vector3, max: Vector3, side: string, top: string, alignZ: number, bottom = NODRAW): FaceSpec[] {
  const fp = [new Vector2(min.x, min.y), new Vector2(max.x, min.y), new Vector2(max.x, max.y), new Vector2(min.x, max.y)];
  const faces = prismFaces(fp, min.z, max.z, { top, bottom, sides: side });
  for (const f of faces.slice(2)) {
    const [a, b, c] = f.points;
    const n = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(b, a)).normalize();
    Object.assign(f, facadeAxes(n, alignZ));
  }
  return faces;
}

function mat(name: string): string {
  return `BUILDING_TEMPLATE/${name.toUpperCase()}`;
}

/** Splits a rectangle into lots on a 128-unit grid. */
function splitLots(rect: Box3, rng: Rng, maxLot: number, minLot: number): Box3[] {
  const size = rect.getSize(new Vector3());
  const axis = size.x >= size.y ? 'x' : 'y';
  const len = size[axis];
  if (len <= maxLot || len < minLot * 2) return [rect];
  const steps = Math.floor(len / FLOOR);
  const minSteps = Math.ceil(minLot / FLOOR);
  const cut = rng.int(minSteps, steps - minSteps) * FLOOR;
  const a = rect.clone(), b = rect.clone();
  a.max[axis] = rect.min[axis] + cut;
  b.min[axis] = rect.min[axis] + cut;
  return [...splitLots(a, rng, maxLot, minLot), ...splitLots(b, rng, maxLot, minLot)];
}

/**
 * Fills a footprint with a block of buildings: lots of varying height and facade style, a ground floor
 * with doors or shop fronts, a cornice, a roof with parapet, optional rooftop props, and (with alleys)
 * sky bridges linking neighbouring buildings. Everything snaps to the 128-unit facade grid.
 */
export function generateBuildings(doc: VmfDocument, footprint: Box3, opts: BuildingOptions): GeneratedBuildings {
  const rng = new Rng(opts.seed);
  const g = FLOOR;
  const area = new Box3(
    new Vector3(Math.ceil(footprint.min.x / g) * g, Math.ceil(footprint.min.y / g) * g, footprint.min.z),
    new Vector3(Math.floor(footprint.max.x / g) * g, Math.floor(footprint.max.y / g) * g, footprint.min.z),
  );
  const out: GeneratedBuildings = { solids: [], entities: [], buildings: 0 };
  if (area.max.x - area.min.x < g || area.max.y - area.min.y < g) return out;
  const z0 = footprint.min.z;
  const styles = Object.keys(FACADE_STYLES) as FacadeStyle[];
  const lots = splitLots(area, rng, 768, 256);
  const placed: { box: Box3; floors: number }[] = [];
  let lastStyle: FacadeStyle | null = null;

  for (const lot0 of lots) {
    const lot = lot0.clone();
    if (opts.alleys) {
      // Shrink lots that border another lot to open a 64-unit alley (keeps outer edges flush).
      for (const axis of ['x', 'y'] as const) {
        if (lot.min[axis] > area.min[axis]) lot.min[axis] += 32;
        if (lot.max[axis] < area.max[axis]) lot.max[axis] -= 32;
      }
    }
    const size = lot.getSize(new Vector3());
    if (size.x < 128 || size.y < 128) continue;
    const floors = rng.int(opts.minFloors, opts.maxFloors);
    let style = opts.style ?? rng.pick(styles);
    if (!opts.style && style === lastStyle) style = styles[(styles.indexOf(style) + 1) % styles.length];
    lastStyle = style;
    const s = FACADE_STYLES[style];
    const top = z0 + floors * g;
    const lo = new Vector3(lot.min.x, lot.min.y, z0 - 32);
    // Ground floor (sunk a little so the building sits on uneven ground).
    out.solids.push(solidNode(doc, facadeBox(lo, new Vector3(lot.max.x, lot.max.y, z0 + g), mat(rng.pick(s.ground)), NODRAW, z0)));
    if (floors > 1) {
      out.solids.push(solidNode(doc, facadeBox(new Vector3(lot.min.x, lot.min.y, z0 + g), new Vector3(lot.max.x, lot.max.y, top), mat(rng.pick(s.windows)), ROOF, z0)));
    } else {
      // Single storey: the ground floor box needs a roof of its own.
      out.solids.pop();
      out.solids.push(solidNode(doc, facadeBox(lo, new Vector3(lot.max.x, lot.max.y, top), mat(rng.pick(s.ground)), ROOF, z0)));
    }
    // Cornice band sticking out 8 units, then a parapet ring on the roof.
    out.solids.push(solidNode(doc, facadeBox(new Vector3(lot.min.x - 8, lot.min.y - 8, top - 16), new Vector3(lot.max.x + 8, lot.max.y + 8, top), mat(s.trim), ROOF, top - 16, mat(s.trim))));
    const p = 12, ph = 32;
    const ring: [Vector3, Vector3][] = [
      [new Vector3(lot.min.x - 8, lot.min.y - 8, top), new Vector3(lot.max.x + 8, lot.min.y - 8 + p, top + ph)],
      [new Vector3(lot.min.x - 8, lot.max.y + 8 - p, top), new Vector3(lot.max.x + 8, lot.max.y + 8, top + ph)],
      [new Vector3(lot.min.x - 8, lot.min.y - 8 + p, top), new Vector3(lot.min.x - 8 + p, lot.max.y + 8 - p, top + ph)],
      [new Vector3(lot.max.x + 8 - p, lot.min.y - 8 + p, top), new Vector3(lot.max.x + 8, lot.max.y + 8 - p, top + ph)],
    ];
    for (const [a, b] of ring) out.solids.push(solidNode(doc, facadeBox(a, b, mat(s.plain), mat(s.plain), top, NODRAW)));

    if (opts.roofProps) {
      const n = Math.min(3, Math.floor((size.x * size.y) / (256 * 256)));
      for (let i = 0; i < n; i++) {
        out.entities.push({
          classname: 'prop_static',
          origin: new Vector3(Math.round(rng.range(lot.min.x + 48, lot.max.x - 48)), Math.round(rng.range(lot.min.y + 48, lot.max.y - 48)), top),
          keys: { model: rng.pick(ROOF_PROPS), angles: `0 ${rng.int(0, 3) * 90} 0`, solid: '6' },
        });
      }
    }
    placed.push({ box: lot, floors });
    out.buildings++;
  }

  if (opts.alleys) {
    // Sky bridges between neighbours that are both at least three floors high.
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
          const min = new Vector3(), max = new Vector3();
          min[axis] = from; max[axis] = to;
          min[other] = mid - 64; max[other] = mid + 64;
          min.z = zb; max.z = zb + g;
          out.solids.push(solidNode(doc, facadeBox(min, max, mat(FACADE_STYLES.stone.windows[0]), ROOF, z0, mat(FACADE_STYLES.stone.plain))));
        }
      }
    }
  }
  return out;
}
