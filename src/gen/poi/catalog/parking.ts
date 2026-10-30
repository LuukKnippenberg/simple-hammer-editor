import { NODRAW, rect } from '../kit.ts';
import type { PoiType } from '../types.ts';

const ASPHALT = 'CONCRETE/CONCRETEFLOOR033A';
const CARS = ['props_vehicles/car002a', 'props_vehicles/car003a', 'props_vehicles/car004a', 'props_vehicles/car005a', 'props_vehicles/car001a_hatchback', 'props_vehicles/car001b_hatchback', 'props_vehicles/van001a'];
const WRECKS = ['props_vehicles/car002b', 'props_vehicles/car003b', 'props_vehicles/car004b', 'props_vehicles/car005b'];
const BAY_W = 128;
const BAY_D = 256;
const AISLE = 192;
const EDGE = 48;
const BOOTH = { top: 'METAL/METALROOF005A', bottom: NODRAW, sides: 'BUILDING_TEMPLATE/BUILDING_TEMPLATE003A' };

/**
 * Rows of marked bays along aisles (the aisles and an end lane are the routes), cars parked in some of the
 * bays with small random turns, a few wrecks, a ticket booth by the entrance, lamp posts and kerbs.
 */
export const PARKING: PoiType = {
  id: 'parking', label: 'Parking lot', icon: '🅿', hint: 'Rows of hard cover (cars) with open lanes between them.',
  landscapes: ['city'], minSize: [768, 704], maxSize: [3072, 2048], defaultSize: [1408, 1152],
  params: [
    { key: 'rows', label: 'Rows of bays', type: 'number', default: 4, hint: '1 to 6; fewer when the lot is not deep enough' },
    { key: 'occupancy', label: 'Cars (%)', type: 'number', default: 60 },
    { key: 'wrecks', label: 'Wrecks', type: 'number', default: 2 },
    { key: 'booth', label: 'Ticket booth', type: 'check', default: true },
    { key: 'lights', label: 'Lights on', type: 'check', default: false },
  ],
  gameplay: { capture: true, scrap: true },
  build(k) {
    const { W, D } = k;
    k.pad(k.bounds, ASPHALT);
    // Bands across the depth: rows of bays face an aisle; back-to-back rows share their back line.
    const want = Math.max(1, Math.min(6, Math.round(k.num('rows', 4))));
    const bandsFor = (n: number) => {
      const out: ('row' | 'aisle')[] = [];
      for (let i = 0; i < n; i++) {
        out.push('row');
        if (i % 2 === 0) out.push('aisle');
      }
      return out;
    };
    let rows = want;
    const depth = (bands: ('row' | 'aisle')[]) => bands.reduce((s, b) => s + (b === 'row' ? BAY_D : AISLE), 0);
    while (rows > 1 && depth(bandsFor(rows)) > D - 2 * EDGE) rows--;
    const bands = bandsFor(rows);
    let y = Math.round((D - depth(bands)) / 2);
    // The end lane on the right joins the aisles to both long sides.
    const lane = rect(W - EDGE - AISLE, 0, W - EDGE, D);
    k.route([lane.x0 + AISLE / 2, 0], [lane.x0 + AISLE / 2, D], AISLE);
    const boothW = k.flag('booth') ? 160 : 0;
    const x0 = EDGE, x1 = lane.x0 - boothW;
    const nBays = Math.max(1, Math.floor((x1 - x0) / BAY_W));
    const bx0 = x0 + Math.floor((x1 - x0 - nBays * BAY_W) / 2);
    const occupancy = Math.max(0, Math.min(100, k.num('occupancy', 60))) / 100;
    const rowsAt: { y0: number; facing: 1 | -1 }[] = [];
    bands.forEach((band, i) => {
      if (band === 'aisle') {
        k.route([0, y + AISLE / 2], [W, y + AISLE / 2], AISLE);
      } else {
        // A row faces the aisle next to it.
        const facing: 1 | -1 = bands[i + 1] === 'aisle' ? 1 : -1;
        rowsAt.push({ y0: y, facing });
      }
      y += band === 'row' ? BAY_D : AISLE;
    });
    const bays: [number, number, 1 | -1][] = [];
    for (const r of rowsAt) {
      for (let i = 0; i <= nBays; i++) k.line([bx0 + i * BAY_W, r.y0 + 8], [bx0 + i * BAY_W, r.y0 + BAY_D - 8], 6);
      for (let i = 0; i < nBays; i++) bays.push([bx0 + i * BAY_W + BAY_W / 2, r.y0 + BAY_D / 2, r.facing]);
    }
    // Lamp posts at the row ends on the left, arms over the bays; the capture point in the middle bays.
    for (const r of rowsAt) k.lamp(EDGE / 2 + 8, r.y0 + BAY_D / 2, 0);
    k.gameplay([bx0 + Math.floor(nBays / 2) * BAY_W + BAY_W / 2, rowsAt[0].y0 + BAY_D / 2]);
    // Wrecks first (they take any bay), then parked cars nose to the aisle.
    let wrecks = Math.max(0, k.num('wrecks', 2));
    const order = bays.map((b) => [k.rng.next(), b] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
    for (const [bx, by, f] of order) {
      if (wrecks > 0 && k.rng.chance(0.5)) {
        const roof = k.rng.chance(0.3);
        if (k.prop(k.rng.pick(WRECKS), bx, by, (f > 0 ? 90 : 270) + k.rng.range(-35, 35), { roll: roof ? 180 : 0 })) { wrecks--; continue; }
      }
      if (!k.rng.chance(occupancy)) continue;
      k.prop(k.rng.pick(CARS), bx, by - f * 12, (f > 0 ? 90 : 270) + k.rng.range(-6, 6));
    }
    if (boothW) {
      const r = rect(lane.x0 - 136, EDGE + 24, lane.x0 - 24, EDGE + 160);
      if (k.isFree(r, 0)) {
        k.box(r, -8, 104, BOOTH, { occupy: true });
        k.box(rect(r.x0 - 12, r.y0 - 12, r.x1 + 12, r.y1 + 12), 104, 112, BOOTH);
        k.prop('props_c17/concrete_barrier001a', lane.x0 - 12, r.y1 + 72, 0, { force: true });
      }
    }
    k.perimeter('kerb', 6);
  },
};
