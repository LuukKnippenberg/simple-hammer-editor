import { describe, expect, it } from 'vitest';
import { Box2, Box3, Vector2, Vector3 } from 'three';
import { planBlock, rectPoly, shapeCorner } from '../src/gen/buildingPlan.ts';
import { facadeAxes, isConvexCcw } from '../src/gen/facade.ts';
import { generateBuildings } from '../src/gen/buildings.ts';
import { Rng } from '../src/gen/rng.ts';
import { VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';

const opts = { minFloors: 2, maxFloors: 6, alleys: false, corners: 'mixed' as const, courtyards: true, annexes: true };
const square = rectPoly(new Box2(new Vector2(0, 0), new Vector2(512, 512)));

describe('building plans', () => {
  it('cuts and rounds corners into convex footprints', () => {
    const cut = shapeCorner(square, 1, 'chamfer', 128);
    expect(cut.poly).toHaveLength(5);
    expect(isConvexCcw(cut.poly)).toBe(true);
    expect(cut.edges).toEqual([1]);
    const round = shapeCorner(square, 2, 'round', 256);
    expect(isConvexCcw(round.poly)).toBe(true);
    // A quarter circle of radius 256 is about 402 units: six segments of one 64-unit bay each.
    expect(round.edges).toHaveLength(6);
  });

  it('fits whole window bays on any face length', () => {
    // A 45° cut of 128: about 181 units, three 64-unit bays of a two-window tile.
    const ax = facadeAxes(new Vector2(384, 0), new Vector2(512, 128), { material: 'X', bays: 2 }, 0);
    expect((Math.hypot(128, 128) / ax.u.scale) / 512 * 2).toBeCloseTo(3, 3);
    // The texture starts at the face's first corner.
    const u0 = (384 * ax.u.axis.x) / ax.u.scale + ax.u.shift;
    expect(((u0 % 512) + 512) % 512).toBeCloseTo(0, 1);
  });

  it('lays out courtyard blocks and row blocks without overlapping buildings', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = 640 + (seed % 6) * 128, h = 512 + (seed % 5) * 192;
      const area = new Box2(new Vector2(0, 0), new Vector2(w, h));
      const plan = planBlock(area, new Rng(seed), opts);
      expect(plan.buildings.length).toBeGreaterThan(0);
      const mains = plan.buildings.flatMap((b) => b.parts);
      for (const p of mains) {
        expect(isConvexCcw(p.poly)).toBe(true);
        for (const v of p.poly) {
          expect(v.x).toBeGreaterThanOrEqual(0); expect(v.x).toBeLessThanOrEqual(w);
          expect(v.y).toBeGreaterThanOrEqual(0); expect(v.y).toBeLessThanOrEqual(h);
        }
      }
      // Parts may touch but never overlap.
      for (let i = 0; i < mains.length; i++) {
        for (let j = i + 1; j < mains.length; j++) {
          const a = new Box2().setFromPoints(mains[i].poly), b = new Box2().setFromPoints(mains[j].poly);
          const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x), oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
          expect(ox <= 0 || oy <= 0).toBe(true);
        }
      }
    }
  });

  it('every generated brush is a valid solid, for many seeds and block sizes', () => {
    let rounded = 0, courtyards = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const doc = VmfDocument.empty();
      const w = 512 + (seed % 7) * 160, h = 384 + (seed % 4) * 256;
      const r = generateBuildings(doc, new Box3(new Vector3(-w / 2, -h / 2, 64), new Vector3(w / 2, h / 2, 64)), { seed, minFloors: 2, maxFloors: 6, alleys: seed % 3 === 0, roofProps: true });
      expect(r.buildings).toBeGreaterThan(0);
      for (const node of r.solids) doc.addSolid(node);
      for (const s of doc.allSolids()) {
        const faces = buildBrushFaces(s);
        expect(faces.length).toBe(s.sides.length);
        if (s.sides.length > 8) rounded++;
      }
      if (w >= 896 && h >= 896) courtyards++;
    }
    expect(rounded).toBeGreaterThan(0);
    expect(courtyards).toBeGreaterThan(0);
  });
});
