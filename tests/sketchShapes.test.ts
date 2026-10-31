import { describe, expect, it } from 'vitest';
import { Box2, Box3, Vector2, Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { decodeCuts, ellipsePoints, encodeCuts, areaPolygon, insideDistance, shapeCuts, shapeRoads, type SketchShape } from '../src/gen/sketchShapes.ts';
import { cutPlan, generateBuildings } from '../src/gen/buildings.ts';
import { planBlock } from '../src/gen/buildingPlan.ts';
import { Rng } from '../src/gen/rng.ts';
import { emptySketch, Feature, generateFromSketch } from '../src/gen/sketch.ts';
import { roadOf } from '../src/gen/roads.ts';
import { solidBounds } from '../src/edit/brushes.ts';

const diagonal: SketchShape = { kind: 'street', points: [[0, 0], [16, 16]], width: 256, pavement: 64 };

describe('free shapes', () => {
  it('makes roads and cut polygons from streets, convex polygons from areas', () => {
    const [r] = shapeRoads([diagonal, { kind: 'area', points: ellipsePoints(2, 2, 8, 6), surface: 'grass' }], 128, () => 0);
    expect(r.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [2048, 2048]]);
    const cuts = shapeCuts([diagonal], 128);
    expect(cuts).toHaveLength(1);
    // The cut is the street with kerbs, pavements and a margin: 128 + 64 + 8 + 16 from the centre line.
    expect(insideDistance(cuts[0], 1024 + 150, 1024 - 150)).toBeGreaterThan(0);
    expect(insideDistance(cuts[0], 1024 + 160, 1024 - 160)).toBeLessThan(0);
    // An ellipse is a convex, counter-clockwise outline.
    const poly = areaPolygon({ kind: 'area', points: ellipsePoints(0, 0, 10, 6), surface: 'paved' }, 128);
    expect(poly.length).toBe(20);
    expect(insideDistance(poly, 640, 384)).toBeGreaterThan(300);
    // Cuts survive the building option string.
    expect(decodeCuts(encodeCuts(cuts)).map((c) => c.map((p) => [p.x, p.y]))).toEqual(cuts.map((c) => c.map((p) => [Math.round(p.x), Math.round(p.y)])));
  });

  it('cuts a block plan along a diagonal street', () => {
    const area = new Box2(new Vector2(0, 0), new Vector2(1280, 1280));
    const plan = planBlock(area, new Rng(4), { minFloors: 3, maxFloors: 4, alleys: false, corners: 'square', courtyards: true, annexes: true });
    const cuts = shapeCuts([{ kind: 'street', points: [[-2, 12], [12, -2]], width: 256, pavement: 64 }], 128);
    cutPlan(plan, cuts);
    expect(plan.buildings.length).toBeGreaterThan(0);
    for (const b of plan.buildings) for (const part of b.parts) for (const p of part.poly) {
      // Nothing inside the street's cut (within rounding).
      expect(insideDistance(cuts[0], p.x, p.y)).toBeLessThan(2);
    }
    // Some building got a slanted wall along the street.
    const slanted = plan.buildings.some((b) => b.parts[0].poly.some((p, i, a) => { const q = a[(i + 1) % a.length]; return Math.abs(p.x - q.x) > 8 && Math.abs(p.y - q.y) > 8; }));
    expect(slanted).toBe(true);
  });

  it('builds a block with a slanted street front', () => {
    const cuts = shapeCuts([{ kind: 'street', points: [[-2, 12], [12, -2]], width: 256, pavement: 64 }], 128);
    const out = generateBuildings(VmfDocument.empty(), new Box3(new Vector3(0, 0, 0), new Vector3(1280, 1280, 0)), { seed: 3, minFloors: 3, maxFloors: 4, alleys: false, roofProps: false, cut: encodeCuts(cuts) });
    expect(out.buildings).toBeGreaterThan(0);
    expect(out.solids.length + out.detail.length).toBeGreaterThan(20);
  });

  it('generates a sketch with a diagonal street and a round lawn', () => {
    const s = emptySketch(20, 20, 'city');
    for (let i = 0; i < 400; i++) s.features[i] = Feature.Building;
    s.shapes = [{ kind: 'street', points: [[0, 10], [20, 18]], width: 256, pavement: 64, radius: 0 }, { kind: 'area', points: ellipsePoints(2, 1, 10, 7), surface: 'grass' }];
    const r = generateFromSketch(s);
    const roads = r.doc.entities.map((e) => roadOf(e)).filter(Boolean);
    expect(roads.some((q) => q!.points.length === 2 && Math.abs(q!.points[1].y - q!.points[0].y) > 500)).toBe(true);
    // No building stands in the lawn (the generator builds in layout space; the cuts must follow).
    const c = new Vector3(6 * 128 - 1280, 4 * 128 - 1280, 0);
    const tall = r.doc.allSolids().filter((q) => { const b = solidBounds(q); return !q.sides.every((x) => x.material.startsWith('TOOLS/')) && b.max.z > 160 && b.min.x < c.x && b.max.x > c.x && b.min.y < c.y && b.max.y > c.y; });
    expect(tall).toHaveLength(0);
    // The edging ring round the lawn.
    expect(r.doc.entities.some((e) => e.classname === 'func_detail' && e.solids.length >= 20 && e.solids.some((q) => q.sides.some((side) => side.material === 'STONE/STONEWALL017A')))).toBe(true);
  });
});
