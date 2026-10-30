import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';

const GRASS = 'NATURE/DIRTFLOOR006A';
const GRAVEL = 'NATURE/DIRTFLOOR008A';
const STONE = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'STONE/STONEWALL017A' };
const WOOD = { top: 'WOOD/WOODFLOOR005A', bottom: NODRAW, sides: 'WOOD/WOODWALL009A' };
const ROOF = { top: 'METAL/METALROOF005A', bottom: 'WOOD/WOODWALL009A', sides: 'METAL/METALROOF005A' };
const TREES = ['props_foliage/mall_tree_medium01', 'props_foliage/mall_tree_medium01', 'props_foliage/tree_deciduous_01a', 'props_foliage/tree_pine06'];
const BUSHES = ['props_foliage/mall_bush01', 'props_foliage/mall_bush02', 'props_foliage/shrub_small', 'props_foliage/bush2'];
const BENCH = 'props_trainstation/benchoutdoor01a';
const BIN = 'props_junk/trashbin01a';

/** Room the centre feature takes (radius); the path loop runs outside it. */
const FEATURE_R: Record<string, number> = { pond: 256, fountain: 160, bandstand: 176, none: 96 };

function centre(k: PoiKit, kind: string, cx: number, cy: number): void {
  if (kind === 'pond') {
    // A raised ornamental pond: a stone rim round a muddy floor (dry until POI phase 6 brings water).
    k.ring(cx, cy, 256, 236, -8, 28, STONE, 20);
    k.cylinder(cx, cy, 238, -8, 4, { top: 'NATURE/MUDFLOOR001A', bottom: NODRAW, sides: NODRAW }, 20);
    for (let i = 0; i < 5; i++) {
      const a = k.rng.range(0, Math.PI * 2);
      k.prop('props_foliage/rock_forest01', cx + Math.cos(a) * 190, cy + Math.sin(a) * 190, k.rng.int(0, 359), { force: true, z: 4, noOccupy: true });
    }
  } else if (kind === 'fountain') {
    k.ring(cx, cy, 160, 140, -8, 28, STONE, 16);
    k.cylinder(cx, cy, 142, -8, -2, { top: 'CONCRETE/CONCRETEFLOOR039A', bottom: NODRAW, sides: NODRAW }, 16);
    k.cylinder(cx, cy, 24, -2, 72, STONE, 10);
    k.cylinder(cx, cy, 64, 72, 88, STONE, 12, 72);
  } else if (kind === 'bandstand') {
    // A low octagonal stage units can step onto (16 high), posts and a pointed roof.
    k.cylinder(cx, cy, 176, -8, 16, WOOD, 8);
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      k.cylinder(cx + Math.cos(a) * 150, cy + Math.sin(a) * 150, 6, 16, 152, WOOD, 6);
    }
    k.cylinder(cx, cy, 196, 152, 160, ROOF, 8);
    k.cylinder(cx, cy, 196, 160, 232, ROOF, 8, 0);
    k.occupied.push(rect(cx - 176, cy - 176, cx + 176, cy + 176));
  }
}

/**
 * A park: gravel paths from the four sides to a loop round a centre feature (pond, fountain or bandstand),
 * grass, clusters of trees and bushes, benches and bins along the paths, and hedges round the edge with gaps
 * at the paths (fog-of-war blockers on request).
 */
export const PARK: PoiType = {
  id: 'park', label: 'Park', icon: '🌳', hint: 'Vision blockers (hedges, trees), soft cover and open lawns.',
  landscapes: ['forest', 'city'], minSize: [1280, 1280], maxSize: [4096, 4096], defaultSize: [1792, 1792],
  params: [
    { key: 'feature', label: 'Centre', type: 'select', default: 'pond', options: [
      { value: 'pond', label: 'Pond' }, { value: 'fountain', label: 'Fountain' }, { value: 'bandstand', label: 'Bandstand' }, { value: 'none', label: 'Lawn' }] },
    { key: 'trees', label: 'Tree density', type: 'number', default: 50, hint: '0 to 100' },
    { key: 'hedges', label: 'Hedges', type: 'check', default: true },
    { key: 'fow', label: 'Hedges block sight', type: 'check', default: true, hint: 'fow_blocker along the hedges' },
    { key: 'lamps', label: 'Lamp posts', type: 'check', default: true },
    { key: 'lights', label: 'Lights on', type: 'check', default: false },
  ],
  gameplay: { capture: true, units: ['zombie', 'fastzombie', 'headcrab'] },
  build(k) {
    const { W, D } = k;
    const [cx, cy] = k.centre;
    k.pad(k.bounds, GRASS);
    const kind = k.str('feature');
    const fr = FEATURE_R[kind] ?? 96;
    const loopR = fr + 128;
    // The loop round the centre, then four winding spokes out to the middle of each side.
    const loop: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      loop.push([Math.round(cx + Math.cos(a) * loopR), Math.round(cy + Math.sin(a) * loopR)]);
    }
    k.path(loop, GRAVEL);
    const spokes: [number, number][][] = [];
    for (const [ex, ey, a] of [[0, cy, Math.PI], [W, cy, 0], [cx, 0, -Math.PI / 2], [cx, D, Math.PI / 2]] as [number, number, number][]) {
      const start: [number, number] = [Math.round(cx + Math.cos(a) * loopR), Math.round(cy + Math.sin(a) * loopR)];
      // A bend halfway, pushed sideways a little.
      const mx = (start[0] + ex) / 2, my = (start[1] + ey) / 2;
      const side = k.rng.range(-1, 1) * Math.min(160, Math.hypot(ex - start[0], ey - start[1]) / 4);
      const bend: [number, number] = [Math.round(mx - Math.sin(a) * side), Math.round(my + Math.cos(a) * side)];
      const pts: [number, number][] = [start, bend, [ex, ey]];
      spokes.push(pts);
      k.path(pts, GRAVEL);
    }
    centre(k, kind, cx, cy);
    k.keepClear(rect(cx - fr, cy - fr, cx + fr, cy + fr));
    k.gameplay([cx, cy - loopR - 160]);
    // Benches and bins beside the spokes, facing the path.
    for (const pts of spokes) {
      const [a, b] = [pts[1], pts[2]];
      const yaw = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      const nx = -Math.sin((yaw * Math.PI) / 180), ny = Math.cos((yaw * Math.PI) / 180);
      const t = 0.45;
      const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      k.prop(BENCH, px + nx * 104, py + ny * 104, yaw + 90);
      k.prop(BIN, px + nx * 96 + (b[0] - a[0]) * 0.1, py + ny * 96 + (b[1] - a[1]) * 0.1, 0);
      if (k.flag('lamps')) k.lamp(px - nx * 96, py - ny * 96, yaw + 90);
    }
    // Benches round the loop, facing the centre.
    for (let i = 0; i < 4; i++) {
      const a = ((i + 0.5) / 4) * Math.PI * 2;
      k.prop(BENCH, cx + Math.cos(a) * (loopR + 100), cy + Math.sin(a) * (loopR + 100), (a * 180) / Math.PI);
    }
    if (k.flag('hedges')) k.perimeter('hedge', 56, { fow: k.flag('fow') });
    // Tree clusters on the lawns, bushes under them.
    const density = Math.max(0, Math.min(100, k.num('trees', 50))) / 100;
    const clusters = Math.round(((W * D) / 600000) * density) + 1;
    for (let c = 0; c < clusters; c++) {
      const x = k.rng.range(200, W - 200), y = k.rng.range(200, D - 200);
      k.scatter(TREES, rect(x - 220, y - 220, x + 220, y + 220), k.rng.int(2, 4), { margin: 64 });
      k.scatter(BUSHES, rect(x - 260, y - 260, x + 260, y + 260), k.rng.int(1, 3), { margin: 16 });
    }
  },
};
