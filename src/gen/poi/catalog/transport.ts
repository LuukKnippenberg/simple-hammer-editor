import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';

const BALLAST = 'NATURE/GRAVELFLOOR002B';
const PLATFORM = { top: 'CONCRETE/CONCRETEFLOOR028A', bottom: NODRAW, sides: 'CONCRETE/CONCRETEWALL001A' };
const EDGE = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'CONCRETE/CONCRETEWALL001A' };
const STEEL = { top: 'METAL/METALPIPE001A', bottom: NODRAW, sides: 'METAL/METALPIPE001A' };
const ROOF = { top: 'METAL/METALROOF005A', bottom: 'METAL/METALROOF005A', sides: 'METAL/METALROOF005A' };
const ASPHALT = 'CONCRETE/CONCRETEFLOOR033A';
const ISLAND = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'CONCRETE/CONCRETEFLOOR027A' };
const CANOPY = { top: 'METAL/METALROOF005A', bottom: 'PLASTER/PLASTERCEILING003A', sides: 'PLASTER/PLASTERWALL003A' };
const CARS = ['props_trainstation/train001', 'props_trainstation/train002', 'props_trainstation/train003', 'props_trainstation/train005'];

/**
 * A rail yard: parallel tracks on ballast with platforms between them (16 high, so units step up), parked
 * and wrecked train cars in long lines that block sight, buffer stops at the track ends, and level crossings
 * kept free of cars (the routes across). Optional canopy over the platforms.
 */
export const RAILYARD: PoiType = {
  id: 'railyard', label: 'Rail yard', icon: '🚃', hint: 'Long lines of hard cover; platforms as low high ground.',
  landscapes: ['city', 'forest'], minSize: [1536, 896], maxSize: [4096, 2560], defaultSize: [2304, 1280],
  params: [
    { key: 'tracks', label: 'Tracks', type: 'number', default: 4, hint: '2 to 6' },
    { key: 'cars', label: 'Train cars (%)', type: 'number', default: 60 },
    { key: 'wrecks', label: 'Wrecked cars', type: 'number', default: 1 },
    { key: 'canopy', label: 'Platform canopy', type: 'check', default: true },
  ],
  gameplay: { capture: true, scrap: true },
  build(k) {
    const { W, D } = k;
    k.pad(k.bounds, BALLAST);
    // Tracks along x, 192 apart, with a platform after every second track.
    const want = Math.max(2, Math.min(6, Math.round(k.num('tracks', 4))));
    const layout: ('track' | 'platform')[] = [];
    for (let i = 0; i < want; i++) { layout.push('track'); if (i % 2 === 0 && i < want - 1) layout.push('platform'); }
    const size = (b: 'track' | 'platform') => (b === 'track' ? 160 : 192);
    let total = layout.reduce((s, b) => s + size(b), 0);
    while (total > D - 128 && layout.length > 2) { layout.pop(); if (layout[layout.length - 1] === 'platform') layout.pop(); total = layout.reduce((s, b) => s + size(b), 0); }
    let y = Math.round((D - total) / 2);
    // Level crossings (routes across all tracks): one in the middle, or two on a long yard, so the stretches
    // between them still hold a train car or two (the cars are 460 to 690 long).
    const crossings = W >= 3072 ? [Math.round(W * 0.3 / 64) * 64, Math.round(W * 0.7 / 64) * 64] : [Math.round(W / 2 / 64) * 64];
    for (const x of crossings) k.route([x, 0], [x, D], 192);
    k.route([0, 64], [W, 64]);
    const trackYs: number[] = [];
    for (const band of layout) {
      if (band === 'track') {
        const ty = y + 80;
        trackYs.push(ty);
        // Rails, 512 at a time (the model runs along its y), bumpers at both ends.
        for (let x = 256; x + 256 <= W; x += 512) k.prop('pg_props/pg_obj/pg_rail_512', x, ty, 90, { force: true, noOccupy: true });
        k.prop('pg_props/pg_gate_ii/pg_train_bumper', 72, ty, 0, { force: true });
        k.prop('pg_props/pg_gate_ii/pg_train_bumper', W - 72, ty, 180, { force: true });
      } else {
        // The platform, cut at the crossings, with a lighter edge strip on both sides.
        let x0 = 96;
        for (const cxing of [...crossings, W - 96 + 96]) {
          const x1 = Math.min(cxing - 96, W - 96);
          if (x1 - x0 > 128) {
            k.box(rect(x0, y + 8, x1, y + size(band) - 8), -4, 16, PLATFORM, { occupy: true });
            for (const ey of [y + 8, y + size(band) - 24]) k.box(rect(x0, ey, x1, ey + 16), 16, 17, EDGE);
            if (k.flag('canopy')) {
              for (let cx = x0 + 64; cx <= x1 - 64; cx += 256) k.box(rect(cx - 6, y + size(band) / 2 - 6, cx + 6, y + size(band) / 2 + 6), 16, 176, STEEL);
              k.slope(rect(x0 + 32, y - 16, x1 - 32, y + size(band) / 2), 'y', 160, 184, 4, ROOF);
              k.slope(rect(x0 + 32, y + size(band) / 2, x1 - 32, y + size(band) + 16), 'y', 184, 160, 4, ROOF);
            }
          }
          x0 = cxing + 96;
        }
      }
      y += size(band);
    }
    // Train cars in lines on the tracks, between the crossings.
    const share = Math.max(0, Math.min(100, k.num('cars', 60))) / 100;
    let wrecks = Math.max(0, Math.round(k.num('wrecks', 1)));
    for (const ty of trackYs) {
      let x = 160;
      for (const end of [...crossings, W]) {
        const stop = end === W ? W - 160 : end - 112;
        while (x < stop) {
          const m = k.rng.pick(CARS);
          const fp = k.footprint(m, 0, 0, 90);
          const len = fp.x1 - fp.x0;
          if (x + len > stop) break;
          if (k.rng.chance(share)) {
            if (wrecks > 0 && k.rng.chance(0.3)) {
              // Off the rails and on its side next to the track.
              const wm = k.rng.pick(['props_junk/train002', 'props_junk/train003']);
              if (k.prop(wm, x + len / 2, ty + 24, 90 + k.rng.range(-8, 8), { pitch: 70 + k.rng.range(0, 15), margin: 0 })) { wrecks--; x += len + 24; continue; }
            }
            k.prop(m, x - fp.x0, ty, 90, { margin: 0 });
          }
          x += len + 24;
        }
        x = end + 112;
      }
    }
    k.scatter(['props_c17/oildrum001_static', 'props_junk/wood_pallet001a_static', 'props_junk/wood_crate001a_static'], rect(64, 64, W - 64, D - 64), 6, { margin: 8 });
    k.gameplay([crossings[0], D / 2]);
  },
};

/**
 * A gas station: a canopy over two islands of pumps, a kiosk you can walk into (from the interior generator;
 * a closed box until that lands), propane tanks that explode, a price sign, a car at a pump, tyres and a
 * dumpster round the back.
 */
export const GASSTATION: PoiType = {
  id: 'gasstation', label: 'Gas station', icon: '⛽', hint: 'Cover plus explosive hazards, and a kiosk to garrison.',
  landscapes: ['city', 'forest'], minSize: [1024, 896], maxSize: [2048, 1536], defaultSize: [1280, 1024],
  params: [
    { key: 'explosive', label: 'Explosive tanks', type: 'check', default: true, hint: 'Propane tanks as prop_physics' },
    { key: 'cars', label: 'Cars', type: 'number', default: 2 },
    { key: 'lights', label: 'Lights on', type: 'check', default: false },
  ],
  gameplay: { capture: true, units: ['zombie', 'rebel'] },
  build(k) {
    const { W, D } = k;
    const [cx] = k.centre;
    k.pad(k.bounds, ASPHALT);
    // The forecourt road along the front, and a lane up the side past the kiosk.
    k.route([0, 112], [W, 112], 160);
    k.route([W - 160, 0], [W - 160, D], 160);
    // The canopy over two islands of pumps; lanes between them are open.
    const cw = Math.min(768, W - 448), cy0 = 256, cy1 = cy0 + 352;
    const c = rect(cx - cw / 2 - 96, cy0, cx + cw / 2 - 96, cy1);
    const islands = [c.y0 + 96, c.y1 - 96];
    for (const iy of islands) {
      k.box(rect(c.x0 + 96, iy - 24, c.x1 - 96, iy + 24), -4, 12, ISLAND, { occupy: true });
      for (let x = c.x0 + 160; x <= c.x1 - 160; x += Math.max(160, (cw - 320) / 2)) k.prop('props_wasteland/gaspump001a', x, iy, 90, { z: 12, force: true, noOccupy: true });
    }
    for (const [x, y] of [[c.x0 + 96, (c.y0 + c.y1) / 2], [c.x1 - 96, (c.y0 + c.y1) / 2]]) k.box(rect(x - 16, y - 16, x + 16, y + 16), 12, 208, ISLAND, { occupy: true });
    k.box(rect(c.x0, c.y0, c.x1, c.y1), 208, 232, CANOPY);
    if (k.flag('lights')) for (const iy of islands) k.light(cx - 96, iy, 196, '255 240 220 220', 700);
    // The kiosk at the back, its door facing the pumps.
    const kw = Math.min(448, W - 512), kd = 256;
    k.house(rect(cx - kw / 2 - 96, D - kd - 64, cx + kw / 2 - 96, D - 64), { storeys: 1, furnish: 'sparse', wideDoors: true, doors: ['s'] });
    // Propane tanks against the kiosk, a sign pole on the corner, cars at the pumps.
    const tanks = k.flag('explosive');
    for (let i = 0; i < 4; i++) k.prop('props_junk/propane_tank001a', cx - kw / 2 - 96 - 40, D - kd - 32 + i * 24, 0, tanks ? { cls: 'prop_physics', margin: 2 } : { margin: 2 });
    k.cylinder(96, 288, 8, -4, 320, STEEL, 8);
    k.box(rect(64, 280, 128, 296), 256, 352, { top: 'METAL/METALBAR001C_WHITE', bottom: 'METAL/METALBAR001C_WHITE', sides: 'PROPS/SIGNBILLBOARD001A' });
    k.occupied.push(rect(80, 272, 112, 304));
    let cars = Math.max(0, Math.round(k.num('cars', 2)));
    for (const iy of islands) for (const dy of [-96, 96]) {
      if (cars <= 0) break;
      if (k.rng.chance(0.6) && k.prop(k.rng.pick(['props_vehicles/car002a', 'props_vehicles/car003a', 'props_vehicles/car004b', 'props_vehicles/van001a']), cx - 96 + k.rng.range(-80, 80), iy + dy, k.rng.pick([0, 180]) + k.rng.range(-5, 5))) cars--;
    }
    k.scatter(['props_silo/tirestack', 'props_vehicles/tire001b_truck_static', 'props_junk/trashdumpster01a_static', 'props_c17/oildrum001_static'], rect(64, D - 320, W - 260, D - 48), 4, { margin: 12 });
    k.gameplay([cx - 96, (cy0 + cy1) / 2]);
  },
};
