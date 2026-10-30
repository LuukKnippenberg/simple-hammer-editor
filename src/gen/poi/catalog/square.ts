import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';

const FIELD = 'CONCRETE/CONCRETEFLOOR051A';
const BORDER = 'STONE/STONEFLOOR006A';
const STONE = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'STONE/STONEWALL017A' };
const BASIN = 'CONCRETE/CONCRETEFLOOR039A';
const PLANTER = { top: 'NATURE/DIRTFLOOR005C', bottom: NODRAW, sides: 'CONCRETE/CONCRETEWALL001A' };
const METAL = 'METAL/METALCOMBINE001';
const SCREEN = 'PROPS/COMBINE_DISPLAY01A';
const TREES = ['props_foliage/mall_tree_medium01', 'props_foliage/tree_deciduous_01a'];
const BENCH = 'props_trainstation/benchoutdoor01a';

/** Radius of each centre feature (the clear ring around it starts 96 further out). */
const FEATURE_R: Record<string, number> = { statue: 80, fountain: 160, breencast: 56, none: 0 };

function feature(k: PoiKit, kind: string, cx: number, cy: number): void {
  if (kind === 'statue') {
    k.box(rect(cx - 80, cy - 80, cx + 80, cy + 80), -8, 16, STONE, { occupy: true });
    k.box(rect(cx - 52, cy - 52, cx + 52, cy + 52), 16, 104, STONE);
    k.box(rect(cx - 60, cy - 60, cx + 60, cy + 60), 104, 112, STONE);
    k.prop('props_c17/gravestone_statue001a', cx, cy, 270, { z: 112, force: true });
  } else if (kind === 'fountain') {
    // A dry basin until water exists (POI phase 6 fills it): rim, floor, a column with a bowl.
    k.ring(cx, cy, 160, 140, -8, 28, STONE, 16);
    k.cylinder(cx, cy, 142, -8, -2, { top: BASIN, bottom: NODRAW, sides: NODRAW }, 16);
    k.cylinder(cx, cy, 24, -2, 72, STONE, 10);
    k.cylinder(cx, cy, 64, 72, 88, STONE, 12, 72);
    k.cylinder(cx, cy, 14, 88, 132, STONE, 8);
  } else if (kind === 'breencast') {
    k.box(rect(cx - 56, cy - 56, cx + 56, cy + 56), -8, 16, METAL, { occupy: true });
    k.cylinder(cx, cy, 12, 16, 288, METAL, 8);
    k.box(rect(cx - 52, cy - 52, cx + 52, cy + 52), 288, 352, { top: METAL, bottom: METAL, sides: SCREEN });
    k.box(rect(cx - 56, cy - 56, cx + 56, cy + 56), 352, 360, METAL);
  }
}

/**
 * A paved square: a cobbled border band, a tiled field, a centre feature (statue, dry fountain or a
 * Breencast screen) in an open ring, benches facing it, trees in planters and lamp posts round the edge.
 * Four routes lead from the middle of each side to the ring.
 */
export const SQUARE: PoiType = {
  id: 'square', label: 'Square', icon: '⛲', hint: 'Paved plaza around a monument: open killing ground with low cover at the edges.',
  landscapes: ['city'], minSize: [1024, 1024], maxSize: [3072, 3072], defaultSize: [1408, 1408],
  params: [
    { key: 'feature', label: 'Centre', type: 'select', default: 'statue', options: [
      { value: 'statue', label: 'Statue on a plinth' }, { value: 'fountain', label: 'Fountain' }, { value: 'breencast', label: 'Breencast screen' }, { value: 'none', label: 'Open' }] },
    { key: 'trees', label: 'Trees', type: 'check', default: true },
    { key: 'combine', label: 'Combine occupation', type: 'check', default: false, hint: 'Barricades at the corners and Combine flags' },
    { key: 'lights', label: 'Lights on', type: 'check', default: false },
    { key: 'capture', label: 'Capture point', type: 'check', default: true, hint: 'In the centre (replaces the centre feature)' },
  ],
  gameplay: { capture: true },
  build(k) {
    const { W, D } = k;
    const [cx, cy] = k.centre;
    const b = 96;
    k.pad(rect(b, b, W - b, D - b), FIELD);
    for (const r of [rect(0, 0, W, b), rect(0, D - b, W, D), rect(0, b, b, D - b), rect(W - b, b, W, D - b)]) k.pad(r, BORDER);
    const capture = k.flag('capture');
    const kind = capture ? 'none' : k.str('feature');
    const ring = Math.max(FEATURE_R[kind] ?? 0, 96) + 96;
    // Routes from each side to the open ring; the ring itself stays clear.
    k.route([0, cy], [cx - ring, cy]);
    k.route([cx + ring, cy], [W, cy]);
    k.route([cx, 0], [cx, cy - ring]);
    k.route([cx, cy + ring], [cx, D]);
    k.keepClear(rect(cx - ring, cy - ring, cx + ring, cy + ring));
    feature(k, kind, cx, cy);
    // Benches at the corners of the open ring, two per corner, facing the centre.
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      k.prop(BENCH, cx + sx * (ring + 48), cy + sy * (ring - 56), sx > 0 ? 180 : 0);
      k.prop(BENCH, cx + sx * (ring - 56), cy + sy * (ring + 48), sy > 0 ? 270 : 90);
    }
    if (k.flag('combine')) {
      const corners: [number, number, number][] = [[b + 72, b + 72, 45], [W - b - 72, b + 72, 135], [W - b - 72, D - b - 72, 225], [b + 72, D - b - 72, 315]];
      for (const [x, y, a] of corners) {
        const rad = (a * Math.PI) / 180;
        k.prop('props_combine/combine_barricade_med02a', x + Math.cos(rad) * 60, y + Math.sin(rad) * 60, a + 90);
        k.prop('props_combine/combine_barricade_short02a', x + Math.cos(rad + 1.2) * 110, y + Math.sin(rad + 1.2) * 110, a);
        k.prop('props_combine/combine_barricade_short02a', x + Math.cos(rad - 1.2) * 110, y + Math.sin(rad - 1.2) * 110, a + 180);
      }
      for (const [x, y] of [[cx - ring - 72, cy + ring + 72], [cx + ring + 72, cy - ring - 72]]) k.prop('pg_props/pg_buildings/other/pg_flagpole/pg_flagpole_combine', x, y, 0);
    }
    // Planters with trees in each quadrant, on a grid that keeps away from the ring and the routes.
    if (k.flag('trees')) {
      const step = 320;
      for (let x = b + 128; x <= W - b - 128; x += step) for (let y = b + 128; y <= D - b - 128; y += step) {
        const pr = rect(x - 56, y - 56, x + 56, y + 56);
        if (!k.isFree(rect(pr.x0 - 40, pr.y0 - 40, pr.x1 + 40, pr.y1 + 40), 24)) continue;
        k.box(pr, -8, 20, PLANTER, { occupy: true });
        k.prop(k.rng.pick(TREES), x, y, k.rng.int(0, 359), { z: 20, force: true, noOccupy: true });
      }
    }
    // Lamp posts round the edge on the border band, arms over the square.
    const lamps: [number, number, number][] = [];
    for (let x = 160; x <= W - 160; x += 384) lamps.push([x, b / 2, 90], [W - x, D - b / 2, 270]);
    for (let y = 160 + 192; y <= D - 160 - 192; y += 384) lamps.push([b / 2, y, 0], [W - b / 2, D - y, 180]);
    for (const [x, y, f] of lamps) k.lamp(x, y, f);
    k.gameplay([cx, cy]);
  },
};
