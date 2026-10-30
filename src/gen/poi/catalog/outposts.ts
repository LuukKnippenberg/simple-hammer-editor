import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';
import { breencast } from './combine.ts';

const DIRT = 'NATURE/DIRTFLOOR003A';
const SAWDUST = 'NATURE/DIRTFLOOR008A';
const BARK = 'WOOD/WOODBEAM001A';
const SHED = { top: 'METAL/METALROOF005A', bottom: 'WOOD/WOODWALL009A', sides: 'WOOD/WOODWALL009A' };
const POST = { top: 'WOOD/WOODBEAM001A', bottom: NODRAW, sides: 'WOOD/WOODBEAM001A' };
const METAL = { top: 'METAL/METALCOMBINE001', bottom: NODRAW, sides: 'METAL/METALCOMBINE001' };
const CONCRETE = 'CONCRETE/CONCRETEFLOOR001A';

/** A pile of logs lying along local x: rows of logs stacked in a pyramid. */
function logPile(k: PoiKit, x0: number, x1: number, y: number, rows: number, r = 14): void {
  for (let row = 0; row < rows; row++) {
    const n = rows - row;
    for (let i = 0; i < n; i++) {
      const at = y + (i - (n - 1) / 2) * r * 2;
      k.log('x', x0 + k.rng.range(-8, 8), x1 + k.rng.range(-8, 8), at, r, BARK, row * r * 1.7);
    }
  }
  k.occupied.push(rect(x0 - 12, y - rows * r - 4, x1 + 12, y + rows * r + 4));
}

/**
 * A logging camp in a forest clearing: log piles in lines (cover), an open sawmill shed over a saw bench, a
 * truck, stumps and fallen trees, a fire and crates. Pines round the edge.
 */
export const LOGGING: PoiType = {
  id: 'logging', label: 'Logging camp', icon: '🪓', hint: 'Lines of cover (log piles) in a forest clearing.',
  landscapes: ['forest'], minSize: [1152, 1024], maxSize: [3072, 3072], defaultSize: [1536, 1280],
  params: [
    { key: 'piles', label: 'Log piles', type: 'number', default: 4 },
    { key: 'trees', label: 'Forest round it', type: 'check', default: true },
  ],
  gameplay: { capture: true, scrap: true, units: ['zombie', 'rebel'] },
  build(k) {
    const { W, D } = k;
    k.pad(rect(192, 192, W - 192, D - 192), DIRT, 2);
    k.route([0, D * 0.5], [W, D * 0.5]);
    k.route([W * 0.62, 0], [W * 0.62, D]);
    // The sawmill shed: posts, a roof, a long bench with a log on it and sawdust round it.
    const s = rect(240, D * 0.5 + 112, 240 + 448, D * 0.5 + 112 + 256);
    k.pad(rect(s.x0 - 32, s.y0 - 32, s.x1 + 32, s.y1 + 32), SAWDUST, 3);
    for (const x of [s.x0, (s.x0 + s.x1) / 2, s.x1]) for (const y of [s.y0, s.y1]) k.box(rect(x - 6, y - 6, x + 6, y + 6), -4, y === s.y0 ? 160 : 176, POST);
    k.slope(rect(s.x0 - 16, s.y0 - 16, s.x1 + 16, s.y1 + 16), 'y', 156, 180, 5, SHED);
    k.box(rect(s.x0 + 48, (s.y0 + s.y1) / 2 - 24, s.x1 - 48, (s.y0 + s.y1) / 2 + 24), -4, 36, { top: 'WOOD/WOODFLOOR005A', bottom: NODRAW, sides: 'WOOD/WOODWALL009A' });
    k.log('x', s.x0 + 64, s.x1 - 64, (s.y0 + s.y1) / 2, 12, BARK, 36);
    k.occupied.push(s);
    // Log piles in lines on the other side of the road: slots in rows, filled until there are enough.
    const piles = Math.max(0, Math.min(8, Math.round(k.num('piles', 4))));
    const slots: [number, number, number][] = [];
    for (let y = 224; y + 64 <= D * 0.5 - 96; y += 192) {
      for (let x = 224; x < W - 224;) {
        const len = k.rng.int(4, 7) * 48;
        if (x + len > W - 224) break;
        slots.push([x, y, len]);
        x += len + 128;
      }
    }
    let made = 0;
    for (const [x0, y, len] of slots.map((q) => [k.rng.next(), q] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1])) {
      if (made >= piles) break;
      if (!k.isFree(rect(x0 - 24, y - 64, x0 + len + 24, y + 64), 16)) continue;
      logPile(k, x0, x0 + len, y, k.rng.int(2, 3));
      made++;
    }
    k.prop(k.rng.pick(['props_vehicles/truck001a', 'props_vehicles/trailer002a']), W - 360, D * 0.5 + 280, k.rng.range(80, 100), { margin: 24 });
    k.scatter(['props_foliage/tree_stump01'], rect(96, 96, W - 96, D - 96), 6, { margin: 16 });
    k.scatter(['props_foliage/fallentree01', 'props_foliage/fallentree_dry01'], rect(96, 96, W - 96, D - 96), 2, { margin: 24 });
    k.scatter(['props_junk/wood_crate001a_static', 'props_c17/oildrum001_static', 'props_forest/footlocker01_closed', 'props_junk/wood_pallet001a_static'], rect(192, 192, W - 192, D - 192), 6, { margin: 12 });
    if (k.flag('trees')) {
      // Pines round the edge, outside the clearing.
      for (let t = 0, n = 0; t < 80 && n < Math.round((W + D) / 160); t++) {
        const edge = k.rng.int(0, 3);
        const x = edge === 0 ? k.rng.range(48, 168) : edge === 1 ? k.rng.range(W - 168, W - 48) : k.rng.range(48, W - 48);
        const y = edge >= 2 ? (edge === 2 ? k.rng.range(48, 168) : k.rng.range(D - 168, D - 48)) : k.rng.range(48, D - 48);
        if (k.prop(k.rng.pick(['props_foliage/tree_pine04', 'props_foliage/tree_pine05', 'props_foliage/tree_pine06']), x, y, k.rng.int(0, 359), { margin: 40 })) n++;
      }
    }
    k.gameplay([W * 0.62 + 200, D * 0.5 - 200]);
  },
};

/**
 * A Combine power node: a generator compound behind Combine fences with one gate, the Lambda Wars power
 * generator in the middle on a metal plinth, smaller generators, cables, floodlights and a Breencast screen.
 * An objective to destroy or hold.
 */
export const POWERNODE: PoiType = {
  id: 'powernode', label: 'Combine power node', icon: '⚡', hint: 'An objective to destroy: generators behind Combine fences.',
  landscapes: ['forest', 'city', 'rocky'], minSize: [896, 896], maxSize: [2048, 2048], defaultSize: [1152, 1152],
  params: [
    { key: 'lights', label: 'Lights on', type: 'check', default: true },
  ],
  gameplay: { capture: true, units: ['combine', 'combine_elite', 'metropolice'] },
  build(k) {
    const { W, D } = k;
    const [cx, cy] = k.centre;
    k.pad(rect(96, 96, W - 96, D - 96), CONCRETE, 2);
    // One way in: the gate on the south side, a route up to the plinth.
    k.route([cx, 0], [cx, cy - 192]);
    k.route([96 + 64, 96 + 64], [W - 160, 96 + 64]);
    // The plinth (16 high) and the generator on it.
    k.box(rect(cx - 160, cy - 160, cx + 160, cy + 160), -4, 16, METAL, { occupy: true });
    k.prop('pg_props/pg_buildings/combine/pg_combine_power_generator', cx, cy, 0, { z: 16, force: true });
    k.prop('props_combine/combine_generator01', cx - 112, cy + 112, 225, { z: 16, force: true });
    k.prop('props_combine/combine_generator01', cx + 112, cy + 112, 315, { z: 16, force: true });
    // Cables from the generator to smaller units in the corners, and those units.
    for (const [x, y, yaw] of [[200, D - 200, 45], [W - 200, D - 200, 135]] as [number, number, number][]) {
      k.prop('props_combine/combine_generator01', x, y, yaw, { margin: 16 });
      k.extrude([[-6, 0], [6, 0], [6, 6], [-6, 6]].map(([c, h]) => [c + (y + cy) / 2, h]) as [number, number][], 'x', Math.min(x, cx), Math.max(x, cx), METAL);
    }
    // Floodlights at the corners of the compound and a Breencast screen by the gate.
    for (const [x, y, yaw] of [[160, 160, 45], [W - 160, 160, 135], [W - 160, D - 160, 225], [160, D - 160, 315]] as [number, number, number][]) {
      k.prop('props_combine/combine_light001a', x, y, yaw, { margin: 4 });
      if (k.flag('lights')) k.light(x, y, 64, '200 225 255 220', 700);
    }
    breencast(k, cx + 224, 200, 224);
    k.scatter(['pg_props/pg_obj/ja_combine_crate', 'pg_props/pg_obj/ja_combine_crate_big', 'props_combine/combine_barricade_short02a'], rect(160, 200, W - 160, D - 160), 5, { margin: 16, yaw: 'right' });
    k.perimeter('combine', 64);
    k.gameplay([cx - 240, cy - 200]);
  },
};
