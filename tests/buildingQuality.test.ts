import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { generateBuildings, type BuildingOptions } from '../src/gen/buildings.ts';
import { blockQuality, emptySketch, Feature, sketchBlocks } from '../src/gen/sketch.ts';

const block = new Box3(new Vector3(0, 0, 0), new Vector3(1280, 1152, 0));
const opts = (o: Partial<BuildingOptions>): BuildingOptions => ({ seed: 7, minFloors: 3, maxFloors: 6, alleys: false, roofProps: true, architecture: 'mixed', interiors: 'some', ...o });
const build = (o: Partial<BuildingOptions>) => generateBuildings(VmfDocument.empty(), block, opts(o));

describe('building quality', () => {
  it('builds less decoration at lower qualities, on the same layout', () => {
    const high = build({ quality: 'high' }), medium = build({ quality: 'medium' }), filler = build({ quality: 'filler' });
    expect(high.buildings).toBe(filler.buildings);
    expect(medium.detail.length).toBeLessThan(high.detail.length);
    expect(filler.detail.length).toBeLessThan(medium.detail.length);
    // Medium is detail 1 whatever the detail setting; high keeps the setting.
    expect(build({ quality: 'medium', detail: 3 }).detail.length).toBe(medium.detail.length);
    expect(build({ detail: 2 }).detail.length).toBe(high.detail.length);
  });

  it('leaves out enterable houses below high', () => {
    const all = (q: BuildingOptions['quality']) => build({ quality: q, interiors: 'all', architecture: 'village' });
    expect(all('high').interiorHouses).toBeGreaterThan(0);
    expect(all('medium').interiorHouses).toBe(0);
    expect(all('filler').interiorHouses).toBe(0);
  });
});

describe('sketch detail', () => {
  const sketch = () => {
    const s = emptySketch(40, 40, 'city');
    for (const [x0, y0] of [[2, 2], [30, 30], [8, 2]]) for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) s.features[y * s.w + x] = Feature.Building;
    s.markers.push({ kind: 'sp_start', x: 1, y: 1 });
    return s;
  };

  it('is high everywhere unless set to auto', () => {
    expect(sketchBlocks(sketch()).every((b) => b.quality === 'high')).toBe(true);
  });

  it('auto: high near markers and POIs, medium a little further, filler far away', () => {
    const s = sketch();
    s.buildingDetail = 'auto';
    const q = (x: number, y: number) => sketchBlocks(s).find((b) => b.x0 === x && b.y0 === y)!.quality;
    expect(q(2, 2)).toBe('high');
    expect(q(8, 2)).toBe('medium');
    expect(q(30, 30)).toBe('filler');
    s.pois = [{ type: 'square', x: 26, y: 26, w: 3, h: 3, seed: 1 }];
    expect(q(30, 30)).toBe('high');
  });

  it('paint wins over auto, and the most detailed paint on a block counts', () => {
    const s = sketch();
    s.buildingDetail = 'auto';
    s.quality = new Array(s.w * s.h).fill(0);
    s.quality[2 * s.w + 2] = 3;
    expect(blockQuality(s, 2, 2, 6, 6)).toBe('filler');
    s.quality[31 * s.w + 31] = 3;
    s.quality[32 * s.w + 32] = 2;
    expect(blockQuality(s, 30, 30, 34, 34)).toBe('medium');
  });
});
