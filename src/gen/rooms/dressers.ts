import { Vector2, Vector3 } from 'three';
import type { VmfDocument } from '../../vmf/map.ts';
import type { KVNode } from '../../vmf/keyvalues.ts';
import { boxSolid } from '../../edit/brushes.ts';
import { PoiKit, rect, overlaps, inside } from '../poi/kit.ts';
import { breencast } from '../poi/catalog/combine.ts';
import type { PoiOutput, PoiType, Rect, Rotation } from '../poi/types.ts';
import { roomType, type RoomTypeInfo } from './types.ts';
import type { Doorway, RoomBox, RoomLayout, Side } from './model.ts';
import { TRIM } from './relief.ts';

/**
 * Furnishing rooms by their type. Each room is filled through a POI kit over its floor (so props stand on the
 * floor, keep off each other and off the routes, and fences come in whole pieces). Before anything is placed,
 * the room's doorways are kept clear and joined by walkways, so furniture never blocks a way through.
 *
 * The kit's local frame is turned per type: the train hall and hallway run along local x (their long side),
 * customs and rations face away from the main way in (it is on local south), the others keep the world's axes,
 * so the walls the camera sees (north and west, it looks north-west) are local north and west.
 */

const SIDES: Side[] = ['s', 'e', 'n', 'w'];

/** A doorway of the room in the kit's local frame. */
export interface LocalDoor {
  door: Doorway;
  /** The local edge it is on. */
  edge: Side;
  /** Along that edge (local x for s and n, local y for e and w). */
  from: number;
  to: number;
  mid: number;
  /** The area in front of it that stays clear (local). */
  clear: Rect;
}

export interface RoomContext {
  layout: RoomLayout;
  room: RoomBox;
  type: RoomTypeInfo;
  doors: LocalDoor[];
  /** The world side each local edge is on. */
  world: Record<Side, Side>;
  /** Wall height above the floor. */
  height: number;
  /** Decoration brushes in world coordinates (pillar bases and capitals), for the building's relief func_brush. */
  relief: KVNode[];
}

type Orient = 'world' | 'long' | 'entry';

export interface RoomDresser {
  orient: Orient;
  /** Lays its own floor (the train hall's ballast and platforms); otherwise the type's floor is laid first. */
  ownFloor?: boolean;
  /** Joins the doorways with walkways before dressing (default true). */
  walkways?: boolean;
  dress(k: PoiKit, ctx: RoomContext): void;
}

/** The world side a local edge lies on, for a kit turned by `rotation`. */
export const worldSide = (local: Side, rotation: Rotation): Side => SIDES[(SIDES.indexOf(local) + rotation / 90) % 4];

/** The side of the room a doorway is in. */
function doorSide(room: RoomBox, d: Doorway): Side {
  const r = room.rect;
  if (d.axis === 'x') return Math.abs(d.at - r.y0) < Math.abs(d.at - r.y1) ? 's' : 'n';
  return Math.abs(d.at - r.x0) < Math.abs(d.at - r.x1) ? 'w' : 'e';
}

/** The way into the room that matters most: a street door, else the widest opening. */
function mainDoor(room: RoomBox): Doorway | null {
  const rank = (d: Doorway) => (d.kind === 'street' ? 1e6 : 0) + (d.to - d.from);
  return [...room.doorways].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

function rotationFor(orient: Orient, room: RoomBox): Rotation {
  if (orient === 'long') return room.inner.x1 - room.inner.x0 >= room.inner.y1 - room.inner.y0 ? 0 : 90;
  if (orient === 'entry') {
    const d = mainDoor(room);
    if (!d) return 0;
    return ({ s: 0, e: 90, n: 180, w: 270 } as const)[doorSide(room, d)];
  }
  return 0;
}

/** Local point of a world point in a kit's frame. */
function toLocal(k: PoiKit, x: number, y: number): Vector2 {
  const o = k.world(0, 0), u = k.world(1, 0).sub(o), v = k.world(0, 1).sub(o);
  const p = new Vector2(x, y).sub(o);
  return new Vector2(Math.round(p.dot(u)), Math.round(p.dot(v)));
}

function localDoors(k: PoiKit, room: RoomBox, rotation: Rotation): LocalDoor[] {
  return room.doorways.map((d) => {
    const ws = doorSide(room, d);
    const edge = SIDES[(SIDES.indexOf(ws) - rotation / 90 + 4) % 4];
    const a = d.axis === 'x' ? toLocal(k, d.from, d.at) : toLocal(k, d.at, d.from);
    const b = d.axis === 'x' ? toLocal(k, d.to, d.at) : toLocal(k, d.at, d.to);
    const along = edge === 's' || edge === 'n' ? [a.x, b.x] : [a.y, b.y];
    const from = Math.min(...along), to = Math.max(...along), mid = (from + to) / 2;
    const depth = d.kind === 'door' ? 160 : 192;
    const clear = edge === 's' ? rect(from - 16, 0, to + 16, depth) : edge === 'n' ? rect(from - 16, k.D - depth, to + 16, k.D)
      : edge === 'w' ? rect(0, from - 16, depth, to + 16) : rect(k.W - depth, from - 16, k.W, to + 16);
    return { door: d, edge, from, to, mid, clear };
  });
}

/**
 * Walkways: from each doorway straight in to the room's middle line, and along that line between them, so every
 * way through the room stays open.
 */
function walkways(k: PoiKit, doors: LocalDoor[]): void {
  const cx = Math.round(k.W / 2), cy = Math.round(k.D / 2);
  const w = 128;
  const xs: number[] = [cx], ys: number[] = [cy];
  for (const d of doors) {
    k.keepClear(d.clear);
    const m = Math.round(d.mid);
    if (d.edge === 's') { k.route([m, 0], [m, cy], w); xs.push(m); }
    if (d.edge === 'n') { k.route([m, cy], [m, k.D], w); xs.push(m); }
    if (d.edge === 'w') { k.route([0, m], [cx, m], w); ys.push(m); }
    if (d.edge === 'e') { k.route([cx, m], [k.W, m], w); ys.push(m); }
  }
  if (Math.max(...xs) > Math.min(...xs)) k.route([Math.min(...xs), cy], [Math.max(...xs), cy], w);
  if (Math.max(...ys) > Math.min(...ys)) k.route([cx, Math.min(...ys)], [cx, Math.max(...ys)], w);
}

/** True when nothing reserved for a way through lies in a local rectangle. */
const offRoutes = (k: PoiKit, r: Rect) => inside(r, k.bounds) && !k.reserved.some((q) => overlaps(q, r));

const STONE = 'STONE/STONEWALL050A';
const NODRAW = 'TOOLS/TOOLSNODRAW';
const METAL = 'METAL/METALCOMBINE001';
const LUGGAGE = ['props_forest/footlocker01_closed', 'props_junk/cardboard_box001a_static', 'props_junk/wood_crate001a_static', 'props_junk/plasticcrate01a'];
const BIN = 'props_trainstation/trashcan_indoor001b';

/** A bin in each corner that is free (a little out from the walls). */
function cornerBins(k: PoiKit, n = 4): void {
  const spots: [number, number][] = [[40, 40], [k.W - 40, 40], [40, k.D - 40], [k.W - 40, k.D - 40]];
  let placed = 0;
  for (const [x, y] of spots) if (placed < n && k.prop(BIN, x, y, 0)) placed++;
}

/**
 * Rows of indoor benches facing local north (yaw 90), centred on x, from y downwards (100 apart, not below 64);
 * benches that would stand on a walkway are left out.
 */
function benchRows(k: PoiKit, cx: number, y: number, rows: number, halfSpan: number, dryRun = false): number {
  const BENCH = 'props_trainstation/bench_indoor001a';
  let n = 0;
  for (let r = 0; r < rows && y - r * 100 >= 64; r++) for (let x = cx - halfSpan; x <= cx + halfSpan; x += 92) {
    if (dryRun ? k.isFree(k.footprint(BENCH, x, y - r * 100, 90), 0) : k.prop(BENCH, x, y - r * 100, 90, { margin: 0 })) n++;
  }
  return n;
}

/**
 * Where a Breencast on a pole goes: the free spot in the north half with the most room for benches in front of it
 * (rows `gap` below it), nearest the middle of the north wall on a tie.
 */
function focusSpot(k: PoiKit, gap: number, rows: number, halfSpan: number): [number, number] | null {
  let best: [number, number] | null = null, score = -Infinity;
  for (let y = k.D - 192; y >= k.D / 2; y -= 64) for (let x = 160; x <= k.W - 160; x += 64) {
    if (!k.isFree(rect(x - 80, y - 80, x + 80, y + 80), 8)) continue;
    const s = benchRows(k, x, y - gap, rows, halfSpan, true) * 100 - Math.hypot(x - k.W / 2, y - (k.D - 256)) / 64;
    if (s > score) { score = s; best = [x, y]; }
  }
  return best;
}

/**
 * Up to `count` of a model standing against the walls (facing in, `inset` out from the wall), trying the sides in
 * order and spots `step` apart along each, wherever they are free.
 */
function againstWalls(k: PoiKit, model: string, count: number, sides: Side[], inset: number, step: number): number {
  let n = 0;
  for (const side of sides) {
    const len = side === 's' || side === 'n' ? k.W : k.D;
    for (let a = 96; a <= len - 96 && n < count; a += step) {
      const [x, y, yaw] = side === 'w' ? [inset, a, 0] : side === 'e' ? [k.W - inset, a, 180] : side === 's' ? [a, inset, 90] : [a, k.D - inset, 270];
      if (k.prop(model, x, y, yaw, { margin: 2 })) n++;
    }
    if (n >= count) break;
  }
  return n;
}

/** A lamp hanging over a local point with its light (a warm pool with a short falloff), `z` above the floor. */
function hanging(k: PoiKit, x: number, y: number, z = 260): void {
  k.prop('props_c17/lampfixture01a', x, y, 0, { z: z + 2, force: true, noOccupy: true });
  lamp(k, x, y, z - 18, '255 208 156 150', 128, 448);
}

function lamp(k: PoiKit, x: number, y: number, dz: number, color: string, fifty: number, zero: number): void {
  k.entity('light', x, y, dz, { _light: color, _lightHDR: '-1 -1 -1 1', _quadratic_attn: '1', _fifty_percent_distance: String(fifty), _zero_percent_distance: String(zero) });
}

const FLOOR_DIRT = ['overlays/stains_05a', 'overlays/stains_05b', 'overlays/stains_05c', 'overlays/stains_05d', 'overlays/stain_01', 'overlays/stain_04', 'overlays/dirt01a'];
const LITTER = ['decals/trashdecal01a', 'decals/trashdecal02a', 'decals/trashdecal03a', 'decals/trashdecal04a', 'decals/trashdecal05a'];
const PAPERS = ['overlays/rationpapers01', 'overlays/rationpapers03', 'overlays/rationpapers04'];

/** Overlays on the floor at random spots in a local area: `count` of `materials`, square, `size` across. */
function floorWear(k: PoiKit, area: Rect, count: number, materials: string[], size: [number, number]): void {
  for (let i = 0; i < count; i++) {
    const w = Math.round(k.rng.range(size[0], size[1]));
    k.overlay(k.rng.pick(materials), Math.round(k.rng.range(area.x0 + w / 2, area.x1 - w / 2)), Math.round(k.rng.range(area.y0 + w / 2, area.y1 - w / 2)), w, w, k.rng.int(0, 359));
  }
}

/** Wear everywhere: stains, cracks and litter, by the room's area. */
function generalWear(k: PoiKit, litter = 1): void {
  const area = (k.W * k.D) / 1e6;
  const all = rect(32, 32, k.W - 32, k.D - 32);
  floorWear(k, all, Math.round(area * 3) + 1, FLOOR_DIRT, [128, 256]);
  floorWear(k, all, Math.round(area * 1.5), ['overlays/concrete_crack01'], [128, 224]);
  floorWear(k, all, Math.round(area * 2.5 * litter), LITTER, [64, 96]);
}

/** A base and a capital round a pillar shaft at a local point (decoration, in world coordinates). */
function pillarTrim(k: PoiKit, ctx: RoomContext, x: number, y: number, top: number): void {
  const z = ctx.layout.floor;
  for (const [z0, z1] of [[0, 64], [top - 32, top]]) {
    const w = k.worldRect(rect(x - 48, y - 48, x + 48, y + 48));
    ctx.relief.push(boxSolid(k.doc, new Vector3(w.x0, w.y0, z + z0), new Vector3(w.x1, w.y1, z + z1), { top: TRIM, bottom: 'TOOLS/TOOLSNODRAW', sides: TRIM }));
  }
}

/** A canteen corner: cafeteria tables with benches either side and bottles and cartons on some. */
function canteen(k: PoiKit, area: Rect, max = 4): number {
  let n = 0;
  for (let tx = area.x0 + 60; tx + 60 <= area.x1 && n < max; tx += 220) for (let ty = area.y1 - 80; ty - 80 >= area.y0 && n < max; ty -= 224) {
    const fp = rect(tx - 64, ty - 72, tx + 64, ty + 72);
    if (!k.isFree(fp, 8)) continue;
    k.prop('props_wasteland/cafeteria_table001a_static', tx, ty, 0, { force: true });
    for (const side of [-1, 1]) k.prop('props_wasteland/cafeteria_bench001a', tx + side * 40, ty, 0, { force: true });
    k.occupied.push(fp);
    for (let i = k.rng.int(0, 3); i > 0; i--) {
      k.prop(k.rng.pick(['props_junk/garbage_glassbottle001a', 'props_junk/garbage_glassbottle003a', 'props_junk/garbage_takeoutcarton001a']), tx + k.rng.range(-10, 10), ty + k.rng.range(-48, 48), k.rng.int(0, 359), { dz: 30, force: true, noOccupy: true });
    }
    n++;
  }
  return n;
}

/**
 * Train hall: a raised platform along the long side the hall is entered from (so nobody has to cross a track to
 * reach it), tracks on ballast beside it with buffers at one end, coaches standing at the platform, benches,
 * bins, luggage and push carts on it. A wide hall gets a second platform along the far wall.
 */
const TRAIN_HALL: RoomDresser = {
  orient: 'long', ownFloor: true, walkways: false,
  dress(k, ctx) {
    const { W, D } = k;
    k.pad(k.bounds, 'NATURE/GRAVELFLOOR002B');
    const P = 256;
    const width = (e: Side) => ctx.doors.filter((d) => d.edge === e).reduce((s, d) => s + d.to - d.from, 0);
    const north = width('n') >= width('s');
    // Distances from the platform's wall, turned into local y.
    const yAt = (off: number) => (north ? D - off : off);
    const span = (o0: number, o1: number) => rect(0, Math.min(yAt(o0), yAt(o1)), W, Math.max(yAt(o0), yAt(o1)));
    const plats = [span(0, P)];
    const tracks: number[] = [];
    for (let off = P + 112; off + 96 <= D; off += 208) {
      tracks.push(yAt(off));
      if (tracks.length === 2 && D - (off + 96) >= P + 32) { plats.push(span(off + 112, D)); break; }
    }
    for (const p of plats) k.pad(p, 'CONCRETE/CONCRETEFLOOR028A', 18, 'CONCRETE/CONCRETEWALL001A');
    // Ways in: doors on the platform's side open onto it; doors in the far wall cross the tracks; doors at the
    // ends lead along the platform.
    const pm = Math.round((plats[0].y0 + plats[0].y1) / 2);
    for (const d of ctx.doors) {
      k.keepClear(d.clear);
      const far = (d.edge === 'n') !== north && (d.edge === 's' || d.edge === 'n');
      if (far) k.route([Math.round(d.mid), 0], [Math.round(d.mid), D], Math.max(160, d.to - d.from));
      else if (d.edge === 'w' || d.edge === 'e') k.route([0, pm], [W, pm], 112);
    }
    for (const ty of tracks) {
      for (let x = 256; x + 256 <= W; x += 512) k.prop('pg_props/pg_obj/pg_rail_512', x, ty, 90, { force: true, noOccupy: true });
      k.prop('pg_props/pg_gate_ii/pg_train_bumper', 72, ty, 0, { force: true });
    }
    // A train at the platform: coaches nose to tail from the buffers; the other tracks sometimes have one too.
    tracks.forEach((ty, i) => {
      let want = i === 0 ? k.rng.int(2, 3) : k.rng.int(0, 2);
      const fp = k.footprint('props_trainstation/train001', 0, 0, 90);
      for (let x = 168; want > 0 && x + (fp.x1 - fp.x0) <= W - 48;) {
        if (k.prop('props_trainstation/train001', x - fp.x0, ty, 90, { margin: 0 })) { want--; x += fp.x1 - fp.x0 + 16; } else x += 64;
      }
    });
    // On the platforms: benches down the middle, bins beside some, luggage and a push cart at each end; lamps
    // over them, hazard stripes along the edges over the tracks, dirt and papers.
    for (const p of plats) {
      const m = Math.round((p.y0 + p.y1) / 2);
      for (let x = 256; x < W - 128; x += 512) hanging(k, x, m, 240);
      for (const ey of [p.y0 + 24, p.y1 - 24]) {
        if (ey < 64 || ey > D - 64) continue;
        for (let x = p.x0 + 96; x < p.x1 - 64; x += 152) k.overlay('overlays/hazard_stripe001c', x, ey, 144, 72, 0);
      }
      floorWear(k, rect(p.x0, p.y0 + 48, p.x1, p.y1 - 48), Math.round((p.x1 - p.x0) / 400), FLOOR_DIRT, [96, 160]);
      floorWear(k, rect(p.x0, p.y0 + 48, p.x1, p.y1 - 48), Math.round((p.x1 - p.x0) / 600), PAPERS, [80, 112]);
      for (let x = 352; x < W - 192; x += 384) {
        if (k.prop('props_trainstation/benchoutdoor01a', x, m, 90) && k.rng.chance(0.5)) k.prop(BIN, x + 96, m + 48, 0);
      }
      for (const x of [112, W - 112]) {
        for (const dy of [-64, 64]) k.prop(k.rng.pick(LUGGAGE), x, m + dy, k.rng.int(0, 3) * 90);
        k.prop('props_silo/pushcart_static', x + (x < W / 2 ? 72 : -72), m, 0);
      }
    }
  },
};

/** Concourse: an open hall with a few stone pillars, a Breencast on a pole with benches facing it, bins and luggage. */
const CONCOURSE: RoomDresser = {
  orient: 'world',
  dress(k, ctx) {
    const { W, D } = k;
    const top = Math.min(304, ctx.height - 96);
    // Pillars on a 512 grid clear of the walls and the ways through (shafts here, bases and capitals with the relief).
    if (W >= 1024 && D >= 1024) {
      for (let x = 320; x <= W - 320; x += 512) for (let y = 320; y <= D - 320; y += 512) {
        const r = rect(x - 48, y - 48, x + 48, y + 48);
        if (!k.isFree(r, 16)) continue;
        k.box(rect(x - 32, y - 32, x + 32, y + 32), 0, top, { top: NODRAW, bottom: NODRAW, sides: STONE }, { occupy: true });
        k.occupied.push(r);
        pillarTrim(k, ctx, x, y, top);
        // A lantern on the side the camera sees (south-east).
        k.prop('props_trainstation/column_light001a', x + 22, y - 22, 315, { z: 190, force: true, noOccupy: true });
        lamp(k, x + 40, y - 40, 190, '255 196 140 90', 96, 384);
      }
    }
    // The Breencast towards the north wall, benches in rows in front of it.
    const half = Math.min(276, W / 2 - 128);
    const spot = focusSpot(k, 160, 4, half);
    if (spot) {
      const [bx, by] = spot;
      breencast(k, bx, by, Math.min(320, ctx.height - 128));
      benchRows(k, bx, by - 160, 4, half);
      // The screens' cold glow, lamps over the benches, litter and papers where people sit.
      lamp(k, bx, by - 96, 200, '165 200 255 110', 128, 512);
      for (const dx of [-half / 2, half / 2]) hanging(k, Math.round(bx + dx), by - 260);
      floorWear(k, rect(bx - half - 48, Math.max(32, by - 560), bx + half + 48, by - 96), 6, [...LITTER, ...PAPERS], [64, 104]);
    }
    generalWear(k);
    // Ornaments either side of the street doors.
    for (const d of ctx.doors.filter((q) => q.door.kind === 'street')) {
      for (const a of [d.from - 48, d.to + 48]) {
        const [x, y, yaw] = d.edge === 's' ? [a, 28, 90] : d.edge === 'n' ? [a, D - 28, 270] : d.edge === 'w' ? [28, a, 0] : [W - 28, a, 180];
        k.prop('props_trainstation/trainstation_ornament001', x, y, yaw);
      }
    }
    cornerBins(k);
    k.scatter([...LUGGAGE, 'props_silo/pushcart_static'], rect(96, 96, W - 96, D - 96), Math.round((W * D) / 400000) + 2, { yaw: 'right' });
  },
};

/**
 * Customs, after the HL2 one: rows of chain-link cages with their backs to the far wall (and the near wall in a
 * deep room), each with a gate onto the corridor between the rows; benches and luggage inside, a scanner line of
 * short barricades across the way in and a guard booth beside it.
 */
const CUSTOMS: RoomDresser = {
  orient: 'entry',
  dress(k, ctx) {
    const { W, D } = k;
    const entry = ctx.doors.find((d) => d.edge === 's');
    const lane = Math.round(entry ? entry.mid : W / 2);
    const CAGE = 240;
    const twoRows = D >= 2 * CAGE + 224;
    // The corridor in front of the cages, along the room.
    const cy = twoRows ? Math.round(D / 2) : Math.round((D - CAGE - 16) / 2 + 48);
    k.route([0, cy], [W, cy], 160);
    k.route([lane, 0], [lane, cy], 160);
    const rows: { y0: number; y1: number; gateAt: number }[] = [{ y0: D - 16 - CAGE, y1: D - 16, gateAt: D - 16 - CAGE }];
    if (twoRows) rows.push({ y0: 16, y1: 16 + CAGE, gateAt: 16 + CAGE });
    const cages: Rect[] = [];
    for (const row of rows) {
      let run: Rect[] = [];
      const flush = () => {
        if (!run.length) return;
        const a = run[0].x0, b = run[run.length - 1].x1;
        // The front with a gate (a gap) in each cage, and the fences between the cages.
        k.edge('chainlink', [a, row.gateAt], [b, row.gateAt], run.map((c): [number, number] => [(c.x0 + c.x1) / 2 - 48 - a, (c.x0 + c.x1) / 2 + 48 - a]));
        for (const x of [a, ...run.map((c) => c.x1)]) k.edge('chainlink', [x, row.y0], [x, row.y1]);
        cages.push(...run);
        run = [];
      };
      // Cages 288 wide (224 where that is all there is room for) from one end of the row to the other, around
      // the doorways and walkways.
      for (let x = 32; x + 224 <= W - 32;) {
        const len = [288, 224].find((l) => x + l <= W - 32 && offRoutes(k, rect(x, row.y0, x + l, row.y1)));
        if (len) { run.push(rect(x, row.y0, x + len, row.y1)); x += len; } else { flush(); x += 32; }
      }
      flush();
    }
    // Inside each cage: a bench against the wall, luggage, sometimes a crate.
    for (const c of cages) {
      const back = c.y1 >= D - 32;
      k.occupied.push(rect(c.x0 + 8, c.y0, c.x1 - 8, c.y1));
      k.prop('props_trainstation/bench_indoor001a', (c.x0 + c.x1) / 2, back ? c.y1 - 36 : c.y0 + 36, back ? 270 : 90, { force: true });
      for (let i = k.rng.int(1, 2); i > 0; i--) k.prop(k.rng.pick(LUGGAGE), k.rng.range(c.x0 + 48, c.x1 - 48), k.rng.range(c.y0 + 64, c.y1 - 96), k.rng.int(0, 359), { force: true });
    }
    // The scanner line across the way in (where there is room between the door and the corridor), the guard
    // booth by the corridor, and a monitor.
    const sy = 208;
    if (sy <= cy - 120) {
      for (const dx of [-112, 112]) k.prop('props_combine/combine_barricade_short01a', lane + dx, sy, 0);
      k.prop('props_combine/combine_light002a', lane - 112, sy + 40, 270);
    }
    let booth = false;
    for (const y of [sy, cy - 152, cy + 152]) for (const x of [lane + 240, lane - 240, 112, W - 112]) {
      if (!booth && k.prop('props_combine/combine_booth_short01a', x, y, x > lane ? 180 : 0)) {
        booth = true;
        k.prop('combine_room/combine_monitor002', x + (x > lane ? -96 : 96), y + 96, x > lane ? 180 : 0);
      }
    }
    cornerBins(k, 2);
    for (let x = 224; x < W - 160; x += 448) hanging(k, x, cy, 240);
    for (let y = 48; y < cy; y += 56) k.overlay(k.rng.pick(['overlays/bootprint_01', 'overlays/bootprint_02']), lane + k.rng.range(-40, 40), y, 48, 48, 90 + k.rng.range(-12, 12));
    generalWear(k, 0.6);
  },
};

/**
 * Rations: lanes between railings leading up to a Combine counter at the far wall, a booth behind it with crates
 * of rations, monitors at the lane heads and a Breencast in a corner.
 */
const RATIONS_ROOM: RoomDresser = {
  orient: 'entry', walkways: false,
  dress(k, ctx) {
    const { W, D } = k;
    for (const d of ctx.doors) k.keepClear(d.clear);
    const lw = 176;
    const n = Math.max(2, Math.min(4, Math.floor((W - 256) / lw)));
    const total = n * lw;
    const entry = ctx.doors.find((d) => d.edge === 's');
    const lx0 = Math.round(Math.max(128, Math.min(W - 128 - total, (entry ? entry.mid : W / 2) - total / 2)));
    const qy0 = 192, qy1 = D - 288;
    for (let i = 0; i < n; i++) k.route([lx0 + i * lw + lw / 2, 0], [lx0 + i * lw + lw / 2, qy1 + 48], 128);
    for (let i = 0; i <= n; i++) {
      const x = lx0 + i * lw;
      for (let y = qy0 + 128; y <= qy1 - 128; y += 256) k.prop('props_combine/railing_256', x, y, 90, { force: true });
      k.occupied.push(rect(x - 6, qy0, x + 6, qy1));
    }
    k.box(rect(lx0 - 32, qy1 + 64, lx0 + total + 32, qy1 + 80), 0, 40, { top: METAL, bottom: NODRAW, sides: METAL }, { occupy: true });
    for (let i = 0; i < n; i++) k.prop('props_combine/combine_smallmonitor001', lx0 + i * lw + lw / 2, qy1 + 72, 270, { z: 40, force: true, noOccupy: true });
    k.prop('props_combine/combine_booth_med01a', lx0 + total / 2, Math.min(D - 100, qy1 + 200), 90, { force: true });
    k.occupied.push(rect(lx0 + total / 2 - 140, qy1 + 100, lx0 + total / 2 + 140, D));
    k.scatter(['pg_props/pg_obj/ja_combine_crate', 'pg_props/pg_obj/ja_combine_crate_big'], rect(48, qy1 + 96, W - 48, D - 48), 6, { yaw: 'right' });
    for (const x of [64, W - 64]) if (k.isFree(rect(x - 80, D - 240, x + 80, D - 80), 8)) { breencast(k, x < W / 2 ? 112 : W - 112, D - 160, Math.min(288, ctx.height - 128)); break; }
    cornerBins(k, 2);
    // Lamps over the lane heads and the middle of the lanes; ration papers dropped in them.
    for (let i = 0; i < n; i++) { hanging(k, lx0 + i * lw + lw / 2, qy1 + 24); hanging(k, lx0 + i * lw + lw / 2, Math.round((qy0 + qy1) / 2)); }
    floorWear(k, rect(lx0, 32, lx0 + total, qy1), 3 * n, PAPERS, [80, 112]);
    generalWear(k, 0.5);
  },
};

/** Waiting room: benches facing a Breencast monitor on the north wall, canteen tables, payphones, a vending machine. */
const WAITING: RoomDresser = {
  orient: 'world',
  dress(k, ctx) {
    const { W, D } = k;
    // The monitor on the north wall (the camera sees it), off any doorway there.
    const northDoors = ctx.doors.filter((d) => d.edge === 'n');
    const mx = [W / 2, W / 3, (2 * W) / 3].find((x) => !northDoors.some((d) => x > d.from - 96 && x < d.to + 96));
    let rowsAt = W / 2;
    if (mx !== undefined && !northDoors.some((d) => d.door.kind === 'open')) {
      k.prop('props_combine/combine_intmonitor003', Math.round(mx), D - 4, 270, { z: 120, force: true, noOccupy: true });
      lamp(k, Math.round(mx), D - 96, 150, '165 200 255 110', 128, 512);
      rowsAt = mx;
    }
    const half = Math.min(230, W / 2 - 120);
    benchRows(k, Math.round(rowsAt), D - 200, 4, half);
    hanging(k, Math.round(rowsAt), Math.max(96, D - 300), 240);
    if (W >= 640 && D >= 640) {
      const area = rect(32, 32, Math.min(W / 2, 520), Math.min(D / 2, 520));
      if (canteen(k, area, 4)) hanging(k, Math.round((area.x0 + area.x1) / 2), Math.round((area.y0 + area.y1) / 2), 240);
    }
    generalWear(k, 1.5);
    // Payphones on the west wall (or another), a vending machine on the east wall (or another).
    againstWalls(k, 'props_trainstation/payphone001a', 3, ['w', 'e', 's'], 20, 56);
    againstWalls(k, 'props_interiors/vendingmachinesoda01a', 1, ['e', 'w', 's'], 28, 64);
    cornerBins(k, 3);
  },
};

/** Hallway: benches along both walls facing in, bins between them, a payphone and a vending machine at the ends. */
const HALLWAY: RoomDresser = {
  orient: 'long', walkways: false,
  dress(k, ctx) {
    const { W, D } = k;
    for (const d of ctx.doors) k.keepClear(d.clear);
    k.route([0, D / 2], [W, D / 2], Math.max(96, Math.min(160, D - 160)));
    for (const d of ctx.doors) {
      const m = Math.round(d.mid);
      if (d.edge === 's') k.route([m, 0], [m, D / 2], 128);
      if (d.edge === 'n') k.route([m, D / 2], [m, D], 128);
    }
    // Benches along the walls (both, when there is room for a walkway between them), bins between them.
    const sides: Side[] = D >= 352 ? ['s', 'n'] : ['s'];
    againstWalls(k, 'props_trainstation/bench_indoor001a', Math.floor(W / 320) * sides.length, sides, 28, 160);
    againstWalls(k, BIN, Math.max(1, Math.floor(W / 640)), sides, 24, 224);
    againstWalls(k, 'props_trainstation/payphone001a', 1, ['w', 'e'], 20, 56);
    againstWalls(k, 'props_interiors/vendingmachinesoda01a', 1, ['e', 'w'], 28, 64);
    for (let x = 192; x < W - 96; x += 384) hanging(k, x, Math.round(D / 2), Math.min(220, ctx.height - 100));
    generalWear(k);
  },
};

export const DRESSERS: Record<string, RoomDresser> = {
  trainHall: TRAIN_HALL, concourse: CONCOURSE, customs: CUSTOMS, rations: RATIONS_ROOM, waiting: WAITING, hallway: HALLWAY,
};

/** A POI type for the kit (the kit asks it for gameplay options; rooms have none). */
const roomPoiType = (t: RoomTypeInfo): PoiType => ({
  id: `room_${t.id}`, label: t.label, icon: '', hint: t.hint, landscapes: ['city'],
  minSize: [0, 0], maxSize: [1e6, 1e6], defaultSize: [512, 512], params: [], build: () => {},
});

/** Furnishes one room: its floor, walkways and furniture, as a POI output (world z from the layout). */
export function dressRoom(doc: VmfDocument, layout: RoomLayout, room: RoomBox, seed: number): { output: PoiOutput; kit: PoiKit; ctx: RoomContext } {
  const type = roomType(room.spec.type);
  const dresser = DRESSERS[type.id] ?? WAITING;
  const rotation = rotationFor(dresser.orient, room);
  const z = layout.spec.origin.z;
  const k = new PoiKit(doc, { type: `room_${type.id}`, uid: `${layout.spec.uid}_${room.spec.id}`, seed, rect: room.inner, rotation, z, landscape: 'city', params: {} }, roomPoiType(type), () => z);
  const world = { s: worldSide('s', rotation), e: worldSide('e', rotation), n: worldSide('n', rotation), w: worldSide('w', rotation) };
  const ctx: RoomContext = { layout, room, type, doors: localDoors(k, room, rotation), world, height: layout.top - layout.floor, relief: [] };
  if (!dresser.ownFloor) k.pad(k.bounds, type.floor);
  if (dresser.walkways !== false) walkways(k, ctx.doors);
  dresser.dress(k, ctx);
  return { output: k.out, kit: k, ctx };
}
