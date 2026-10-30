import { describe, expect, it } from 'vitest';
import { Box2, Box3, Vector2, Vector3 } from 'three';
import { inradius, roofSolids, type RoofKind } from '../src/gen/roofs.ts';
import { rectPoly, shapeCorner } from '../src/gen/buildingPlan.ts';
import { generateBuildings } from '../src/gen/buildings.ts';
import { Rng } from '../src/gen/rng.ts';
import { MapSolid, VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';

const tile = { material: 'X', bays: 2 };
const rect = rectPoly(new Box2(new Vector2(0, 0), new Vector2(512, 256)));
const roof = (kind: RoofKind, poly = rect, extra = {}) =>
  roofSolids(VmfDocument.empty(), poly, 384, { kind, material: 'R', wall: tile, window: tile, overhang: 14, dormers: false, chimneys: false, ...extra }, new Rng(1));
const valid = (n: Parameters<typeof buildBrushFaces>[0]['node']) => {
  const s = new MapSolid(n, null);
  return buildBrushFaces(s).length === s.sides.length && s.sides.length >= 4;
};

describe('roofs', () => {
  it('a hip roof over a rounded corner is one convex brush peaking at the inradius', () => {
    const poly = shapeCorner(rectPoly(new Box2(new Vector2(0, 0), new Vector2(512, 384))), 2, 'round', 192).poly;
    const r = roof('hip', poly);
    expect(r.solids).toHaveLength(1);
    expect(valid(r.solids[0])).toBe(true);
    // Eaves stand 16 out, so the peak is at (384 / 2 + 16) × 0.75.
    expect(r.heightAt(new Vector2(256, 192))).toBeCloseTo(384 + 208 * 0.75, 0);
    expect(inradius(rect)).toBeCloseTo(128, 0);
  });

  it('mansard and curved roofs stack tiers; gables keep their wall ends', () => {
    for (const [kind, tiers] of [['mansard', 2], ['curved', 3], ['gable', 1]] as const) {
      const r = roof(kind);
      expect(r.solids).toHaveLength(tiers);
      for (const s of r.solids) expect(valid(s)).toBe(true);
    }
    const gable = new MapSolid(roof('gable').solids[0], null);
    expect(gable.sides.filter((s) => s.material === 'X')).toHaveLength(2);
  });

  it('mansards get dormers on long walls and every roof brush is valid', () => {
    const r = roof('mansard', rect, { dormers: true, chimneys: true });
    expect(r.solids.length).toBeGreaterThan(4);
    for (const s of r.solids) expect(valid(s)).toBe(true);
  });

  it('generated blocks with every roof kind build valid brushes', () => {
    for (const roofs of ['mixed', 'hip', 'mansard', 'gable', 'curved', 'flat'] as const) {
      const doc = VmfDocument.empty();
      const g = generateBuildings(doc, new Box3(new Vector3(0, 0, 0), new Vector3(1280, 1152, 0)), { seed: 5, minFloors: 2, maxFloors: 6, alleys: false, roofProps: true, roofs, detail: 3 });
      for (const n of [...g.solids, ...g.detail]) expect(valid(n)).toBe(true);
    }
  });
});
