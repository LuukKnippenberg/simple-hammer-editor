import { describe, expect, it } from 'vitest';
import { Box2, Box3, Vector2, Vector3 } from 'three';
import { FACADE_STYLES, generateBuildings } from '../src/gen/buildings.ts';
import { streetDressing, wallClutter, WALL_PROP_SIZE, type Anchor, type BlockDressing } from '../src/gen/streets.ts';
import { wallOf, type FeatureEntity } from '../src/gen/facadeFeatures.ts';
import { FLOOR, bayCount, type FacadeTile } from '../src/gen/facade.ts';
import { WALL_MOUNT, wallMount } from '../src/gen/powerlines.ts';
import { Rng } from '../src/gen/rng.ts';
import { VmfDocument, MapEntity } from '../src/vmf/map.ts';
import { RopeRenderer } from '../src/render/ropeRenderer.ts';
import { entity } from '../src/gen/layout.ts';

/** Two rows of blocks with a 256-unit street between them and an alley-width gap between neighbours. */
function district(seed: number): BlockDressing[] {
  const doc = VmfDocument.empty();
  const boxes = [[0, 0, 1024, 1024], [1152, 0, 2176, 1024], [0, 1280, 1024, 2304], [1152, 1280, 2176, 2304]];
  return boxes.map(([x0, y0, x1, y1], i) => generateBuildings(doc, new Box3(new Vector3(x0, y0, 0), new Vector3(x1, y1, 0)), {
    seed: seed + i, minFloors: 4, maxFloors: 6, alleys: false, roofProps: false, architecture: 'tenement',
  }).dressing);
}

describe('street dressing', () => {
  it('strings cables across the street between facing walls, each rope linked to its far end', () => {
    let cables = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const blocks = district(seed);
      const ents = streetDressing(blocks, new Rng(seed));
      const ropes = ents.filter((e) => e.classname === 'move_rope');
      cables += ropes.length;
      const doc = VmfDocument.empty();
      const wrapped = ents.map((e) => new MapEntity(entity(doc, e.classname, e.origin, e.keys)));
      const spans = RopeRenderer.spans(wrapped);
      expect(spans).toHaveLength(ropes.length);
      for (const [a, b] of spans) {
        // Across a street: 128 to 900 units, level ends.
        const span = Math.hypot(b.x - a.x, b.y - a.y);
        expect(span).toBeGreaterThanOrEqual(128);
        expect(span).toBeLessThanOrEqual(900);
        expect(a.z).toBe(b.z);
      }
    }
    expect(cables).toBeGreaterThan(6);
  });

  it('puts lamps on the pavement but not in alleys, and trees in courtyards clear of the sheds', () => {
    const blocks = district(3);
    const ents = streetDressing(blocks, new Rng(3));
    const lamps = ents.filter((e) => e.keys.model?.includes('lamppost'));
    expect(lamps.length).toBeGreaterThan(4);
    // The 128-unit gap between neighbouring blocks (x 1024..1152) is an alley: no lamps in it.
    expect(lamps.some((l) => l.origin.x > 1024 && l.origin.x < 1152 && l.origin.y > 0 && l.origin.y < 1024)).toBe(false);
    const trees = ents.filter((e) => e.keys.model?.includes('tree'));
    for (const t of trees) {
      const p = { x: t.origin.x, y: t.origin.y };
      for (const b of blocks) for (const o of b.obstacles) expect(o.clone().expandByScalar(40).containsPoint(p as never)).toBe(false);
    }
  });
});

describe('wall clutter', () => {
  /** A prop's footprint on the wall (x along it, y height), from its entity. */
  const footprint = (e: FeatureEntity, a: Vector2, dir: Vector2) => {
    const s = WALL_PROP_SIZE[e.keys.model];
    const u = (e.origin.x - a.x) * dir.x + (e.origin.y - a.y) * dir.y;
    return new Box2(new Vector2(u + s.u[0], e.origin.z + s.z[0]), new Vector2(u + s.u[1], e.origin.z + s.z[1]));
  };
  /** Window openings of a tile on a wall, along it: centred in each bay, `opening` of it wide. */
  const openings = (len: number, tile: FacadeTile) => {
    const bays = bayCount(len, tile), bay = len / bays, w = (tile.opening ?? 0.8) * bay;
    return Array.from({ length: bays }, (_, k) => [(k + 0.5) * bay - w / 2, (k + 0.5) * bay + w / 2]);
  };

  it('hangs props on the piers between windows, clear of the wall ends, of each other and of oriels', () => {
    const styles = Object.values(FACADE_STYLES);
    let props = 0, mounts = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rng = new Rng(seed);
      const s = styles[seed % styles.length];
      const windows = s.windows[seed % s.windows.length], ground = s.ground[0];
      const len = rng.pick([192, 256, 320, 384, 512, 640, 768, 1024]), floors = rng.int(3, 7), z0 = rng.int(-2, 2) * 32;
      // A wall at an angle, with an oriel over two bays from the first floor up.
      const a = new Vector2(rng.int(-500, 500), rng.int(-500, 500)), ang = rng.range(0, Math.PI * 2);
      const w = wallOf(a, a.clone().add(new Vector2(Math.cos(ang), Math.sin(ang)).multiplyScalar(len)));
      const bay = len / bayCount(len, windows);
      const oriel = new Box2(new Vector2(bay + 4, z0 + FLOOR - 8), new Vector2(3 * bay - 4, z0 + floors * FLOOR - 14));
      const anchors: Anchor[] = [];
      const ents = wallClutter(w, z0, floors, rng, anchors, { windows, ground, taken: len >= 512 ? [oriel] : [] });
      const boxes: { model: string; box: Box2 }[] = [];
      for (const e of ents) {
        const box = footprint(e, w.a, w.dir);
        props++;
        expect(box.min.x).toBeGreaterThanOrEqual(40);
        expect(box.max.x).toBeLessThanOrEqual(len - 40);
        // No part of a prop lies in front of a window, on the ground floor or above.
        for (const [tile, from, to] of [[ground, z0 - 32, z0 + FLOOR], [windows, z0 + FLOOR, z0 + floors * FLOOR]] as const) {
          if (box.max.y <= from || box.min.y >= to) continue;
          for (const [o0, o1] of openings(len, tile)) expect(box.max.x <= o0 || box.min.x >= o1, `${e.keys.model} over a window`).toBe(true);
        }
        if (len >= 512) expect(box.intersectsBox(oriel)).toBe(false);
        // Pipe segments of one pipe stack on each other; everything else keeps 20 units apart.
        for (const o of boxes) {
          if (o.model === e.keys.model && e.keys.model.includes('gutter_pipe') && Math.abs(o.box.min.x - box.min.x) < 1) continue;
          expect(o.box.clone().expandByScalar(20).intersectsBox(box), `${e.keys.model} next to ${o.model}`).toBe(false);
        }
        boxes.push({ model: e.keys.model, box });
      }
      // Every bracket gives one anchor, on its outer insulator; the two on a wall stand apart.
      const brackets = ents.filter((e) => e.keys.model === WALL_MOUNT.model);
      mounts += brackets.length;
      expect(anchors).toHaveLength(brackets.length);
      if (brackets.length === 2) expect(brackets[0].origin.distanceTo(brackets[1].origin)).toBeGreaterThanOrEqual(95);
      for (const b of brackets) {
        const wall = new Vector3(b.origin.x - w.out.x * WALL_MOUNT.back, b.origin.y - w.out.y * WALL_MOUNT.back, b.origin.z);
        expect(anchors.some((an) => an.p.distanceTo(wallMount(wall, w.out).wire) < 1.5)).toBe(true);
      }
    }
    expect(props).toBeGreaterThan(300);
    expect(mounts).toBeGreaterThan(100);
  });

  it('ends every street cable on a bracket insulator', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const blocks = district(seed);
      const wires = blocks.flatMap((b) => b.anchors.map((an) => an.p));
      const ents = streetDressing(blocks, new Rng(seed));
      const ends = ents.filter((e) => e.classname === 'move_rope' || e.classname === 'keyframe_rope');
      for (const e of ends) expect(wires.some((p) => Math.hypot(p.x - e.origin.x, p.y - e.origin.y, p.z - e.origin.z) < 1.5)).toBe(true);
    }
  });
});
