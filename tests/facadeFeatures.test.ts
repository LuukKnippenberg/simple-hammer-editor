import { describe, expect, it } from 'vitest';
import { Vector2 } from 'three';
import { balcony, entranceSteps, oriel, streetFacade, wallOf } from '../src/gen/facadeFeatures.ts';
import { Rng } from '../src/gen/rng.ts';
import { MapSolid, VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import type { KVNode } from '../src/vmf/keyvalues.ts';

const tile = { material: 'W', bays: 2 };
const valid = (n: KVNode) => {
  const s = new MapSolid(n, null);
  return s.sides.length >= 5 && buildBrushFaces(s).length === s.sides.length;
};
// A street wall running along +x; its outside faces -y.
const wall = wallOf(new Vector2(0, 0), new Vector2(768, 0));

describe('facade features', () => {
  it('oriels of every shape are valid brushes standing out from the wall', () => {
    for (const shape of ['rect', 'angled', 'round'] as const) {
      const doc = VmfDocument.empty();
      const solids = oriel(doc, wall, 384, { width: 120, depth: 32, shape, z0: 0, zBottom: 144, zTop: 616, windows: tile, trim: tile, plain: tile });
      expect(solids.length).toBe(4);
      for (const s of solids) expect(valid(s)).toBe(true);
      const body = new MapSolid(solids[0], null);
      const ys = buildBrushFaces(body).flatMap((f) => f.verts.map((v) => v.y));
      // Outside is -y: the oriel reaches out to about -32 and back 2 into the wall.
      expect(Math.min(...ys)).toBeLessThan(-28);
      expect(Math.max(...ys)).toBeCloseTo(2, 0);
    }
  });

  it('balconies and steps build valid brushes', () => {
    const doc = VmfDocument.empty();
    for (const s of [...balcony(doc, wall, 200, 120, 136, tile), ...entranceSteps(doc, wallOf(new Vector2(0, 0), new Vector2(90, 90)), 0)]) expect(valid(s)).toBe(true);
  });

  it('long street walls get oriels or balconies and awnings, no vent decals', () => {
    let oriels = 0, balconies = 0, awnings = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const doc = VmfDocument.empty();
      const r = streetFacade(doc, wall, { z0: 0, floors: 5, windows: tile, trim: tile, plain: tile, level: 2 }, new Rng(seed));
      for (const s of r.solids) expect(valid(s)).toBe(true);
      const mats = r.solids.map((n) => new MapSolid(n, null).sides.map((x) => x.material).join());
      if (mats.some((m) => m.includes('W') && m.includes('NODRAW') && !m.includes('METALRAIL'))) oriels++;
      if (mats.some((m) => m.includes('METALRAIL'))) balconies++;
      awnings += r.entities.filter((e) => e.keys.model?.includes('awning')).length;
      expect(r.entities.some((e) => e.classname === 'infodecal')).toBe(false);
    }
    expect(oriels).toBeGreaterThan(5);
    expect(balconies).toBeGreaterThan(5);
    expect(awnings).toBeGreaterThan(5);
  });
});
