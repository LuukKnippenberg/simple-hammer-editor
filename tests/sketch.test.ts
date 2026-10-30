import { describe, expect, it } from 'vitest';
import { Feature, emptySketch, generateFromSketch, placeMarkers, sketchHeights, SKETCH_CELL } from '../src/gen/sketch.ts';
import { buildSolidChunks } from '../src/render/worldRenderer.ts';
import { solidBounds } from '../src/edit/brushes.ts';

describe('map sketch', () => {
  it('makes cliffs between levels and smooth ramps where painted', () => {
    const s = emptySketch(8, 4);
    // East half is level 2 (256 units up).
    for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) s.levels[y * 8 + x] = 2;
    // Row 0, cells 3..4: ramp across the step.
    s.ramps[0 * 8 + 3] = 1;
    s.ramps[0 * 8 + 4] = 1;
    const { W, heights } = sketchHeights(s);
    const at = (x: number, y: number) => heights[(y / 32) * W + x / 32];
    // Row 2 (no ramp): the drop happens within one 32-unit step at x = 512.
    expect(at(480, 320)).toBe(0);
    expect(at(512, 320)).toBe(256);
    // Row 0 (ramp from x = 384 to 640): rises steadily.
    const ramp = [384, 448, 512, 576, 640].map((x) => at(x, 64));
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThan(ramp[i - 1]);
    expect(ramp[0]).toBe(0);
    expect(ramp[4]).toBe(256);
  });

  it('generates a complete map with buildings on their level and markers as kits', () => {
    const s = emptySketch(16, 16);
    for (let y = 8; y < 16; y++) for (let x = 0; x < 16; x++) s.levels[y * 16 + x] = 1;
    for (let y = 10; y < 13; y++) for (let x = 2; x < 6; x++) s.features[y * 16 + x] = Feature.Building;
    for (let x = 8; x < 12; x++) s.features[4 * 16 + x] = Feature.Wall;
    s.markers.push({ kind: 'sp_start', x: 2, y: 2 }, { kind: 'zombies', x: 10, y: 10 }, { kind: 'capture_point', x: 12, y: 3 });
    const r = generateFromSketch(s);
    placeMarkers({ doc: r.doc }, s, r);
    for (const solid of r.doc.allSolids()) expect(buildSolidChunks(solid).chunks.size).toBeGreaterThan(0);
    const facade = r.doc.worldEntity.solids.filter((x) => x.sides.some((side) => side.material.startsWith('BUILDING_TEMPLATE')));
    expect(facade.length).toBeGreaterThan(0);
    // Buildings stand on level 1 (128 units up), sunk 32 units into the ground.
    expect(Math.min(...facade.map((x) => solidBounds(x).min.z))).toBe(128 - 32);
    const cls = (c: string) => r.doc.entities.filter((e) => e.classname === c).length;
    expect(cls('info_player_wars')).toBe(1);
    expect(cls('unit_zombie')).toBe(6);
    expect(cls('control_point')).toBe(1);
    expect(cls('func_map_boundary')).toBe(1);
    // Zombies stand on the upper level, grouped around the marker (cell 10,10 → 256,256 after centring).
    const zs = r.doc.entities.filter((e) => e.classname === 'unit_zombie');
    expect(Math.min(...zs.map((e) => e.origin!.z))).toBeGreaterThanOrEqual(128);
    const cx = zs.reduce((a, e) => a + e.origin!.x, 0) / zs.length, cy = zs.reduce((a, e) => a + e.origin!.y, 0) / zs.length;
    expect(Math.abs(cx - (10 * SKETCH_CELL - 8 * SKETCH_CELL))).toBeLessThan(40);
    expect(Math.abs(cy - (10 * SKETCH_CELL - 8 * SKETCH_CELL))).toBeLessThan(40);
  });
});
