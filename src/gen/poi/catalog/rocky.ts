import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { PoiType, Rect } from '../types.ts';

const ROCK = { top: 'NATURE/DIRTFLOOR004A', bottom: NODRAW, sides: 'NATURE/CLIFF03A' };
const ROCKTOP = { top: 'NATURE/ROCKWALL015A', bottom: NODRAW, sides: 'NATURE/CLIFF03A' };
const GRAVEL = 'NATURE/GRAVELFLOOR003A';
const DIRT = 'NATURE/DIRTFLOOR003A';
const TIMBER = { top: 'WOOD/WOODBEAM001A', bottom: 'WOOD/WOODBEAM001A', sides: 'WOOD/WOODBEAM001A' };
const CONVEYOR = { top: 'METAL/METALFLOOR006A', bottom: 'METAL/METALPIPE001A', sides: 'METAL/METALPIPE001A' };
const BOULDERS = ['cliffs/rocks_large01', 'cliffs/rocks_xlarge01', 'props_wasteland/rockcliff01b', 'cliffs/rocks_medium01', 'cliffs/rocks_medium02', 'props_foliage/rock_coast02c', 'lostcoast/props_wasteland/rock_coast01a'];
const STONES = ['props_wasteland/rockgranite02a', 'props_wasteland/rockgranite03a', 'props_foliage/rock_forest01', 'props_foliage/rock_forest02'];

/**
 * A rock plateau: a box of cliff sides `h` high over a local rectangle (with irregular boulders along its
 * edges) and a ramp up from the given side (1:3, dirt), the only way up.
 */
function plateau(k: PoiKit, r: Rect, h: number, ramp: { side: 's' | 'n' | 'e' | 'w'; at: number; width?: number } | null, mats = ROCKTOP): Rect | null {
  k.box(r, -8, h, mats, { occupy: true });
  if (!ramp) return null;
  const w = ramp.width ?? 160, run = h * 3;
  let rr: Rect;
  if (ramp.side === 's') { rr = rect(ramp.at - w / 2, r.y0 - run, ramp.at + w / 2, r.y0); k.slope(rr, 'y', 0, h, 8, ROCK); }
  else if (ramp.side === 'n') { rr = rect(ramp.at - w / 2, r.y1, ramp.at + w / 2, r.y1 + run); k.slope(rr, 'y', h, 0, 8, ROCK); }
  else if (ramp.side === 'w') { rr = rect(r.x0 - run, ramp.at - w / 2, r.x0, ramp.at + w / 2); k.slope(rr, 'x', 0, h, 8, ROCK); }
  else { rr = rect(r.x1, ramp.at - w / 2, r.x1 + run, ramp.at + w / 2); k.slope(rr, 'x', h, 0, 8, ROCK); }
  k.keepClear(rr);
  return rr;
}

/** Boulders along the foot of a rectangle's sides (except where a ramp meets it). */
function rubble(k: PoiKit, r: Rect, n: number, keep: Rect | null = null): void {
  for (let i = 0; i < n * 6 && n > 0; i++) {
    const side = k.rng.int(0, 3);
    const t = k.rng.next();
    const x = side < 2 ? r.x0 + (r.x1 - r.x0) * t : side === 2 ? r.x0 - 24 : r.x1 + 24;
    const y = side >= 2 ? r.y0 + (r.y1 - r.y0) * t : side === 0 ? r.y0 - 24 : r.y1 + 24;
    if (keep && x > keep.x0 - 64 && x < keep.x1 + 64 && y > keep.y0 - 64 && y < keep.y1 + 64) continue;
    if (k.prop(k.rng.pick(BOULDERS), x, y, k.rng.int(0, 359), { margin: 8 })) n--;
  }
}

/**
 * A quarry: stepped terraces of rock round a gravel floor (each step 64 high: too high to climb), one ramp
 * per terrace (the chokepoints), a conveyor down to the floor, mining carts on rails and a crane frame.
 */
export const QUARRY: PoiType = {
  id: 'quarry', label: 'Quarry', icon: '⛰', hint: 'Terraced high ground with ramp chokepoints.',
  landscapes: ['rocky'], minSize: [1536, 1536], maxSize: [3072, 3072], defaultSize: [2048, 1792],
  params: [{ key: 'terraces', label: 'Terraces', type: 'number', default: 2, hint: '1 to 3' }],
  gameplay: { capture: true, scrap: true, units: ['antlion', 'zombie', 'combine'] },
  build(k) {
    const { W, D } = k;
    const n = Math.max(1, Math.min(3, Math.round(k.num('terraces', 2))));
    // Terraces 288 deep and ramps 192 wide: room for large units (radius 58) on both.
    const step = 64, band = 288;
    k.pad(k.bounds, GRAVEL, 2);
    // The floor in the middle is the open ground; terraces rise round three sides (open to the front).
    const floor = rect(band * n + 64, 160, W - band * n - 64, D - band * n - 64);
    k.route([floor.x0 + 128, 0], [floor.x0 + 128, floor.y1 - 64]);
    for (let t = 0; t < n; t++) {
      const h = (n - t) * step;
      const inset = t * band;
      // Each terrace is a U: left, back and right strips at height h.
      const left = rect(inset, 160, inset + band, D - inset), right = rect(W - inset - band, 160, W - inset, D - inset), back = rect(inset + band, D - inset - band, W - inset - band, D - inset);
      for (const r of [left, back, right]) k.box(r, -8, h, ROCKTOP);
      for (const r of [left, back, right]) k.occupied.push(r);
    }
    // Ramps: from the floor onto the lowest terrace on the right, then up each terrace in turn (alternating
    // sides), 1:3 slopes cut into the step in front of them.
    for (let t = n - 1; t >= 0; t--) {
      const hTop = (n - t) * step, hBase = hTop - step;
      const inset = t * band;
      const onRight = (n - 1 - t) % 2 === 0;
      // On the level below (the next terrace in, or the floor), beside this terrace's side strip.
      const x = onRight ? W - inset - band - 96 : inset + band + 96;
      // Into the terrace face a little: a gap between ramp and face would cut the navmesh there.
      const y1 = D - inset - band + 8, y0 = y1 - step * 3;
      const rr = rect(x - 96, y0, x + 96, y1);
      k.slope(rr, 'y', hBase, hTop, 8, ROCK);
      k.keepClear(rect(rr.x0, rr.y0 - 96, rr.x1, rr.y1));
      k.out.routes.push(k.worldRect(rect(rr.x0, rr.y0, rr.x1, rr.y1)));
    }
    // A conveyor from the top terrace down to the floor, a crane frame, carts on rails across the floor.
    const top = n * step;
    k.slope(rect(W - 96, floor.y0 + 96, W - 48, floor.y0 + 96 + top * 4), 'y', 16, top + 24, 6, CONVEYOR);
    for (let y = floor.y0 + 128; y < floor.y0 + 96 + top * 4; y += 160) k.box(rect(W - 80, y - 4, W - 64, y + 4), -4, 16 + ((y - floor.y0 - 96) / (top * 4)) * top, CONVEYOR);
    k.prop('cranes/crane_frame', floor.x1 - 180, floor.y1 - 180, k.rng.int(0, 3) * 90, { margin: 8 });
    const ry = (floor.y0 + floor.y1) / 2;
    for (let x = floor.x0 + 256; x + 256 <= floor.x1; x += 512) k.prop('pg_props/pg_obj/pg_rail_512', x, ry, 90, { force: true, noOccupy: true });
    for (let i = 0; i < 3; i++) k.prop(k.rng.pick(['props_mining/flatbed_cart01', 'props_mining/flatbed_cart02']), floor.x0 + 320 + i * 220, ry, 90, { margin: 8 });
    k.scatter(STONES, floor, 8, { margin: 16 });
    k.scatter(['props/vehicles/bulldozer/bulldozer', 'props_mining/diesel_generator_static', 'props_c17/oildrum001_static'], floor, 3, { margin: 24 });
    k.gameplay([(floor.x0 + floor.x1) / 2 + 128, ry - 192]);
  },
};

/**
 * A mine entrance: a cliff face across the back (rock brushes with boulders in front), a timber-framed
 * tunnel mouth cut into it, rails running out of the tunnel with carts, lamps, and a spawn point inside for
 * enemy waves.
 */
export const MINE: PoiType = {
  id: 'mine', label: 'Mine entrance', icon: '⛏', hint: 'A chokepoint at a tunnel mouth; enemy waves spawn inside.',
  landscapes: ['rocky', 'forest'], minSize: [1024, 896], maxSize: [2560, 2048], defaultSize: [1408, 1152],
  params: [{ key: 'height', label: 'Cliff height', type: 'number', default: 384 }, { key: 'lights', label: 'Lamps lit', type: 'check', default: true }],
  gameplay: { capture: true, scrap: true, units: ['zombie', 'antlion', 'combine'] },
  build(k) {
    const { W, D } = k;
    const cx = W / 2;
    const h = Math.max(256, Math.min(768, k.num('height', 384)));
    const cy0 = D - 384;
    const mouth = 192;
    k.pad(rect(0, 0, W, cy0), DIRT, 2);
    // The cliff: two blocks either side of the tunnel and a lintel block over it, then the tunnel itself.
    k.box(rect(0, cy0, cx - mouth / 2, D), -8, h, ROCK, { occupy: true });
    k.box(rect(cx + mouth / 2, cy0, W, D), -8, h, ROCK, { occupy: true });
    k.box(rect(cx - mouth / 2, cy0, cx + mouth / 2, D), 192, h, ROCK, { occupy: true });
    k.box(rect(cx - mouth / 2, D - 32, cx + mouth / 2, D), -8, 192, { top: 'TOOLS/TOOLSBLACK', bottom: NODRAW, sides: 'TOOLS/TOOLSBLACK' });
    k.box(rect(cx - mouth / 2, cy0, cx + mouth / 2, D - 32), -8, 2, { top: DIRT, bottom: NODRAW, sides: NODRAW });
    // Timber frames along the tunnel, the first one at the mouth.
    for (let y = cy0 + 8; y < D - 48; y += 96) {
      for (const x of [cx - mouth / 2 + 8, cx + mouth / 2 - 16]) k.box(rect(x, y, x + 8, y + 12), 2, 184, TIMBER);
      k.box(rect(cx - mouth / 2 + 8, y, cx + mouth / 2 - 8, y + 12), 176, 192, TIMBER);
    }
    k.route([cx, 0], [cx, D - 48]);
    k.entity('info_target', cx, D - 96, 16, { targetname: `poi_${k.spec.uid}_tunnel` });
    // Rails out of the tunnel, carts beside them, lamps on the frame.
    for (let y = D - 96 - 256; y > 0; y -= 512) k.prop('pg_props/pg_obj/pg_rail_512', cx, y, 0, { force: true, noOccupy: true });
    k.prop('props_mining/flatbed_cart01', cx + 200, cy0 - 220, 0, { margin: 8 });
    k.prop('props_mining/flatbed_cart02', cx - 220, cy0 - 360, 0, { margin: 8 });
    for (const x of [cx - mouth / 2 - 24, cx + mouth / 2 + 24]) {
      k.prop('brush/lamp_industrial01', x, cy0 - 24, 90, { margin: 0 });
      if (k.flag('lights')) k.light(x, cy0 - 48, 200, '255 210 150 150', 500);
    }
    // Boulders along the cliff foot, timbers and crates.
    rubble(k, rect(0, cy0, W, D), 8, rect(cx - mouth, cy0 - 256, cx + mouth, D));
    k.scatter(['props_junk/wood_crate001a_static', 'props_c17/oildrum001_static', 'props_mining/diesel_generator_static', 'props_junk/wood_pallet001a_static'], rect(64, 64, W - 64, cy0 - 96), 6, { margin: 16 });
    k.gameplay([cx + 280, cy0 * 0.45]);
  },
};

/**
 * An overlook (sniper nest): a rock ledge with sandbags on its edge, reached by one ramp; boulders round its
 * foot. High ground with one way up.
 */
export const OVERLOOK: PoiType = {
  id: 'overlook', label: 'Overlook', icon: '🔭', hint: 'A rock ledge with sandbags and one way up.',
  landscapes: ['rocky', 'forest', 'beach'], minSize: [1024, 1024], maxSize: [2048, 2048], defaultSize: [1280, 1280],
  params: [{ key: 'height', label: 'Ledge height', type: 'number', default: 128, hint: '64 to 192' }],
  gameplay: { capture: true, units: ['rebel', 'combine'] },
  build(k) {
    const { W, D } = k;
    const h = Math.max(64, Math.min(192, Math.round(k.num('height', 128) / 16) * 16));
    k.route([0, 112], [W, 112]);
    const ledge = rect(W * 0.3, D * 0.45, W * 0.86, D * 0.9);
    const ramp = plateau(k, ledge, h, { side: 'w', at: ledge.y0 + 112 });
    // Sandbags along the front edge of the ledge, looking out over the front.
    k.sandbags([ledge.x0 + 160, ledge.y0 + 24], [ledge.x1 - 48, ledge.y0 + 24], 3);
    k.sandbags([ledge.x1 - 24, ledge.y0 + 48], [ledge.x1 - 24, ledge.y0 + 240], 2);
    k.prop('items/ammocrate_smg1_static', ledge.x1 - 120, ledge.y0 + 120, 0, { z: h, force: true });
    rubble(k, ledge, 7, ramp);
    k.scatter(STONES, rect(64, 200, W - 64, D - 64), 6, { margin: 16 });
    k.scatter(['props_foliage/tree_pine06', 'props_foliage/tree_dead04'], rect(64, 200, W - 64, D - 64), 2, { margin: 48 });
    k.gameplay([(ledge.x0 + ledge.x1) / 2 + 64, (ledge.y0 + ledge.y1) / 2 + 64]);
  },
};

/**
 * A rocky pass: a dirt road through a narrow gap between two rock masses (cliff brushes and boulders that
 * block sight), with a rockslide half blocking the road. A natural chokepoint.
 */
export const PASS: PoiType = {
  id: 'pass', label: 'Rocky pass', icon: '🪨', hint: 'A natural chokepoint: a road through a narrow gap.',
  landscapes: ['rocky'], minSize: [1024, 1024], maxSize: [3072, 3072], defaultSize: [1536, 1536],
  params: [
    { key: 'gap', label: 'Gap width', type: 'number', default: 320, hint: 'At least 192 (the slide narrows it to 128 or more)' },
    { key: 'height', label: 'Rock height', type: 'number', default: 256 },
    { key: 'fow', label: 'Rocks block sight', type: 'check', default: true },
  ],
  gameplay: { capture: true, units: ['antlion', 'zombie', 'combine'] },
  build(k) {
    const { W, D } = k;
    const cx = W / 2;
    const gap = Math.max(192, Math.min(W - 384, k.num('gap', 320)));
    const h = Math.max(128, Math.min(512, k.num('height', 256)));
    const pathW = 128, wiggle = Math.max(0, Math.min(48, gap / 2 - pathW / 2 - 32));
    k.path([[cx, 0], [cx + k.rng.range(-wiggle, wiggle), D / 2], [cx, D]], DIRT, pathW, 3);
    const clear = pathW / 2 + wiggle;
    // Two rock masses: stepped boxes, lower towards the ends of the pass, boulders on top and along the faces.
    const masses: Rect[] = [];
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? 0 : cx + gap / 2, x1 = side < 0 ? cx - gap / 2 : W;
      k.box(rect(x0, D * 0.28, x1, D * 0.72), -8, h, ROCKTOP);
      k.box(rect(x0, D * 0.12, x1, D * 0.28), -8, h * 0.55, ROCKTOP);
      k.box(rect(x0, D * 0.72, x1, D * 0.88), -8, h * 0.55, ROCKTOP);
      if (k.flag('fow')) k.fowStrip([(x0 + x1) / 2, D * 0.12], [(x0 + x1) / 2, D * 0.88], x1 - x0, h + 64);
      // Along the inner faces, as far into the gap as the route allows.
      for (let y = D * 0.16; y < D * 0.84; y += 200) {
        const m = k.rng.pick(BOULDERS.slice(0, 5));
        const fp = k.footprint(m, 0, 0, 0);
        const half = (fp.x1 - fp.x0) / 2;
        const fx = side < 0 ? x1 + Math.min(gap / 2 - clear - half - 4, 24) : x0 - Math.min(gap / 2 - clear - half - 4, 24);
        if (side < 0 ? fx + half > cx - clear : fx - half < cx + clear) continue;
        k.prop(m, fx, y + k.rng.range(-40, 40), 0, { margin: 0, force: true });
      }
      for (let i = 0; i < 3; i++) k.prop(k.rng.pick(BOULDERS), k.rng.range(x0 + 96, x1 - 96), k.rng.range(D * 0.32, D * 0.68), k.rng.int(0, 359), { z: h, force: true, noOccupy: true });
      masses.push(rect(x0, D * 0.12, x1, D * 0.88));
    }
    k.occupied.push(...masses);
    // The rockslide: boulders and stones from one side into the road, leaving 128 or more.
    const slideSide = k.rng.pick([-1, 1]);
    const y = D * k.rng.range(0.4, 0.6);
    for (let i = 0; i < 6; i++) k.prop(k.rng.pick(STONES.concat(['cliffs/rocks_medium02'])), cx + slideSide * k.rng.range(80, gap / 2), y + k.rng.range(-120, 120), k.rng.int(0, 359), { margin: 4 });
    k.overlay('overlays/rockslide01a', cx + slideSide * (gap / 4), y, gap / 2, 256, 90);
    k.scatter(STONES, rect(64, 64, W - 64, D * 0.12), 3, { margin: 16 });
    k.gameplay([cx, D * 0.06 + 96]);
  },
};

/**
 * A radio relay: the rebel radio tower on a rocky knoll (one ramp up), a shack, a generator and sandbags.
 */
export const RELAY: PoiType = {
  id: 'relay', label: 'Radio relay', icon: '📡', hint: 'An objective on a rocky knoll.',
  landscapes: ['rocky', 'forest'], minSize: [1024, 1024], maxSize: [2048, 2048], defaultSize: [1280, 1280],
  params: [{ key: 'height', label: 'Knoll height', type: 'number', default: 96 }],
  gameplay: { capture: true, units: ['rebel', 'combine'] },
  build(k) {
    const { W, D } = k;
    const h = Math.max(32, Math.min(192, Math.round(k.num('height', 96) / 16) * 16));
    k.route([0, 112], [W, 112]);
    const knoll = rect(W * 0.3, D * 0.4, W * 0.82, D * 0.86);
    const ramp = plateau(k, knoll, h, { side: 's', at: knoll.x0 + 120 });
    const tx = (knoll.x0 + knoll.x1) / 2 + 64, ty = (knoll.y0 + knoll.y1) / 2 + 48;
    k.prop('pg_props/pg_buildings/pg_rebel_radio_tower', tx, ty, 0, { z: h, force: true });
    k.prop('structures/resistance/shack', knoll.x1 - 150, knoll.y0 + 110, 180, { z: h, force: true });
    k.prop('props_outland/generator_static01a', tx - 140, ty + 30, 90, { z: h, force: true });
    k.sandbags([knoll.x0 + 240, knoll.y0 + 24], [knoll.x1 - 300, knoll.y0 + 24], 2);
    k.box(rect(knoll.x0, knoll.y0, knoll.x1, knoll.y1), h - 2, h + 1, { top: DIRT, bottom: NODRAW, sides: NODRAW });
    rubble(k, knoll, 6, ramp);
    k.scatter(STONES, rect(64, 200, W - 64, D - 64), 5, { margin: 16 });
    k.gameplay([knoll.x0 + 120, knoll.y0 - 300]);
  },
};

/**
 * A canal crossing (Route Kanal): a sunken canal across the POI with concrete walls too high to climb, water
 * in it, bridges over it (the chokepoints) and ladders down. The terrain is lowered under the canal.
 */
export const CANAL: PoiType = {
  id: 'canal', label: 'Canal crossing', icon: '🌉', hint: 'Chokepoints at the bridges over a sunken canal (needs terrain).',
  landscapes: ['city', 'forest'], minSize: [1024, 1024], maxSize: [4096, 2560], defaultSize: [1792, 1280],
  params: [
    { key: 'bridges', label: 'Bridges', type: 'number', default: 2, hint: '1 to 3' },
    { key: 'width', label: 'Canal width', type: 'number', default: 384 },
  ],
  gameplay: { capture: true, units: ['combine', 'metropolice', 'rebel'] },
  build(k) {
    const { W, D } = k;
    const cy = D / 2, cw = Math.max(256, Math.min(D - 512, k.num('width', 384)));
    const c = rect(0, cy - cw / 2, W, cy + cw / 2);
    const depth = 192;
    k.pad(rect(0, 0, W, c.y0), 'CONCRETE/CONCRETEFLOOR001A', 2);
    k.pad(rect(0, c.y1, W, D), 'CONCRETE/CONCRETEFLOOR001A', 2);
    k.pit(c, depth);
    // Walls down to the canal floor, the floor, water and a nav blocker in the water.
    for (const y of [c.y0, c.y1 - 16]) k.box(rect(0, y, W, y + 16), -depth - 8, 2, { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'CONCRETE/CONCRETEWALL001A' });
    k.box(rect(0, c.y0 + 16, W, c.y1 - 16), -depth - 16, -depth, { top: 'NATURE/MUDFLOOR001A', bottom: NODRAW, sides: NODRAW });
    k.water([[0, c.y0 + 16], [W, c.y0 + 16], [W, c.y1 - 16], [0, c.y1 - 16]], -96, -depth, 'NATURE/WATER_CANALS_WATER2');
    k.out.entities.push({ classname: 'func_nav_blocker', keys: { StartDisabled: '0' }, solids: [k.box(rect(0, c.y0 + 16, W, c.y1 - 16), -depth, -98, NODRAW)] });
    k.out.detail.pop();
    k.keepClear(c);
    // Bridges: concrete decks with railings, each a route across.
    const n = Math.max(1, Math.min(3, Math.round(k.num('bridges', 2))));
    for (let i = 0; i < n; i++) {
      const x = Math.round((W * (i + 1)) / (n + 1));
      k.box(rect(x - 96, c.y0 - 32, x + 96, c.y1 + 32), -24, 4, { top: 'CONCRETE/CONCRETEFLOOR028A', bottom: 'CONCRETE/CONCRETECEILING001A', sides: 'CONCRETE/CONCRETEWALL001A' });
      for (const dx of [-92, 88]) k.box(rect(x + dx, c.y0 - 32, x + dx + 4, c.y1 + 32), 4, 44, { top: 'METAL/METALRAIL001A', bottom: NODRAW, sides: 'METAL/METALRAIL001A' });
      k.route([x, 0], [x, D]);
    }
    // Ladders down the wall between the bridges (decoration: units cross on the bridges).
    for (let i = 0; i <= n; i++) {
      const x = Math.round((W * (i + 0.5)) / (n + 1));
      if (x < 64 || x > W - 64) continue;
      k.prop('props_forest/ladderwood', x, c.y0 + 20, 90, { force: true, noOccupy: true, z: -depth + 40 });
      k.prop('props_forest/ladderwood', x, c.y0 + 20, 90, { force: true, noOccupy: true, z: -depth + 180 });
    }
    k.scatter(['props_c17/oildrum001_static', 'props_junk/wood_crate001a_static', 'props_c17/concrete_barrier001a', 'props_junk/trashdumpster01a_static'], rect(64, 64, W - 64, c.y0 - 64), 4, { margin: 16 });
    k.scatter(['props_c17/oildrum001_static', 'props_junk/wood_crate001a_static', 'props_c17/concrete_barrier001a'], rect(64, c.y1 + 64, W - 64, D - 64), 4, { margin: 16 });
    k.gameplay([Math.round(W / (n + 1)), c.y0 - 200]);
  },
};
