import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';

const COBBLE = 'STONE/STONEFLOOR006A';
const COUNTER = { top: 'WOOD/WOODFLOOR005A', bottom: NODRAW, sides: 'WOOD/WOODWALL009A' };
const POST = { top: 'WOOD/WOODBEAM001A', bottom: NODRAW, sides: 'WOOD/WOODBEAM001A' };
const ROOFS = [
  { top: 'METAL/METALROOF005A', bottom: 'METAL/METALROOF005A', sides: 'METAL/METALROOF005A' },
  { top: 'METAL/METALROOF003A', bottom: 'METAL/METALROOF003A', sides: 'METAL/METALROOF003A' },
  { top: 'WOOD/WOODSHINGLES002A', bottom: 'WOOD/WOODWALL009A', sides: 'WOOD/WOODWALL009A' },
];
const HALL = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: 'CONCRETE/CONCRETEWALL001A', sides: 'CONCRETE/CONCRETEWALL001A' };
const GOODS = ['props_junk/wood_crate001a_static', 'props_junk/wood_crate002a_static', 'props_junk/watermelon01_large', 'props_junk/plasticcrate01a', 'props_junk/wood_pallet001a_static', 'pg_props/pg_obj/pg_barrel', 'pg_props/pg_obj/pg_crate'];
const CARTS = ['props_junk/pushcart01a', 'props_silo/pushcart_static', 'props_wasteland/laundry_cart001_static'];
const STALL_W = 192;
const STALL_D = 128;
const LANE = 160;

/**
 * One stall at a local spot, its counter towards local -y (`front`): a counter, four posts, a roof sloping
 * to the front (corrugated metal or shingles, or a striped awning model), goods on the counter and beside it.
 */
function stall(k: PoiKit, x0: number, y0: number, front: 1 | -1, abandoned: boolean): void {
  const x1 = x0 + STALL_W, y1 = y0 + STALL_D;
  const fy = front < 0 ? y0 : y1, by = front < 0 ? y1 : y0;
  const counter = front < 0 ? rect(x0 + 8, y0 + 16, x1 - 8, y0 + 48) : rect(x0 + 8, y1 - 48, x1 - 8, y1 - 16);
  k.box(counter, -4, 40, COUNTER, { occupy: true });
  // Posts and roof; an abandoned stall may have lost its roof.
  const roofless = abandoned && k.rng.chance(0.4);
  for (const px of [x0 + 8, x1 - 14]) for (const py of [fy + (front < 0 ? 8 : -14), by + (front < 0 ? -14 : 8)]) k.box(rect(px, py, px + 6, py + 6), -4, py === fy + (front < 0 ? 8 : -14) ? 100 : 124, POST);
  if (!roofless) {
    if (k.rng.chance(0.35)) {
      // A striped awning hung along the front edge, and a plain board roof behind it.
      k.box(rect(x0, Math.min(fy, by), x1, Math.max(fy, by)), 124, 128, ROOFS[2]);
      const model = 'props_c17/awning001a';
      for (const ax of [x0 + 64, x1 - 64]) k.prop(model, ax, fy - front * 16, front < 0 ? 270 : 90, { z: 104, force: true, noOccupy: true });
    } else {
      const ry0 = Math.min(fy, by) - (front < 0 ? 24 : 0), ry1 = Math.max(fy, by) + (front > 0 ? 24 : 0);
      const roof = k.rng.pick(ROOFS);
      k.slope(rect(x0 - 8, ry0, x1 + 8, ry1), 'y', front < 0 ? 100 : 128, front < 0 ? 128 : 100, 4, roof);
    }
  }
  // Goods on the counter and stacked by the stall.
  const goods = abandoned ? 1 : k.rng.int(2, 4);
  for (let i = 0; i < goods; i++) {
    const gx = k.rng.range(x0 + 32, x1 - 32), gy = (counter.y0 + counter.y1) / 2;
    k.prop(k.rng.pick(['props_junk/watermelon01_large', 'props_junk/plasticcrate01a', 'props_junk/wood_crate001a']), gx, gy, k.rng.int(0, 359), { z: 40, force: true, noOccupy: true });
  }
  k.scatter(GOODS, rect(x0 + 16, Math.min(fy, by) + 48, x1 - 16, Math.max(fy, by) - 8), abandoned ? 3 : 2, { margin: 4, tries: 20, yaw: 'any' });
  k.occupied.push(rect(x0, y0, x1, y1));
}

/**
 * A market: rows of stalls facing lanes (at least 128 wide, the routes), with crates, produce and carts in
 * and around them, or a covered hall (columns and an open roof frame over the stalls).
 */
export const MARKET: PoiType = {
  id: 'market', label: 'Market', icon: '🧺', hint: 'Dense soft cover and narrow lanes: a good place for an ambush.',
  landscapes: ['city'], minSize: [896, 768], maxSize: [3072, 3072], defaultSize: [1408, 1216],
  params: [
    { key: 'hall', label: 'Covered hall', type: 'check', default: false, hint: 'Columns and an open roof frame over the stalls' },
    { key: 'density', label: 'Stalls (%)', type: 'number', default: 85 },
    { key: 'abandoned', label: 'Abandoned', type: 'check', default: false },
    { key: 'lamps', label: 'Lamp posts', type: 'check', default: true },
    { key: 'lights', label: 'Lights on', type: 'check', default: false },
  ],
  gameplay: { capture: true, scrap: true, units: ['zombie', 'combine', 'metropolice'] },
  build(k) {
    const { W, D } = k;
    k.pad(k.bounds, COBBLE);
    const abandoned = k.flag('abandoned');
    const density = Math.max(0, Math.min(100, k.num('density', 85))) / 100;
    const m = 64;
    // Columns of stalls between cross lanes; rows of back-to-back stalls between lanes.
    const cols = Math.max(1, Math.floor((W - 2 * m + LANE) / (2 * STALL_W + LANE)));
    const blockW = cols * 2 * STALL_W + (cols - 1) * LANE;
    const xStart = Math.round((W - blockW) / 2);
    const pairs = Math.max(1, Math.floor((D - 2 * m - LANE) / (2 * STALL_D + LANE)));
    const blockD = pairs * 2 * STALL_D + (pairs + 1) * LANE;
    const yStart = Math.round((D - blockD) / 2);
    // Lanes along x (between the rows of stalls) and along y (between the columns): the routes.
    for (let p = 0; p <= pairs; p++) {
      const y = yStart + p * (2 * STALL_D + LANE) + LANE / 2;
      k.route([0, y], [W, y], LANE);
    }
    for (let c = 1; c < cols; c++) {
      const x = xStart + c * (2 * STALL_W + LANE) - LANE / 2;
      k.route([x, 0], [x, D], LANE);
    }
    // The capture point sits on the middle lane crossing, in a stall's place.
    const g = k.type.gameplay!;
    const capture = g.capture && k.flag('capture');
    const empty: [number, number][] = [];
    for (let p = 0; p < pairs; p++) {
      const y0 = yStart + LANE + p * (2 * STALL_D + LANE);
      for (let c = 0; c < cols; c++) {
        for (let s = 0; s < 2; s++) {
          const x0 = xStart + c * (2 * STALL_W + LANE) + s * STALL_W;
          for (const [sy, front] of [[y0, -1], [y0 + STALL_D, 1]] as [number, 1 | -1][]) {
            if (capture && p === Math.floor(pairs / 2) && c === Math.floor(cols / 2) && s === 0) continue;
            // The pitches lie on a grid between the lanes, so they never overlap each other or a route.
            if (!k.rng.chance(density)) {
              empty.push([x0 + STALL_W / 2, sy + STALL_D / 2]);
              continue;
            }
            stall(k, x0, sy, front, abandoned);
          }
        }
      }
    }
    // Empty pitches get a cart, lengthwise.
    for (const [x, y] of empty) if (k.rng.chance(0.6)) k.prop(k.rng.pick(CARTS), x, y, k.rng.pick([0, 180]) + k.rng.range(-8, 8));
    if (k.flag('hall')) {
      // Columns along the outside of the stall block and an open frame of beams on top.
      const hx0 = xStart - 48, hx1 = xStart + blockW + 48, hy0 = yStart - 16, hy1 = yStart + blockD + 16;
      const nx = Math.max(2, Math.round((hx1 - hx0) / 384) + 1), ny = Math.max(2, Math.round((hy1 - hy0) / 384) + 1);
      for (let i = 0; i < nx; i++) for (const y of [hy0, hy1]) k.cylinder(hx0 + ((hx1 - hx0) * i) / (nx - 1), y, 16, -4, 256, HALL, 10);
      for (let j = 1; j < ny - 1; j++) for (const x of [hx0, hx1]) k.cylinder(x, hy0 + ((hy1 - hy0) * j) / (ny - 1), 16, -4, 256, HALL, 10);
      for (const y of [hy0, hy1]) k.box(rect(hx0 - 16, y - 16, hx1 + 16, y + 16), 256, 288, HALL);
      for (const x of [hx0, hx1]) k.box(rect(x - 16, hy0 + 16, x + 16, hy1 - 16), 256, 288, HALL);
      for (let i = 1; i < nx - 1; i++) {
        const x = hx0 + ((hx1 - hx0) * i) / (nx - 1);
        k.box(rect(x - 8, hy0 + 16, x + 8, hy1 - 16), 264, 288, HALL);
      }
    } else if (k.flag('lamps')) {
      for (let p = 0; p <= pairs; p += Math.max(1, pairs)) {
        const y = yStart + p * (2 * STALL_D + LANE) + LANE / 2;
        k.lamp(32, y + LANE / 2 + 24, 0);
        k.lamp(W - 32, y - LANE / 2 - 24, 180);
      }
    }
    if (abandoned) k.scatter(['props_junk/wood_crate001a_static', 'props_vehicles/tire001b_truck_static', 'props_junk/trashdumpster01a_static'], rect(32, 32, W - 32, D - 32), 6);
    const cx = xStart + Math.floor(cols / 2) * (2 * STALL_W + LANE) + STALL_W / 2;
    const cy = yStart + LANE + Math.floor(pairs / 2) * (2 * STALL_D + LANE) + STALL_D;
    k.gameplay([cx, cy]);
  },
};
