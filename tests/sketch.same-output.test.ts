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
    const s = emptySketch(16, 16);
    for (let y = 8; y < 16; y++) for (let x = 0; x < 16; x++) s.levels[y * 16 + x] = 1;
    for (let y = 10; y < 13; y++) for (let x = 2; x < 6; x++) s.features[y * 16 + x] = Feature.Building;
    for (let x = 8; x < 12; x++) s.features[4 * 16 + x] = Feature.Wall;
    s.markers.push({ kind: 'sp_start', x: 2, y: 2 }, { kind: 'zombies', x: 10, y: 10 }, { kind: 'capture_point', x: 12, y: 3 });
    return s;
  },
  lawn: () => {
    const s = emptySketch(16, 12, 'city');
    for (let y = 4; y < 8; y++) for (let x = 4; x < 12; x++) s.surface[y * 16 + x] = Surface.Grass;
    return s;
  },
  street: () => streetSketch(),
  sofiaStreet: () => ({ ...streetSketch(), streets: 'sofia' }),
  // Not in the other tests: the countryside, ramps, every prop feature (cars on and off the road) and hills.
  rural: () => {
    const s = emptySketch(20, 16, 'rural');
    s.seed = 77;
    for (let y = 0; y < 16; y++) for (let x = 12; x < 20; x++) s.levels[y * 20 + x] = 1;
    for (let y = 0; y < 3; y++) for (let x = 11; x < 13; x++) s.ramps[y * 20 + x] = 1;
    for (let x = 0; x < 20; x++) for (let y = 6; y < 8; y++) s.surface[y * 20 + x] = Surface.Road;
    for (let x = 0; x < 20; x++) s.features[6 * 20 + x] = Feature.Cars;
    for (let y = 9; y < 14; y++) for (let x = 1; x < 6; x++) s.features[y * 20 + x] = (x + y) % 3 === 0 ? Feature.Trees : (x + y) % 3 === 1 ? Feature.Rubble : Feature.Cars;
    for (let y = 1; y < 4; y++) for (let x = 2; x < 6; x++) { s.features[y * 20 + x] = Feature.Building; s.surface[y * 20 + x] = Surface.Dirt; }
    for (let y = 10; y < 13; y++) s.features[y * 20 + 15] = Feature.Wall;
    s.surroundings = { style: 'hills', sides: { n: 'city', w: 'wall' } };
    return s;
  },
};

function streetSketch(): Sketch {
  const s = emptySketch(32, 32, 'city');
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = y * s.w + x;
    if (x >= 14 && x < 18) s.surface[i] = Surface.Road;
    else if (x >= 4 && x < 12 && y >= 4 && y < 28) s.features[i] = Feature.Building;
  }
  return s;
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
  poiNoParks: [() => { const s = emptySketch(48, 48, 'city'); s.pois = [{ type: 'square', x: 20, y: 20, w: 4, h: 4, seed: 1 }]; return s; }, { ...SOFIA_GRID, parks: 0 }],
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
    const r = generateFromSketch(SKETCHES[name]());
    const hash = sha1(r.doc.serialize() + JSON.stringify({ poiLevels: r.poiLevels, shift: r.shift.toArray() }));
    expect(hash).toBe(SKETCH_HASHES[name]);
  });

  it.each(Object.keys(GRIDS))('streetGrid(%s) is unchanged', (name) => {
    const [make, o] = GRIDS[name];
    const s = make();
    streetGrid(s, o);
    const hash = sha1(JSON.stringify(s));
    expect(hash).toBe(GRID_HASHES[name]);
  });
});
