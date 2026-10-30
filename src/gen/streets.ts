import { Box2, Vector2, Vector3 } from 'three';
import { Rng } from './rng.ts';
import { FLOOR } from './facade.ts';
import type { FeatureEntity, Wall } from './facadeFeatures.ts';

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
}

/** Leafless street trees (tree_dead01/02 are dead pines with needles, so they're left out). */
const BARE_TREES = ['models/props_foliage/tree_dead03.mdl', 'models/props_foliage/tree_dead04.mdl', 'models/props_foliage/tree_dry02.mdl'];
const LAMP = 'models/props_c17/lamppost03a_off.mdl';
const PIPE = 'models/props_rooftop/gutter_pipe_256.mdl';
const DISH = 'models/props_rooftop/satellitedish02.mdl';
const METERS = ['models/props_c17/gasmeter001a.mdl', 'models/props_c17/gasmeter002a.mdl'];
const MOUNT = 'models/props_c17/utilitypolemount01a.mdl';

const deg = (r: number) => Math.round((r * 180) / Math.PI);
const prop = (model: string, p: Vector3, yaw: number): FeatureEntity => ({
  classname: 'prop_static', origin: new Vector3(Math.round(p.x), Math.round(p.y), Math.round(p.z)), keys: { model, angles: `0 ${yaw} 0`, solid: '0' },
});

/**
 * Clutter on one street wall: drainpipes down from the cornice at the wall's ends, a satellite dish,
 * a gas meter by the ground floor, and cable anchors for the street pass.
 */
export function wallClutter(w: Wall, z0: number, floors: number, rng: Rng, anchors: Anchor[]): FeatureEntity[] {
  const out: FeatureEntity[] = [];
  const top = z0 + floors * FLOOR;
  const at = (along: number, off: number, z: number) => {
    const p = w.a.clone().addScaledVector(w.dir, along).addScaledVector(w.out, off);
    return new Vector3(p.x, p.y, z);
  };
  // The pipe model hangs 256 down from its origin and sits on its -y side: turn -y to face out.
  const pipeYaw = deg(Math.atan2(w.out.x, -w.out.y));
  const faceYaw = deg(Math.atan2(w.out.y, w.out.x));
  if (w.len >= 192) {
    for (const along of [24, w.len - 24]) {
      if (!rng.chance(0.45)) continue;
      for (let z = top - 20; z - 256 > z0 - 64; z -= 256) out.push(prop(PIPE, at(along, 0, z), pipeYaw));
    }
  }
  if (floors >= 3 && rng.chance(0.35)) out.push(prop(DISH, at(rng.range(48, w.len - 48), 18, z0 + rng.int(2, floors - 1) * FLOOR + 40), faceYaw));
  if (rng.chance(0.35)) out.push(prop(rng.pick(METERS), at(rng.range(40, w.len - 40), 7, z0 + 56), faceYaw));
  if (floors >= 3 && w.len >= 256) {
    for (const f of [1 / 3, 2 / 3]) {
      const z = z0 + Math.min(floors - 1, rng.int(2, 4)) * FLOOR + 72;
      const p = at(w.len * f, 6, z);
      anchors.push({ p, out: w.out.clone() });
      out.push(prop(MOUNT, at(w.len * f, 6, z), faceYaw));
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
 * along the pavements (not in alleys), bare trees in courtyards, yards and wide streets.
 */
export function streetDressing(blocks: BlockDressing[], rng: Rng, opts: { cables?: boolean; lamps?: boolean; trees?: boolean } = {}): FeatureEntity[] {
  const out: FeatureEntity[] = [];
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
          if (used.has(b) || a.out.dot(b.out) > -0.95) continue;
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
        // Wide streets alternate lamps and trees; narrower ones get lamps only.
        if ((opts.trees ?? true) && gap >= 448 && k % 2 === 1) {
          const t = p.clone().addScaledVector(s.out, 120);
          out.push(prop(rng.pick(BARE_TREES), new Vector3(t.x, t.y, B.z0 - 4), rng.int(0, 359)));
        } else if ((opts.lamps ?? true) && rng.chance(0.8)) {
          const l = p.clone().addScaledVector(s.out, 40);
          // The lamp's arm points along +y: turn it out over the street.
          out.push(prop(LAMP, new Vector3(l.x, l.y, B.z0), deg(Math.atan2(-s.out.x, s.out.y))));
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
          if (B.obstacles.some((o) => o.clone().expandByScalar(48).containsPoint(p))) continue;
          out.push(prop(rng.pick(BARE_TREES), new Vector3(p.x, p.y, B.z0 - 4), rng.int(0, 359)));
        }
      }
    }
  });
  return out;
}
