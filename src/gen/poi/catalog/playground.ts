import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';

const SURFACES: Record<string, string> = { sand: 'NATURE/DIRTFLOOR008A', rubber: 'PROPS/RUBBERROOF001A', gravel: 'NATURE/GRAVELFLOOR002B' };
const FRAME = { top: 'WOOD/WOODBEAM001A', bottom: NODRAW, sides: 'WOOD/WOODBEAM001A' };
const BENCH = 'props_trainstation/benchoutdoor01a';
const DEBRIS = ['props_vehicles/tire001b_truck_static', 'props_junk/trashdumpster01a_static', 'props_c17/furniturecouch001a_static', 'props_c17/furnituremattress001a_static', 'props_junk/wood_crate001a_static', 'props_trainstation/trashcan_indoor001a', 'props_silo/tirestack3'];
const STAINS = ['decals/decalstain002a', 'decals/decalstain005a', 'overlays/leaves_ground03', 'decals/decalstain010a'];

/** One piece of equipment at a spot; returns false when it doesn't fit. */
const EQUIPMENT: ((k: PoiKit, x: number, y: number, yaw: number) => boolean)[] = [
  (k, x, y, yaw) => k.prop('props_c17/playground_swingset01', x, y, yaw, { margin: 72 }),
  (k, x, y, yaw) => k.prop('props_c17/playgroundslide01', x, y, yaw, { margin: 48 }),
  (k, x, y, yaw) => k.prop('props_c17/playground_carousel01', x, y, yaw, { margin: 48 }),
  (k, x, y, yaw) => k.prop('props_c17/playground_jungle_gym01a', x, y, yaw, { margin: 40 }),
  (k, x, y, yaw) => k.prop('props_c17/playground_jungle_gym01b', x, y, yaw, { margin: 40 }),
  (k, x, y, yaw) => {
    if (!k.prop('props_c17/playground_teetertoter_stan', x, y, yaw, { margin: 72 })) return false;
    // The see-saw's board rests on the stand, across it.
    k.prop('props_c17/playground_teetertoter_seat', x, y, yaw, { force: true, noOccupy: true, dz: 21 });
    k.occupied.push(rect(x - 72, y - 72, x + 72, y + 72));
    return true;
  },
  (k, x, y, yaw) => k.prop('props_c17/playgroundtick-tack-toe_post01', x, y, yaw, { margin: 32 }),
];

/**
 * A fenced playground: sand or rubber surface, a low wooden fence with gates where the route crosses,
 * three to six pieces of equipment spread out, a sandpit with a timber frame and benches facing in.
 * Abandoned: rubbish, tyres and stains, and some equipment missing.
 */
export const PLAYGROUND: PoiType = {
  id: 'playground', label: 'Playground', icon: '🛝', hint: 'Light cover and a clear landmark; a low fence with gates.',
  landscapes: ['city', 'forest'], minSize: [768, 640], maxSize: [2048, 2048], defaultSize: [1024, 896],
  params: [
    { key: 'surface', label: 'Surface', type: 'select', default: 'sand', options: [{ value: 'sand', label: 'Sand' }, { value: 'rubber', label: 'Rubber' }, { value: 'gravel', label: 'Gravel' }] },
    { key: 'equipment', label: 'Equipment', type: 'number', default: 5, hint: '3 to 6 pieces' },
    { key: 'fence', label: 'Fence', type: 'check', default: true },
    { key: 'sandpit', label: 'Sandpit', type: 'check', default: true },
    { key: 'abandoned', label: 'Abandoned', type: 'check', default: false },
  ],
  gameplay: { capture: true, units: ['zombie', 'fastzombie', 'headcrab'] },
  build(k) {
    const { W, D } = k;
    const [cx, cy] = k.centre;
    k.pad(k.bounds, SURFACES[k.str('surface')] ?? SURFACES.sand);
    k.crossRoute('x');
    // A second gate on the short sides' middle lets units cut across the other way too.
    k.route([cx, 0], [cx, 160]);
    k.route([cx, D - 160], [cx, D]);
    const abandoned = k.flag('abandoned');
    if (k.flag('sandpit')) {
      // In the larger half, away from the route.
      const sx = W * 0.27, sy = cy + 224;
      const s = rect(sx - 128, sy - 96, sx + 128, sy + 96);
      if (k.isFree(rect(s.x0 - 16, s.y0 - 16, s.x1 + 16, s.y1 + 16))) {
        k.box(rect(s.x0 + 8, s.y0 + 8, s.x1 - 8, s.y1 - 8), -8, 6, { top: 'NATURE/DIRTFLOOR004A', bottom: NODRAW, sides: NODRAW });
        for (const r of [rect(s.x0, s.y0, s.x1, s.y0 + 8), rect(s.x0, s.y1 - 8, s.x1, s.y1), rect(s.x0, s.y0 + 8, s.x0 + 8, s.y1 - 8), rect(s.x1 - 8, s.y0 + 8, s.x1, s.y1 - 8)]) k.box(r, -8, 14, FRAME);
        k.occupied.push(s);
      }
    }
    let n = Math.max(3, Math.min(6, Math.round(k.num('equipment', 5))));
    if (abandoned) n = Math.max(2, n - 2);
    // Equipment in shuffled order, each at the first free spot of a loose grid.
    const kinds = EQUIPMENT.map((_, i) => [k.rng.next(), i] as const).sort((a, b) => a[0] - b[0]).map((p) => EQUIPMENT[p[1]]);
    const spots: [number, number][] = [];
    for (let x = 160; x <= W - 160; x += 96) for (let y = 160; y <= D - 160; y += 96) spots.push([x, y]);
    let placed = 0;
    for (const place of kinds) {
      if (placed >= n) break;
      for (let t = 0; t < 30; t++) {
        const [x, y] = k.rng.pick(spots);
        if (place(k, x, y, k.rng.int(0, 3) * 90 + k.rng.range(-10, 10))) { placed++; break; }
      }
    }
    // Benches along the long sides, facing in.
    for (const x of [W * 0.2, W * 0.8]) {
      k.prop(BENCH, x, 72, 0);
      k.prop(BENCH, x, D - 72, 180);
    }
    if (abandoned) {
      k.scatter(DEBRIS, rect(64, 64, W - 64, D - 64), 6 + Math.round((W * D) / 400000));
      for (let i = 0; i < 6; i++) k.overlay(k.rng.pick(STAINS), k.rng.range(96, W - 96), k.rng.range(96, D - 96), k.rng.range(96, 192), k.rng.range(96, 192), k.rng.int(0, 359));
    } else {
      k.prop('props_junk/trashbin01a', 112, cy + 112, 0);
      k.prop('props_junk/trashbin01a', W - 112, cy - 112, 0);
    }
    for (const [x, y] of [[96, 96], [W - 96, D - 96]]) k.prop(k.rng.pick(['props_foliage/mall_tree_medium01', 'props_foliage/tree_deciduous_01a']), x, y, k.rng.int(0, 359), { force: true });
    if (k.flag('fence')) k.perimeter('wood', 10);
    else k.perimeter('kerb', 6);
    k.gameplay([cx, Math.max(160, cy - 224)]);
  },
};
