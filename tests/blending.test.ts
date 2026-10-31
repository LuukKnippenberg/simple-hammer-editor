import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { dressEdges, surfaceEdges } from '../src/gen/surfaceEdges.ts';
import { emptySketch, generateFromSketch, Surface, sketchPoiPlacements } from '../src/gen/sketch.ts';
import { buildPoi, newSpec, poiType } from '../src/gen/poi/registry.ts';
import { Rng } from '../src/gen/rng.ts';
import '../src/gen/poi/catalogue.ts';

describe('blending generated parts in', () => {
  it('finds the boundaries between lawn and paving, merged into runs', () => {
    // A 4 × 2 lawn in a 8 × 6 square of paving.
    const lawn = (x: number, y: number) => x >= 2 && x < 6 && y >= 2 && y < 4;
    const edges = surfaceEdges(8, 6, 128, lawn, (x, y) => !lawn(x, y), () => false);
    expect(edges).toHaveLength(4);
    const south = edges.find((e) => e.axis === 'x' && e.at === 256)!;
    expect([south.from, south.to, south.soft]).toEqual([256, 768, 1]);
    const east = edges.find((e) => e.axis === 'y' && e.at === 768)!;
    expect(east.soft).toBe(-1);
    // Cells to skip break the runs.
    expect(surfaceEdges(8, 6, 128, lawn, (x, y) => !lawn(x, y), (x) => x === 3).length).toBeGreaterThan(4);
  });

  it('edges them with stone and lays wear over them on the terrain faces', () => {
    const doc = VmfDocument.empty();
    const edges = surfaceEdges(8, 6, 128, (_x, y) => y >= 3, (_x, y) => y < 3, () => false);
    const d = dressEdges(doc, edges, () => 0, () => '42', new Vector3(-100, -100, 0), new Rng(3), { every: 200 });
    expect(d.brushes.length).toBe(2);
    expect(d.overlays.length).toBeGreaterThan(2);
    const o = d.overlays[0];
    expect(o.get('sides')).toBe('42');
    // The basis is in world space (shifted), the origin in layout space (finishDoc shifts it).
    const [bx] = o.get('BasisOrigin')!.split(' ').map(Number);
    const [ox] = o.get('origin')!.split(' ').map(Number);
    expect(Math.round(bx - ox)).toBe(-100);
  });

  it('lets POIs on paving take the paving', () => {
    const s = emptySketch(20, 20, 'city');
    s.pois = [{ type: 'parking', x: 2, y: 2, w: 10, h: 8, seed: 1 }, { type: 'park', x: 2, y: 11, w: 12, h: 9, seed: 2, params: { ground: 'own' } }];
    for (let y = 11; y < 20; y++) for (let x = 0; x < 20; x++) s.surface[y * 20 + x] = Surface.Grass;
    const [lot, park] = sketchPoiPlacements(s);
    expect(lot.params?.ground).toBe('paving');
    expect(park.params?.ground).toBe('own');
    const spec = newSpec(poiType('parking')!, { x0: 0, y0: 0, x1: 1280, y1: 1024 }, 0, { seed: 1, params: { ground: 'paving' } });
    const out = buildPoi(VmfDocument.empty(), spec);
    const mats = out.detail.flatMap((n) => n.childrenNamed('side').map((q) => q.get('material')));
    expect(mats).toContain('STONE/STONEFLOOR006D');
    expect(mats).not.toContain('CONCRETE/CONCRETEFLOOR033A');
    // Fuller rows than before, and no wrecks on a kept lot.
    const cars = out.entities.filter((e) => /props_vehicles/.test(e.keys.model ?? ''));
    expect(cars.length).toBeGreaterThanOrEqual(8); // of 12 bays
    expect(cars.some((e) => /car00[2-5]b/.test(e.keys.model ?? ''))).toBe(false);
  });

  it('edges a lawn on a square with a sketch boundary', () => {
    const s = emptySketch(16, 12, 'city');
    for (let y = 4; y < 8; y++) for (let x = 4; x < 12; x++) s.surface[y * 16 + x] = Surface.Grass;
    const r = generateFromSketch(s);
    expect(r.doc.entities.filter((e) => e.classname === 'info_overlay').length).toBeGreaterThan(4);
    const edging = r.doc.entities.find((e) => e.classname === 'func_detail' && e.solids.some((q) => q.sides.some((side) => side.material === 'STONE/STONEWALL017A')));
    expect(edging).toBeTruthy();
  });
});
