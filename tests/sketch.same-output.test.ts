// Characterization test for the KISS refactor (research/editor-kiss-plan.md). Delete after K10.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { emptySketch, Feature, generateFromSketch, SOFIA_GRID, streetGrid, Surface, type GridOptions, type Sketch } from '../src/gen/sketch.ts';
import { buildDistrictSketch } from '../src/examples/district.ts';
import { buildGardenSketch } from '../src/examples/gardenDistrict.ts';

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');

/** The sketches in tests/sketch.test.ts, tests/blending.test.ts and tests/streetGrid.test.ts, plus a rural one. */
const SKETCHES: Record<string, () => Sketch> = {
  district: buildDistrictSketch,
  garden: buildGardenSketch,
  levels: () => {
    const sketch = emptySketch(16, 16);
    for (let y = 8; y < 16; y++) for (let x = 0; x < 16; x++) sketch.levels[y * 16 + x] = 1;
    for (let y = 10; y < 13; y++) for (let x = 2; x < 6; x++) sketch.features[y * 16 + x] = Feature.Building;
    for (let x = 8; x < 12; x++) sketch.features[4 * 16 + x] = Feature.Wall;
    sketch.markers.push({ kind: 'sp_start', x: 2, y: 2 }, { kind: 'zombies', x: 10, y: 10 }, { kind: 'capture_point', x: 12, y: 3 });
    return sketch;
  },
  lawn: () => {
    const sketch = emptySketch(16, 12, 'city');
    for (let y = 4; y < 8; y++) for (let x = 4; x < 12; x++) sketch.surface[y * 16 + x] = Surface.Grass;
    return sketch;
  },
  street: () => streetSketch(),
  sofiaStreet: () => ({ ...streetSketch(), streets: 'sofia' }),
  // Not in the other tests: the countryside, ramps, every prop feature (cars on and off the road) and hills.
  rural: () => {
    const sketch = emptySketch(20, 16, 'rural');
    sketch.seed = 77;
    for (let y = 0; y < 16; y++) for (let x = 12; x < 20; x++) sketch.levels[y * 20 + x] = 1;
    for (let y = 0; y < 3; y++) for (let x = 11; x < 13; x++) sketch.ramps[y * 20 + x] = 1;
    for (let x = 0; x < 20; x++) for (let y = 6; y < 8; y++) sketch.surface[y * 20 + x] = Surface.Road;
    for (let x = 0; x < 20; x++) sketch.features[6 * 20 + x] = Feature.Cars;
    for (let y = 9; y < 14; y++) for (let x = 1; x < 6; x++) sketch.features[y * 20 + x] = (x + y) % 3 === 0 ? Feature.Trees : (x + y) % 3 === 1 ? Feature.Rubble : Feature.Cars;
    for (let y = 1; y < 4; y++) for (let x = 2; x < 6; x++) { sketch.features[y * 20 + x] = Feature.Building; sketch.surface[y * 20 + x] = Surface.Dirt; }
    for (let y = 10; y < 13; y++) sketch.features[y * 20 + 15] = Feature.Wall;
    sketch.surroundings = { style: 'hills', sides: { n: 'city', w: 'wall' } };
    return sketch;
  },
};

function streetSketch(): Sketch {
  const sketch = emptySketch(32, 32, 'city');
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = y * sketch.w + x;
    if (x >= 14 && x < 18) sketch.surface[i] = Surface.Road;
    else if (x >= 4 && x < 12 && y >= 4 && y < 28) sketch.features[i] = Feature.Building;
  }
  return sketch;
}

const SKETCH_HASHES: Record<string, string> = {
  district: '13965bb6a00c036499d8e20674a0f53c84ce7b35',
  garden: 'dfaee813d21e36c7c7026d1c9fabe2d4ca59d85e',
  levels: 'c13712ecb0277a515e49f28dd1dbb29d84d1b640',
  lawn: '03e6c3fac6b05e858097a09ccc182763926543a8',
  street: '2a8a0f85c1f010af6def00b107b4b81490b9b9ca',
  sofiaStreet: '5e4acb9d21cf16653015345072afded49206ed94',
  rural: '6d2fde935f10ab85d78b159c1e4f61e9b87554f9',
};

const GRIDS: Record<string, [() => Sketch, GridOptions]> = {
  poiNoParks: [() => { const sketch = emptySketch(48, 48, 'city'); sketch.pois = [{ type: 'square', x: 20, y: 20, w: 4, h: 4, seed: 1 }]; return sketch; }, { ...SOFIA_GRID, parks: 0 }],
  sofia: [() => emptySketch(48, 40, 'city'), SOFIA_GRID],
  ruralParks: [() => emptySketch(30, 36, 'rural'), { block: 7, street: 2, boulevard: 5, every: 2, parks: 0.5, seed: 9 }],
};

const GRID_HASHES: Record<string, string> = {
  poiNoParks: '083b6bc783ab28401a8ef94681bce19e46d1f7ef',
  sofia: '781b7e1468a26fd3406e635ff2822ada00701ee4',
  ruralParks: '6a29a52488e3102ff052a73cb04d2cc8ec81eb19',
};

describe('sketch generator output (characterization)', () => {
  it.each(Object.keys(SKETCHES))('generateFromSketch(%s) is unchanged', (name) => {
    const result = generateFromSketch(SKETCHES[name]());
    const hash = sha1(result.doc.serialize() + JSON.stringify({ poiLevels: result.poiLevels, shift: result.shift.toArray() }));
    expect(hash).toBe(SKETCH_HASHES[name]);
  });

  it.each(Object.keys(GRIDS))('streetGrid(%s) is unchanged', (name) => {
    const [make, options] = GRIDS[name];
    const sketch = make();
    streetGrid(sketch, options);
    const hash = sha1(JSON.stringify(sketch));
    expect(hash).toBe(GRID_HASHES[name]);
  });
});
