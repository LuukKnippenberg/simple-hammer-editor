import { Box2, Vector2, Vector3 } from 'three';
import { Rng } from './rng.ts';
import { FLOOR, piers, type FacadeTile } from './facade.ts';
import type { FeatureEntity, Wall } from './facadeFeatures.ts';
import { WALL_MOUNT, wallMount } from './powerlines.ts';

/** A point on a street wall where a cable can be fixed, with the wall's outward normal. */
export interface Anchor { p: Vector3; out: Vector2 }

/** What a generated block leaves for the street pass: its outline, cable anchors and open yards. */
export interface BlockDressing {
  area: Box2;
  z0: number;
  anchors: Anchor[];
  yards: Box2[];
  /** Sheds standing in the yards (trees keep clear of them). */
  obstacles: Box2[];
  /** The ground in front of the doors of enterable houses: no lamps or trees there. */
  doors?: Box2[];
}

/** Leafless street trees (tree_dead01/02 are dead pines with needles, so they're left out). */
const BARE_TREES = ['models/props_foliage/tree_dead03.mdl', 'models/props_foliage/tree_dead04.mdl', 'models/props_foliage/tree_dry02.mdl'];
const LAMP = 'models/props_c17/lamppost03a_off.mdl';
const PIPE = 'models/props_rooftop/gutter_pipe_256.mdl';
const DISH = 'models/props_rooftop/satellitedish02.mdl';
const METERS = ['models/props_c17/gasmeter001a.mdl', 'models/props_c17/gasmeter002a.mdl'];

const deg = (r: number) => Math.round((r * 180) / Math.PI);
const prop = (model: string, p: Vector3, yaw: number): FeatureEntity => ({
  classname: 'prop_static', origin: new Vector3(Math.round(p.x), Math.round(p.y), Math.round(p.z)), keys: { model, angles: `0 ${yaw} 0`, solid: '0' },
});

/** What else is on a street wall, for placing its clutter. */
export interface WallFront {
  /** Tile of the upper floors, and of the ground floor. */
  windows: FacadeTile;
  ground: FacadeTile;
  /** Parts of the wall (x along it from `a`, y height) covered by oriels, balconies, awnings and pilasters. */
  taken: Box2[];
}

/**
 * Extents of the wall props in the plane of the wall, from their MDL hulls: along the wall and up from the
 * point they are placed at (for the bracket, the point on the wall behind its origin).
 */
export const WALL_PROP_SIZE: Record<string, { u: [number, number]; z: [number, number] }> = {
  [WALL_MOUNT.model]: { u: [-6, 6], z: [-33, 32] },
  [DISH]: { u: [-19, 19], z: [-21, 21] },
  // The second meter has its origin at one side.
  [METERS[0]]: { u: [-27, 27], z: [-44, 44] },
  [METERS[1]]: { u: [0, 46], z: [-18, 30] },
  [PIPE]: { u: [-6, 6], z: [-257, 1] },
};
/** Plain wall left at each end of a wall: corners, quoins and the faces of shaped corners stay clear. */
const END_CLEAR = 40;
/** Room left beside oriels, balconies, awnings and pilasters, and between two props. */
const PROP_GAP = 8, PROP_SPACING = 24;
/** Two cable brackets on one wall stand at least this far apart. */
const MOUNT_SPACING = 96;

/**
 * Clutter on one street wall: cable brackets for the street pass, drainpipes down from the cornice near the
 * wall's ends, a satellite dish and a gas meter by the ground floor. Everything hangs on the piers between
 * windows (the ground floor's and the upper floors'), clear of the wall's ends, of what `front` covers and of
 * each other.
 */
export function wallClutter(w: Wall, z0: number, floors: number, rng: Rng, anchors: Anchor[], front: WallFront): FeatureEntity[] {
  const out: FeatureEntity[] = [];
  const top = z0 + floors * FLOOR;
  const at = (along: number, off: number, z: number) => {
    const p = w.a.clone().addScaledVector(w.dir, along).addScaledVector(w.out, off);
    return new Vector3(p.x, p.y, z);
  };
  // The pipe model hangs 256 down from its origin and sits on its -y side: turn -y to face out.
  const pipeYaw = deg(Math.atan2(w.out.x, -w.out.y));
  const faceYaw = deg(Math.atan2(w.out.y, w.out.x));
  const rows = [
    { from: z0 - 32, to: z0 + FLOOR, piers: piers(w.len, front.ground) },
    { from: z0 + FLOOR, to: top, piers: piers(w.len, front.windows) },
  ];
  const placed: Box2[] = [];
  const boxOf = (u: number, zb: number, zt: number, model: string) => {
    const s = WALL_PROP_SIZE[model];
    return new Box2(new Vector2(u + s.u[0], zb + s.z[0]), new Vector2(u + s.u[1], zt + s.z[1]));
  };
  /**
   * Positions along the wall for `model` spanning heights zb..zt: on a pier of every floor it covers, clear of
   * the rest. Centred on a pier where one is free, otherwise moved aside on a wide pier.
   */
  const spots = (model: string, zb: number, zt = zb) => {
    const s = WALL_PROP_SIZE[model];
    const hit = rows.filter((r) => r.from < zt + s.z[1] && r.to > zb + s.z[0]);
    // Props keep 2 units off the window frames (origins are rounded to whole units).
    const tries: { u: number; centred: boolean }[] = [];
    for (const r of hit) {
      for (const [a, b] of r.piers) {
        const lo = a + 2 - s.u[0], hi = b - 2 - s.u[1], mid = (lo + hi) / 2;
        for (let d = 0; mid - d >= lo; d += 8) tries.push({ u: mid - d, centred: d === 0 }, ...(d ? [{ u: mid + d, centred: false }] : []));
      }
    }
    const free = tries.filter(({ u }) => {
      const box = boxOf(u, zb, zt, model);
      if (box.min.x < END_CLEAR || box.max.x > w.len - END_CLEAR) return false;
      if (!hit.every((r) => r.piers.some(([a, b]) => a + 2 <= box.min.x && box.max.x <= b - 2))) return false;
      const near = (gap: number) => (t: Box2) => t.intersectsBox(box.clone().expandByScalar(gap));
      return !front.taken.some(near(PROP_GAP)) && !placed.some(near(PROP_SPACING));
    });
    const centred = free.filter((t) => t.centred);
    return (centred.length ? centred : free).map((t) => t.u);
  };
  const nearest = (us: number[], target: number) => us.reduce((best, u) => (Math.abs(u - target) < Math.abs(best - target) ? u : best));

  if (floors >= 3 && w.len >= 256) {
    // Two brackets near the thirds of the wall, on the third floor: cables run level between brackets at one
    // height, so every street wall uses the same one.
    const z = z0 + 2 * FLOOR + 60;
    let first: number | undefined;
    for (const f of [1 / 3, 2 / 3]) {
      const free = spots(WALL_MOUNT.model, z).filter((u) => first === undefined || Math.abs(u - first) >= MOUNT_SPACING);
      if (!free.length) break;
      const u = nearest(free, w.len * f);
      first ??= u;
      placed.push(boxOf(u, z, z, WALL_MOUNT.model));
      // The bracket sticks out from the wall; the cable meets its outer insulator.
      const m = wallMount(at(u, 0, z), w.out);
      anchors.push({ p: m.wire, out: w.out.clone() });
      out.push(prop(WALL_MOUNT.model, m.origin, m.yaw));
    }
  }
  if (w.len >= 192) {
    // Pipe segments from under the cornice down to the ground.
    const zs: number[] = [];
    for (let z = top - 20; z - 256 > z0 - 64; z -= 256) zs.push(z);
    for (const end of [0, w.len]) {
      if (!rng.chance(0.6) || !zs.length) continue;
      const free = spots(PIPE, zs[zs.length - 1], zs[0]).filter((u) => Math.abs(u - end) <= 160);
      if (!free.length) continue;
      const u = nearest(free, end);
      placed.push(boxOf(u, zs[zs.length - 1], zs[0], PIPE));
      for (const z of zs) out.push(prop(PIPE, at(u, 0, z), pipeYaw));
    }
  }
  if (floors >= 3 && rng.chance(0.6)) {
    const z = z0 + rng.int(2, floors - 1) * FLOOR + 40;
    const free = spots(DISH, z);
    if (free.length) {
      const u = rng.pick(free);
      placed.push(boxOf(u, z, z, DISH));
      out.push(prop(DISH, at(u, 18, z), faceYaw));
    }
  }
  if (rng.chance(0.5)) {
    const model = rng.pick(METERS), z = z0 + 66;
    const free = spots(model, z);
    if (free.length) {
      const u = rng.pick(free);
      placed.push(boxOf(u, z, z, model));
      out.push(prop(model, at(u, 7, z), faceYaw));
    }
  }
  return out;
}

/** Gap from a block side to the nearest other block in front of it (Infinity when open). */
function gapInFront(blocks: BlockDressing[], i: number, side: { a: Vector2; b: Vector2; out: Vector2 }): number {
  let best = Infinity;
  const axis = Math.abs(side.out.x) > 0.5 ? 'x' : 'y';
  const other = axis === 'x' ? 'y' : 'x';
  const lo = Math.min(side.a[other], side.b[other]), hi = Math.max(side.a[other], side.b[other]);
  blocks.forEach((b, j) => {
    if (j === i || Math.min(hi, b.area.max[other]) - Math.max(lo, b.area.min[other]) < 128) return;
    const d = side.out[axis] > 0 ? b.area.min[axis] - side.a[axis] : side.a[axis] - b.area.max[axis];
    if (d > 0) best = Math.min(best, d);
  });
  return best;
}

/**
 * The street pass over several blocks: cables strung between facing buildings across streets, lamp posts
 * along the pavements (not in alleys), bare trees in courtyards, yards and wide streets. `groundAt` gives the
 * height lamps and trees stand on (a pavement's top, say), or null where none may stand (a carriageway);
 * without it they stand at their block's base.
 */
export function streetDressing(blocks: BlockDressing[], rng: Rng, opts: { cables?: boolean; lamps?: boolean; trees?: boolean; groundAt?: (x: number, y: number) => number | null } = {}): FeatureEntity[] {
  const out: FeatureEntity[] = [];
  const groundAt = (p: Vector2, B: BlockDressing) => (opts.groundAt ? opts.groundAt(p.x, p.y) : B.z0);
  const prefix = `wire${rng.int(1000, 9999)}`;
  if (opts.cables ?? true) {
    // Pair anchors that face each other across a street, each anchor used once.
    const used = new Set<Anchor>();
    let n = 0;
    blocks.forEach((A, i) => A.anchors.forEach((a) => {
      if (used.has(a) || !rng.chance(0.7)) return;
      let best: Anchor | null = null, bestD = Infinity;
      blocks.forEach((B, j) => {
        if (j === i) return;
        for (const b of B.anchors) {
          // Level cables only, so both ends sit on their bracket's insulator.
          if (used.has(b) || a.out.dot(b.out) > -0.95 || Math.abs(a.p.z - b.p.z) > 1) continue;
          const d = new Vector3().subVectors(b.p, a.p);
          const flat = new Vector2(d.x, d.y);
          const span = flat.length();
          if (span < 128 || span > 900 || flat.normalize().dot(a.out) < 0.9) continue;
          if (span < bestD) { best = b; bestD = span; }
        }
      });
      if (!best) return;
      const b: Anchor = best;
      used.add(a); used.add(b);
      const name = `${prefix}_${n++}`;
      const common = { RopeMaterial: 'cable/cable.vmt', Width: '2', TextureScale: '1', Subdiv: '2', Type: '0', Collide: '0' };
      const z = Math.min(a.p.z, b.p.z);
      out.push({ classname: 'move_rope', origin: new Vector3(Math.round(a.p.x), Math.round(a.p.y), z), keys: { ...common, targetname: `${name}_a`, NextKey: `${name}_b`, Slack: String(Math.round(bestD * 0.08 + rng.range(0, 40))), PositionInterpolator: '2', MoveSpeed: '64', Dangling: '0', Breakable: '0', Barbed: '0' } });
      out.push({ classname: 'keyframe_rope', origin: new Vector3(Math.round(b.p.x), Math.round(b.p.y), z), keys: { ...common, targetname: `${name}_b`, Slack: '0' } });
    }));
  }
  blocks.forEach((B, i) => {
    const r = B.area;
    const sides = [
      { a: new Vector2(r.min.x, r.min.y), b: new Vector2(r.max.x, r.min.y), out: new Vector2(0, -1) },
      { a: new Vector2(r.max.x, r.min.y), b: new Vector2(r.max.x, r.max.y), out: new Vector2(1, 0) },
      { a: new Vector2(r.max.x, r.max.y), b: new Vector2(r.min.x, r.max.y), out: new Vector2(0, 1) },
      { a: new Vector2(r.min.x, r.max.y), b: new Vector2(r.min.x, r.min.y), out: new Vector2(-1, 0) },
    ];
    for (const s of sides) {
      const gap = gapInFront(blocks, i, s);
      if (gap < 192) continue;
      const len = s.a.distanceTo(s.b);
      const dir = new Vector2().subVectors(s.b, s.a).normalize();
      const count = Math.floor((len - 192) / 448);
      for (let k = 0; k <= count; k++) {
        const along = 96 + ((len - 192) * (k + 0.5)) / (count + 1);
        const p = s.a.clone().addScaledVector(dir, along);
        if (blocks.some((X) => X.doors?.some((d) => d.clone().expandByScalar(160).containsPoint(p)))) continue;
        // Wide streets alternate lamps and trees (where the tree's spot isn't a carriageway); narrower ones
        // get lamps only.
        const t = p.clone().addScaledVector(s.out, 120);
        const tz = (opts.trees ?? true) && gap >= 448 && k % 2 === 1 ? groundAt(t, B) : null;
        if (tz !== null) {
          out.push(prop(rng.pick(BARE_TREES), new Vector3(t.x, t.y, tz - 4), rng.int(0, 359)));
        } else if ((opts.lamps ?? true) && rng.chance(0.8)) {
          const l = p.clone().addScaledVector(s.out, 40);
          const lz = groundAt(l, B);
          // The lamp's arm points along +y: turn it out over the street.
          if (lz !== null) out.push(prop(LAMP, new Vector3(l.x, l.y, lz), deg(Math.atan2(-s.out.x, s.out.y))));
        }
      }
    }
    if (opts.trees ?? true) {
      for (const y of B.yards) {
        const size = y.getSize(new Vector2());
        if (size.x < 192 || size.y < 192) continue;
        const n = Math.min(3, Math.max(1, Math.floor((size.x * size.y) / (448 * 448))));
        for (let k = 0; k < n; k++) {
          const p = new Vector2(rng.range(y.min.x + 80, y.max.x - 80), rng.range(y.min.y + 80, y.max.y - 80));
          const z = groundAt(p, B);
          if (z === null || B.obstacles.some((o) => o.clone().expandByScalar(48).containsPoint(p))) continue;
          if (B.doors?.some((d) => d.clone().expandByScalar(48).containsPoint(p))) continue;
          out.push(prop(rng.pick(BARE_TREES), new Vector3(p.x, p.y, z - 4), rng.int(0, 359)));
        }
      }
    }
  });
  return out;
}
