import { describe, expect, it } from 'vitest';
import { emptySketch, Feature, generateFromSketch, SOFIA_GRID, streetGrid, Surface } from '../src/gen/sketch.ts';

describe('street grid', () => {
  it('lays out blocks between streets, boulevards with a planted median, and keeps POI ground clear', () => {
    const s = emptySketch(48, 48, 'city');
    s.pois = [{ type: 'square', x: 20, y: 20, w: 4, h: 4, seed: 1 }];
    streetGrid(s, { ...SOFIA_GRID, parks: 0 });
    const at = (x: number, y: number) => ({ f: s.features[y * s.w + x], s: s.surface[y * s.w + x] });
    // Row 0 starts with a block of 9 to 13 cells, then a street of 4 road cells.
    expect(at(0, 0).f).toBe(Feature.Building);
    let x = 0;
    while (at(x, 0).f === Feature.Building) x++;
    expect(x).toBeGreaterThanOrEqual(9);
    expect(x).toBeLessThanOrEqual(13);
    for (let k = 0; k < 4; k++) expect(at(x + k, 0).s).toBe(Surface.Road);
    expect(at(x + 4, 0).f).toBe(Feature.Building);
    // Some street is a boulevard: grass down its middle, with trees.
    expect(s.surface.some((v) => v === Surface.Grass)).toBe(true);
    expect(s.features.some((v) => v === Feature.Trees)).toBe(true);
    // Under the POI: no buildings, no road.
    for (let y = 20; y < 24; y++) for (let xx = 20; xx < 24; xx++) {
      expect(at(xx, y).f).toBe(Feature.None);
      expect(at(xx, y).s).not.toBe(Surface.Road);
    }
  });

  it('sofia streets park cars along wide carriageways and put bollards on wide pavements', () => {
    const s = emptySketch(32, 32, 'city');
    // One block either side of a 4-cell street running north–south.
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = y * s.w + x;
      if (x >= 14 && x < 18) s.surface[i] = Surface.Road;
      else if (x >= 4 && x < 12 && y >= 4 && y < 28) s.features[i] = Feature.Building;
    }
    const models = (sk: typeof s) => generateFromSketch(sk).doc.entities.map((e) => e.get('model') ?? '');
    const classic = models(s);
    s.streets = 'sofia';
    const sofia = models(s);
    expect(classic.filter((m) => m.includes('trainstation_post001'))).toHaveLength(0);
    expect(sofia.filter((m) => m.includes('trainstation_post001')).length).toBeGreaterThan(10);
    expect(sofia.filter((m) => m.includes('props_vehicles/car')).length).toBeGreaterThan(classic.filter((m) => m.includes('props_vehicles/car')).length);
  });
});
