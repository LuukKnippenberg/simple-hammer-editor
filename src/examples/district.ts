/**
 * "City 17 district" – a test map for the building generator: a grid of pre-war tenement blocks with
 * courtyards, rounded and cut corners, towers, mansards, oriels, balconies, cables across the streets,
 * lamps and bare trees, around a paved square. A two-player skirmish: starts in opposite corners, capture
 * points on the square and at two crossings, scrap in the side streets.
 *
 * Grid: 40×40 cells of 128 units; blocks are 8 cells (1024 units) with 2-cell (256-unit) streets.
 */
import { Feature, Surface, emptySketch, type Sketch, type SketchMarker } from '../gen/sketch.ts';
import type { ParamValue } from '../lw/kits.ts';

const N = 40;
const BLOCKS = [1, 11, 21, 31];
const m = (kind: SketchMarker['kind'], x: number, y: number, params?: Record<string, ParamValue>): SketchMarker => ({ kind, x, y, params });

export function buildDistrictSketch(): Sketch {
  const s = emptySketch(N, N, 'city');
  s.seed = 1717;
  s.floors = [3, 6];
  s.architecture = 'tenement';
  const fill = (x0: number, y0: number, x1: number, y1: number, f: (i: number) => void) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) f(y * N + x);
  };
  // Streets are road (asphalt with kerbs and pavements); the ground under the blocks cobble.
  fill(0, 0, N - 1, N - 1, (i) => (s.surface[i] = Surface.Road));
  for (const bx of BLOCKS) {
    for (const by of BLOCKS) {
      const square = (bx === 11 || bx === 21) && (by === 11 || by === 21);
      if (square) continue;
      fill(bx, by, bx + 7, by + 7, (i) => (s.surface[i] = Surface.Paved));
      // Some blocks split in two by a lane, for row houses and alleys.
      if ((bx === 31 && by === 11) || (bx === 1 && by === 21)) {
        fill(bx, by, bx + 7, by + 2, (i) => (s.features[i] = Feature.Building));
        fill(bx, by + 4, bx + 7, by + 7, (i) => (s.features[i] = Feature.Building));
      } else {
        fill(bx, by, bx + 7, by + 7, (i) => (s.features[i] = Feature.Building));
      }
    }
  }
  // The square: paving, a ring of trees, rubble where a building came down.
  fill(11, 11, 28, 28, (i) => (s.surface[i] = Surface.Paved));
  for (let k = 12; k <= 27; k += 3) {
    for (const [x, y] of [[k, 12], [k, 27], [12, k], [27, k]]) s.features[y * N + x] = Feature.Trees;
  }
  fill(18, 18, 21, 21, (i) => (s.surface[i] = Surface.Rubble));
  s.features[19 * N + 19] = Feature.Rubble;
  s.features[20 * N + 21] = Feature.Rubble;
  // Parked cars in the side streets.
  for (const x of [5, 15, 25, 35]) { s.features[9 * N + x] = Feature.Cars; s.features[30 * N + x] = Feature.Cars; }

  s.markers = [
    m('mp_start', 4.5, 0.5, { yaw: 90 }),
    m('mp_start', 35.5, 39.5, { yaw: 270 }),
    m('capture_point', 19.5, 19.5, { name: 'square', radius: 256 }),
    m('capture_point', 9.5, 29.5, { name: 'west_crossing', radius: 192 }),
    m('capture_point', 29.5, 9.5, { name: 'east_crossing', radius: 192 }),
    m('scrap', 19.5, 4.5), m('scrap', 19.5, 35.5), m('scrap', 4.5, 19.5), m('scrap', 35.5, 19.5),
  ];
  return s;
}
