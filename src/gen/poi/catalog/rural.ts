import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';

const DIRT = 'NATURE/DIRTFLOOR003A';
const GRASS = 'NATURE/DIRTFLOOR006A';
const FIELD = 'NATURE/MUDFLOOR001A';
const PLANKS = { top: 'WOOD/WOODWALL009A', bottom: NODRAW, sides: 'WOOD/WOODWALL009A' };
const BARN_ROOF = { top: 'METAL/METALROOF005A', bottom: 'WOOD/WOODWALL009A', sides: 'WOOD/WOODWALL009A' };
const STONE = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'STONE/STONEWALL017A' };
const BEAM = { top: 'WOOD/WOODBEAM001A', bottom: NODRAW, sides: 'WOOD/WOODBEAM001A' };
const DECK = { top: 'WOOD/WOODFLOOR005A', bottom: 'WOOD/WOODFLOOR005A', sides: 'WOOD/WOODWALL009A' };
const CONCRETE = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: 'CONCRETE/CONCRETECEILING001A', sides: 'CONCRETE/CONCRETEWALL001A' };
const CLIP = 'TOOLS/TOOLSNPCCLIP';
const GRAVES = ['props_c17/gravestone001a', 'props_c17/gravestone002a', 'props_c17/gravestone003a', 'props_c17/gravestone004a', 'props_c17/gravestone_cross001a', 'props_c17/gravestone_cross001b', 'brush/cross_stone01'];
const DEAD_TREES = ['props_foliage/tree_dead03', 'props_foliage/tree_dead04', 'props_foliage/tree_dry02'];

/**
 * A barn: an open-fronted shed of plank walls (one side open to the yard) under a pitched roof, so units can
 * walk in and take cover. `open` is the local side without a wall.
 */
function barn(k: PoiKit, r: { x0: number; y0: number; x1: number; y1: number }, open: 's' | 'n'): void {
  const h = 192, t = 8;
  const walls = [rect(r.x0, r.y0, r.x0 + t, r.y1), rect(r.x1 - t, r.y0, r.x1, r.y1)];
  walls.push(open === 's' ? rect(r.x0 + t, r.y1 - t, r.x1 - t, r.y1) : rect(r.x0 + t, r.y0, r.x1 - t, r.y0 + t));
  for (const w of walls) k.box(w, -4, h, PLANKS, { occupy: true });
  // Posts along the open side, and the roof: two slopes meeting over the middle.
  const fy = open === 's' ? r.y0 : r.y1;
  for (let x = r.x0 + 4; x <= r.x1 - 4; x += Math.max(128, (r.x1 - r.x0 - 8) / 3)) k.box(rect(x - 6, fy - 6, x + 6, fy + 6), -4, h, BEAM);
  const my = (r.y0 + r.y1) / 2;
  k.slope(rect(r.x0 - 16, r.y0 - 24, r.x1 + 16, my), 'y', h, h + 72, 6, BARN_ROOF);
  k.slope(rect(r.x0 - 16, my, r.x1 + 16, r.y1 + 24), 'y', h + 72, h, 6, BARN_ROOF);
  // Gable ends.
  for (const x of [r.x0, r.x1 - t]) k.extrude([[r.y0, h], [r.y1, h], [my, h + 72]], 'x', x, x + t, PLANKS);
}

/**
 * A farmstead: a farmhouse (from the interior generator), an open barn, a fenced field, a well, hay bales,
 * tractor tyres, a trough and a generator round a dirt yard. The house can be garrisoned once the interiors
 * branch lands; until then it is a closed box.
 */
export const FARMSTEAD: PoiType = {
  id: 'farmstead', label: 'Farmstead', icon: '🏡', hint: 'A garrisonable house, a barn and fenced fields.',
  landscapes: ['forest'], minSize: [1408, 1152], maxSize: [3072, 3072], defaultSize: [1792, 1536],
  params: [
    { key: 'field', label: 'Fenced field', type: 'check', default: true },
    { key: 'storeys', label: 'House storeys', type: 'number', default: 1, hint: '1 or 2' },
  ],
  gameplay: { capture: true, scrap: true, units: ['zombie', 'rebel', 'combine'] },
  build(k) {
    const { W, D } = k;
    k.route([0, 448], [W, 448]);
    k.route([W * 0.5, 0], [W * 0.5, D]);
    // The yard between house and barn.
    k.pad(rect(W * 0.5 - 320, 192, W * 0.5 + 320, D - 64), DIRT, 2);
    // The farmhouse on the left, its door to the yard (east).
    const hw = Math.min(448, W * 0.5 - 448), hd = 320;
    k.house(rect(W * 0.5 - 320 - 64 - hw, D - 96 - hd, W * 0.5 - 320 - 64, D - 96), { storeys: Math.round(k.num('storeys', 1)) >= 2 ? 2 : 1, furnish: 'sparse', doors: ['e', 's'] });
    // The barn on the right, open to the yard (south side faces the route).
    const bw = Math.min(512, W * 0.5 - 448), bd = 384;
    barn(k, rect(W * 0.5 + 384, D - 96 - bd, W * 0.5 + 384 + bw, D - 96), 's');
    k.scatter(['props_outland/haybale_large'], rect(W * 0.5 + 400, D - 96 - bd + 24, W * 0.5 + 384 + bw - 24, D - 120), 4, { margin: 4, yaw: 'right' });
    // The well in the yard: a stone ring with two posts and a little roof.
    const wx = W * 0.5 + 200, wy = D * 0.62;
    k.ring(wx, wy, 44, 32, -4, 36, STONE, 10);
    k.cylinder(wx, wy, 33, -4, 2, { top: 'NATURE/MUDFLOOR001A', bottom: NODRAW, sides: NODRAW }, 10);
    for (const dx of [-40, 40]) k.box(rect(wx + dx - 4, wy - 4, wx + dx + 4, wy + 4), 36, 112, BEAM);
    k.extrude([[wy - 56, 108], [wy + 56, 108], [wy, 140]], 'x', wx - 56, wx + 56, { top: 'WOOD/WOODSHINGLES002A', bottom: 'WOOD/WOODWALL009A', sides: 'WOOD/WOODWALL009A' });
    // The field in front: furrowed earth inside a fence with a gate on the route.
    if (k.flag('field')) {
      const f = rect(64, 64, W - 64, 448 - 96);
      if (f.y1 - f.y0 >= 160) {
        k.pad(rect(f.x0, f.y0, W * 0.5 - 96, f.y1), FIELD, 3);
        k.pad(rect(W * 0.5 + 96, f.y0, f.x1, f.y1), FIELD, 3);
      }
    }
    k.perimeter('farm', 24);
    // Farm clutter round the yard.
    k.prop('props_outland/trough_farm01', W * 0.5 - 220, D * 0.6, 0);
    k.prop('props_outland/generator_static01a', W * 0.5 + 300, D - 96 - bd - 80, 0);
    k.scatter(['props_vehicles/tire001a_tractor_static', 'props_outland/haybale_large', 'props_junk/wood_crate001a_static', 'props_c17/oildrum001_static', 'props_junk/wood_pallet001a_static'], rect(96, 512, W - 96, D - 96), 8, { margin: 12 });
    k.scatter(['props_foliage/tree_deciduous_01a', 'props_foliage/tree_pine06', 'props_foliage/mall_tree_medium01'], rect(64, 512, W - 64, D - 64), 3, { margin: 48 });
    k.gameplay([W * 0.5 + 40, D * 0.55]);
  },
};

/** A small chapel: a nave (interior house, door to the graveyard) and a stone bell tower. */
function chapel(k: PoiKit, r: { x0: number; y0: number; x1: number; y1: number }): void {
  k.house(r, { storeys: 1, furnish: 'none', doors: ['s'] });
  const tx = (r.x0 + r.x1) / 2, ty = r.y1 + 64;
  k.box(rect(tx - 64, ty - 64, tx + 64, ty + 64), -4, 320, STONE, { occupy: true });
  k.cylinder(tx, ty, 72, 320, 448, { top: 'METAL/METALROOF003A', bottom: NODRAW, sides: 'METAL/METALROOF003A' }, 4, 0);
}

/**
 * A graveyard: rows of gravestones and crosses inside a low stone wall with gates, dead trees, a statue, a
 * small chapel (from the interior generator) and a Ravenholm sign. A zombie spawn site.
 */
export const GRAVEYARD: PoiType = {
  id: 'graveyard', label: 'Graveyard and chapel', icon: '⚰', hint: 'Low cover in rows; a zombie spawn site (Ravenholm).',
  landscapes: ['forest', 'city'], minSize: [1152, 1024], maxSize: [3072, 3072], defaultSize: [1536, 1408],
  params: [
    { key: 'chapel', label: 'Chapel', type: 'check', default: true },
    { key: 'ravenholm', label: 'Ravenholm look', type: 'check', default: true, hint: 'Dead trees, open graves, a Ravenholm sign' },
  ],
  gameplay: { capture: true, units: ['zombie', 'fastzombie', 'poisonzombie', 'headcrab'] },
  build(k) {
    const { W, D } = k;
    k.pad(k.bounds, GRASS);
    const ravenholm = k.flag('ravenholm');
    // A main path through the middle and a cross path between the rows.
    const cx = W / 2;
    k.path([[cx, 0], [cx, D]], DIRT, 128);
    k.path([[0, D * 0.42], [W, D * 0.42]], DIRT, 128);
    // The chapel at the back.
    if (k.flag('chapel')) {
      const cw = 320, cd = 448;
      chapel(k, rect(cx + 192, D - 96 - cd - 128, cx + 192 + cw, D - 96 - 128));
    }
    // Rows of graves facing the main path: each a headstone and a mound (or an open pit).
    const rowsY: number[] = [];
    for (let y = 160; y < D - 128; y += 112) rowsY.push(y);
    for (const y of rowsY) {
      for (let x = 112; x < W - 112; x += 80) {
        if (k.rng.chance(0.18)) continue;
        const g = k.rng.pick(GRAVES);
        if (!k.prop(g, x, y, 0 + k.rng.range(-6, 6), { margin: 2 })) continue;
        // The grave in front of the stone.
        const pit = ravenholm && k.rng.chance(0.12);
        k.box(rect(x - 16, y - 76, x + 16, y - 16), pit ? -4 : -4, pit ? 0 : 6, { top: pit ? 'NATURE/MUDFLOOR001A' : 'NATURE/DIRTFLOOR003A', bottom: NODRAW, sides: 'NATURE/DIRTFLOOR003A' });
        k.occupied.push(rect(x - 18, y - 78, x + 18, y - 14));
      }
    }
    k.prop('props_c17/gravestone_statue001a', cx - 160, D * 0.42 + 120, 270, { margin: 8 });
    if (ravenholm) {
      k.scatter(DEAD_TREES, rect(64, 64, W - 64, D - 64), 6, { margin: 32 });
      // The sign on two posts beside the gate.
      k.prop('props_junk/ravenholmsign', cx - 176, 64, 0, { z: 72, force: true, noOccupy: true });
      for (const x of [cx - 236, cx - 116]) k.box(rect(x - 5, 66, x + 5, 76), -4, 96, BEAM, { occupy: true });
      k.scatter(['props_c17/gravestone_coffinpiece002a', 'props_junk/wood_crate001a_static'], rect(96, 96, W - 96, D - 96), 3, { margin: 8 });
    } else {
      k.scatter(['props_foliage/tree_deciduous_01a', 'props_foliage/mall_tree_medium01'], rect(64, 64, W - 64, D - 64), 4, { margin: 32 });
    }
    k.perimeter('wall', 16, { height: 40 });
    k.gameplay([cx - 160, D * 0.42 - 120]);
  },
};

/**
 * A lookout tower: a wooden or concrete watchtower whose platform (at 256) is high ground with long sight,
 * reached by an NPC-clip ramp hidden inside a stair of planks, on a low mound with rocks and trees round it.
 */
export const LOOKOUT: PoiType = {
  id: 'lookout', label: 'Lookout tower', icon: '🗼', hint: 'High ground with long sight, one way up.',
  landscapes: ['forest', 'rocky', 'beach'], minSize: [768, 768], maxSize: [1536, 1536], defaultSize: [1152, 1024],
  params: [
    { key: 'material', label: 'Tower', type: 'select', default: 'wood', options: [{ value: 'wood', label: 'Wood' }, { value: 'concrete', label: 'Concrete' }] },
    { key: 'height', label: 'Platform height', type: 'number', default: 256, hint: '128 to 384' },
  ],
  gameplay: { capture: true, units: ['rebel', 'combine'] },
  build(k) {
    const { W, D } = k;
    const [cx, cy] = k.centre;
    k.crossRoute('x', cy - 256);
    const s = 96;
    // The stair runs 1.25 units per unit of height (under the navmesh's 45° limit) from the deck's west edge to
    // the POI's edge: a POI too small for the height asked for gets a lower platform.
    const room = cx - s - 32 - 48;
    const h = Math.max(128, Math.min(384, Math.round(k.num('height', 256) / 16) * 16, Math.floor(room / 1.25 / 16) * 16));
    const wood = k.str('material') !== 'concrete';
    // The legs or the concrete shaft, the deck and its parapet.
    if (wood) {
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(rect(cx + dx * s - 8, cy + dy * s - 8, cx + dx * s + 8, cy + dy * s + 8), -4, h + 112, BEAM);
      // Cross bracing at two levels.
      for (const z of [h * 0.35, h * 0.7]) for (const [a, b] of [[[-s, -s], [s, -s]], [[-s, s], [s, s]]] as [number, number][][]) k.box(rect(cx + a[0], cy + a[1] - 3, cx + b[0], cy + b[1] + 3), z, z + 8, BEAM);
    } else {
      k.box(rect(cx - s, cy - s, cx + s, cy + s), -4, h - 16, CONCRETE, { occupy: true });
    }
    const deck = rect(cx - s - 32, cy - s - 32, cx + s + 32, cy + s + 32);
    k.box(deck, h - 16, h, wood ? DECK : CONCRETE);
    for (const r of [rect(deck.x0, deck.y0, deck.x1, deck.y0 + 8), rect(deck.x0, deck.y1 - 8, deck.x1, deck.y1), rect(deck.x1 - 8, deck.y0 + 8, deck.x1, deck.y1 - 8)]) k.box(r, h, h + 40, wood ? DECK : CONCRETE);
    k.slope(rect(deck.x0 - 16, deck.y0 - 16, deck.x1 + 16, deck.y1 + 16), 'x', h + 112, h + 96, 6, { top: 'METAL/METALROOF005A', bottom: 'METAL/METALROOF005A', sides: 'METAL/METALROOF005A' });
    k.occupied.push(rect(cx - s - 16, cy - s - 16, cx + s + 16, cy + s + 16));
    // The stair: plank steps 16 high rising to the deck's open west side, with a clip ramp over them for the
    // navmesh.
    const run = h * 1.25;
    const sx1 = deck.x0, sx0 = sx1 - run;
    const sy0 = cy - 48, sy1 = cy + 48;
    if (sx0 >= 32) {
      const n = h / 16;
      for (let i = 0; i < n; i++) {
        const x0 = sx0 + (run * i) / n, x1 = sx0 + (run * (i + 1)) / n;
        k.box(rect(x0, sy0, x1, sy1), (i + 1) * 16 - 8, (i + 1) * 16, DECK);
      }
      for (let x = sx0 + 64; x < sx1; x += 128) for (const y of [sy0, sy1 - 6]) k.box(rect(x - 3, y, x + 3, y + 6), -4, ((x - sx0) / run) * h, BEAM);
      const ramp = k.slope(rect(sx0 - 16, sy0, sx1, sy1), 'x', 0, h, 4, CLIP);
      k.out.detail.splice(k.out.detail.indexOf(ramp), 1);
      k.out.world.push(ramp);
      k.keepClear(rect(sx0 - 96, sy0 - 32, sx1, sy1 + 32));
    }
    // A low mound of rocks and a few trees round it.
    for (let i = 0; i < 8; i++) {
      const a = k.rng.range(0, Math.PI * 2), r = k.rng.range(220, Math.min(W, D) / 2 - 80);
      k.prop(k.rng.pick(['props_foliage/rock_forest01', 'props_wasteland/rockgranite02a', 'cliffs/rocks_medium02', 'props_foliage/forestrock_cluster01']), cx + Math.cos(a) * r, cy + Math.sin(a) * r, k.rng.int(0, 359), { margin: 16 });
    }
    k.scatter(['props_foliage/tree_pine06', 'props_foliage/tree_pine04'], rect(48, 48, W - 48, D - 48), 3, { margin: 64 });
    k.gameplay([cx + s + 160, cy + 120]);
  },
};
