import { Box3, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import { VmfDocument } from '../vmf/map.ts';
import { boxFaces, solidNode } from '../edit/brushes.ts';
import { detailEntityNode, generateBuildings, type ArchitectureName, type FacadeStyle } from './buildings.ts';
import { streetDressing, type BlockDressing } from './streets.ts';
import { buildRoads, defaultRoad, roadEntityNode, type RoadSpec } from './roads.ts';
import { addEnvironment, entity, finishDoc, terrainPatch } from './layout.ts';
import { Rng } from './rng.ts';
import { KITS, type ParamValue } from '../lw/kits.ts';
import type { Editor } from '../editor.ts';

/**
 * A 2D map sketch: a grid of 128-unit cells with separate layers for height level, ground surface and
 * features, plus point markers. It is saved next to the VMF (`<map>.sketch.json`) so it can be edited and
 * regenerated.
 */
export const SKETCH_CELL = 128;

export enum Surface { Grass = 0, Dirt = 1, Road = 2, Paved = 3, Rubble = 4 }
export enum Feature { None = 0, Building = 1, Trees = 2, Wall = 3, Rubble = 4, Cars = 5 }

export const SURFACE_INFO: Record<Surface, { label: string; color: string }> = {
  [Surface.Grass]: { label: 'Grass', color: '#5d7a3e' },
  [Surface.Dirt]: { label: 'Dirt', color: '#8a6d4a' },
  [Surface.Road]: { label: 'Road', color: '#9b9488' },
  [Surface.Paved]: { label: 'Cobble', color: '#7d7a76' },
  [Surface.Rubble]: { label: 'Rubble', color: '#6e6258' },
};
export const FEATURE_INFO: Record<Feature, { label: string; color: string }> = {
  [Feature.None]: { label: 'Erase', color: 'transparent' },
  [Feature.Building]: { label: 'Building', color: '#b55a3c' },
  [Feature.Trees]: { label: 'Trees', color: '#2c6b2a' },
  [Feature.Wall]: { label: 'Wall', color: '#cfc6b8' },
  [Feature.Rubble]: { label: 'Debris', color: '#5b5048' },
  [Feature.Cars]: { label: 'Cars', color: '#4f7fa8' },
};

export type MarkerKind = 'mp_start' | 'sp_start' | 'capture_point' | 'scrap' | 'zombies' | 'combine' | 'combine_wave' | 'rebels';
export const MARKER_INFO: Record<MarkerKind, { label: string; color: string; letter: string }> = {
  mp_start: { label: 'Player start (MP)', color: '#3ddc84', letter: 'S' },
  sp_start: { label: 'Mission start', color: '#8fe0ff', letter: 'P' },
  capture_point: { label: 'Capture point', color: '#ffa630', letter: 'C' },
  scrap: { label: 'Scrap', color: '#d8c040', letter: '$' },
  zombies: { label: 'Zombies', color: '#c03a3a', letter: 'Z' },
  combine: { label: 'Combine squad', color: '#4f7fa8', letter: 'K' },
  combine_wave: { label: 'Combine wave', color: '#2a5fa0', letter: 'W' },
  rebels: { label: 'Rebel squad', color: '#d18b2f', letter: 'R' },
};

export interface SketchMarker {
  kind: MarkerKind;
  /** Position in cells (fractional), origin at the south-west corner. */
  x: number;
  y: number;
  /** Optional settings passed to the kit (count, name, unit, ...). */
  params?: Record<string, ParamValue>;
}

export type SketchTheme = 'rural' | 'city';

export interface Sketch {
  version: 1;
  w: number;
  h: number;
  theme: SketchTheme;
  seed: number;
  /** Height of one level step in units. */
  levelHeight: number;
  /** Per cell: height level 0..4. */
  levels: number[];
  /** Per cell: 1 where the slope between levels should be a walkable ramp instead of a cliff. */
  ramps: number[];
  surface: Surface[];
  features: Feature[];
  markers: SketchMarker[];
  floors: [number, number];
  facade?: FacadeStyle;
  /** Kind of buildings (default mixed). */
  architecture?: ArchitectureName;
}

export function emptySketch(w: number, h: number, theme: SketchTheme = 'city'): Sketch {
  const n = w * h;
  return {
    version: 1, w, h, theme, seed: 1, levelHeight: 128,
    levels: new Array(n).fill(0), ramps: new Array(n).fill(0),
    surface: new Array(n).fill(theme === 'city' ? Surface.Paved : Surface.Grass),
    features: new Array(n).fill(Feature.None), markers: [], floors: [2, 4],
  };
}

const THEMES: Record<SketchTheme, { blend: string; alpha: Record<Surface, number>; noise: number; sky: string; fog: string }> = {
  // Blend: $basetexture is alpha 0, $basetexture2 alpha 255.
  rural: { blend: 'NATURE/BLENDGRASSDIRT01', alpha: { 0: 0, 1: 200, 2: 255, 3: 255, 4: 230 }, noise: 6, sky: 'sky_day01_01', fog: '185 195 205' },
  city: { blend: 'NATURE/BLENDSTONEDIRT001A', alpha: { 0: 230, 1: 255, 2: 40, 3: 0, 4: 190 }, noise: 2, sky: 'sky_day01_07', fog: '170 168 160' },
};

const TREES = ['models/props_foliage/tree_deciduous_03a.mdl', 'models/props_foliage/tree_deciduous_03b.mdl', 'models/props_foliage/mall_tree_medium01.mdl', 'models/props_foliage/tree_pine06.mdl'];
/** City 17's bare, leafless street trees. */
const CITY_TREES = ['models/props_foliage/tree_dead03.mdl', 'models/props_foliage/tree_dead04.mdl', 'models/props_foliage/tree_dry02.mdl', 'models/props_foliage/tree_deciduous_03a.mdl'];
const DEBRIS = ['models/props_debris/concrete_debris128pile001a.mdl', 'models/props_debris/concrete_debris128pile001b.mdl', 'models/props_debris/plaster_floorpile001a.mdl', 'models/props_debris/concrete_chunk02a.mdl'];
const CARS = ['models/props_vehicles/car002a.mdl', 'models/props_vehicles/car003a.mdl', 'models/props_vehicles/car004a.mdl', 'models/props_vehicles/car005a.mdl', 'models/props_vehicles/van001a.mdl', 'models/props_vehicles/truck003a.mdl'];

const SAMPLE = 32; // terrain vertex spacing (power-4 displacements on 512 patches)

/** Cells touching a vertex of the 32-unit grid: one inside a cell, two on an edge, four on a corner. */
function vertexCells(s: Sketch, vx: number, vy: number): number[] {
  const sub = SKETCH_CELL / SAMPLE;
  const xs = vx % sub === 0 ? [vx / sub - 1, vx / sub] : [Math.floor(vx / sub)];
  const ys = vy % sub === 0 ? [vy / sub - 1, vy / sub] : [Math.floor(vy / sub)];
  const out: number[] = [];
  for (const cy of ys) for (const cx of xs) if (cx >= 0 && cy >= 0 && cx < s.w && cy < s.h) out.push(cy * s.w + cx);
  return out;
}

/**
 * Terrain heights on the 32-unit vertex grid. Level changes are cliffs (the step happens within one
 * 32-unit quad) unless one of the cells is marked as a ramp: vertices inside ramp areas are solved as a
 * smooth (Laplace) surface between the fixed heights around them.
 */
export function sketchHeights(s: Sketch): { W: number; H: number; heights: Float32Array; steep: Uint8Array } {
  const sub = SKETCH_CELL / SAMPLE;
  const W = s.w * sub + 1, H = s.h * sub + 1;
  const heights = new Float32Array(W * H);
  const free = new Uint8Array(W * H);
  const cellsAt = (vx: number, vy: number) => vertexCells(s, vx, vy);
  for (let vy = 0; vy < H; vy++) for (let vx = 0; vx < W; vx++) {
    const cells = cellsAt(vx, vy);
    const i = vy * W + vx;
    const nonRamp = cells.filter((c) => !s.ramps[c]);
    if (!nonRamp.length) {
      free[i] = 1;
      heights[i] = cells.reduce((a, c) => a + s.levels[c], 0) / cells.length * s.levelHeight;
    } else {
      // Cliff tops stay sharp: a vertex shared by several levels takes the highest.
      heights[i] = Math.max(...nonRamp.map((c) => s.levels[c])) * s.levelHeight;
    }
  }
  // Ramps: relax free vertices towards the average of their neighbours.
  const freeIdx: number[] = [];
  for (let i = 0; i < free.length; i++) if (free[i]) freeIdx.push(i);
  for (let it = 0; it < 400 && freeIdx.length; it++) {
    for (const i of freeIdx) {
      const x = i % W, y = Math.floor(i / W);
      let sum = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        sum += heights[ny * W + nx];
        n++;
      }
      heights[i] = sum / n;
    }
  }
  // Steep vertices (cliff faces) get the rough texture.
  const steep = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const h0 = heights[y * W + x];
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (Math.abs(heights[ny * W + nx] - h0) > SAMPLE * 1.2) steep[y * W + x] = 1;
    }
  }
  return { W, H, heights, steep };
}

/** Boxes from z = 0 up to each raised level (greedy rectangles of cells at or above the level). */
export function levelBlocks(s: Sketch): Box3[] {
  const out: Box3[] = [];
  const maxLevel = Math.max(0, ...s.levels);
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    const used = new Uint8Array(s.w * s.h);
    const is = (x: number, y: number) => x >= 0 && y >= 0 && x < s.w && y < s.h && s.levels[y * s.w + x] >= lvl && !used[y * s.w + x];
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      if (!is(x, y)) continue;
      let x1 = x;
      while (is(x1 + 1, y)) x1++;
      let y1 = y;
      const rowOk = (yy: number) => { for (let xx = x; xx <= x1; xx++) if (!is(xx, yy)) return false; return true; };
      while (rowOk(y1 + 1)) y1++;
      for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) used[yy * s.w + xx] = 1;
      // Each level's block sits on the one below it, so they never overlap.
      out.push(new Box3(new Vector3(x * SKETCH_CELL, y * SKETCH_CELL, (lvl - 1) * s.levelHeight), new Vector3((x1 + 1) * SKETCH_CELL, (y1 + 1) * SKETCH_CELL, lvl * s.levelHeight)));
    }
  }
  return out;
}

/** Rectangles covering the cells of one feature type that share a height level (greedy). */
function featureRects(s: Sketch, f: Feature): { box: Box3; level: number }[] {
  return cellRects(s, (i) => s.features[i] === f, 8);
}

/** Greedy rectangles of matching cells on one height level, at most `max` cells along each side. */
function cellRects(s: Sketch, match: (i: number) => boolean, max: number): { box: Box3; level: number }[] {
  const used = new Uint8Array(s.w * s.h);
  const out: { box: Box3; level: number }[] = [];
  const is = (x: number, y: number, lvl: number) => x >= 0 && y >= 0 && x < s.w && y < s.h && match(y * s.w + x) && s.levels[y * s.w + x] === lvl && !used[y * s.w + x];
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const lvl = s.levels[y * s.w + x];
    if (!is(x, y, lvl)) continue;
    let x1 = x;
    while (is(x1 + 1, y, lvl) && x1 - x < max - 1) x1++;
    let y1 = y;
    const rowOk = (yy: number) => { for (let xx = x; xx <= x1; xx++) if (!is(xx, yy, lvl)) return false; return true; };
    while (y1 - y < max - 1 && rowOk(y1 + 1)) y1++;
    for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) used[yy * s.w + xx] = 1;
    out.push({ box: new Box3(new Vector3(x * SKETCH_CELL, y * SKETCH_CELL, 0), new Vector3((x1 + 1) * SKETCH_CELL, (y1 + 1) * SKETCH_CELL, 0)), level: lvl });
  }
  return out;
}

export interface SketchResult {
  doc: VmfDocument;
  /** World offset applied to layout coordinates (for placing markers afterwards). */
  shift: Vector3;
  heightAt(x: number, y: number): number;
}

/** Turns a sketch into a complete map (terrain, buildings, walls, props, lighting, shell, boundary). */
export function generateFromSketch(s: Sketch): SketchResult {
  const doc = VmfDocument.empty();
  const rng = new Rng(s.seed);
  const theme = THEMES[s.theme];
  const { W, H, heights, steep } = sketchHeights(s);
  // Alpha per vertex from the surrounding cells' surfaces, softened; steep vertices get the rough texture.
  const alpha = new Float32Array(W * H);
  for (let vy = 0; vy < H; vy++) for (let vx = 0; vx < W; vx++) {
    const cells = vertexCells(s, vx, vy);
    let a = cells.reduce((sum, c) => sum + theme.alpha[s.surface[c] as Surface], 0) / cells.length;
    if (steep[vy * W + vx]) a = 255;
    if (cells.some((c) => s.surface[c] === Surface.Grass || s.surface[c] === Surface.Dirt || s.surface[c] === Surface.Rubble)) a += (rng.next() - 0.5) * 50;
    alpha[vy * W + vx] = Math.max(0, Math.min(255, Math.round(a)));
  }
  const sampleGrid = (f: Float32Array, x: number, y: number) => {
    // Outside the sketch the edge values continue (the scenery apron).
    const gx = Math.max(0, Math.min(W - 1, Math.round(x / SAMPLE))), gy = Math.max(0, Math.min(H - 1, Math.round(y / SAMPLE)));
    return f[gy * W + gx];
  };
  const noise = (x: number, y: number) => {
    const surf = s.surface[Math.min(s.h - 1, Math.max(0, Math.floor(y / SKETCH_CELL))) * s.w + Math.min(s.w - 1, Math.max(0, Math.floor(x / SKETCH_CELL)))];
    if (surf === Surface.Road || surf === Surface.Paved) return 0;
    const h = Math.sin(x * 0.013 + s.seed) * Math.cos(y * 0.011 - s.seed) + Math.sin((x + y) * 0.031);
    return h * theme.noise;
  };
  const heightAt = (x: number, y: number) => Math.round((sampleGrid(heights, x, y) + noise(x, y)) * 10) / 10;
  const alphaAt = (x: number, y: number) => sampleGrid(alpha, x, y);
  const flatHeight = (x: number, y: number) => sampleGrid(heights, x, y);

  const solids: KVNode[] = [];
  const ents: KVNode[] = [];
  const mapW = s.w * SKETCH_CELL, mapH = s.h * SKETCH_CELL;
  const apron = 512;
  const P = 512;
  for (let y = -apron; y < mapH + apron; y += P) for (let x = -apron; x < mapW + apron; x += P) {
    solids.push(terrainPatch(doc, x, y, P, theme.blend, heightAt, alphaAt, 4));
  }

  const shift = new Vector3(-mapW / 2, -mapH / 2, 0);
  // Roads over the road cells, built by the road tool's code (so they can be edited as roads): in the city
  // an asphalt carriageway with kerbs and pavements inside the road cells, in the countryside a dirt track.
  // A piece that ends against another road runs on to its centre, so the crossing opens.
  const roads: RoadSpec[] = [];
  const isRoad = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < s.w && cy < s.h && s.surface[cy * s.w + cx] === Surface.Road;
  for (const { box } of cellRects(s, (i) => s.surface[i] === Surface.Road, 64)) {
    const size = box.getSize(new Vector3());
    const alongX = size.x >= size.y;
    const long = Math.max(size.x, size.y), short = Math.min(size.x, size.y);
    const c = box.getCenter(new Vector3());
    const ends = alongX ? [new Vector3(box.min.x, c.y, 0), new Vector3(box.max.x, c.y, 0)] : [new Vector3(c.x, box.min.y, 0), new Vector3(c.x, box.max.y, 0)];
    const cell = (v: number) => Math.floor(v / SKETCH_CELL);
    ends.forEach((p, k) => {
      const out = k === 0 ? -1 : 1;
      const beyond = alongX ? isRoad(cell(p.x) + (out < 0 ? -1 : 0), cell(c.y)) : isRoad(cell(c.x), cell(p.y) + (out < 0 ? -1 : 0));
      if (beyond) { if (alongX) p.x += out * SKETCH_CELL; else p.y += out * SKETCH_CELL; }
      p.z = flatHeight(p.x - (alongX ? out : 0), p.y - (alongX ? 0 : out));
    });
    if (s.theme === 'city') {
      const pavement = short >= 384 ? 64 : 48;
      // The pavement stops 6 units short of the building line, clear of the buildings' base course (4 out):
      // overlapping detail brushes get chopped against each other, and over a whole district the extra
      // t-junctions overflow vbsp's limit.
      const width = Math.max(96, short - 2 * (pavement + 8 + 6));
      roads.push({ ...defaultRoad('asphalt', ends), width, pavement, radius: 0, lined: long >= short * 2 && width >= 128, lift: 3 });
    } else {
      roads.push({ ...defaultRoad('dirt', ends), width: short - 32, radius: 0, lift: 2 });
    }
  }
  // Longest first: through roads keep their surface across junctions.
  roads.sort((a, b) => b.points[0].distanceTo(b.points[1]) - a.points[0].distanceTo(a.points[1]));
  buildRoads(doc, roads).forEach((nodes, i) => {
    const stored = { ...roads[i], points: roads[i].points.map((p) => p.clone().add(shift)) };
    ents.push(roadEntityNode(doc, stored, nodes));
  });

  // Buildings: one generated block per rectangle of building cells, on that cell's height level.
  const dressings: BlockDressing[] = [];
  for (const { box, level } of featureRects(s, Feature.Building)) {
    const z = level * s.levelHeight;
    const fp = box.clone();
    fp.min.z = fp.max.z = z;
    const b = generateBuildings(doc, fp, { seed: rng.int(1, 1e9), minFloors: s.floors[0], maxFloors: s.floors[1], alleys: false, roofProps: true, style: s.facade, architecture: s.architecture });
    solids.push(...b.solids);
    const d = detailEntityNode(doc, b.detail);
    if (d) ents.push(d);
    for (const e of b.entities) ents.push(entity(doc, e.classname, e.origin, e.keys));
    dressings.push(b.dressing);
  }
  // Cables across streets, lamps and trees: only between blocks on the same level.
  for (const z of new Set(dressings.map((d) => d.z0))) {
    for (const e of streetDressing(dressings.filter((d) => d.z0 === z), rng)) ents.push(entity(doc, e.classname, e.origin, e.keys));
  }
  // Walls: 48-thick concrete runs through wall cells, joined across neighbours.
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const i = y * s.w + x;
    if (s.features[i] !== Feature.Wall) continue;
    const z = s.levels[i] * s.levelHeight;
    const wall = (dx: number, dy: number) => x + dx >= 0 && y + dy >= 0 && x + dx < s.w && y + dy < s.h && s.features[(y + dy) * s.w + x + dx] === Feature.Wall;
    const cx = (x + 0.5) * SKETCH_CELL, cy = (y + 0.5) * SKETCH_CELL, t = 24, hgt = 160;
    const horiz = wall(-1, 0) || wall(1, 0), vert = wall(0, -1) || wall(0, 1);
    const mat = 'CONCRETE/CONCRETEWALL071A';
    const add = (min: Vector3, max: Vector3) => solids.push(solidNode(doc, boxFaces(min, max, { top: mat, bottom: 'TOOLS/TOOLSNODRAW', sides: mat })));
    if (horiz || !vert) add(new Vector3(wall(-1, 0) ? x * SKETCH_CELL : cx - t, cy - t, z - 16), new Vector3(wall(1, 0) ? (x + 1) * SKETCH_CELL : cx + t, cy + t, z + hgt));
    if (vert) add(new Vector3(cx - t, wall(0, -1) ? y * SKETCH_CELL : cy - t, z - 16), new Vector3(cx + t, wall(0, 1) ? (y + 1) * SKETCH_CELL : cy + t, z + hgt));
  }
  // Props on feature cells.
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const f = s.features[y * s.w + x];
    const at = () => {
      const px = (x + rng.range(0.2, 0.8)) * SKETCH_CELL, py = (y + rng.range(0.2, 0.8)) * SKETCH_CELL;
      return new Vector3(Math.round(px), Math.round(py), Math.round(flatHeight(px, py)) - 2);
    };
    if (f === Feature.Trees) ents.push(entity(doc, 'prop_static', at(), { model: rng.pick(s.theme === 'city' ? CITY_TREES : TREES), angles: `0 ${rng.int(0, 359)} 0`, solid: '6' }));
    else if (f === Feature.Rubble && rng.chance(0.7)) ents.push(entity(doc, 'prop_static', at(), { model: rng.pick(DEBRIS), angles: `0 ${rng.int(0, 359)} 0`, solid: '6' }));
    else if (f === Feature.Cars && rng.chance(0.6)) ents.push(entity(doc, 'prop_static', at(), { model: rng.pick(CARS), angles: `0 ${rng.int(0, 3) * 90 + rng.int(-12, 12)} 0`, solid: '6' }));
  }

  const maxLevel = Math.max(0, ...s.levels);
  addEnvironment(doc, solids, ents, {
    width: mapW, height: mapH, apron, maxHeight: maxLevel * s.levelHeight + s.floors[1] * 128 + 768,
    sunYaw: rng.int(20, 70), fogColor: theme.fog, cameraGround: levelBlocks(s),
  });
  doc.world.set('skyname', theme.sky);
  const out = finishDoc(doc, solids, ents, shift);
  return { doc: out, shift, heightAt: (x, y) => flatHeight(x - shift.x, y - shift.y) };
}

/** Kit settings used for sketch markers. */
const MARKER_KITS: Record<MarkerKind, { kit: string; params: Record<string, ParamValue> }> = {
  mp_start: { kit: 'mp_start', params: {} },
  sp_start: { kit: 'sp_start', params: { faction: 'rebels', squad: 'rebel', count: 6 } },
  capture_point: { kit: 'capture_point', params: { radius: 192, owner: '0', time: 15 } },
  scrap: { kit: 'unit_group', params: {} },
  zombies: { kit: 'unit_group', params: { unit: 'zombie', count: 6, owner: '1', spacing: 72 } },
  combine: { kit: 'unit_group', params: { unit: 'combine', count: 5, owner: '3', spacing: 64 } },
  combine_wave: { kit: 'wave', params: { name: 'combine_wave', unit: 'combine', count: 8, live: 4, freq: 3, owner: '3', goal: 0, disabled: true } },
  rebels: { kit: 'unit_group', params: { unit: 'rebel', count: 4, owner: '2', spacing: 56 } },
};

/**
 * Places the sketch markers into a generated document with the Lambda Wars kits. `editor` only needs a
 * `doc`: kits use it for names and ids.
 */
export function placeMarkers(editor: Pick<Editor, 'doc'>, s: Sketch, r: SketchResult): void {
  for (const m of s.markers) {
    const lx = m.x * SKETCH_CELL, ly = m.y * SKETCH_CELL;
    const at = new Vector3(Math.round(lx + r.shift.x), Math.round(ly + r.shift.y), Math.round(r.heightAt(lx + r.shift.x, ly + r.shift.y)));
    if (m.kind === 'scrap') {
      editor.doc.addEntity(entity(editor.doc, 'scrap_marker', at, { angles: '0 0 0', autoconstruct: '1', constructed: '2' }));
      continue;
    }
    const spec = MARKER_KITS[m.kind];
    const kit = KITS.find((k) => k.id === spec.kit)!;
    const defaults = Object.fromEntries(kit.params.map((p) => [p.key, p.default]));
    kit.place(editor as Editor, at, { ...defaults, ...spec.params, ...(m.params ?? {}) });
  }
}

/** Mirrors a painted cell according to the symmetry mode. */
export function symmetricCells(s: Sketch, x: number, y: number, mode: 'none' | 'mirror' | 'rotate'): [number, number][] {
  const out: [number, number][] = [[x, y]];
  if (mode === 'mirror') out.push([s.w - 1 - x, y]);
  if (mode === 'rotate') out.push([s.w - 1 - x, s.h - 1 - y]);
  return out;
}
