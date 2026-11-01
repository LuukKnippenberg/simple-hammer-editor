import { Box2, Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { boxSolid } from '../edit/brushes.ts';
import { MODEL_BOUNDS } from './poi/models.ts';
import type { FeatureEntity } from './facadeFeatures.ts';
import type { Rng } from './rng.ts';
import { resolveExtras, type Extras } from './extras.ts';

/**
 * What fills the courtyards and back yards of a block: low sheds (the old default), or green yards as in the
 * blocks of Sofia: a lawn with leafy trees and benches, and in the bigger ones a playground or a row of parked
 * cars. The lawn is one world brush kept clear of the walls (touching them would cost vbsp t-junctions); the
 * rest are props.
 */
export type YardStyle = 'sheds' | 'green';

const LAWN = 'NATURE/FOREST_GRASS_01';
const NODRAW = 'TOOLS/TOOLSNODRAW';
const TREES = ['props_foliage/mall_tree_medium01', 'props_foliage/tree_deciduous_01a', 'props_foliage/tree_deciduous_01a'];
const PLAY = ['props_c17/playground_swingset01', 'props_c17/playgroundslide01', 'props_c17/playground_jungle_gym01a', 'props_c17/playground_carousel01'];
const CARS = ['props_vehicles/car002a', 'props_vehicles/car003a', 'props_vehicles/car004a', 'props_vehicles/car005a', 'props_vehicles/car001a_hatchback'];
const BENCH = 'props_trainstation/benchoutdoor01a';
const BIN = 'props_junk/trashbin01a';
/** Lawn edge to the walls around it. */
const INSET = 24;

/** A prop standing on z: prop_static where the model allows it. */
function prop(model: string, x: number, y: number, z: number, yaw: number): FeatureEntity {
  const b = MODEL_BOUNDS[model];
  return {
    classname: b && b[6] === 0 ? 'prop_dynamic' : 'prop_static',
    origin: new Vector3(Math.round(x), Math.round(y), Math.round(z - (b ? b[2] : 0))),
    keys: { model: `models/${model}.mdl`, angles: `0 ${Math.round(yaw)} 0`, solid: '6' },
  };
}

/** Footprint radius of a model, for spacing (a tree by its trunk: canopies may overlap). */
const radius = (model: string) => {
  if (TREES.includes(model)) return 64;
  const b = MODEL_BOUNDS[model];
  return b ? Math.max(b[3] - b[0], b[4] - b[1]) / 2 : 48;
};
/** Trees stand this far in from the lawn's edge, so their canopies (about 170 across) stay off the walls. */
const TREE_IN = 128;

/**
 * A green yard on `yard` (open ground inside a block) at height z0: lawn, trees, benches, and a playground or
 * parking when there is room. `keepClear` are boxes nothing may stand in (doors, gateways). `extras` thins or
 * doubles the trees and drops the trees or the other props (what is dropped still takes its spot, so the rest
 * stays where it was).
 */
export function greenYard(doc: VmfDocument, yard: Box2, z0: number, rng: Rng, keepClear: Box2[] = [], extras: Extras = resolveExtras({})): { solids: KVNode[]; entities: FeatureEntity[] } {
  const size = yard.getSize(new Vector2());
  const solids: KVNode[] = [], entities: FeatureEntity[] = [];
  if (size.x < 2 * INSET + 64 || size.y < 2 * INSET + 64) return { solids, entities };
  const inner = yard.clone().expandByScalar(-INSET);
  const taken: { p: Vector2; r: number }[] = [];
  const free = (p: Vector2, r: number) => inner.clone().expandByScalar(-r).containsPoint(p)
    && !taken.some((t) => t.p.distanceTo(p) < t.r + r + 16) && !keepClear.some((k) => k.clone().expandByScalar(r).containsPoint(p));
  const place = (model: string, p: Vector2, yaw: number) => {
    const r = radius(model);
    if (!free(p, r)) return false;
    taken.push({ p, r });
    if (extras.keep(TREES.includes(model) ? 'trees' : 'yardProps')) entities.push(prop(model, p.x, p.y, z0, yaw));
    return true;
  };
  const long = size.x >= size.y ? 'x' : 'y';
  const kind = size.x >= 448 && size.y >= 448 ? rng.pick(['garden', 'playground', 'parking'] as const) : 'garden';
  let lawn = inner.clone();
  if (kind === 'parking') {
    // A row of cars along one long side, nose to the wall, on the yard's own paving; lawn on the rest.
    const atMin = rng.chance(0.5);
    const depth = 192;
    const strip = inner.clone();
    if (long === 'x') { if (atMin) strip.max.y = inner.min.y + depth; else strip.min.y = inner.max.y - depth; }
    else if (atMin) strip.max.x = inner.min.x + depth; else strip.min.x = inner.max.x - depth;
    const n = Math.floor((long === 'x' ? strip.max.x - strip.min.x : strip.max.y - strip.min.y) / 128);
    for (let i = 0; i < n; i++) {
      if (!rng.chance(0.7)) continue;
      const along = (long === 'x' ? strip.min.x : strip.min.y) + 64 + i * 128;
      const c = strip.getCenter(new Vector2());
      const p = long === 'x' ? new Vector2(along, c.y) : new Vector2(c.x, along);
      // The car models run along their x: across the strip means facing the wall.
      place(rng.pick(CARS), p, (long === 'x' ? 90 : 0) + (atMin ? 180 : 0) + rng.range(-6, 6));
    }
    if (long === 'x') { if (atMin) lawn.min.y = strip.max.y + 32; else lawn.max.y = strip.min.y - 32; }
    else if (atMin) lawn.min.x = strip.max.x + 32; else lawn.max.x = strip.min.x - 32;
  }
  if (kind === 'playground') {
    const c = inner.getCenter(new Vector2());
    const pool = [...PLAY];
    const kit = [0, 1, 2].map(() => pool.splice(rng.int(0, pool.length - 1), 1)[0]);
    kit.forEach((m, i) => place(m, new Vector2(c.x + (i - 1) * 160 * (long === 'x' ? 1 : 0), c.y + (i - 1) * 160 * (long === 'y' ? 1 : 0)), rng.int(0, 3) * 90));
    place(BENCH, new Vector2(c.x + (long === 'x' ? 0 : 200), c.y + (long === 'y' ? 0 : -200)), long === 'x' ? 0 : 90);
  }
  if (lawn.max.x - lawn.min.x >= 64 && lawn.max.y - lawn.min.y >= 64) {
    solids.push(boxSolid(doc, new Vector3(lawn.min.x, lawn.min.y, z0 - 8), new Vector3(lawn.max.x, lawn.max.y, z0 + 2), { top: LAWN, bottom: NODRAW, sides: NODRAW }));
  }
  // Trees along the edges of the lawn, a bench or two and a bin.
  const d = extras.trees;
  const trees = Math.max(1, Math.min(Math.round(8 * d), Math.round(((lawn.max.x - lawn.min.x) * (lawn.max.y - lawn.min.y) * d) / (320 * 320))));
  for (let k = 0, tries = 0; k < trees && tries < trees * 6; tries++) {
    const edge = rng.int(0, 3);
    const t = rng.range(0.1, 0.9);
    const p = edge < 2
      ? new Vector2(lawn.min.x + t * (lawn.max.x - lawn.min.x), edge === 0 ? lawn.min.y + TREE_IN : lawn.max.y - TREE_IN)
      : new Vector2(edge === 2 ? lawn.min.x + TREE_IN : lawn.max.x - TREE_IN, lawn.min.y + t * (lawn.max.y - lawn.min.y));
    if (p.x < lawn.min.x + TREE_IN || p.x > lawn.max.x - TREE_IN || p.y < lawn.min.y + TREE_IN || p.y > lawn.max.y - TREE_IN) continue;
    if (place(rng.pick(TREES), p, rng.int(0, 359))) k++;
  }
  for (let k = 0; k < rng.int(1, 2); k++) {
    const c = lawn.getCenter(new Vector2());
    place(BENCH, new Vector2(c.x + rng.range(-1, 1) * (lawn.max.x - lawn.min.x) * 0.3, c.y + rng.range(-1, 1) * (lawn.max.y - lawn.min.y) * 0.3), rng.int(0, 3) * 90);
  }
  place(BIN, new Vector2(lawn.min.x + 40, lawn.min.y + 40), 0);
  return { solids, entities };
}
