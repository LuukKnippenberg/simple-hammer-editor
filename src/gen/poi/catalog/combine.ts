import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';

const METAL = 'METAL/METALCOMBINE001';
const SCREEN = { top: METAL, bottom: METAL, sides: 'PROPS/COMBINE_DISPLAY01A' };
const CONCRETE = 'CONCRETE/CONCRETEFLOOR001A';
const TALL = ['props_combine/combine_barricade_tall01a', 'props_combine/combine_barricade_tall03a', 'props_combine/combine_barricade_med02a'];
const SHORT = ['props_combine/combine_barricade_short01a', 'props_combine/combine_barricade_short02a'];
const GAP = 192;

/** Lays models along the local x axis from x0 to x1 at y, each turned `yaw`, using each model's length along x. */
function lineOf(k: PoiKit, models: string[], x0: number, x1: number, y: number, yaw: number, o: { force?: boolean } = {}): void {
  const len = (m: string) => { const fp = k.footprint(m, 0, 0, yaw); return fp.x1 - fp.x0; };
  let x = x0;
  for (;;) {
    // A random piece, or the longest that still fits.
    let m = k.rng.pick(models);
    if (x + len(m) > x1) m = [...models].sort((a, b) => len(b) - len(a)).find((q) => x + len(q) <= x1) ?? '';
    if (!m) break;
    const fp = k.footprint(m, 0, 0, yaw);
    k.prop(m, x - fp.x0, y, yaw, { force: o.force, margin: 0 });
    x += fp.x1 - fp.x0;
  }
}

/** A Breencast screen on a pole (four screens round a box). */
export function breencast(k: PoiKit, x: number, y: number, h = 288): void {
  k.box(rect(x - 40, y - 40, x + 40, y + 40), -8, 16, METAL, { occupy: true });
  k.cylinder(x, y, 10, 16, h, METAL, 8);
  k.box(rect(x - 48, y - 48, x + 48, y + 48), h, h + 64, SCREEN);
  k.box(rect(x - 52, y - 52, x + 52, y + 52), h + 64, h + 70, METAL);
}

/**
 * A Combine checkpoint across a street: a line of tall barricades along the POI's width with a vehicle gap in
 * the middle, a booth and a scanner gate beside it, floodlights, short barricades funnelling the approach, and
 * crates (and an APC) on the Combine side. Drag it so its long side runs across the road.
 */
export const CHECKPOINT: PoiType = {
  id: 'checkpoint', label: 'Combine checkpoint', icon: '🛂', hint: 'A chokepoint across a street with one gap: a natural capture point.',
  landscapes: ['city'], minSize: [896, 512], maxSize: [2560, 1024], defaultSize: [1536, 640],
  params: [
    { key: 'surface', label: 'Ground', type: 'select', default: 'none', options: [{ value: 'none', label: 'As it is (on a road)' }, { value: 'concrete', label: 'Concrete' }] },
    { key: 'apc', label: 'APC', type: 'check', default: true },
    { key: 'lights', label: 'Lights on', type: 'check', default: false },
  ],
  gameplay: { capture: true, units: ['combine', 'metropolice', 'combine_sg'] },
  build(k) {
    const { W, D } = k;
    const cx = W / 2, ly = D / 2;
    if (k.str('surface') === 'concrete') k.pad(k.bounds, CONCRETE);
    k.route([cx, 0], [cx, D], GAP);
    // The scanner gate for people, beside the vehicle gap; the booth on the other side.
    const gateX = cx - GAP / 2 - 130;
    k.prop('combine_gate_citizen', gateX, ly, 0, { force: true });
    k.keepClear(rect(gateX - 120, ly - 60, gateX + 120, ly + 60));
    k.prop('props_combine/combine_booth_short01a', cx + GAP / 2 + 16, ly + 12, 0, { force: true });
    k.occupied.push(rect(cx + GAP / 2, ly - 70, cx + GAP / 2 + 96, ly + 70));
    // The barricade line.
    lineOf(k, TALL, 16, gateX - 120, ly, 0);
    lineOf(k, TALL, cx + GAP / 2 + 104, W - 16, ly, 0);
    // Floodlights on the Combine side, aimed at the approach.
    for (const x of [96, W - 96]) {
      k.prop('props_c17/light_floodlight02_off', x, ly + 112, 270);
      if (k.flag('lights')) k.light(x, ly + 64, 96, '220 235 255 300', 900);
    }
    k.prop('props_combine/combine_light002a', cx + GAP / 2 + 60, ly - 40, 270);
    // A funnel of short barricades on the approach.
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const x = cx + s * (GAP / 2 + 64 + i * 56), y = ly - 120 - i * 64;
        k.prop(k.rng.pick(SHORT), x, y, 90 + s * 35);
      }
    }
    // The Combine side: crates, an APC, a camera post.
    if (k.flag('apc')) k.prop('combine_apc_static', cx + GAP / 2 + 260, D - 100, 90 + k.rng.range(-6, 6));
    k.scatter(['pg_props/pg_obj/ja_combine_crate', 'pg_props/pg_obj/ja_combine_crate_big'], rect(48, ly + 96, cx - GAP / 2 - 24, D - 32), 4, { yaw: 'right' });
    breencast(k, cx - GAP / 2 - 320, D - 96, 224);
    k.gameplay([cx, ly + 176]);
  },
};

/**
 * A rebel barricade: cars, furniture, crates, barrels and sandbag walls piled along the POI's width with one
 * gap, supplies behind it. "Anticitizen One" style.
 */
export const BARRICADE: PoiType = {
  id: 'barricade', label: 'Rebel barricade', icon: '🚧', hint: 'A defensive line across a street with one gap.',
  landscapes: ['city'], minSize: [768, 384], maxSize: [2560, 1024], defaultSize: [1152, 512],
  params: [
    { key: 'explosive', label: 'Explosive barrels', type: 'check', default: true, hint: 'Physics barrels that blow up' },
    { key: 'surface', label: 'Ground', type: 'select', default: 'none', options: [{ value: 'none', label: 'As it is (on a road)' }, { value: 'rubble', label: 'Rubble' }] },
  ],
  gameplay: { capture: true, units: ['rebel', 'rebel_sg', 'rebel_rpg'] },
  build(k) {
    const { W, D } = k;
    const cx = W / 2, ly = D / 2;
    if (k.str('surface') === 'rubble') k.pad(k.bounds, 'CONCRETE/CONCRETEFLOOR038A');
    k.route([cx, 0], [cx, D], GAP);
    // Pieces along the line on both sides of the gap: wrecks, furniture piles, sandbags, barricade props.
    const pieces = ['car', 'sandbags', 'furniture', 'barricade', 'crates'];
    for (const [x0, x1] of [[24, cx - GAP / 2 - 8], [cx + GAP / 2 + 8, W - 24]]) {
      let x = x0;
      while (x < x1 - 64) {
        const kind = k.rng.pick(pieces);
        const y = ly + k.rng.range(-16, 16);
        if (kind === 'car' && x1 - x >= 200) {
          const car = k.rng.pick(['props_vehicles/car002b', 'props_vehicles/car003b', 'props_vehicles/car004b', 'props_vehicles/car005b']);
          if (k.prop(car, x + 100, y, k.rng.range(-12, 12), { roll: k.rng.chance(0.25) ? 180 : 0, margin: 0 })) { x += 210; continue; }
        }
        if (kind === 'sandbags' && x1 - x >= 160) {
          const l = Math.min(x1 - x, k.rng.int(3, 5) * 48);
          k.sandbags([x, ly], [x + l, ly], 3);
          x += l + 8;
          continue;
        }
        if (kind === 'furniture') {
          const m = k.rng.pick(['props_c17/furniturecouch001a_static', 'props_c17/furniturebed001a_static', 'props_c17/furniturebathtub001a_static', 'props_wasteland/laundry_cart001_static']);
          if (k.prop(m, x + 48, y, k.rng.range(-20, 20) + (m.includes('couch') ? 90 : 0), { margin: 0 })) {
            k.prop(k.rng.pick(['props_c17/furnituremattress001a_static', 'props_junk/wood_crate001a_static']), x + 48, y + 30, k.rng.int(0, 359), { force: true, noOccupy: true, dz: 24 });
            x += 104;
            continue;
          }
        }
        if (kind === 'barricade') {
          const m = k.rng.pick(['pg_props/pg_buildings/rebels/pg_rebel_barricade', 'pg_props/pg_buildings/other/pg_wood_fence_barricade', 'pg_props/pg_buildings/other/pg_old_wall_barrikade']);
          const yaw = m.includes('fence') ? 90 : 0;
          const fp = k.footprint(m, 0, 0, yaw);
          if (x + (fp.x1 - fp.x0) <= x1 && k.prop(m, x - fp.x0, ly, yaw, { margin: 0 })) { x += fp.x1 - fp.x0 + 4; continue; }
        }
        // Crates and drums fill what is left.
        k.prop(k.rng.pick(['props_junk/wood_crate001a_static', 'props_junk/wood_crate002a_static', 'props_c17/oildrum001_static']), x + 24, ly, k.rng.int(0, 3) * 90, { margin: 0 });
        x += 48;
      }
    }
    // Junk piled against the line on both faces.
    k.scatter(['props_junk/wood_crate001a_static', 'props_c17/oildrum001_static', 'props_vehicles/tire001b_truck_static', 'props_junk/wood_pallet001a_static'], rect(24, ly - 90, W - 24, ly - 40), Math.round(W / 160), { margin: 0 });
    k.scatter(['props_junk/wood_crate002a_static', 'props_c17/oildrum001_static', 'props_junk/cinderblock01a_large'], rect(24, ly + 40, W - 24, ly + 90), Math.round(W / 192), { margin: 0 });
    // Supplies and a fire barrel behind the line (the rebel side, +y).
    k.scatter(['items/ammocrate_smg1_static', 'items/ammocrate_ar2_static', 'props/crates/supplycrate', 'items/item_item_crate_static'], rect(48, ly + 96, W - 48, D - 32), 5, { yaw: 'any' });
    if (k.flag('explosive')) k.scatter(['props_c17/oildrum001_explosive'], rect(48, ly + 64, W - 48, ly + 160), 3, { cls: 'prop_physics' });
    k.gameplay([cx, ly + 160]);
  },
};

/**
 * Ration distribution: queue lanes between railings leading to a Combine booth at the back, a Breencast
 * screen over the square, crates of rations and guard posts.
 */
export const RATIONS: PoiType = {
  id: 'rations', label: 'Ration distribution', icon: '📦', hint: 'Funnel lanes to a Combine booth; a story set piece.',
  landscapes: ['city'], minSize: [768, 768], maxSize: [2048, 2048], defaultSize: [1024, 1024],
  params: [
    { key: 'lanes', label: 'Queue lanes', type: 'number', default: 3, hint: '2 to 5' },
  ],
  gameplay: { capture: true, units: ['metropolice', 'combine'] },
  build(k) {
    const { W, D } = k;
    const cx = W / 2;
    k.pad(k.bounds, CONCRETE);
    const n = Math.max(2, Math.min(5, Math.round(k.num('lanes', 3))));
    // Lanes 176 apart: a route in each and room for the railing between.
    const lw = 176;
    const total = n * lw;
    const lx0 = Math.round(cx - total / 2);
    const qy0 = 96, qy1 = D - 320;
    // Lanes are routes; railings between them (and on the outside).
    for (let i = 0; i < n; i++) k.route([lx0 + i * lw + lw / 2, 0], [lx0 + i * lw + lw / 2, qy1 + 48]);
    for (let i = 0; i <= n; i++) {
      const x = lx0 + i * lw;
      for (let y = qy0 + 128; y <= qy1 - 128; y += 256) k.prop('props_combine/railing_256', x, y, 90, { force: true });
      k.occupied.push(rect(x - 6, qy0, x + 6, qy1));
    }
    // The booth across the head of the lanes, with crates of rations beside it.
    k.box(rect(lx0 - 32, qy1 + 64, lx0 + total + 32, qy1 + 80), -4, 40, { top: METAL, bottom: NODRAW, sides: METAL }, { occupy: true });
    k.prop('props_combine/combine_booth_med01a', cx, qy1 + 200, 90, { force: true });
    k.occupied.push(rect(cx - 140, qy1 + 100, cx + 140, qy1 + 300));
    k.scatter(['pg_props/pg_obj/ja_combine_crate', 'pg_props/pg_obj/ja_combine_crate_big'], rect(48, qy1 + 96, W - 48, D - 48), 6, { yaw: 'right' });
    breencast(k, 112, D - 160, 320);
    // Barricades on the flanks, a dispenser monitor at the lane heads.
    for (const x of [64, W - 64]) for (let y = 160; y < qy1; y += 160) k.prop(k.rng.pick(TALL), x, y, 90);
    for (let i = 0; i < n; i++) k.prop('props_combine/combine_smallmonitor001', lx0 + i * lw + lw / 2, qy1 + 72, 270, { z: 40, force: true, noOccupy: true });
    // Ration papers on the ground.
    for (let i = 0; i < 5; i++) k.overlay(k.rng.pick(['overlays/rationpapers01', 'overlays/rationpapers03', 'overlays/rationpapers04']), k.rng.range(64, W - 64), k.rng.range(64, qy0 + 64), 96, 96, k.rng.int(0, 359));
    k.gameplay([cx, qy0 / 2 + 24]);
  },
};
