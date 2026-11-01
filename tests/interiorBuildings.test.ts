import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Box3, Vector2, Vector3 } from 'three';
import { generateBuildings } from '../src/gen/buildings.ts';
import { streetDressing } from '../src/gen/streets.ts';
import { outlineOf } from '../src/gen/interiorPlan.ts';
import { Rng } from '../src/gen/rng.ts';
import { MapSolid, VmfDocument } from '../src/vmf/map.ts';
import { writeKeyValues } from '../src/vmf/keyvalues.ts';
import { solidBounds } from '../src/edit/brushes.ts';
import { Box2 } from 'three';

const block = (w: number, h: number) => new Box3(new Vector3(0, 0, 0), new Vector3(w, h, 0));

describe('interior houses in the building generator', () => {
  it('without interiors the output is byte-identical to before', () => {
    // Hashes of the generator without interiors (recorded after the facade, kerb and wall-prop fixes, the vent decal
    // removal and nodraw on covered faces).
    const golden = { mixed: '75b7674241fac5477423850ca78cd24695476f67', sheds: '51595b6ab42d6366e37d1a64960d8cc157088377', brick: 'fe10ee0e0a6b3e77568f64339a6f737d2e512f66' };
    for (const [arch, seed] of [['mixed', 5], ['sheds', 9], ['brick', 13]] as const) {
      for (const interiors of [undefined, 'none'] as const) {
        const doc = VmfDocument.empty();
        const g = generateBuildings(doc, block(1536, 1152), { seed, minFloors: 1, maxFloors: 4, alleys: true, roofProps: true, architecture: arch, detail: 2, interiors });
        const text = writeKeyValues([...g.solids, ...g.detail]) + JSON.stringify(g.entities) + JSON.stringify(g.dressing);
        expect(createHash('sha1').update(text).digest('hex')).toBe(golden[arch]);
        expect(g.interiorHouses).toBe(0);
      }
    }
  });

  it('all interiors on a small block gives only enterable houses, without roofs', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const doc = VmfDocument.empty();
      const g = generateBuildings(doc, block(640, 384), { seed, minFloors: 1, maxFloors: 1, alleys: false, roofProps: true, architecture: 'sheds', interiors: 'all', detail: 2 });
      expect(g.buildings).toBeGreaterThan(0);
      expect(g.interiorHouses).toBeGreaterThanOrEqual(g.buildings);
      // Nothing rises above the cut walls (plus the eave stubs' cap): no roofs, no cornices.
      for (const n of [...g.solids, ...g.detail]) expect(solidBounds(new MapSolid(n, null)).max.z).toBeLessThanOrEqual(112);
      expect(g.dressing.doors!.length).toBeGreaterThan(0);
    }
  });

  it('slum and village architectures default to enterable houses', () => {
    const slum = generateBuildings(VmfDocument.empty(), block(1280, 640), { seed: 3, minFloors: 1, maxFloors: 1, alleys: true, roofProps: true, architecture: 'slum' });
    expect(slum.interiorHouses).toBeGreaterThanOrEqual(slum.buildings);
    let village = 0;
    for (let seed = 1; seed <= 6; seed++) village += generateBuildings(VmfDocument.empty(), block(1280, 640), { seed, minFloors: 1, maxFloors: 2, alleys: true, roofProps: true, architecture: 'village' }).interiorHouses;
    expect(village).toBeGreaterThan(0);
  });

  it('street lamps and trees keep clear of the doors', () => {
    const blocks = [0, 1, 2].map((i) => generateBuildings(VmfDocument.empty(), new Box3(new Vector3(i * 960, 0, 0), new Vector3(i * 960 + 640, 640, 0)), { seed: 20 + i, minFloors: 1, maxFloors: 2, alleys: false, roofProps: false, architecture: 'slum' }).dressing);
    const doors = blocks.flatMap((b) => b.doors ?? []);
    expect(doors.length).toBeGreaterThan(0);
    for (const e of streetDressing(blocks, new Rng(4))) {
      if (e.classname !== 'prop_static') continue;
      const p = new Vector2(e.origin.x, e.origin.y);
      for (const d of doors) expect(d.containsPoint(p)).toBe(false);
    }
  });

  it('an L of two wings becomes one outline', () => {
    const o = outlineOf([new Box2(new Vector2(0, 0), new Vector2(512, 256)), new Box2(new Vector2(0, 256), new Vector2(256, 512))]);
    expect(o.map((p) => [p.x, p.y])).toEqual([[0, 0], [512, 0], [512, 256], [256, 256], [256, 512], [0, 512]]);
  });
});
