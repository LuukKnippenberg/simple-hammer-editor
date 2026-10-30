import { Box2, Vector2, Vector3 } from 'three';
import { Rng } from './rng.ts';
import { FLOOR_TOP, STOREY, wallBox, type InteriorPlan, type RoomType } from './interiorPlan.ts';
import type { FeatureEntity } from './facadeFeatures.ts';

/**
 * Furniture, lamps and grime for an interior house (docs/interior-buildings-plan.md, phase 3). Props stand
 * against the walls facing into the room and keep the plan's lanes, door zones and stairs clear, because
 * the navmesh treats static props as obstacles.
 */

/** A model with its bounds as compiled (measured from the MDL hull, in model space; +x is its front). */
export interface FurnitureModel {
  model: string;
  min: [number, number, number];
  max: [number, number, number];
  /** Compiled with $staticprop and no physics prop_data, so vbsp keeps it as prop_static. */
  isStatic: boolean;
  /** Stand with the long side (local -y) against the wall instead of the back (local -x). */
  along?: boolean;
}

const m = (model: string, min: [number, number, number], max: [number, number, number], isStatic = true, along = false): FurnitureModel =>
  ({ model: `models/${model}.mdl`, min, max, isStatic, along });

/** Measured from the game's MDLs (hull bounds and the static-prop flag). */
export const FURNITURE = {
  couch: m('props_c17/furniturecouch001a_static', [-23, -39, -17], [23, 39, 16]),
  couch2: m('props_interiors/furniture_couch01a_static', [-21, -39, -22], [18, 39, 22]),
  bed: m('props_c17/furniturebed001a_static', [-40, -22, -19], [40, 21, 18]),
  mattress: m('props_c17/furnituremattress001a_static', [-38, -19, -3], [38, 19, 3]),
  bedframe: m('props_wasteland/prison_bedframe001b_static', [-46, -20, -15], [45, 20, 15]),
  tub: m('props_c17/furniturebathtub001a_static', [-38, -16, -12], [39, 15, 12], true, true),
  tub2: m('props_interiors/bathtub01a', [-51, -13, -10], [47, 26, 29], true, true),
  stove: m('props_c17/furniturestove001a', [-18, -27, -20], [18, 26, 20]),
  stove2: m('props_wasteland/kitchen_stove001a', [-19, -32, 0], [18, 34, 47]),
  sink: m('props_c17/furnituresink001a', [-11, -14, -23], [11, 14, 22]),
  kitchenSink: m('props_interiors/sinkkitchen01a', [-12, -14, -18], [12, 14, 18]),
  toilet: m('props_c17/furnituretoilet001a', [-13, -11, -47], [12, 11, 47]),
  boiler: m('props_c17/furnitureboiler001a', [-17, -19, -45], [14, 25, 45]),
  heater: m('props_c17/furniturefireplace001a', [-15, -20, -42], [14, 20, 41]),
  fridge: m('props_interiors/refrigerator01a', [-16, -17, -38], [16, 17, 38]),
  desk: m('props_wasteland/controlroom_desk001a_static', [-21, -68, -17], [21, 68, 17]),
  bench: m('props_wasteland/cafeteria_table001a_static', [-19, -65, -16], [19, 65, 15]),
  crate: m('props_junk/wood_crate001a_static', [-20, -20, -20], [20, 20, 20]),
  crate2: m('props_junk/wood_crate002a_static', [-20, -34, -20], [20, 34, 20]),
  box: m('props_junk/cardboard_box001a_static', [-16, -20, -12], [16, 20, 12]),
  box2: m('props_junk/cardboard_box002a_static', [-16, -20, -12], [16, 20, 12]),
  drum: m('props_c17/oildrum001_static', [-14, -14, 0], [15, 15, 45]),
  debris: m('props_debris/plaster_floorpile001a', [-40, -31, -8], [42, 30, 8]),
  // No static versions: prop_dynamic.
  table: m('props_c17/furnituretable001a', [-24, -25, -18], [25, 24, 19], false),
  table2: m('props_c17/furnituretable002a', [-20, -34, -18], [20, 34, 19], false),
  chair: m('props_c17/furniturechair001a', [-10, -10, -20], [10, 10, 14], false),
} as const satisfies Record<string, FurnitureModel>;
type Key = keyof typeof FURNITURE;

/** Wall lamp: a caged bulb whose plate is at the model origin, sticking out along +x. */
const LAMP = m('props_c17/light_cagelight01_on', [-1, -3, -11], [8, 3, 2]);
const WARM = '255 214 170';

/** What goes in each kind of room: the first slot most often, later slots as the room and furnish level allow. */
const ROOM_SETS: Record<RoomType, { wall: Key[][]; free?: Key[][] }> = {
  kitchen: { wall: [['stove', 'stove2'], ['fridge'], ['kitchenSink'], ['box']], free: [['table2', 'table']] },
  living: { wall: [['couch', 'couch2'], ['heater'], ['box2', 'crate']], free: [['table'], ['chair']] },
  bedroom: { wall: [['bed', 'bedframe', 'mattress'], ['box', 'crate'], ['mattress', 'box2']] },
  bath: { wall: [['tub', 'tub2'], ['toilet'], ['sink']] },
  storage: { wall: [['crate', 'crate2'], ['box', 'box2', 'drum'], ['crate', 'drum'], ['box2']] },
  workshop: { wall: [['desk', 'bench'], ['crate2', 'crate'], ['drum', 'boiler'], ['box']], free: [['crate'], ['drum']] },
  hall: { wall: [['boiler', 'box', 'drum']] },
};

const WALL_DECALS = ['decals/decalstain001a', 'decals/decalstain002a', 'decals/decalstain005a', 'decals/decalstain008a', 'decals/wallstain01a', 'decals/paperposter001b', 'decals/paperposter003a', 'decals/decalgraffiti001a', 'decals/decalgraffiti010a'];
const FLOOR_DECALS = ['decals/bloodstain_001', 'decals/bloodstain_002', 'decals/bloodstain_003', 'decals/debris_concrete001a', 'decals/rubble01a', 'decals/decalstain010a', 'decals/decalstain012a', 'decals/burn01a'];

export interface DressingOptions {
  furnish?: 'none' | 'sparse' | 'full';
  lights?: boolean;
  /** Stains, blood, paper and debris, 0 to 1 (default 0.5). */
  weathering?: number;
}

/** A placed prop and its footprint seen from above. */
export interface PlacedProp { entity: FeatureEntity; box: Box2; room: number; item: FurnitureModel }

export interface Dressing {
  entities: FeatureEntity[];
  props: PlacedProp[];
  /** Rooms with a lamp and a light. */
  litRooms: number[];
}

const overlaps = (a: Box2, b: Box2) => Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x) > 0.01 && Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y) > 0.01;

/** Footprint of a model turned by `yaw` (a multiple of 90°) standing at `p`. */
function footprint(item: FurnitureModel, yaw: number, p: Vector2): Box2 {
  const c = Math.round(Math.cos((yaw * Math.PI) / 180)), s = Math.round(Math.sin((yaw * Math.PI) / 180));
  const pts = [[item.min[0], item.min[1]], [item.max[0], item.min[1]], [item.max[0], item.max[1]], [item.min[0], item.max[1]]]
    .map(([x, y]) => new Vector2(p.x + x * c - y * s, p.y + x * s + y * c));
  return new Box2().setFromPoints(pts);
}

/** The floor inside a room's walls (16 from outside walls, 4 from partitions). */
export function roomInterior(plan: InteriorPlan, r: number): Box2 {
  const room = plan.rooms[r], b = room.box.clone();
  const others = plan.rooms.filter((x, i) => i !== r && x.storey === room.storey);
  const outside = (p: Vector2) => !others.some((x) => x.box.containsPoint(p));
  const c = b.getCenter(new Vector2());
  const inset = (p: Vector2) => (outside(p) ? 16 : 4);
  const minX = inset(new Vector2(b.min.x - 2, c.y)), maxX = inset(new Vector2(b.max.x + 2, c.y));
  const minY = inset(new Vector2(c.x, b.min.y - 2)), maxY = inset(new Vector2(c.x, b.max.y + 2));
  b.min.x += minX; b.max.x -= maxX; b.min.y += minY; b.max.y -= maxY;
  return b;
}

/** Floor height of a room above z0. */
const floorOf = (plan: InteriorPlan, r: number) => (plan.rooms[r].storey - 1) * STOREY + FLOOR_TOP;

/**
 * Furnishes the rooms of a planned house standing at `z0`, lights some of them and adds grime. Draws from
 * its own random sequence (the caller passes `seed * 23 + 13`), so furnishing never changes the plan.
 */
export function dressInterior(plan: InteriorPlan, z0: number, rng: Rng, o: DressingOptions = {}): Dressing {
  const out: Dressing = { entities: [], props: [], litRooms: [] };
  const furnish = o.furnish ?? 'full';
  const weathering = o.weathering ?? 0.5;
  const blocked = [...plan.lanes, ...plan.doorZones, ...plan.keepClear];
  // Openings by side: tall props don't stand in front of windows, lamps don't hang over doors.
  const openingsNear = (side: Box2, kinds: string[]) => plan.walls.flatMap((w) => {
    if (!overlaps(wallBox(w).expandByScalar(1), side)) return [];
    const wb = wallBox(w);
    return w.openings.filter((x) => kinds.includes(x.kind)).map((x) => {
      const b = wb.clone();
      b.min[w.axis] = wb.min[w.axis] + x.from; b.max[w.axis] = wb.min[w.axis] + x.to;
      return { box: b, storey: w.storey };
    });
  });

  plan.rooms.forEach((room, r) => {
    const inner = roomInterior(plan, r);
    const size = inner.getSize(new Vector2());
    if (size.x < 48 || size.y < 48) return;
    const floor = z0 + floorOf(plan, r);
    const cut = plan.cut;
    const sides = [
      { n: new Vector2(1, 0), a: new Vector2(inner.min.x, inner.min.y), b: new Vector2(inner.min.x, inner.max.y) },
      { n: new Vector2(-1, 0), a: new Vector2(inner.max.x, inner.min.y), b: new Vector2(inner.max.x, inner.max.y) },
      { n: new Vector2(0, 1), a: new Vector2(inner.min.x, inner.min.y), b: new Vector2(inner.max.x, inner.min.y) },
      { n: new Vector2(0, -1), a: new Vector2(inner.min.x, inner.max.y), b: new Vector2(inner.max.x, inner.max.y) },
    ];
    const strip = (s: typeof sides[number], depth: number) => new Box2().setFromPoints([s.a, s.b, s.a.clone().addScaledVector(s.n, depth), s.b.clone().addScaledVector(s.n, depth)]);
    const placed: Box2[] = [];
    const free = (b: Box2) => inner.containsBox(b) && !blocked.some((x) => overlaps(x, b)) && !placed.some((x) => overlaps(x.clone().expandByScalar(4), b));
    const add = (item: FurnitureModel, p: Vector2, yaw: number, box: Box2) => {
      const keys: Record<string, string> = { model: item.model, angles: `0 ${yaw} 0`, solid: '6' };
      if (!item.isStatic) keys.DisableBoneFollowers = '1';
      const entity: FeatureEntity = { classname: item.isStatic ? 'prop_static' : 'prop_dynamic', origin: new Vector3(Math.round(p.x), Math.round(p.y), Math.round(floor - item.min[2])), keys };
      out.entities.push(entity);
      out.props.push({ entity, box, room: r, item });
      placed.push(box);
    };
    // Against a wall, back to the wall, facing into the room.
    const placeOnWall = (item: FurnitureModel) => {
      const height = item.max[2] - item.min[2];
      // Nothing pokes out over the cut walls.
      if (FLOOR_TOP + height > cut - 16) return false;
      const back = item.along ? -item.min[1] : -item.min[0];
      const options: { p: Vector2; yaw: number; box: Box2 }[] = [];
      for (const s of sides) {
        const yaw = ((Math.round((Math.atan2(s.n.y, s.n.x) * 180) / Math.PI) - (item.along ? 90 : 0)) % 360 + 360) % 360;
        const len = s.a.distanceTo(s.b), dir = new Vector2().subVectors(s.b, s.a).normalize();
        const windows = height > 36 ? openingsNear(strip(s, -20), ['window']).filter((x) => x.storey === room.storey).map((x) => x.box) : [];
        for (let t = 0; t <= len; t += 8) {
          const p = s.a.clone().addScaledVector(dir, t).addScaledVector(s.n, back + 1);
          const box = footprint(item, yaw, p);
          if (!free(box) || windows.some((w) => overlaps(w.clone().expandByScalar(24), box))) continue;
          options.push({ p, yaw, box });
        }
      }
      if (!options.length) return false;
      const c = rng.pick(options);
      add(item, c.p, c.yaw, c.box);
      return true;
    };
    const placeFree = (item: FurnitureModel, near?: Box2) => {
      const options: { p: Vector2; yaw: number; box: Box2 }[] = [];
      for (let x = inner.min.x + 24; x <= inner.max.x - 24; x += 8) for (let y = inner.min.y + 24; y <= inner.max.y - 24; y += 8) {
        const p = new Vector2(x, y);
        if (near && p.distanceTo(near.getCenter(new Vector2())) > 56) continue;
        const yaw = rng.pick([0, 90, 180, 270]);
        const box = footprint(item, yaw, p);
        if (free(box)) options.push({ p, yaw, box });
      }
      if (!options.length) return false;
      const c = rng.pick(options);
      add(item, c.p, c.yaw, c.box);
      return true;
    };

    if (furnish !== 'none') {
      const set = ROOM_SETS[room.type];
      const area = size.x * size.y;
      const max = furnish === 'sparse' ? Math.min(2, rng.int(1, 2)) : Math.min(4, Math.max(1, Math.round(area / (96 * 96))));
      let n = 0;
      set.wall.forEach((slot, k) => {
        if (n >= max || (k > 0 && !rng.chance(0.75))) return;
        if (placeOnWall(FURNITURE[rng.pick(slot)])) n++;
      });
      let lastFree: Box2 | undefined;
      for (const slot of set.free ?? []) {
        if (n >= max + 1 || !rng.chance(0.7)) continue;
        if (placeFree(FURNITURE[rng.pick(slot)], lastFree)) { n++; lastFree = placed[placed.length - 1]; }
      }
    }

    // A caged lamp on a wall with a warm light in front of it; a quarter of the rooms stay dark.
    if ((o.lights ?? true) && rng.chance(0.75)) {
      const zLamp = z0 + (room.storey - 1) * STOREY + Math.min(cut - 20, 92);
      const options: { p: Vector2; n: Vector2 }[] = [];
      for (const s of sides) {
        const holes = openingsNear(strip(s, -20), ['door', 'gap', 'window']).filter((x) => x.storey === room.storey).map((x) => x.box.clone().expandByScalar(16));
        const len = s.a.distanceTo(s.b), dir = new Vector2().subVectors(s.b, s.a).normalize();
        for (let t = 24; t <= len - 24; t += 8) {
          const p = s.a.clone().addScaledVector(dir, t);
          const at = new Box2().setFromPoints([p.clone().addScaledVector(s.n, -20), p.clone().addScaledVector(s.n, 8)]);
          if (!holes.some((h) => overlaps(h, at))) options.push({ p, n: s.n });
        }
      }
      if (options.length) {
        const c = rng.pick(options);
        const yaw = Math.round((Math.atan2(c.n.y, c.n.x) * 180) / Math.PI);
        out.entities.push({ classname: 'prop_static', origin: new Vector3(Math.round(c.p.x), Math.round(c.p.y), zLamp), keys: { model: LAMP.model, angles: `0 ${(yaw + 360) % 360} 0`, solid: '0' } });
        const lp = c.p.clone().addScaledVector(c.n, 16);
        const brightness = rng.int(80, 150);
        out.entities.push({
          classname: 'light', origin: new Vector3(Math.round(lp.x), Math.round(lp.y), zLamp - 8),
          keys: { _light: `${WARM} ${brightness}`, _lightHDR: '-1 -1 -1 1', _lightscaleHDR: '1', _fifty_percent_distance: '96', _zero_percent_distance: '320' },
        });
        out.litRooms.push(r);
      }
    }

    // Grime: stains, posters and graffiti on the walls, blood, burns and rubble on the floor.
    const decals = Math.round(((size.x * size.y) / (128 * 128)) * weathering * 1.5 * rng.next());
    for (let k = 0; k < decals; k++) {
      if (rng.chance(0.5)) {
        const p = new Vector2(rng.range(inner.min.x + 16, inner.max.x - 16), rng.range(inner.min.y + 16, inner.max.y - 16));
        out.entities.push({ classname: 'infodecal', origin: new Vector3(Math.round(p.x), Math.round(p.y), floor + 1), keys: { texture: rng.pick(FLOOR_DECALS) } });
      } else {
        const s = rng.pick(sides);
        const p = s.a.clone().lerp(s.b, rng.range(0.15, 0.85)).addScaledVector(s.n, 2);
        out.entities.push({ classname: 'infodecal', origin: new Vector3(Math.round(p.x), Math.round(p.y), floor + rng.int(24, 72)), keys: { texture: rng.pick(WALL_DECALS) } });
      }
    }
    if (weathering > 0.4 && furnish !== 'none' && rng.chance(weathering * 0.4)) placeFree(FURNITURE.debris);
  });
  return out;
}

/** Every model the dressing can place as prop_static. */
export const STATIC_MODELS = new Set([...Object.values(FURNITURE).filter((x) => x.isStatic).map((x) => x.model), LAMP.model]);
