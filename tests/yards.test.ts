import { describe, expect, it } from 'vitest';
import { Box2, Box3, Vector2, Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { generateBuildings, type BuildingOptions } from '../src/gen/buildings.ts';
import { greenYard } from '../src/gen/yards.ts';
import { emptySketch, Feature, sketchBlocks } from '../src/gen/sketch.ts';
import { Rng } from '../src/gen/rng.ts';

// A 12 × 12 cell block: big enough for a ring around a courtyard.
const block = new Box3(new Vector3(0, 0, 0), new Vector3(1536, 1536, 0));
const opts = (o: Partial<BuildingOptions>): BuildingOptions => ({ seed: 3, minFloors: 4, maxFloors: 6, alleys: false, roofProps: true, architecture: 'tenement', courtyards: true, ...o });
const models = (es: { keys: Record<string, string> }[]) => es.map((e) => e.keys.model ?? '');

describe('green yards', () => {
  it('lays a lawn clear of the walls, with trees and benches, and a playground or parking when there is room', () => {
    const yard = new Box2(new Vector2(0, 0), new Vector2(768, 640));
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const g = greenYard(VmfDocument.empty(), yard, 0, new Rng(seed));
      const m = models(g.entities);
      expect(m.some((x) => x.includes('tree') || x.includes('mall_tree'))).toBe(true);
      // Everything stands inside the yard, off its edges.
      for (const e of g.entities) expect(yard.clone().expandByScalar(-24).containsPoint(new Vector2(e.origin.x, e.origin.y))).toBe(true);
      if (m.some((x) => x.includes('playground'))) kinds.add('playground');
      if (m.some((x) => x.includes('props_vehicles'))) kinds.add('parking');
      // The lawn stays 24 off the walls.
      for (const s of g.solids) for (const side of s.childrenNamed('side')) {
        for (const [x, y] of [...side.get('plane')!.matchAll(/\(([-\d.]+) ([-\d.]+) [-\d.]+\)/g)].map((q) => [Number(q[1]), Number(q[2])])) {
          expect(x).toBeGreaterThanOrEqual(24); expect(x).toBeLessThanOrEqual(744);
          expect(y).toBeGreaterThanOrEqual(24); expect(y).toBeLessThanOrEqual(616);
        }
      }
    }
    expect(kinds).toEqual(new Set(['playground', 'parking']));
  });

  it('replace the sheds in a ring block, and open lots let the courtyard reach the street', () => {
    const sheds = generateBuildings(VmfDocument.empty(), block, opts({}));
    const green = generateBuildings(VmfDocument.empty(), block, opts({ yards: 'green' }));
    // The same buildings around the courtyard (sheds aside), with props in it instead of sheds.
    expect(green.dressing.obstacles).toEqual([]);
    expect(models(green.entities).filter((m) => m.includes('props_foliage')).length).toBeGreaterThan(0);
    expect(sheds.dressing.yards.length).toBeGreaterThan(0);
    const open = generateBuildings(VmfDocument.empty(), block, opts({ yards: 'green', openYards: 0.6 }));
    expect(open.buildings).toBeLessThan(green.buildings);
  });
});

describe('sketch block size', () => {
  it('cuts building cells into blocks of at most blockSize cells', () => {
    const s = emptySketch(32, 32, 'city');
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) s.features[y * s.w + x] = Feature.Building;
    expect(sketchBlocks(s).length).toBe(4);
    s.blockSize = 12;
    expect(sketchBlocks(s)).toEqual([expect.objectContaining({ x0: 2, y0: 2, x1: 14, y1: 14 })]);
  });
});
