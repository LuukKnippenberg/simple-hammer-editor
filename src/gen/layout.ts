import { Box3, Vector3 } from 'three';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import { MapSolid, VmfDocument, vecStr } from '../vmf/map.ts';
import { boxFaces, solidNode } from '../edit/brushes.ts';
import { buildBrushFaces } from '../geom/brush.ts';
import { dispBaseGrid, dispCorners } from '../geom/displacement.ts';
import { ARCHITECTURES, detailEntityNode, generateBuildings, type ArchitectureName } from './buildings.ts';
import { streetDressing, type BlockDressing } from './streets.ts';
import { standZ } from './props.ts';
import { Rng } from './rng.ts';
import { cameraSpawnFor } from '../lw/kits.ts';
import { addPoisToMap, levelForPois, planLayoutPois } from './poi/mapgen.ts';

export const CELL = 256;
/** Scenery border outside the playable area (two terrain patches wide). */
const APRON = 1024;

/** What a layout cell becomes. */
export enum Cell {
  Ground = 0,
  Road = 1,
  High = 2,
  Block = 3,
  Base = 4,
  Point = 5,
  Scrap = 6,
  Forest = 7,
  /** Enterable open-top houses: village houses in the countryside, shacks in the city. */
  Houses = 8,
}

export const CELL_INFO: Record<Cell, { label: string; color: string }> = {
  [Cell.Ground]: { label: 'Ground', color: '#5d7a3e' },
  [Cell.Road]: { label: 'Road', color: '#b9a27a' },
  [Cell.High]: { label: 'High ground', color: '#8a8f6a' },
  [Cell.Block]: { label: 'Buildings', color: '#7c5a4a' },
  [Cell.Base]: { label: 'Player base', color: '#3ddc84' },
  [Cell.Point]: { label: 'Control point', color: '#ffa630' },
  [Cell.Scrap]: { label: 'Scrap', color: '#d8c040' },
  [Cell.Forest]: { label: 'Trees', color: '#2f5a2a' },
  [Cell.Houses]: { label: 'Houses (enterable)', color: '#c99566' },
};

export type Theme = 'rural' | 'city';

export interface Layout {
  w: number;
  h: number;
  cells: Cell[];
}

export interface GenerateOptions {
  theme: Theme;
  seed: number;
  highGround: number;
  /** Kind of buildings on city blocks (default mixed). */
  architecture?: ArchitectureName;
  /** Enterable houses among the buildings on blocks (default: some in the countryside, the architecture's in the city). */
  interiors?: 'none' | 'some' | 'all';
  /** Points of interest to place in open ground (in mirrored pairs; 0 for none). */
  pois?: number;
}

const THEMES = {
  rural: { blend: 'NATURE/BLENDGRASSDIRT01', ground: 0, road: 255, noise: 10 },
  city: { blend: 'CONCRETE/BLENDBUNK_CONC01', ground: 0, road: 255, noise: 3 },
};
// Picked by size: 140-480 units tall reads well from the RTS camera (static props cannot be scaled).
const TREES = ['models/props_foliage/tree_deciduous_03a.mdl', 'models/props_foliage/tree_deciduous_03b.mdl', 'models/props_foliage/mall_tree_medium01.mdl', 'models/props_foliage/tree_pine06.mdl', 'models/props_foliage/tree_deciduous_03a.mdl'];
const BUSHES = ['models/props_foliage/mall_bush01_medium.mdl', 'models/props_foliage/mall_bush01_medium.mdl', 'models/props_foliage/forestrock_single01.mdl', 'models/props_foliage/rock_forest01.mdl'];
const CARS = ['models/props_vehicles/car002a.mdl', 'models/props_vehicles/car003a.mdl', 'models/props_vehicles/car004a.mdl', 'models/props_vehicles/car005a.mdl', 'models/props_vehicles/van001a.mdl'];
// Static-prop-safe models only (some HL2 props, e.g. barricades, must be physics props).
const CITY_BITS = ['models/props_c17/concrete_barrier001a.mdl', 'models/props_c17/fence01a.mdl'];

export function emptyLayout(w: number, h: number): Layout {
  return { w, h, cells: new Array(w * h).fill(Cell.Ground) };
}

/**
 * Point-symmetric random layout for two players: bases in opposite corners, L-shaped main roads to the
 * centre, a ring road, high-ground plateaus with flank control points, and buildings or trees in between.
 */
export function randomLayout(w: number, h: number, theme: Theme, seed: number): Layout {
  const rng = new Rng(seed);
  const L = emptyLayout(w, h);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const set = (x: number, y: number, c: Cell) => {
    if (!inside(x, y)) return;
    L.cells[y * w + x] = c;
    L.cells[(h - 1 - y) * w + (w - 1 - x)] = c; // 180° rotation keeps it fair
  };
  const get = (x: number, y: number) => (inside(x, y) ? L.cells[y * w + x] : Cell.Road);
  const rect = (x0: number, y0: number, x1: number, y1: number, c: Cell, onlyGround = false) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!onlyGround || get(x, y) === Cell.Ground) set(x, y, c);
  };
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const ring = Math.max(4, Math.floor(w / 4));

  // Ring road around the centre and the main road from each base.
  rect(cx - ring, cy - ring, cx + ring - 1, cy - ring, Cell.Road);
  rect(cx - ring, cy - ring, cx - ring, cy + ring - 1, Cell.Road);
  const lane = rng.int(2, 3);
  rect(3, lane, cx, lane, Cell.Road);
  rect(cx, lane, cx, cy, Cell.Road);
  rect(lane, 3, lane, cy - ring, Cell.Road);

  // High ground plateaus on the flanks, each holding a control point.
  const px = cx - ring + rng.int(2, 3), py = cy + ring - rng.int(4, 5);
  rect(px - 1, py - 1, px + 1, py + 1, Cell.High);
  set(px, py, Cell.Point);
  if (rng.chance(0.6)) rect(cx + 2, cy - ring + 2, cx + 3, cy - ring + 3, Cell.High);

  // Buildings (city) or trees (rural) in the gaps, never on roads.
  const fill = theme === 'city' ? Cell.Block : Cell.Forest;
  // Cities are dense; the countryside keeps open fields between the woods.
  const attempts = Math.round((w * h) / (theme === 'city' ? 10 : 45));
  for (let n = 0; n < attempts; n++) {
    const x = rng.int(4, w - 3), y = rng.int(0, h - 3);
    const sw = rng.int(2, 4), sh = rng.int(2, 3);
    let clear = true;
    for (let yy = y - 1; yy <= y + sh && clear; yy++) for (let xx = x - 1; xx <= x + sw && clear; xx++) {
      const c = get(xx, yy);
      if (c !== Cell.Ground && c !== Cell.Road && c !== fill) clear = false;
    }
    if (clear) rect(x, y, x + sw - 1, y + sh - 1, fill, true);
  }
  if (theme === 'rural') {
    for (let n = 0; n < Math.round((w * h) / 50); n++) {
      const x = rng.int(0, w - 1), y = rng.int(0, h - 1);
      if (get(x, y) === Cell.Ground) set(x, y, Cell.Forest);
    }
  }

  // A few hamlets of enterable houses in the countryside, from their own sequence.
  if (theme === 'rural') {
    const hr = new Rng(seed * 19 + 7);
    const want = Math.max(1, Math.round((w * h) / 200));
    for (let n = 0, placed = 0; n < 60 && placed < want; n++) {
      const x = hr.int(5, w - 4), y = hr.int(1, h - 4), sw = hr.int(2, 3), sh = 2;
      let clear = true;
      for (let yy = y - 1; yy <= y + sh && clear; yy++) for (let xx = x - 1; xx <= x + sw && clear; xx++) if (get(xx, yy) !== Cell.Ground && get(xx, yy) !== Cell.Forest) clear = false;
      if (clear) { rect(x, y, x + sw - 1, y + sh - 1, Cell.Houses); placed++; }
    }
  }

  // Bases in opposite corners, kept clear around them.
  rect(0, 0, 3, 3, Cell.Ground);
  rect(1, 1, 2, 2, Cell.Base);
  set(3, lane, Cell.Road);
  // Centre point and scrap: one near each base, one on the way to the centre.
  L.cells[cy * w + cx] = Cell.Point;
  set(cx - 1, cy, Cell.Road); set(cx, cy - 1, Cell.Road);
  set(5, 1, Cell.Scrap);
  set(1, 6, Cell.Scrap);
  set(cx - ring + 1, cy - ring + 2, Cell.Scrap);
  return L;
}

/** Box-blurs a grid in place (separable, clamped edges). */
function blur(f: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(f.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += f[y * w + Math.min(w - 1, Math.max(0, x + k))];
    tmp[y * w + x] = s / (2 * r + 1);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
    f[y * w + x] = s / (2 * r + 1);
  }
}

/** Height and blend fields sampled every 64 units over the whole map. */
function fields(L: Layout, opts: GenerateOptions, rng: Rng) {
  const sub = CELL / 64; // samples per cell
  const W = L.w * sub + 1, H = L.h * sub + 1;
  const height = new Float32Array(W * H), alpha = new Float32Array(W * H), flat = new Float32Array(W * H);
  const cellAt = (sx: number, sy: number) => {
    const cx = Math.min(L.w - 1, Math.floor(sx / sub)), cy = Math.min(L.h - 1, Math.floor(sy / sub));
    return L.cells[cy * L.w + cx];
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = cellAt(x, y);
    height[y * W + x] = c === Cell.High ? opts.highGround : 0;
    alpha[y * W + x] = c === Cell.Road || c === Cell.Base || c === Cell.Point ? 255 : c === Cell.Block ? 200 : c === Cell.Houses ? 140 : 0;
    flat[y * W + x] = c === Cell.Base || c === Cell.Block || c === Cell.Point || c === Cell.Houses ? 1 : 0;
  }
  blur(height, W, H, 2);
  blur(height, W, H, 1);
  blur(alpha, W, H, 1);
  blur(flat, W, H, 1);
  const noise = THEMES[opts.theme].noise;
  for (let i = 0; i < W * H; i++) {
    const n = (rng.next() - 0.5) * 2 * noise * (1 - flat[i]);
    height[i] = Math.round((height[i] + n) * 10) / 10;
    alpha[i] = Math.max(0, Math.min(255, Math.round(alpha[i] + (rng.next() - 0.5) * 40 * (1 - flat[i]))));
  }
  const sample = (f: Float32Array, wx: number, wy: number) => {
    const x = Math.max(0, Math.min(W - 1, Math.round(wx / 64))), y = Math.max(0, Math.min(H - 1, Math.round(wy / 64)));
    return f[y * W + x];
  };
  return { heightAt: (x: number, y: number) => sample(height, x, y), alphaAt: (x: number, y: number) => sample(alpha, x, y) };
}

function block(name: string, size: number, rowFn: (r: number) => string): KVNode {
  const n = new KVNode(name);
  for (let r = 0; r < size; r++) n.items.push(new KVPair(`row${r}`, rowFn(r)));
  return n;
}

/** A square terrain patch: a thin world brush whose top face is a displacement (power 3: 9×9, power 4: 17×17 vertices). */
export function terrainPatch(doc: VmfDocument, x0: number, y0: number, size: number, material: string, heightAt: (x: number, y: number) => number, alphaAt: (x: number, y: number) => number, power = 3, z0 = 0, sizeY = size): KVNode {
  const min = new Vector3(x0, y0, z0 - 16), max = new Vector3(x0 + size, y0 + sizeY, z0);
  const node = solidNode(doc, boxFaces(min, max, { top: material, bottom: 'TOOLS/TOOLSNODRAW', sides: 'TOOLS/TOOLSNODRAW' }));
  const solid = new MapSolid(node, null);
  const top = buildBrushFaces(solid).find((f) => f.plane.normal.z > 0.99)!;
  const start = new Vector3(x0, y0, z0);
  const n = (1 << power) + 1;
  const grid = dispBaseGrid(dispCorners(top, start), n);
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  const disp = new KVNode('dispinfo');
  disp.items.push(
    new KVPair('power', String(power)), new KVPair('startposition', `[${vecStr(start)}]`), new KVPair('flags', '0'),
    new KVPair('elevation', '0'), new KVPair('subdiv', '0'),
    block('normals', n, () => Array(n).fill('0 0 1').join(' ')),
    block('distances', n, (r) => grid.slice(r * n, r * n + n).map((p) => fmt(heightAt(p.x, p.y) - z0)).join(' ')),
    block('offsets', n, () => Array(n).fill('0 0 0').join(' ')),
    block('offset_normals', n, () => Array(n).fill('0 0 1').join(' ')),
    block('alphas', n, (r) => grid.slice(r * n, r * n + n).map((p) => fmt(alphaAt(p.x, p.y))).join(' ')),
    block('triangle_tags', n - 1, () => Array((n - 1) * 2).fill('9').join(' ')),
  );
  const allowed = new KVNode('allowed_verts');
  allowed.items.push(new KVPair('10', '-1 -1 -1 -1 -1 -1 -1 -1 -1 -1'));
  disp.items.push(allowed);
  // The top face is the first side; its dispinfo goes after the side's keys.
  solid.sides[0].node.items.push(disp);
  return node;
}

export function entity(doc: VmfDocument, classname: string, origin: Vector3, keys: Record<string, string> = {}): KVNode {
  const e = new KVNode('entity');
  e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', classname));
  for (const [k, v] of Object.entries(keys)) e.items.push(new KVPair(k, v));
  e.items.push(new KVPair('origin', vecStr(origin)));
  return e;
}

/** Connected regions of one cell type (4-neighbour flood fill). */
function regions(L: Layout, type: Cell): { x: number; y: number }[][] {
  const seen = new Uint8Array(L.w * L.h);
  const out: { x: number; y: number }[][] = [];
  for (let i = 0; i < L.cells.length; i++) {
    if (seen[i] || L.cells[i] !== type) continue;
    const region: { x: number; y: number }[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % L.w, y = Math.floor(j / L.w);
      region.push({ x, y });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = ny * L.w + nx;
        if (nx >= 0 && ny >= 0 && nx < L.w && ny < L.h && !seen[k] && L.cells[k] === type) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    out.push(region);
  }
  return out;
}

/** Splits a cell region into rectangles (greedy row-runs merged downwards). */
function rectangles(L: Layout, region: { x: number; y: number }[]): Box3[] {
  const inRegion = new Set(region.map((c) => c.y * L.w + c.x));
  const used = new Set<number>();
  const out: Box3[] = [];
  for (const c of [...region].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const k = c.y * L.w + c.x;
    if (used.has(k)) continue;
    let x1 = c.x;
    while (inRegion.has(c.y * L.w + x1 + 1) && !used.has(c.y * L.w + x1 + 1)) x1++;
    let y1 = c.y;
    const rowFree = (y: number) => { for (let x = c.x; x <= x1; x++) if (!inRegion.has(y * L.w + x) || used.has(y * L.w + x)) return false; return true; };
    while (rowFree(y1 + 1)) y1++;
    for (let y = c.y; y <= y1; y++) for (let x = c.x; x <= x1; x++) used.add(y * L.w + x);
    out.push(new Box3(new Vector3(c.x * CELL, c.y * CELL, 0), new Vector3((x1 + 1) * CELL, (y1 + 1) * CELL, 0)));
  }
  return out;
}

/**
 * Turns a layout into a complete, compilable Lambda Wars map: displacement terrain with blended roads,
 * buildings on city blocks, trees, player starts, control points with capture areas, scrap, lighting,
 * fog, a sealing sky shell and the RTS map boundary.
 */
export function generateMap(L: Layout, opts: GenerateOptions): VmfDocument {
  const doc = VmfDocument.empty();
  const rng = new Rng(opts.seed);
  const theme = THEMES[opts.theme];
  const ox = -(L.w * CELL) / 2, oy = -(L.h * CELL) / 2;
  // Points of interest away from the bases, on ground, woods or (in a dense city) building blocks, which
  // they clear.
  const poiFree = (c: Cell) => c === Cell.Ground || c === Cell.Forest || c === Cell.Block;
  const poiPlan = opts.pois ? planLayoutPois(L.w, L.h, CELL, (i) => poiFree(L.cells[i]), (i) => L.cells[i] === Cell.Base, opts.theme, opts.pois, opts.seed) : null;
  if (poiPlan) L = { ...L, cells: L.cells.map((c, i) => (poiPlan.cells.has(i) && poiFree(c) ? Cell.Ground : c)) };
  // Work in layout space (0..w*CELL) and shift everything into a map centred on the origin at the end.
  const f = fields(L, opts, rng);
  const poiLevel = poiPlan ? levelForPois(f.heightAt, poiPlan.placements) : null;
  if (poiLevel) f.heightAt = poiLevel.height;
  const world = doc.world;
  world.set('skyname', opts.theme === 'city' ? 'sky_day01_07' : 'sky_day01_01');
  const solids: KVNode[] = [];
  const ents: KVNode[] = [];
  const ground = (x: number, y: number) => f.heightAt(x, y);
  const P = 512;
  const W = L.w * CELL, H = L.h * CELL;
  // Terrain continues past the playable area (the apron), so the RTS camera never looks into the void.
  for (let y = -APRON; y < H + APRON; y += P) for (let x = -APRON; x < W + APRON; x += P) {
    solids.push(terrainPatch(doc, x, y, P, theme.blend, f.heightAt, f.alphaAt));
  }
  // Scenery on the apron: a wood (rural) or a ring of city blocks (city), outside the map boundary.
  const ringRects = [
    new Box3(new Vector3(-APRON + 64, -APRON + 64, 0), new Vector3(W + APRON - 64, -64, 0)),
    new Box3(new Vector3(-APRON + 64, H + 64, 0), new Vector3(W + APRON - 64, H + APRON - 64, 0)),
    new Box3(new Vector3(-APRON + 64, -64, 0), new Vector3(-64, H + 64, 0)),
    new Box3(new Vector3(W + 64, -64, 0), new Vector3(W + APRON - 64, H + 64, 0)),
  ];
  for (const r of ringRects) {
    if (opts.theme === 'city') {
      // Backdrop outside the playable area: lighter decoration.
      const b = generateBuildings(doc, r, { seed: rng.int(1, 1e9), minFloors: 3, maxFloors: 7, alleys: false, roofProps: false, detail: 1, architecture: opts.architecture });
      solids.push(...b.solids);
      const d = detailEntityNode(doc, b.detail);
      if (d) ents.push(d);
    } else {
      const area = (r.max.x - r.min.x) * (r.max.y - r.min.y);
      for (let k = 0; k < area / (180 * 180); k++) {
        const x = rng.range(r.min.x, r.max.x), y = rng.range(r.min.y, r.max.y);
        ents.push(entity(doc, 'prop_static', new Vector3(Math.round(x), Math.round(y), Math.round(f.heightAt(x, y)) - 4), {
          model: rng.pick(TREES), angles: `0 ${rng.int(0, 359)} 0`, solid: '0', disableshadows: '1',
        }));
      }
    }
  }

  // Buildings on city blocks, trees in forest cells.
  const dressings: BlockDressing[] = [];
  for (const region of regions(L, Cell.Block)) {
    for (const r of rectangles(L, region)) {
      const inset = r.clone();
      inset.min.x += 32; inset.min.y += 32; inset.max.x -= 32; inset.max.y -= 32;
      inset.min.z = inset.max.z = 0;
      const arch = ARCHITECTURES[opts.architecture ?? 'mixed'];
      const b = generateBuildings(doc, inset, {
        seed: rng.int(1, 1e9), minFloors: Math.min(arch.floors[0], 5), maxFloors: Math.min(arch.floors[1], 7), alleys: rng.chance(0.5), roofProps: true, architecture: opts.architecture,
        interiors: opts.interiors ?? (opts.theme === 'rural' ? 'some' : undefined),
      });
      solids.push(...b.solids);
      const d = detailEntityNode(doc, b.detail);
      if (d) ents.push(d);
      for (const e of b.entities) ents.push(entity(doc, e.classname, e.origin, e.keys));
      dressings.push(b.dressing);
    }
  }
  // Enterable houses: village houses in the countryside, shacks in the city, with gaps between them.
  const houseRng = new Rng(opts.seed * 29 + 3);
  for (const region of regions(L, Cell.Houses)) {
    for (const r of rectangles(L, region)) {
      const inset = r.clone();
      inset.min.x += 32; inset.min.y += 32; inset.max.x -= 32; inset.max.y -= 32;
      inset.min.z = inset.max.z = 0;
      const village = opts.theme === 'rural';
      const b = generateBuildings(doc, inset, {
        seed: houseRng.int(1, 1e9), minFloors: 1, maxFloors: village ? 2 : 1, alleys: true, roofProps: false, courtyards: false,
        architecture: village ? 'village' : 'slum', interiors: 'all',
      });
      solids.push(...b.solids);
      const d = detailEntityNode(doc, b.detail);
      if (d) ents.push(d);
      for (const e of b.entities) ents.push(entity(doc, e.classname, e.origin, e.keys));
      dressings.push(b.dressing);
    }
  }
  for (const e of streetDressing(dressings, rng, { groundAt: ground })) ents.push(entity(doc, e.classname, e.origin, e.keys));
  const cells = (type: Cell) => L.cells.flatMap((c, i) => (c === type ? [{ x: i % L.w, y: Math.floor(i / L.w) }] : []));
  for (const c of cells(Cell.Forest)) {
    for (let k = 0; k < 3; k++) {
      const x = c.x * CELL + rng.range(24, CELL - 24), y = c.y * CELL + rng.range(24, CELL - 24);
      ents.push(entity(doc, 'prop_static', new Vector3(Math.round(x), Math.round(y), Math.round(ground(x, y)) - 4), {
        model: rng.pick(TREES), angles: `0 ${rng.int(0, 359)} 0`, solid: '6',
      }));
    }
  }
  // Decoration along roads: bushes and rocks (rural) or lamps, cars and barriers (city).
  for (const c of cells(Cell.Road)) {
    if (!rng.chance(opts.theme === 'city' ? 0.18 : 0.12)) continue;
    const side = rng.chance(0.5) ? 24 : CELL - 24;
    const x = c.x * CELL + (rng.chance(0.5) ? side : rng.range(40, CELL - 40)), y = c.y * CELL + (rng.chance(0.5) ? rng.range(40, CELL - 40) : side);
    const model = opts.theme === 'city' ? rng.pick(rng.chance(0.5) ? CARS : [...CITY_BITS, 'models/props_c17/lamppost03a_off.mdl']) : rng.pick(BUSHES);
    ents.push(entity(doc, 'prop_static', new Vector3(Math.round(x), Math.round(y), standZ(model, Math.round(ground(x, y)))), { model, angles: `0 ${rng.int(0, 3) * 90 + rng.int(-10, 10)} 0`, solid: '6' }));
  }

  // Player bases: one start per connected base region, with the RTS camera spawn above it.
  regions(L, Cell.Base).forEach((region, i) => {
    const cx = (region.reduce((s, c) => s + c.x, 0) / region.length + 0.5) * CELL;
    const cy = (region.reduce((s, c) => s + c.y, 0) / region.length + 0.5) * CELL;
    const z = Math.round(ground(cx, cy));
    const yaw = Math.round((Math.atan2(L.h * CELL / 2 - cy, L.w * CELL / 2 - cx) * 180) / Math.PI);
    ents.push(entity(doc, 'info_start_wars', new Vector3(Math.round(cx), Math.round(cy), z + 8), { angles: `0 ${yaw} 0` }));
    ents.push(entity(doc, 'info_player_wars', cameraSpawnFor(new Vector3(cx, cy, z)), { angles: '65 135 0', ownernumber: String(2 + i) }));
  });
  // Control points with their capture areas.
  let cp = 1;
  for (const c of cells(Cell.Point)) {
    const x = (c.x + 0.5) * CELL, y = (c.y + 0.5) * CELL, z = Math.round(ground(x, y));
    const name = String(cp++);
    ents.push(entity(doc, 'control_point', new Vector3(x, y, z), {
      targetname: name, angles: '0 0 0', autoconstruct: '1', CaptureTime: '15.0', constructed: '2', constructprogress: '0.0', constructtime: '5.0', unittype: 'unit_unknown',
    }));
    const trig = entity(doc, 'trigger_capture_area', new Vector3(x, y, z + 56), { control_point: name, spawnflags: '3', StartDisabled: '0' });
    trig.items.push(solidNode(doc, boxFaces(new Vector3(x - 192, y - 192, z - 16), new Vector3(x + 192, y + 192, z + 128), 'TOOLS/TOOLSTRIGGER')));
    ents.push(trig);
  }
  for (const c of cells(Cell.Scrap)) {
    const x = (c.x + 0.5) * CELL, y = (c.y + 0.5) * CELL;
    ents.push(entity(doc, 'scrap_marker', new Vector3(x, y, Math.round(ground(x, y))), { angles: `0 ${rng.int(0, 359)} 0`, autoconstruct: '1', constructed: '2' }));
  }

  const maxH = opts.highGround + 6 * 128 + 256;
  addEnvironment(doc, solids, ents, { width: W, height: H, apron: APRON, maxHeight: maxH, sunYaw: rng.int(20, 70), fogColor: opts.theme === 'city' ? '170 175 180' : '185 195 205' });
  const out = finishDoc(doc, solids, ents, new Vector3(ox, oy, 0));
  return poiPlan ? addPoisToMap(out, poiPlan.placements, poiLevel!.levels, { x: ox, y: oy }, f.heightAt) : out;
}

/** Six boxes around `box` (the inside stays empty). */
export function shellSolids(doc: VmfDocument, box: Box3, material: string, t: number): KVNode[] {
  const a = box.min, b = box.max;
  const parts: [Vector3, Vector3][] = [
    [new Vector3(a.x - t, a.y - t, a.z - t), new Vector3(b.x + t, b.y + t, a.z)],
    [new Vector3(a.x - t, a.y - t, b.z), new Vector3(b.x + t, b.y + t, b.z + t)],
    [new Vector3(a.x - t, a.y - t, a.z), new Vector3(a.x, b.y + t, b.z)],
    [new Vector3(b.x, a.y - t, a.z), new Vector3(b.x + t, b.y + t, b.z)],
    [new Vector3(a.x, a.y - t, a.z), new Vector3(b.x, a.y, b.z)],
    [new Vector3(a.x, b.y, a.z), new Vector3(b.x, b.y + t, b.z)],
  ];
  return parts.map(([lo, hi]) => solidNode(doc, boxFaces(lo, hi, material)));
}

export interface EnvironmentOptions {
  /** Playable area size (layout space starts at 0,0). */
  width: number;
  height: number;
  apron: number;
  maxHeight: number;
  sunYaw: number;
  fogColor: string;
  sunPitch?: number;
  light?: string;
  ambient?: string;
  /**
   * Playerclip blocks inside the boundary for raised ground. The RTS camera rides on playerclip
   * surfaces (SnapCameraTo traces CONTENTS_PLAYERCLIP), so these keep it at the right height.
   */
  cameraGround?: Box3[];
}

/** Sun, fog, camera spawn, the sealing sky shell and the RTS map boundary. */
export function addEnvironment(doc: VmfDocument, solids: KVNode[], ents: KVNode[], o: EnvironmentOptions): void {
  const mid = new Vector3(o.width / 2, o.height / 2, 0);
  ents.push(entity(doc, 'light_environment', new Vector3(mid.x, mid.y, o.maxHeight), {
    pitch: String(o.sunPitch ?? -50), angles: `0 ${o.sunYaw} 0`, _light: o.light ?? '255 236 205 500', _ambient: o.ambient ?? '165 182 210 160',
    _lightHDR: '-1 -1 -1 1', _ambientHDR: '-1 -1 -1 1', _lightscaleHDR: '1', _AmbientScaleHDR: '1', SunSpreadAngle: '2',
  }));
  ents.push(entity(doc, 'env_fog_controller', new Vector3(mid.x, mid.y, o.maxHeight + 100), {
    fogenable: '1', fogcolor: o.fogColor, fogcolor2: '255 255 255', fogstart: '3000', fogend: '14000',
    fogmaxdensity: '0.6', fogdir: '1 0 0', fogblend: '0', farz: '-1', spawnflags: '1', angles: '0 0 0',
  }));
  ents.push(entity(doc, 'info_player_start', new Vector3(mid.x, mid.y, o.maxHeight - 300), { angles: '0 0 0' }));
  const inner = new Box3(new Vector3(-o.apron - 64, -o.apron - 64, -64), new Vector3(o.width + o.apron + 64, o.height + o.apron + 64, o.maxHeight + 1024));
  solids.push(...shellSolids(doc, inner, 'TOOLS/TOOLSSKYBOX', 32));
  const boundary = entity(doc, 'func_map_boundary', new Vector3(mid.x, mid.y, o.maxHeight / 2), { bloat: '-32.0' });
  // The shell's floor sits at ground level (its top at z = 0), like the shipped maps.
  for (const s of shellSolids(doc, new Box3(new Vector3(0, 0, 0), new Vector3(o.width, o.height, o.maxHeight + 512)), 'TOOLS/TOOLSPLAYERCLIP', 32)) boundary.items.push(s);
  for (const b of o.cameraGround ?? []) boundary.items.push(solidNode(doc, boxFaces(b.min, b.max, 'TOOLS/TOOLSPLAYERCLIP')));
  ents.push(boundary);
}

/** Moves everything by `shift` (texture-locked), attaches it to the document and re-reads it. */
export function finishDoc(doc: VmfDocument, solids: KVNode[], ents: KVNode[], shift: Vector3): VmfDocument {
  const world = doc.world;
  const moveNode = (n: KVNode) => {
    for (const side of n.childrenNamed('side')) {
      const plane = side.get('plane')!;
      side.set('plane', plane.replace(/\(([^)]+)\)/g, (_m, p: string) => {
        const [x, y, z] = p.trim().split(/\s+/).map(Number);
        return `(${vecStr(new Vector3(x + shift.x, y + shift.y, z))})`;
      }));
      for (const key of ['uaxis', 'vaxis']) {
        // Keep texture alignment: shift -= dot(d, axis) / scale.
        const m = /\[([^\]]+)\]\s*(\S+)/.exec(side.get(key)!)!;
        const [ax, ay, az, sh] = m[1].trim().split(/\s+/).map(Number);
        const scale = parseFloat(m[2]);
        const nsh = sh - (shift.x * ax + shift.y * ay) / scale;
        side.set(key, `[${ax} ${ay} ${az} ${Math.round(nsh * 1000) / 1000}] ${m[2]}`);
      }
      const disp = side.child('dispinfo');
      if (disp) {
        const sp = disp.get('startposition')!.replace(/[[\]]/g, '').trim().split(/\s+/).map(Number);
        disp.set('startposition', `[${vecStr(new Vector3(sp[0] + shift.x, sp[1] + shift.y, sp[2]))}]`);
      }
    }
  };
  for (const s of solids) {
    moveNode(s);
    world.items.push(s);
  }
  for (const e of ents) {
    const o = e.get('origin');
    if (o) {
      const [x, y, z] = o.split(/\s+/).map(Number);
      e.set('origin', vecStr(new Vector3(x + shift.x, y + shift.y, z)));
    }
    for (const s of e.childrenNamed('solid')) moveNode(s);
    doc.roots.push(e);
  }
  // Re-read the document so wrappers see the new nodes.
  return VmfDocument.parse(doc.serialize());
}
