import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';

const GRAVEL = 'NATURE/GRAVELFLOOR003A';
const DIRT = 'NATURE/DIRTFLOOR003A';
const CONCRETE = 'CONCRETE/CONCRETEFLOOR001A';
const WRECKS = ['props_vehicles/car002b', 'props_vehicles/car003b', 'props_vehicles/car004b', 'props_vehicles/car005b', 'props_vehicles/car001b_hatchback'];
const SLAB = { top: 'CONCRETE/CONCRETEFLOOR028A', bottom: 'CONCRETE/CONCRETECEILING001A', sides: 'CONCRETE/CONCRETEWALL001A' };
const COLUMN = { top: 'CONCRETE/CONCRETEWALL001A', bottom: NODRAW, sides: 'CONCRETE/CONCRETEWALL001A' };
const BRICK = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'BRICK/BRICKWALL045A' };
const POLE = { top: 'METAL/METALPIPE001A', bottom: NODRAW, sides: 'METAL/METALPIPE001A' };
const PLANK = { top: 'WOOD/WOODFLOOR005A', bottom: 'WOOD/WOODFLOOR005A', sides: 'WOOD/WOODWALL009A' };
const TANK = { top: 'METAL/METALROOF005A', bottom: NODRAW, sides: 'METAL/METALHULL003A' };
const BUND = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'CONCRETE/CONCRETEWALL001A' };

/** A heap (sand, gravel, scrap): a low frustum with a rounded top. */
function heap(k: PoiKit, x: number, y: number, r: number, h: number, material: string): void {
  const m = { top: material, bottom: NODRAW, sides: material };
  k.cylinder(x, y, r, -4, h * 0.55, m, 10, r * 0.55);
  k.cylinder(x, y, r * 0.55, h * 0.55, h, m, 10, r * 0.12);
  k.occupied.push(rect(x - r, y - r, x + r, y + r));
}

/**
 * A fenced junkyard: rows and stacks of car wrecks, tyre stacks, dumpsters and containers, scrap heaps, and
 * scrap piles (scrap_marker) rebels can harvest.
 */
export const JUNKYARD: PoiType = {
  id: 'junkyard', label: 'Junkyard', icon: '♻', hint: 'A scrap source (scrap_marker) with hard cover.',
  landscapes: ['city', 'forest'], minSize: [1024, 896], maxSize: [3072, 3072], defaultSize: [1408, 1152],
  params: [
    { key: 'fence', label: 'Fence', type: 'select', default: 'chainlink', options: [{ value: 'chainlink', label: 'Chain-link' }, { value: 'barbed', label: 'Barbed wire' }, { value: 'none', label: 'None' }] },
    { key: 'stacks', label: 'Stacked wrecks', type: 'check', default: true },
    { key: 'scrap', label: 'Scrap piles', type: 'number', default: 3 },
  ],
  gameplay: { capture: true, scrap: true, units: ['zombie', 'rebel'] },
  build(k) {
    const { W, D } = k;
    const [cx, cy] = k.centre;
    k.pad(k.bounds, GRAVEL);
    k.crossRoute('x');
    k.crossRoute('y');
    // Scrap spots first, one per quadrant, so they keep the room workers need.
    const quads: [number, number][] = [[W * 0.27, D * 0.28], [W * 0.73, D * 0.72], [W * 0.73, D * 0.28], [W * 0.27, D * 0.72]];
    k.gameplay([cx + 192, cy + 192], quads);
    // Rows of wrecks along the edges, some with another wreck on top.
    const stacks = k.flag('stacks');
    for (const [y, yaw] of [[112, 0], [D - 112, 180]] as [number, number][]) {
      for (let x = 128; x < W - 128; x += 200) {
        if (!k.prop(k.rng.pick(WRECKS), x, y, yaw + k.rng.range(-15, 15), { margin: 4 })) continue;
        if (stacks && k.rng.chance(0.5)) k.prop(k.rng.pick(WRECKS), x + k.rng.range(-10, 10), y, yaw + k.rng.range(-25, 25), { dz: 52, force: true, noOccupy: true, roll: k.rng.chance(0.3) ? 180 : 0 });
      }
    }
    // Containers and big dumpsters along the sides.
    for (const [x, yaw] of [[96, 0], [W - 96, 0]] as [number, number][]) {
      for (let y = 288; y < D - 288; y += 420) k.prop(k.rng.pick(['props_wasteland/cargo_container01', 'props_wasteland/cargo_container01b', 'brush/dumpster_rolloff01']), x, y, yaw + k.rng.range(-4, 4), { margin: 4 });
    }
    // Tyre stacks, scrap heaps and loose junk in the yard.
    k.scatter(['props_silo/tirestack', 'props_silo/tirestack3', 'props_vehicles/tire001b_truck_static', 'props_vehicles/tire001a_tractor_static'], rect(64, 64, W - 64, D - 64), Math.round((W * D) / 120000), { margin: 16 });
    for (let i = 0; i < Math.round((W * D) / 700000) + 1; i++) {
      const x = k.rng.range(220, W - 220), y = k.rng.range(220, D - 220), r = k.rng.range(80, 130);
      if (k.isFree(rect(x - r - 16, y - r - 16, x + r + 16, y + r + 16))) heap(k, x, y, r, r * 0.7, 'NATURE/DIRTFLOOR008A');
    }
    k.scatter(['props_lab/scrapyarddumpster_static', 'props_junk/trashdumpster02', 'props_vehicles/van001a_nodoor', 'props_vehicles/truck002a_cab'], rect(96, 96, W - 96, D - 96), 3, { margin: 24 });
    k.scatter(['props_junk/ibeam01b_cluster01', 'props_c17/oildrum001_static', 'props_junk/wood_pallet001a_static', 'props_pipes/concrete_pipe001a'], rect(64, 64, W - 64, D - 64), 8, { margin: 8 });
    const fence = k.str('fence');
    if (fence !== 'none') k.perimeter(fence === 'barbed' ? 'barbed' : 'chainlink', 16);
  },
};

/** Scaffolding along a local line: poles every 128, planks at each 128-high level, a ladder-free frame. */
function scaffold(k: PoiKit, x0: number, x1: number, y: number, depth: number, levels: number): void {
  for (let x = x0; x <= x1 + 1; x += 128) for (const dy of [0, depth]) k.box(rect(x - 3, y + dy - 3, x + 3, y + dy + 3), -4, levels * 128 + 40, POLE);
  for (let l = 1; l <= levels; l++) {
    k.box(rect(x0 - 4, y - 4, x1 + 4, y + depth + 4), l * 128 - 4, l * 128, PLANK);
    for (const dy of [0, depth]) k.box(rect(x0, y + dy - 2, x1, y + dy + 2), l * 128 + 36, l * 128 + 40, POLE);
  }
  k.occupied.push(rect(x0 - 8, y - 8, x1 + 8, y + depth + 8));
}

/**
 * A construction site: a fenced dirt yard round a half-built concrete frame (a foundation units can stand on,
 * columns, a part-finished upper slab and a brick wall going up), scaffolding along one side, a crane, sand
 * and gravel heaps, containers, a bulldozer, pipes, pallets and steel beams.
 */
export const CONSTRUCTION: PoiType = {
  id: 'construction', label: 'Construction site', icon: '🏗', hint: 'Height and cover with many lanes.',
  landscapes: ['city'], minSize: [1152, 1024], maxSize: [3072, 3072], defaultSize: [1536, 1280],
  params: [
    { key: 'crane', label: 'Crane', type: 'check', default: true },
    { key: 'floors', label: 'Floors built', type: 'number', default: 2, hint: '1 to 3' },
  ],
  gameplay: { capture: true, scrap: true },
  build(k) {
    const { W, D } = k;
    const [cx, cy] = k.centre;
    k.pad(k.bounds, DIRT);
    k.crossRoute('x', cy - 352);
    k.crossRoute('y', 192);
    // The building: a foundation 16 high (units step onto it), columns on a grid, upper slabs.
    const bw = Math.min(768, W - 576), bd = Math.min(512, D - 576);
    const b = rect(cx - bw / 2 + 96, cy - bd / 2 + 96, cx + bw / 2 + 96, cy + bd / 2 + 96);
    k.box(b, -8, 16, SLAB, { occupy: true });
    const floors = Math.max(1, Math.min(3, Math.round(k.num('floors', 2))));
    const nx = Math.round(bw / 192), ny = Math.round(bd / 192);
    for (let f = 0; f < floors; f++) {
      const z0 = 16 + f * 160;
      // Columns everywhere on the lowest floor, fewer higher up.
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
        if (f > 0 && (i > nx * (1 - f * 0.3) || k.rng.chance(0.15))) continue;
        const x = b.x0 + 16 + ((bw - 32) * i) / nx, y = b.y0 + 16 + ((bd - 32) * j) / ny;
        k.box(rect(x - 12, y - 12, x + 12, y + 12), z0, z0 + 144, COLUMN);
      }
      // The slab above: whole over the first floor, cut back higher up.
      if (f < floors) {
        const cut = f === 0 ? 1 : 0.6 - f * 0.15;
        k.box(rect(b.x0, b.y0, b.x0 + bw * cut, b.y1), z0 + 144, z0 + 160, SLAB);
      }
    }
    // A brick wall going up along the back, rebar-less but ragged on top.
    for (let x = b.x0; x < b.x1 - 32; x += 64) k.box(rect(x, b.y1 - 16, x + 64, b.y1), 16, 16 + k.rng.int(2, 7) * 16, BRICK);
    scaffold(k, b.x0, b.x0 + 384, b.y0 - 64, 48, floors);
    if (k.flag('crane')) {
      const x = b.x1 + 160, y = b.y1 - 96;
      if (k.isFree(rect(x - 140, y - 140, x + 140, y + 140))) k.prop('cranes/crane_frame', x, y, k.rng.int(0, 3) * 90);
    }
    // Heaps of sand and gravel, materials and machines in the yard.
    heap(k, W - 200, 200, 120, 96, 'NATURE/DIRTFLOOR004A');
    if (k.isFree(rect(W - 520, 80, W - 300, 320))) heap(k, W - 410, 200, 96, 72, GRAVEL);
    k.prop('props_wasteland/cargo_container01', 120, D - 260, 0, { margin: 16 });
    k.prop('props/vehicles/bulldozer/bulldozer', W - 260, D - 200, k.rng.int(0, 359), { margin: 16 });
    k.scatter(['props_pipes/concrete_pipe001a', 'props_pipes/concrete_pipe001b', 'props_junk/wood_pallet001a_static', 'props_junk/ibeam01a', 'props_junk/cinderblock01a_large', 'props_c17/oildrum001_static'], rect(64, 64, W - 64, D - 64), 10, { margin: 12 });
    k.perimeter('border', 16);
    k.gameplay([b.x0 + 120, b.y0 + 120]);
  },
};

/**
 * A tank farm: big storage tanks on concrete bunds, smaller vertical and horizontal tanks, pipe runs between
 * them on supports, a pump house and a barbed fence. Big hard cover; explosive barrels on request.
 */
export const TANKFARM: PoiType = {
  id: 'tankfarm', label: 'Tank farm', icon: '🛢', hint: 'Big hard cover: storage tanks, pipes, a fence.',
  landscapes: ['city', 'rocky'], minSize: [1152, 1152], maxSize: [3072, 3072], defaultSize: [1536, 1408],
  params: [
    { key: 'tanks', label: 'Big tanks', type: 'number', default: 4, hint: '1 to 6' },
    { key: 'explosive', label: 'Explosive barrels', type: 'check', default: true },
  ],
  gameplay: { capture: true },
  build(k) {
    const { W, D } = k;
    const [cx, cy] = k.centre;
    k.pad(k.bounds, CONCRETE);
    k.crossRoute('x');
    k.crossRoute('y');
    // Big tanks in the four quadrants (up to two each), each in a low bund.
    const n = Math.max(1, Math.min(6, Math.round(k.num('tanks', 4))));
    const spots: [number, number][] = [];
    for (const [qx, qy] of [[0.25, 0.27], [0.75, 0.73], [0.75, 0.27], [0.25, 0.73]]) spots.push([W * qx, D * qy]);
    const tanks: [number, number][] = [];
    for (let i = 0; i < n && i < 6; i++) {
      const [sx, sy] = spots[i % 4];
      const r = Math.min(200, Math.min(W, D) / 4 - 112) - (i >= 4 ? 64 : 0);
      const x = i >= 4 ? sx + (sx < cx ? -1 : 1) * 40 : sx, y = sy;
      const bund = rect(x - r - 32, y - r - 32, x + r + 32, y + r + 32);
      if (!k.isFree(bund, 0)) continue;
      // The bund wall (16 high), the tank and its roof.
      for (const q of [rect(bund.x0, bund.y0, bund.x1, bund.y0 + 12), rect(bund.x0, bund.y1 - 12, bund.x1, bund.y1), rect(bund.x0, bund.y0 + 12, bund.x0 + 12, bund.y1 - 12), rect(bund.x1 - 12, bund.y0 + 12, bund.x1, bund.y1 - 12)]) k.box(q, -4, 16, BUND);
      const h = k.rng.int(16, 24) * 16;
      k.cylinder(x, y, r, -4, h, TANK, 16);
      k.cylinder(x, y, r, h, h + r * 0.25, { top: 'METAL/METALROOF005A', bottom: NODRAW, sides: 'METAL/METALROOF005A' }, 16, r * 0.15);
      // A pipe stub towards the pipe run.
      k.box(rect(x - 6, y - r - 24, x + 6, y - r), 24, 40, POLE);
      k.occupied.push(bund);
      tanks.push([x, y]);
    }
    // A pipe run on supports along the outer side of each row of tanks (away from the route in the middle).
    for (const y of [D * 0.27, D * 0.73]) {
      const py = y + (y < cy ? -1 : 1) * (Math.min(200, Math.min(W, D) / 4 - 112) + 64);
      if (py < 80 || py > D - 80) continue;
      for (let x = 160; x <= W - 160; x += 192) {
        if (Math.abs(x - cx) < 96) continue;
        k.box(rect(x - 6, py - 6, x + 6, py + 6), -4, 64, POLE);
      }
      for (const [x0, x1] of [[160, cx - 96], [cx + 96, W - 160]]) k.box(rect(x0, py - 8, x1, py + 8), 64, 80, POLE);
    }
    // The pump house in a free corner, and smaller tanks.
    const ph = rect(64, D - 280, 300, D - 64);
    if (k.isFree(ph)) {
      k.box(ph, -4, 128, { top: 'METAL/METALROOF005A', bottom: NODRAW, sides: 'CONCRETE/CONCRETEWALL001A' }, { occupy: true });
    }
    k.scatter(['props_mining/oiltank01', 'props_wasteland/horizontalcoolingtank04', 'props_wasteland/coolingtank02', 'brush/tank_storage01'], rect(96, 96, W - 96, D - 96), 3, { margin: 24, yaw: 'right' });
    k.scatter(['props_c17/oildrum001_static', 'props_borealis/bluebarrel001_static'], rect(64, 64, W - 64, D - 64), 6, { margin: 4 });
    if (k.flag('explosive')) k.scatter(['props_c17/oildrum001_explosive'], rect(64, 64, W - 64, D - 64), 4, { cls: 'prop_physics', margin: 4 });
    k.perimeter('barbed', 16);
    k.gameplay([cx + 160, cy + 160]);
  },
};
