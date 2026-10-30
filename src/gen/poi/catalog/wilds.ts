import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';

const DIRT = 'NATURE/DIRTFLOOR003A';
const SAND = 'NATURE/SANDFLOOR010A';
const WOOD = { top: 'WOOD/WOODFLOOR005A', bottom: 'WOOD/WOODFLOOR005A', sides: 'WOOD/WOODWALL009A' };
const BEAM = { top: 'WOOD/WOODBEAM001A', bottom: NODRAW, sides: 'WOOD/WOODBEAM001A' };
const ROOF = { top: 'METAL/METALROOF005A', bottom: 'METAL/METALROOF005A', sides: 'METAL/METALROOF005A' };
const ROCKS = ['props_foliage/rock_forest01', 'props_foliage/rock_forest02', 'props_wasteland/rockgranite03a', 'props_wasteland/rockgranite02a'];
const BIG_ROCKS = ['props_foliage/forestrock_cluster01', 'cliffs/rocks_medium01', 'cliffs/rocks_medium02', 'cliffs/rocks_large01', 'props_wasteland/rockcliff01b'];
const DEAD_TREES = ['props_foliage/tree_dead03', 'props_foliage/tree_dead04', 'props_foliage/tree_dry02', 'props_foliage/tree_stump01'];
const PINES = ['props_foliage/tree_pine04', 'props_foliage/tree_pine06', 'props_foliage/tree_pine05'];

/** A campfire: a ring of stones, charred logs and a flickering light. */
export function campfire(k: PoiKit, x: number, y: number, lit = true): void {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    k.prop('props_foliage/rock_forest01', x + Math.cos(a) * 34, y + Math.sin(a) * 34, k.rng.int(0, 359), { force: true, noOccupy: true, dz: -14 });
  }
  k.cylinder(x, y, 28, -2, 1, { top: 'NATURE/MUDFLOOR001A', bottom: NODRAW, sides: NODRAW }, 8);
  k.log('x', x - 22, x + 22, y - 6, 4, 'WOOD/WOODBURNT001A', 1);
  k.log('y', y - 20, y + 20, x + 4, 4, 'WOOD/WOODBURNT001A', 5);
  if (lit) k.light(x, y, 24, '255 140 50 160', 400);
  k.occupied.push(rect(x - 48, y - 48, x + 48, y + 48));
}

/** A wooden watch post: four legs, a deck at 128, a rail, a tin roof and a ladder. */
function watchPost(k: PoiKit, x: number, y: number): void {
  const h = 128, s = 56;
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(rect(x + dx * s - 5, y + dy * s - 5, x + dx * s + 5, y + dy * s + 5), -4, h + 96, BEAM);
  k.box(rect(x - s - 8, y - s - 8, x + s + 8, y + s + 8), h - 8, h, WOOD);
  for (const r of [rect(x - s - 8, y - s - 8, x + s + 8, y - s - 4), rect(x - s - 8, y + s + 4, x + s + 8, y + s + 8), rect(x - s - 8, y - s - 4, x - s - 4, y + s + 4)]) k.box(r, h, h + 36, WOOD);
  k.slope(rect(x - s - 16, y - s - 16, x + s + 16, y + s + 16), 'y', h + 104, h + 88, 4, ROOF);
  k.prop('props_forest/ladderwood', x + s + 10, y, 0, { z: 0, force: true, noOccupy: true, pitch: -12 });
  k.occupied.push(rect(x - s - 16, y - s - 16, x + s + 16, y + s + 16));
}

/**
 * A rebel camp in a clearing: tents round a campfire, a shack, supply and ammo crates, a radio mast, a watch
 * post, a rebel flag and sandbags at the way in.
 */
export const REBELCAMP: PoiType = {
  id: 'rebelcamp', label: 'Rebel camp', icon: '⛺', hint: 'A rebel base or objective with a watch post.',
  landscapes: ['forest', 'city'], minSize: [1024, 896], maxSize: [2560, 2560], defaultSize: [1408, 1152],
  params: [
    { key: 'tents', label: 'Tents', type: 'number', default: 4 },
    { key: 'ground', label: 'Ground', type: 'select', default: 'terrain', options: [{ value: 'terrain', label: 'Terrain' }, { value: 'dirt', label: 'Dirt' }] },
    { key: 'radio', label: 'Radio mast', type: 'check', default: true },
    { key: 'lights', label: 'Fire lit', type: 'check', default: true },
  ],
  gameplay: { capture: true, scrap: true, units: ['rebel', 'rebel_sg', 'rebel_medic'] },
  build(k) {
    const { W, D } = k;
    if (k.str('ground') === 'dirt') k.pad(k.bounds, DIRT);
    // Routes: along x near the front, along y near the right side.
    k.route([0, D * 0.22], [W, D * 0.22]);
    k.route([W * 0.78, 0], [W * 0.78, D]);
    const fx = W * 0.42, fy = D * 0.6;
    campfire(k, fx, fy, k.flag('lights'));
    // Logs to sit on round the fire.
    for (const a of [0.6, 2.4, 4.2]) {
      const lx = fx + Math.cos(a) * 112, ly = fy + Math.sin(a) * 112;
      k.log(Math.abs(Math.cos(a)) > 0.7 ? 'y' : 'x', (Math.abs(Math.cos(a)) > 0.7 ? ly : lx) - 48, (Math.abs(Math.cos(a)) > 0.7 ? ly : lx) + 48, Math.abs(Math.cos(a)) > 0.7 ? lx : ly, 10, 'WOOD/WOODBEAM001A');
    }
    k.occupied.push(rect(fx - 140, fy - 140, fx + 140, fy + 140));
    // Tents in a ring, their doors towards the fire.
    const n = Math.max(1, Math.min(8, Math.round(k.num('tents', 4))));
    for (let i = 0, placed = 0; i < 24 && placed < n; i++) {
      const a = (placed / n) * Math.PI * 2 + k.rng.range(-0.25, 0.25) + i * 0.13;
      const r = k.rng.range(300, 380);
      const tx = fx + Math.cos(a) * r, ty = fy + Math.sin(a) * r;
      if (k.prop('pg_props/pg_obj/pg_tent', tx, ty, (a * 180) / Math.PI, { margin: 16 })) placed++;
    }
    if (!k.prop('structures/resistance/shack', W * 0.16, D * 0.82, 0, { margin: 16 })) k.prop('brush/rebels/billet', W * 0.16, D * 0.82, 0);
    if (k.flag('radio')) k.prop('pg_props/pg_buildings/pg_rebel_radio_tower', W * 0.9, D * 0.88, 0, { margin: 16 });
    watchPost(k, W - 112, D * 0.5);
    k.prop('pg_props/pg_buildings/other/pg_flagpole/pg_flagpole_rebels', fx + 200, fy - 220, 0);
    k.scatter(['props/crates/supplycrate', 'items/ammocrate_smg1_static', 'items/ammocrate_ar2_static', 'props_forest/footlocker01_closed', 'props_junk/wood_crate001a_static', 'items/item_item_crate_static'], rect(64, D * 0.3, W * 0.7, D - 64), 8, { margin: 12, yaw: 'any' });
    k.prop('brush/table_wood01', W * 0.3, D * 0.4, 90);
    // Sandbags either side of the way in along the front route.
    k.sandbags([W * 0.3, D * 0.22 + 96], [W * 0.3 + 192, D * 0.22 + 96], 3);
    k.sandbags([W * 0.62, D * 0.22 + 96], [W * 0.62 + 144, D * 0.22 + 96], 2);
    k.scatter(PINES, rect(64, 64, W - 64, D - 64), 3, { margin: 48 });
    k.gameplay([fx + 260, fy - 40]);
  },
};

/** A mound round a burrow: sand heaped up with a dark hole on top. */
function burrow(k: PoiKit, x: number, y: number): void {
  k.cylinder(x, y, 72, -4, 14, { top: SAND, bottom: NODRAW, sides: SAND }, 10, 44);
  k.cylinder(x, y, 30, 14, 15, { top: 'NATURE/MUDFLOOR001A', bottom: NODRAW, sides: NODRAW }, 8);
  k.occupied.push(rect(x - 72, y - 72, x + 72, y + 72));
}

/**
 * A thumper site: a Combine thumper on a ring of sand, rocks and short barricades round it, and antlion
 * burrows around (info_target spawn spots named <poi>_burrow_N). Hold the thumper; antlions come out of
 * the burrows.
 */
export const THUMPER: PoiType = {
  id: 'thumper', label: 'Thumper site', icon: '⛏', hint: 'Objective: hold the thumper. Antlion spawn spots around it.',
  landscapes: ['forest', 'beach', 'rocky'], minSize: [896, 896], maxSize: [2560, 2560], defaultSize: [1280, 1280],
  params: [
    { key: 'burrows', label: 'Burrows', type: 'number', default: 4 },
    { key: 'guards', label: 'Combine barricades', type: 'check', default: true },
    { key: 'capture', label: 'Capture point', type: 'check', default: true },
  ],
  gameplay: { capture: true, units: ['antlion', 'antlionguard', 'combine', 'zombie'] },
  build(k) {
    const { W, D } = k;
    const [cx, cy] = k.centre;
    k.crossRoute('x', cy - 224);
    k.crossRoute('y', cx + 224);
    // The thumper on a disc of sand.
    k.cylinder(cx, cy, 320, -4, 2, { top: SAND, bottom: NODRAW, sides: SAND }, 16);
    k.prop('props_combine/combinethumper001a', cx, cy, k.rng.int(0, 3) * 90, { force: true });
    k.occupied.push(rect(cx - 112, cy - 80, cx + 112, cy + 80));
    if (k.flag('guards')) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        k.prop(k.rng.pick(['props_combine/combine_barricade_short01a', 'props_combine/combine_barricade_short02a', 'props_combine/combine_barricade_med01a']), cx + Math.cos(a) * 200, cy + Math.sin(a) * 200, (a * 180) / Math.PI, { margin: 4 });
      }
      k.prop('props_combine/combine_light001a', cx + 120, cy + 120, 45);
    }
    // Rocks round the sand.
    for (let i = 0; i < 10; i++) {
      const a = k.rng.range(0, Math.PI * 2), r = k.rng.range(340, Math.min(W, D) / 2 - 80);
      k.prop(k.rng.pick(i < 4 ? BIG_ROCKS : ROCKS), cx + Math.cos(a) * r, cy + Math.sin(a) * r, k.rng.int(0, 359), { margin: 16 });
    }
    // Burrows further out, each with a spawn spot.
    const n = Math.max(0, Math.min(8, Math.round(k.num('burrows', 4))));
    for (let i = 0, placed = 0; i < 40 && placed < n; i++) {
      const a = k.rng.range(0, Math.PI * 2), r = k.rng.range(380, Math.min(W, D) / 2 - 96);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (!k.isFree(rect(x - 80, y - 80, x + 80, y + 80))) continue;
      burrow(k, x, y);
      k.entity('info_target', x, y, 24, { targetname: `poi_${k.spec.uid}_burrow_${placed + 1}` });
      placed++;
    }
    k.gameplay([cx - 160, cy + 140]);
  },
};

/**
 * A crash site in a clearing: a downed dropship container half buried, gunship wreckage, headcrab canisters
 * stuck in the ground, burnt trees, a scorched crater and scattered crates. Scrap and cover.
 */
export const CRASHSITE: PoiType = {
  id: 'crashsite', label: 'Crash site', icon: '💥', hint: 'Scrap plus cover in a clearing.',
  landscapes: ['forest', 'city', 'rocky'], minSize: [1024, 896], maxSize: [2560, 2560], defaultSize: [1408, 1152],
  params: [
    { key: 'scrap', label: 'Scrap piles', type: 'number', default: 2 },
    { key: 'canisters', label: 'Headcrab canisters', type: 'number', default: 2 },
    { key: 'lights', label: 'Fires', type: 'check', default: true },
  ],
  gameplay: { capture: true, scrap: true, units: ['zombie', 'headcrab', 'combine'] },
  build(k) {
    const { W, D } = k;
    const [cx, cy] = k.centre;
    k.route([0, D * 0.2], [W, D * 0.2]);
    k.route([W * 0.82, 0], [W * 0.82, D]);
    // The crater: a dark disc with a low raised rim.
    const kx = cx - 96, ky = cy + 96;
    k.cylinder(kx, ky, 260, -4, 1, { top: 'NATURE/MUDFLOOR001A', bottom: NODRAW, sides: NODRAW }, 14);
    k.ring(kx, ky, 300, 250, -4, 10, { top: DIRT, bottom: NODRAW, sides: DIRT }, 14);
    k.occupied.pop();
    k.prop('combine_dropship_container_static', kx, ky, k.rng.range(20, 60), { force: true, pitch: 8, roll: 12, dz: -18 });
    k.occupied.push(rect(kx - 220, ky - 220, kx + 220, ky + 220));
    // Gunship wreckage thrown along the crash path.
    const debris = ['gibs/gunship_gibs_tailsection', 'gibs/gunship_gibs_midsection', 'gibs/gunship_gibs_wing', 'gibs/gunship_gibs_wing'];
    for (const m of debris) {
      for (let t = 0; t < 10; t++) {
        const x = k.rng.range(kx + 280, W - 140), y = k.rng.range(ky - 260, ky + 200);
        if (k.prop(m, x, y, k.rng.int(0, 359), { margin: 24, roll: k.rng.range(-20, 20) })) break;
      }
    }
    let can = Math.max(0, Math.round(k.num('canisters', 2)));
    for (let t = 0; t < 30 && can > 0; t++) {
      const x = k.rng.range(160, W - 160), y = k.rng.range(160, D - 160);
      if (k.prop('props_combine/headcrabcannister01a', x, y, k.rng.int(0, 359), { pitch: -55, dz: -30, margin: 24 })) can--;
    }
    k.scatter(DEAD_TREES, rect(64, 64, W - 64, D - 64), 7, { margin: 48 });
    k.scatter(['props_foliage/fallentree_dry01', 'props_foliage/fallentree_dry02'], rect(96, 96, W - 96, D - 96), 2, { margin: 24 });
    k.scatter(['pg_props/pg_obj/ja_combine_crate', 'pg_props/pg_obj/ja_combine_crate_big', 'props_junk/wood_crate001a_static', 'props_c17/oildrum001_static'], rect(64, 64, W - 64, D - 64), 7, { margin: 16, yaw: 'any' });
    if (k.flag('lights')) {
      k.light(kx + 60, ky - 40, 48, '255 120 40 200', 500);
      k.light(kx + 340, ky - 60, 32, '255 120 40 120', 300);
    }
    k.gameplay([W * 0.6, D * 0.35]);
  },
};
