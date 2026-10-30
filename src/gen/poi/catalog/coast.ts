import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';
import { towerSolids } from '../../towers.ts';

const SAND = 'NATURE/SANDFLOOR010A';
const DECK = { top: 'WOOD/WOODFLOOR005A', bottom: 'WOOD/WOODFLOOR005A', sides: 'WOOD/WOODWALL009A' };
const POLE = { top: 'WOOD/WOODBEAM001A', bottom: NODRAW, sides: 'WOOD/WOODBEAM001A' };
const QUAY = { top: 'CONCRETE/CONCRETEFLOOR028A', bottom: NODRAW, sides: 'CONCRETE/CONCRETEWALL001A' };
const STONE = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'STONE/STONEWALL017A' };
const COAST_ROCKS = ['props_foliage/rock_coast02c', 'lostcoast/props_wasteland/rock_coast01a', 'props_wasteland/rockcliff01b', 'cliffs/rocks_large01'];
const SMALL_ROCKS = ['props_wasteland/rockgranite02a', 'props_wasteland/rockgranite03a', 'props_foliage/rock_forest01'];

/** The shoreline: where land ends and the sea starts (local y), leaving at least `land` of land. */
function shore(k: PoiKit, land: number): number {
  return Math.round(Math.max(land, k.D * (1 - k.num('sea', 45) / 100)) / 32) * 32;
}

const SEA_PARAM = { key: 'sea', label: 'Sea (% of depth)', type: 'number' as const, default: 45, hint: 'The back of the POI is sea; it needs displacement terrain to be lowered' };

/** A pier on poles from the shore out into the sea along +y: a deck units walk on, poles to the seabed. */
function pier(k: PoiKit, x: number, y0: number, y1: number, w: number): void {
  k.box(rect(x - w / 2, y0 - 32, x + w / 2, y1), 0, 8, DECK);
  for (let y = y0 + 64; y <= y1 - 8; y += 128) for (const dx of [-w / 2 + 8, w / 2 - 8]) k.cylinder(x + dx, y, 7, -136, 0, POLE, 6);
  // Bollards along the edge.
  for (let y = y0 + 128; y <= y1 - 32; y += 256) k.cylinder(x + w / 2 - 12, y, 6, 8, 28, POLE, 6);
}

/**
 * A dock: a quay along the shore with crates, containers and a crane, and piers on poles running out over the
 * water (narrow walkways: chokepoints), with boats tied up beside them and buoys further out.
 */
export const DOCK: PoiType = {
  id: 'dock', label: 'Dock', icon: '⚓', hint: 'Narrow walkways over water: chokepoints. The back of the POI is sea.',
  landscapes: ['beach', 'city'], minSize: [1024, 1024], maxSize: [3072, 3072], defaultSize: [1536, 1536],
  params: [
    { key: 'piers', label: 'Piers', type: 'number', default: 2, hint: '1 to 4' },
    { key: 'boats', label: 'Boats', type: 'number', default: 3 },
    { key: 'crane', label: 'Dock crane', type: 'check', default: false },
    SEA_PARAM,
  ],
  gameplay: { capture: true, scrap: true, units: ['combine', 'rebel'] },
  build(k) {
    const { W, D } = k;
    const sy = shore(k, 448);
    k.pad(rect(0, 0, W, sy), QUAY.top, 2);
    // The quay edge: a concrete wall down to the seabed.
    k.box(rect(0, sy - 16, W, sy), -136, 2, QUAY);
    k.route([0, sy - 128], [W, sy - 128]);
    k.sea(rect(0, sy, W, D));
    const n = Math.max(1, Math.min(4, Math.round(k.num('piers', 2))));
    const pw = 160;
    const xs = Array.from({ length: n }, (_, i) => Math.round((W * (i + 1)) / (n + 1)));
    for (const x of xs) {
      pier(k, x, sy, D - 96, pw);
      k.route([x, sy - 64], [x, D - 96]);
    }
    // Boats moored beside the piers.
    let boats = Math.max(0, Math.round(k.num('boats', 3)));
    for (const x of xs) for (const side of [-1, 1]) {
      if (boats <= 0) break;
      const bx = x + side * (pw / 2 + 56), by = sy + k.rng.range(220, Math.max(240, D - sy - 260));
      if (bx < 60 || bx > W - 60) continue;
      const model = k.rng.pick(['props_canal/boat001a', 'props_canal/boat002b_static', 'lostcoast/props_wasteland/boat_wooden01a_static']);
      if (k.prop(model, bx, by, 90 + k.rng.range(-6, 6), { z: -16, dz: -12, force: true })) boats--;
    }
    // Buoys between the piers (off their walkways).
    for (let i = 0; i < 3; i++) {
      const bx = k.rng.range(64, W - 64);
      if (xs.some((px) => Math.abs(px - bx) < pw / 2 + 48)) continue;
      k.prop('props_wasteland/buoy01', bx, k.rng.range(D - 200, D - 48), 0, { z: -16, dz: -130, force: true, noOccupy: true });
    }
    // The quay: containers, crates, drums, a crane, a bollard row.
    k.scatter(['props_wasteland/cargo_container01', 'props_wasteland/cargo_container01b', 'props/crates/containerload'], rect(64, 64, W - 64, sy - 224), 2, { margin: 24, yaw: 'right' });
    k.scatter(['props_junk/wood_crate001a_static', 'props_junk/wood_crate002a_static', 'props_c17/oildrum001_static', 'props_junk/wood_pallet001a_static'], rect(64, 64, W - 64, sy - 224), 8, { margin: 8 });
    if (k.flag('crane')) k.prop('cranes/crane_docks', 160, sy - 120, 0, { margin: 16 });
    for (let x = 96; x < W - 64; x += 256) if (!xs.some((px) => Math.abs(px - x) < 128)) k.cylinder(x, sy - 32, 8, 2, 26, { top: 'METAL/METALPIPE001A', bottom: NODRAW, sides: 'METAL/METALPIPE001A' }, 6);
    k.gameplay([xs[0] + 200, sy - 256]);
  },
};

/** A lifeguard tower: four legs, a deck at 128 with a rail, a slanted roof and a ladder. */
function lifeguard(k: PoiKit, x: number, y: number): void {
  const s = 48, h = 128;
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(rect(x + dx * s - 5, y + dy * s - 5, x + dx * s + 5, y + dy * s + 5), -4, h + 96, POLE);
  k.box(rect(x - s - 8, y - s - 8, x + s + 8, y + s + 8), h - 8, h, DECK);
  for (const r of [rect(x - s - 8, y + s + 4, x + s + 8, y + s + 8), rect(x - s - 8, y - s - 8, x - s - 4, y + s + 4), rect(x + s + 4, y - s - 8, x + s + 8, y + s + 4)]) k.box(r, h, h + 36, DECK);
  k.slope(rect(x - s - 16, y - s - 16, x + s + 16, y + s + 16), 'y', h + 92, h + 104, 4, { top: 'METAL/METALROOF005A', bottom: 'WOOD/WOODWALL009A', sides: 'WOOD/WOODWALL009A' });
  k.prop('props_forest/ladderwood', x, y - s - 22, 90, { force: true, noOccupy: true, pitch: -12, z: 0 });
  k.occupied.push(rect(x - s - 16, y - s - 40, x + s + 16, y + s + 16));
}

/**
 * A beach front: sand down to the sea, a row of beach huts (from the interior generator), umbrellas, chairs
 * and blankets, a lifeguard tower, driftwood, and a rock breakwater running out into the water.
 */
export const BEACH: PoiType = {
  id: 'beach', label: 'Beach front', icon: '🏖', hint: 'Scattered soft cover and one tall lookout. The back is sea.',
  landscapes: ['beach'], minSize: [1280, 1024], maxSize: [4096, 3072], defaultSize: [1792, 1536],
  params: [
    { key: 'huts', label: 'Beach huts', type: 'number', default: 3 },
    { key: 'umbrellas', label: 'Umbrellas', type: 'number', default: 6 },
    { key: 'breakwater', label: 'Breakwater', type: 'check', default: true },
    SEA_PARAM,
  ],
  gameplay: { capture: true, units: ['antlion', 'combine', 'rebel'] },
  build(k) {
    const { W, D } = k;
    const sy = shore(k, 640);
    k.pad(rect(0, 0, W, sy), SAND, 2);
    k.sea(rect(0, sy, W, D));
    k.route([0, 224], [W, 224]);
    k.route([W * 0.5, 0], [W * 0.5, sy - 32]);
    // Huts in a row at the back of the beach, doors to the sea.
    const n = Math.max(0, Math.min(6, Math.round(k.num('huts', 3))));
    const hw = 160, hd = 160, gap = 96;
    let x = 64;
    for (let i = 0; i < n && x + hw <= W - 64; ) {
      if (Math.abs(x + hw / 2 - W * 0.5) < hw / 2 + 96) { x += gap; continue; }
      k.house(rect(x, 48 + 128 + 64, x + hw, 48 + 128 + 64 + hd), { storeys: 1, furnish: 'none', doors: ['n'] });
      x += hw + gap;
      i++;
    }
    lifeguard(k, W * 0.78, sy - 200);
    // Umbrellas with chairs and blankets on the sand.
    const um = Math.max(0, Math.round(k.num('umbrellas', 6)));
    for (let t = 0, placed = 0; t < um * 10 && placed < um; t++) {
      const ux = k.rng.range(120, W - 120), uy = k.rng.range(sy - 300, sy - 120);
      if (!k.prop('pg_props/pg_deko/pg_beach_umbrella', ux, uy, k.rng.int(0, 359), { margin: 32 })) continue;
      placed++;
      k.prop(k.rng.pick(['pg_props/pg_deko/pg_beach_chair', 'pg_props/pg_deko/pg_beach_blanket']), ux + k.rng.range(-60, 60), uy + k.rng.range(-80, -50), k.rng.int(0, 359), { margin: 2 });
    }
    k.scatter(['props_foliage/driftwood_01a', 'props_foliage/driftwood_clump_01a'], rect(64, sy - 120, W - 64, sy - 24), 3, { margin: 8 });
    // A breakwater of big rocks out into the sea.
    if (k.flag('breakwater')) {
      const bx = W * 0.2;
      for (let y = sy + 64; y < D - 96; y += 150) k.prop(k.rng.pick(COAST_ROCKS), bx + k.rng.range(-30, 30), y, k.rng.int(0, 359), { z: -128, dz: 0, force: true });
    }
    k.gameplay([W * 0.5 + 200, sy - 360]);
  },
};

/**
 * A shipwreck: a big fishing boat beached on its side half in the water, its cargo (containers, crates,
 * drums) spilled along the sand, rocks and driftwood. Cover plus scrap.
 */
export const SHIPWRECK: PoiType = {
  id: 'shipwreck', label: 'Shipwreck', icon: '🚢', hint: 'Cover plus scrap on a beach. The back is sea.',
  landscapes: ['beach'], minSize: [1408, 1280], maxSize: [3072, 3072], defaultSize: [1792, 1536],
  params: [SEA_PARAM, { key: 'scrap', label: 'Scrap piles', type: 'number', default: 2 }],
  gameplay: { capture: true, scrap: true, units: ['zombie', 'headcrab', 'antlion'] },
  build(k) {
    const { W, D } = k;
    const sy = shore(k, 768);
    k.pad(rect(0, 0, W, sy), SAND, 2);
    k.sea(rect(0, sy, W, D));
    k.route([0, 192], [W, 192]);
    k.route([W * 0.2, 0], [W * 0.2, sy - 32]);
    // The hull lies along the shore on its side, its keel to the land.
    const hx = W * 0.6, hy = sy - 40;
    k.prop('props_wasteland/boat_fishing01a', hx, hy, 90 + k.rng.range(-12, 12), { roll: -78, force: true, dz: -120 });
    k.occupied.push(rect(hx - 600, hy - 260, hx + 600, hy + 300));
    // Spilled cargo on the sand.
    k.scatter(['props_wasteland/cargo_container01', 'props_wasteland/cargo_container01c'], rect(96, 320, W - 96, sy - 300), 2, { margin: 32, yaw: 'any' });
    k.scatter(['props_junk/wood_crate001a_static', 'props_junk/wood_crate002a_static', 'props_c17/oildrum001_static', 'props_junk/wood_pallet001a_static', 'props_borealis/bluebarrel001_static'], rect(64, 256, W - 64, sy - 32), 12, { margin: 8 });
    k.scatter(SMALL_ROCKS, rect(64, 64, W - 64, sy - 32), 5, { margin: 16 });
    k.scatter(['props_foliage/driftwood_01a', 'props_foliage/driftwood_clump_01a'], rect(64, 64, W - 64, sy - 32), 3, { margin: 8 });
    k.gameplay([W * 0.2 + 220, sy - 420], [[W * 0.42, sy - 360], [W * 0.82, sy - 380]]);
  },
};

/**
 * A lighthouse point: a stone lighthouse (a tapering tower with a gallery, a lantern room and a cap, built like
 * the buildings' corner towers) on a rocky point by the sea, the keeper's house (interior generator), a path
 * and rocks. A landmark; the rocky point is low high ground.
 */
export const LIGHTHOUSE: PoiType = {
  id: 'lighthouse', label: 'Lighthouse point', icon: '🗼', hint: 'A landmark on a rocky point with a keeper\'s house. The back is sea.',
  landscapes: ['beach', 'rocky'], minSize: [1280, 1280], maxSize: [2560, 2560], defaultSize: [1536, 1536],
  params: [SEA_PARAM, { key: 'lights', label: 'Light on', type: 'check', default: true }],
  gameplay: { capture: true, units: ['combine', 'rebel'] },
  build(k) {
    const { W, D } = k;
    const sy = shore(k, 896);
    k.pad(rect(0, 0, W, sy), 'NATURE/DIRTFLOOR006A', 2);
    k.sea(rect(0, sy, W, D));
    k.route([0, 160], [W, 160]);
    // The point: a raised rock platform (16 high) at the shore, the tower on it, a path to it.
    const tx = W * 0.62, ty = sy - 240;
    k.path([[tx - 200, 160], [tx - 200, ty]], 'NATURE/DIRTFLOOR008A', 160, 3);
    k.cylinder(tx, ty, 200, -136, 16, STONE, 12);
    k.occupied.push(rect(tx - 200, ty - 200, tx + 200, ty + 200));
    const plain = { material: 'PLASTER/PLASTERWALL003A', bays: 0 };
    const body = towerSolids(k.doc, {
      centre: k.world(tx, ty).round(), radius: 96, sides: 12, z0: k.z + 16, z1: k.z + 512,
      windows: plain, trim: { material: 'CONCRETE/CONCRETEWALL001A', bays: 0 }, plain, cap: 'dome', capMaterial: 'METAL/METALROOF003A',
    });
    k.out.detail.push(...body.solids);
    // A gallery round the top, and the lantern room's glow.
    k.ring(tx, ty, 132, 96, 500, 512, { top: 'METAL/METALFLOOR001A', bottom: 'METAL/METALFLOOR001A', sides: 'METAL/METALRAIL001A' }, 12);
    k.occupied.pop();
    if (k.flag('lights')) k.light(tx, ty, 560, '255 245 200 900', 3000);
    // Rocks round the point and along the shore.
    for (let i = 0; i < 10; i++) {
      const a = k.rng.range(-Math.PI, Math.PI), r = k.rng.range(220, 360);
      k.prop(k.rng.pick(COAST_ROCKS), tx + Math.cos(a) * r, ty + Math.sin(a) * r * 0.7, k.rng.int(0, 359), { margin: 0, z: Math.sin(a) > 0.3 ? -128 : undefined });
    }
    // The keeper's house, its door to the path.
    k.house(rect(W * 0.12, 320, W * 0.12 + 384, 320 + 288), { storeys: 1, furnish: 'sparse', doors: ['s', 'e'] });
    k.scatter(SMALL_ROCKS, rect(64, 64, W - 64, sy - 32), 6, { margin: 16 });
    k.gameplay([tx - 360, ty - 120]);
  },
};

/**
 * A coastal bunker: a Combine bunker on a dune overlooking the beach, trenches dug either side of it lined
 * with sandbags, barricades and a mortar, the sea at the back.
 */
export const BUNKER: PoiType = {
  id: 'bunker', label: 'Coastal bunker', icon: '🛡', hint: 'A hard point overlooking the beach, with trenches.',
  landscapes: ['beach', 'rocky'], minSize: [1280, 1024], maxSize: [3072, 2560], defaultSize: [1664, 1408],
  params: [SEA_PARAM, { key: 'trenches', label: 'Trenches', type: 'check', default: true }],
  gameplay: { capture: true, units: ['combine', 'combine_elite', 'rebel'] },
  build(k) {
    const { W, D } = k;
    const sy = shore(k, 768);
    k.pad(rect(0, 0, W, sy), SAND, 2);
    k.sea(rect(0, sy, W, D));
    k.route([0, 160], [W, 160]);
    k.route([W * 0.5, 0], [W * 0.5, sy - 32]);
    // The bunker on the dune, its slit to the sea.
    const bx = W * 0.5 + 320, by = sy * 0.55;
    k.prop('props_combine/combine_bunker01', bx, by, 90, { margin: 16 });
    // Trenches: shallow cuts in the terrain either side, lined with sandbags.
    if (k.flag('trenches')) {
      for (const [x0, x1] of [[96, W * 0.5 - 128], [W * 0.5 + 560, W - 96]]) {
        if (x1 - x0 < 160) continue;
        const y = sy * 0.62;
        k.pit(rect(x0, y - 48, x1, y + 48), 40);
        k.sandbags([x0, y + 72], [x1, y + 72], 2);
        k.sandbags([x0, y - 72], [x1, y - 72], 1);
      }
    }
    for (let i = 0; i < 4; i++) k.prop(k.rng.pick(['props_combine/combine_barricade_short02a', 'props_combine/combine_barricade_med01a']), k.rng.range(96, W - 96), k.rng.range(sy - 220, sy - 96), k.rng.int(0, 359), { margin: 16 });
    k.prop('props_combine/combine_mortar01a', bx - 260, by - 120, 0, { margin: 16 });
    k.scatter(['pg_props/pg_obj/ja_combine_crate', 'pg_props/pg_obj/ja_combine_crate_big'], rect(64, 220, W - 64, sy * 0.5), 4, { margin: 16, yaw: 'right' });
    k.scatter(SMALL_ROCKS, rect(64, 64, W - 64, sy - 32), 5, { margin: 16 });
    k.gameplay([W * 0.5 - 220, sy * 0.3]);
  },
};
