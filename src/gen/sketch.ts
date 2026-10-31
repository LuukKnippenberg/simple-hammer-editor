import { Box2, Box3, Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import { VmfDocument } from '../vmf/map.ts';
import { boxFaces, solidNode } from '../edit/brushes.ts';
import type { ArchitectureName, BuildingQuality, FacadeStyle } from './buildings.ts';
import type { YardStyle } from './yards.ts';
import type { BlockDressing } from './streets.ts';
import { blockIntoDoc, blockUids, groupStreet, type BlockSpec } from './buildingStore.ts';
import { buildRoads, defaultRoad, roadEntityNode, roadGround, type RoadSpec } from './roads.ts';
import { PROP_BOUNDS, standZ } from './props.ts';
import { addEnvironment, entity, finishDoc, terrainPatch } from './layout.ts';
import { Rng } from './rng.ts';
import { MODEL_BOUNDS } from './poi/models.ts';
import { KITS, type ParamValue } from '../lw/kits.ts';
import type { Editor } from '../editor.ts';
import { levelForPois, type PoiPlacement } from './poi/mapgen.ts';
import { dressEdges, surfaceEdges } from './surfaceEdges.ts';
import type { RoadMaterials } from './streetMaterials.ts';
import { areaAlpha, areaEdging, encodeCuts, insideDistance, shapeCuts, shapeRoads, boxesOverlap, type ShapeSurface, type SketchShape } from './sketchShapes.ts';
import { bandWidth, buildSurroundings, extendEdgeRoads, HILL_HEIGHT, PLAIN_APRON, sideOf, styleOf, surroundRise, type SurroundSpec } from './surroundings.ts';

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
  /** Enterable open-top houses among the buildings (default from the architecture). */
  interiors?: 'none' | 'some' | 'all';
  /** Points of interest: rectangles in cells, built by the POI generator (see placePois in poi/sketchPois.ts). */
  pois?: SketchPoi[];
  /**
   * How detailed the buildings are where nothing is painted (see blockQuality): `high` everywhere (default),
   * or `auto` by distance to the action (markers and POIs).
   */
  buildingDetail?: 'high' | 'auto';
  /** Per cell, painted: 0 (or missing) not painted, 1 high, 2 medium, 3 filler (QUALITY_PAINT). */
  quality?: number[];
  /**
   * Longest side of one block of buildings, in cells (default 8). Building cells beyond it start another block;
   * blocks of 7 cells and more can be rings around a courtyard.
   */
  blockSize?: number;
  /** What fills courtyards and back yards (default sheds; green: lawns, trees, playgrounds, parking). */
  yards?: YardStyle;
  /** Share of a ring's side lots left open onto the street (0–1, default 0). */
  openYards?: number;
  /**
   * Street furnishing: classic (default), or sofia: wider pavements on streets of 4 cells and more, cars parked
   * along both kerbs of wide carriageways and bollards on the pavement edges.
   */
  streets?: 'classic' | 'sofia';
  /** What lies beyond the playable area (default: a flat apron). */
  surroundings?: SurroundSpec;
  /** Carriageway, pavement, kerb and gutter materials and rounded corners for the streets (default: City 17). */
  streetMaterials?: RoadMaterials;
  /** Streets and areas drawn freely over the cells: diagonal and curved streets, round squares, lawns. */
  shapes?: SketchShape[];
}

/** The painted values of the sketch's Detail layer. */
export const QUALITY_PAINT: Record<1 | 2 | 3, { quality: BuildingQuality; label: string; color: string }> = {
  1: { quality: 'high', label: 'High detail', color: '#e05a4f' },
  2: { quality: 'medium', label: 'Medium detail', color: '#e8a33d' },
  3: { quality: 'filler', label: 'Filler', color: '#6e8fb0' },
};

/** Auto detail: blocks within this many cells of a marker or POI are high, within the second medium, the rest filler. */
export const AUTO_DETAIL = { high: 3, medium: 8 };

/**
 * The quality of a block of buildings on cells [x0, x1) × [y0, y1): the most detailed quality painted on any of
 * its cells; else by the sketch's `buildingDetail` (auto: the cell gap to the nearest marker or POI).
 */
export function blockQuality(s: Sketch, x0: number, y0: number, x1: number, y1: number): BuildingQuality {
  let painted = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const v = s.quality?.[y * s.w + x] ?? 0;
    if (v && (!painted || v < painted)) painted = v;
  }
  if (painted) return QUALITY_PAINT[painted as 1 | 2 | 3].quality;
  if (s.buildingDetail !== 'auto') return 'high';
  // Gap between two cell ranges along one axis (0 when they overlap).
  const gap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, b0 - a1, a0 - b1);
  const dist = (bx0: number, by0: number, bx1: number, by1: number) => Math.hypot(gap(x0, x1, bx0, bx1), gap(y0, y1, by0, by1));
  const d = Math.min(Infinity, ...s.markers.map((m) => dist(m.x, m.y, m.x, m.y)), ...(s.pois ?? []).map((p) => dist(p.x, p.y, p.x + p.w, p.y + p.h)));
  return d <= AUTO_DETAIL.high ? 'high' : d <= AUTO_DETAIL.medium ? 'medium' : 'filler';
}

/** The blocks of buildings the sketch makes (cell rectangles) and their quality, as the generator will build them. */
export function sketchBlocks(s: Sketch): { x0: number; y0: number; x1: number; y1: number; quality: BuildingQuality }[] {
  return featureRects(s, Feature.Building).map(({ box }) => {
    const x0 = Math.round(box.min.x / SKETCH_CELL), y0 = Math.round(box.min.y / SKETCH_CELL), x1 = Math.round(box.max.x / SKETCH_CELL), y1 = Math.round(box.max.y / SKETCH_CELL);
    return { x0, y0, x1, y1, quality: blockQuality(s, x0, y0, x1, y1) };
  });
}

export interface SketchPoi {
  type: string;
  /** Rectangle in cells, from the south-west corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: 0 | 90 | 180 | 270;
  seed: number;
  params?: Record<string, ParamValue>;
}

/** A sketch's POIs as placements in layout units. */
export function sketchPoiPlacements(s: Sketch): PoiPlacement[] {
  return (s.pois ?? []).map((p) => ({
    type: p.type, seed: p.seed, rotation: p.rotation ?? 0, params: poiGround(s, p), landscape: s.theme === 'city' ? 'city' : undefined,
    rect: { x0: p.x * SKETCH_CELL, y0: p.y * SKETCH_CELL, x1: (p.x + p.w) * SKETCH_CELL, y1: (p.y + p.h) * SKETCH_CELL },
  }));
}

/**
 * A POI's parameters with its `ground` set from the sketch where it isn't set: the surface most of its cells have
 * (paving or a road), so a park or a parking lot on a square takes the square's paving round it.
 */
function poiGround(s: Sketch, p: SketchPoi): Record<string, ParamValue> | undefined {
  if (p.params?.ground !== undefined || s.theme !== 'city') return p.params;
  const n: Record<number, number> = {};
  for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
    const v = s.surface[y * s.w + x];
    n[v] = (n[v] ?? 0) + 1;
  }
  const top = Number(Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0]);
  const ground = top === Surface.Paved ? 'paving' : top === Surface.Road ? 'asphalt' : undefined;
  return ground ? { ...p.params, ground } : p.params;
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

/** Gap between a parked car and the kerb; the rest of the carriageway must leave room for units. */
const KERB_GAP = 6;
const LANE_LEFT = 32;

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
  return cellRects(s, (i) => s.features[i] === f, f === Feature.Building ? Math.max(2, s.blockSize ?? 8) : 8);
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
  /** Ground height of each POI (in sketch order). */
  poiLevels: number[];
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
  // POIs level the terrain under them (and cut their sea or pits into it).
  const pois = levelForPois((x, y) => sampleGrid(heights, x, y), sketchPoiPlacements(s));
  // No noise where a POI levelled the ground.
  const mapW = s.w * SKETCH_CELL, mapH = s.h * SKETCH_CELL;
  // Beyond the edge: hills rise out of the terrain (city and wall sides stay level).
  const rise = surroundRise(s.surroundings, mapW, mapH, s.seed);
  const heightAt = (x: number, y: number) => Math.round((pois.height(x, y) + noise(x, y) * (1 - pois.weight(x, y)) + rise(x, y)) * 10) / 10;
  // Areas drawn over the cells paint their surface into the blend, softly at their outline.
  const SHAPE_SURFACE: Record<ShapeSurface, Surface> = { grass: Surface.Grass, dirt: Surface.Dirt, paved: Surface.Paved, rubble: Surface.Rubble };
  const inAreas = areaAlpha(s.shapes, SKETCH_CELL, (sf) => theme.alpha[SHAPE_SURFACE[sf]]);
  const alphaAt = (x: number, y: number) => inAreas(x, y, sampleGrid(alpha, x, y));
  // Hills are grass, with dirt showing through higher up and in patches.
  const hillAlpha = (x: number, y: number) => Math.max(0, Math.min(220, 20 + (rise(x, y) / HILL_HEIGHT) * 110 + Math.sin(x * 0.0037 + s.seed) * Math.cos(y * 0.0049) * 70));
  const flatHeight = (x: number, y: number) => pois.height(x, y) + rise(x, y);

  const solids: KVNode[] = [];
  const ents: KVNode[] = [];
  const apron = bandWidth(s.surroundings);
  const P = 512;
  // The terrain's top faces by patch, for overlays laid on it.
  const patchTops = new Map<string, string>();
  for (let y = -apron; y < mapH + apron; y += P) for (let x = -apron; x < mapW + apron; x += P) {
    const side = sideOf(x + P / 2, y + P / 2, mapW, mapH);
    const hill = !!side && styleOf(s.surroundings, side) === 'hills';
    const patch = terrainPatch(doc, x, y, P, hill ? THEMES.rural.blend : theme.blend, heightAt, hill ? hillAlpha : alphaAt, 4);
    solids.push(patch);
    patchTops.set(`${x},${y}`, patch.childrenNamed('side')[0].get('id')!);
  }
  const patchSide = (x: number, y: number) => patchTops.get(`${Math.floor((x + apron) / P) * P - apron},${Math.floor((y + apron) / P) * P - apron}`) ?? null;

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
      const pavement = s.streets === 'sofia' && short >= 512 ? 96 : short >= 384 ? 64 : 48;
      // The pavement stops 6 units short of the building line, clear of the buildings' base course (4 out):
      // overlapping detail brushes get chopped against each other, and over a whole district the extra
      // t-junctions overflow vbsp's limit.
      const width = Math.max(96, short - 2 * (pavement + 8 + 6));
      roads.push({ ...defaultRoad('asphalt', ends), width, pavement, radius: 0, lined: long >= short * 2 && width >= 128, lift: 3, ...(s.streetMaterials ? { materials: { ...s.streetMaterials } } : {}) });
    } else {
      roads.push({ ...defaultRoad('dirt', ends), width: short - 32, radius: 0, lift: 2 });
    }
  }
  // Streets drawn as shapes: diagonal and curved, built by the same road code.
  roads.push(...shapeRoads(s.shapes, SKETCH_CELL, flatHeight, s.streetMaterials));
  // What buildings and props keep off: the shapes' streets and areas.
  const cuts = shapeCuts(s.shapes, SKETCH_CELL);
  const inCut = (x: number, y: number) => cuts.some((c) => insideDistance(c, x, y) > 0);
  // Streets that reach a city or wall side run on out of the map.
  extendEdgeRoads(roads, s.surroundings, mapW, mapH, flatHeight);
  // Longest first: through roads keep their surface across junctions.
  roads.sort((a, b) => b.points[0].distanceTo(b.points[1]) - a.points[0].distanceTo(a.points[1]));
  buildRoads(doc, roads).forEach((nodes, i) => {
    const stored = { ...roads[i], points: roads[i].points.map((p) => p.clone().add(shift)) };
    ents.push(roadEntityNode(doc, stored, nodes));
  });
  // The walkable top under a point: the road's surface, kerb or pavement where there is one, else the terrain.
  const onRoad = roadGround(roads);
  const groundAt = (x: number, y: number) => onRoad(x, y)?.z ?? flatHeight(x, y);
  const carriageway = (x: number, y: number) => { const g = onRoad(x, y); return !!g && (g.kind === 'surface' || g.kind === 'rail'); };
  if (s.streets === 'sofia' && s.theme === 'city') ents.push(...sofiaStreets(doc, roads, onRoad, new Rng(s.seed * 61 + 5)));

  // A block's cut option: the shape cuts over it, in world units.
  const blockCut = (box: Box3) => {
    const r = [new Vector2(box.min.x, box.min.y), new Vector2(box.max.x, box.min.y), new Vector2(box.max.x, box.max.y), new Vector2(box.min.x, box.max.y)];
    const mine = cuts.filter((c) => boxesOverlap(c, r)).map((c) => c.map((p) => new Vector2(p.x + shift.x, p.y + shift.y)));
    return mine.length ? { cut: encodeCuts(mine) } : {};
  };
  // Buildings: one generated block per rectangle of building cells, on that cell's height level. Each is a stored
  // block (with a handle); the blocks on one level are a group, which shares its street dressing.
  const blocks: { spec: BlockSpec; dressing: BlockDressing }[] = [];
  const ids = new Rng(s.seed * 23 + 9), uid = blockUids(ids);
  const groups = new Map<number, { id: string; seed: number }>();
  for (const { box, level } of featureRects(s, Feature.Building)) {
    const z = level * s.levelHeight;
    let group = groups.get(z);
    if (!group) groups.set(z, (group = { id: uid(), seed: ids.int(1, 1e9) }));
    const spec: BlockSpec = {
      uid: uid(), group: group.id, street: 'ground', groupSeed: group.seed, z,
      rect: { x0: box.min.x + shift.x, y0: box.min.y + shift.y, x1: box.max.x + shift.x, y1: box.max.y + shift.y },
      options: {
        seed: rng.int(1, 1e9), minFloors: s.floors[0], maxFloors: s.floors[1], alleys: false, roofProps: true, style: s.facade, architecture: s.architecture, interiors: s.interiors,
        yards: s.yards, openYards: s.openYards,
        ...blockCut(box),
        quality: blockQuality(s, Math.round(box.min.x / SKETCH_CELL), Math.round(box.min.y / SKETCH_CELL), Math.round(box.max.x / SKETCH_CELL), Math.round(box.max.y / SKETCH_CELL)),
      },
    };
    const b = blockIntoDoc(doc, spec, (c, o, k) => entity(doc, c, o, k), shift);
    solids.push(...b.world);
    ents.push(...b.entities);
    blocks.push({ spec, dressing: b.out.dressing });
  }
  // Cables across streets, lamps and trees: only between blocks on the same level. Lamps and trees stand on
  // the pavement, never on a carriageway.
  const standing: Vector2[] = [];
  for (const g of groups.values()) {
    const mine = blocks.filter((b) => b.spec.group === g.id);
    for (const e of groupStreet(mine.map((b) => b.spec), (x, y) => (carriageway(x, y) ? null : groundAt(x, y)), mine.map((b) => b.dressing), rng)) {
      ents.push(entity(doc, e.classname, e.origin, e.keys));
      if (e.classname === 'prop_static') standing.push(new Vector2(e.origin.x, e.origin.y));
    }
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
  // Parked cars in road cells: along the nearer kerb, facing the traffic on that side, on the carriageway and
  // clear of kerbs, other cars, lamps and trees.
  const parked: Box2[] = [];
  const parkCar = (x: number, y: number): KVNode | null => {
    const c = new Vector2((x + 0.5) * SKETCH_CELL, (y + 0.5) * SKETCH_CELL);
    let best: { r: RoadSpec; dir: Vector2; n: Vector2; along: number; across: number } | null = null;
    for (const r of roads) {
      const a = new Vector2(r.points[0].x, r.points[0].y), b = new Vector2(r.points[1].x, r.points[1].y);
      const dir = b.clone().sub(a).normalize(), n = new Vector2(-dir.y, dir.x);
      const along = c.clone().sub(a).dot(dir), across = c.clone().sub(a).dot(n);
      if (along < 0 || along > a.distanceTo(b) || (best && Math.abs(across) >= Math.abs(best.across))) continue;
      best = { r, dir, n, along, across };
    }
    if (!best || Math.abs(best.across) > best.r.width / 2 + best.r.pavement + 64) return null;
    const { r, dir, n, along, across } = best;
    // Vans and trucks only where they leave a lane free; on a narrow road whatever fits at all.
    const carWidth = (m: string) => PROP_BOUNDS[m][4] - PROP_BOUNDS[m][1];
    let fits = CARS.filter((m) => r.width - KERB_GAP - carWidth(m) >= LANE_LEFT);
    if (!fits.length) fits = CARS.filter((m) => r.width - 2 * KERB_GAP >= carWidth(m));
    if (!fits.length) return null;
    const model = rng.pick(fits);
    const [x0, y0, , x1, y1] = PROP_BOUNDS[model];
    // Right-hand traffic: on the left of the road's direction a car faces back along it.
    const side = across >= 0 ? 1 : -1, face = -side;
    const [lo, hi] = face > 0 ? [y0, y1] : [-y1, -y0];
    const off = side > 0 ? r.width / 2 - KERB_GAP - hi : -r.width / 2 + KERB_GAP - lo;
    const mid = face > 0 ? (x0 + x1) / 2 : -(x0 + x1) / 2;
    const yaw = Math.atan2(dir.y, dir.x) + (face > 0 ? 0 : Math.PI) + rng.range(-0.03, 0.03);
    const fx = new Vector2(Math.cos(yaw), Math.sin(yaw)), fy = new Vector2(-fx.y, fx.x);
    const shift = rng.range(-24, 24);
    for (const d of [shift, 0, -64, 64]) {
      const o = new Vector2(r.points[0].x, r.points[0].y).addScaledVector(dir, along - mid + d).addScaledVector(n, off);
      // The footprint (and its edges' midpoints) must lie on the carriageway, a little inside it.
      const pts: Vector2[] = [];
      for (const [u, v] of [[x0 - 2, y0 - 2], [x1 + 2, y0 - 2], [x1 + 2, y1 + 2], [x0 - 2, y1 + 2], [(x0 + x1) / 2, y0 - 2], [(x0 + x1) / 2, y1 + 2]]) {
        pts.push(o.clone().addScaledVector(fx, u).addScaledVector(fy, v));
      }
      if (!pts.every((p) => carriageway(p.x, p.y))) continue;
      const box = new Box2().setFromPoints(pts);
      if (parked.some((q) => q.intersectsBox(box)) || standing.some((p) => box.distanceToPoint(p) < 24)) continue;
      parked.push(box);
      const z = Math.min(...pts.map((p) => groundAt(p.x, p.y)));
      return entity(doc, 'prop_static', new Vector3(Math.round(o.x), Math.round(o.y), standZ(model, z)), { model, angles: `0 ${Math.round((yaw * 180) / Math.PI)} 0`, solid: '6' });
    }
    return null;
  };
  // Props on feature cells.
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const f = s.features[y * s.w + x];
    const at = () => {
      const px = (x + rng.range(0.2, 0.8)) * SKETCH_CELL, py = (y + rng.range(0.2, 0.8)) * SKETCH_CELL;
      return new Vector3(Math.round(px), Math.round(py), Math.round(groundAt(px, py)) - 2);
    };
    if (f !== Feature.None && inCut((x + 0.5) * SKETCH_CELL, (y + 0.5) * SKETCH_CELL)) continue;
    if (f === Feature.Trees) ents.push(entity(doc, 'prop_static', at(), { model: rng.pick(s.theme === 'city' ? CITY_TREES : TREES), angles: `0 ${rng.int(0, 359)} 0`, solid: '6' }));
    else if (f === Feature.Rubble && rng.chance(0.7)) ents.push(entity(doc, 'prop_static', at(), { model: rng.pick(DEBRIS), angles: `0 ${rng.int(0, 359)} 0`, solid: '6' }));
    else if (f === Feature.Cars && rng.chance(0.6)) {
      if (s.surface[y * s.w + x] === Surface.Road) {
        const car = parkCar(x, y);
        if (car) ents.push(car);
      } else {
        const p = at(), model = rng.pick(CARS);
        p.z = standZ(model, p.z + 2);
        ents.push(entity(doc, 'prop_static', p, { model, angles: `0 ${rng.int(0, 3) * 90 + rng.int(-12, 12)} 0`, solid: '6' }));
      }
    }
  }

  // Where lawns and dirt meet paving: a stone edging along the boundary and leaves and dirt over it. Not under
  // buildings or POIs (they edge themselves), and only on the level ground of the city.
  if (s.theme === 'city') {
    const surf = (x: number, y: number) => s.surface[y * s.w + x];
    const inPoi = (x: number, y: number) => (s.pois ?? []).some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    const edges = surfaceEdges(s.w, s.h, SKETCH_CELL,
      (x, y) => surf(x, y) === Surface.Grass || surf(x, y) === Surface.Dirt,
      (x, y) => surf(x, y) === Surface.Paved,
      (x, y) => s.features[y * s.w + x] === Feature.Building || inPoi(x, y) || s.levels[y * s.w + x] !== 0);
    const dressed = dressEdges(doc, edges, flatHeight, patchSide, shift, new Rng(s.seed * 83 + 7));
    // And round the areas drawn as shapes.
    const ring = areaEdging(doc, s.shapes, SKETCH_CELL, flatHeight, patchSide, shift, new Rng(s.seed * 89 + 5));
    dressed.brushes.push(...ring.brushes);
    dressed.overlays.push(...ring.overlays);
    if (dressed.brushes.length) {
      const e = entity(doc, 'func_detail', new Vector3(), {});
      e.delete('origin');
      e.items.push(...dressed.brushes);
      ents.push(e);
    }
    ents.push(...dressed.overlays);
  }

  // Beyond the edge: the city going on, a Combine wall or wooded hills (one func_brush and props), and an NPC clip
  // round the playable area so units stay in it where streets run on out.
  const around = buildSurroundings({ doc, spec: s.surroundings, w: mapW, h: mapH, seed: s.seed, ground: flatHeight, roads });
  if (around.brushes.length) {
    const e = entity(doc, 'func_brush', new Vector3(mapW / 2, mapH / 2, 0), {
      targetname: 'surroundings', Solidity: '1', spawnflags: '2', rendermode: '0', disableshadows: '1', vrad_brush_cast_shadows: '1', StartDisabled: '0',
    });
    e.delete('origin');
    e.items.push(...around.brushes);
    ents.push(e);
  }
  for (const p of around.props) ents.push(entity(doc, 'prop_static', p.origin, { model: p.model, angles: `0 ${p.yaw} 0`, solid: p.solid, disableshadows: p.solid === '0' ? '1' : '0' }));
  if (apron > PLAIN_APRON) {
    const top = Math.max(0, ...s.levels) * s.levelHeight + s.floors[1] * 128 + 1024;
    for (const [x0, y0, x1, y1] of [[-16, -16, mapW + 16, 0], [-16, mapH, mapW + 16, mapH + 16], [-16, 0, 0, mapH], [mapW, 0, mapW + 16, mapH]]) {
      solids.push(solidNode(doc, boxFaces(new Vector3(x0, y0, -48), new Vector3(x1, y1, top), 'TOOLS/TOOLSNPCCLIP')));
    }
  }

  const maxLevel = Math.max(0, ...s.levels);
  // POIs cut canals and pits below the ground; their walls and floors reach 16 further down.
  let lowest = 0;
  for (let vy = 0; vy < H; vy++) for (let vx = 0; vx < W; vx++) lowest = Math.min(lowest, pois.height(vx * SAMPLE, vy * SAMPLE) - 16);
  addEnvironment(doc, solids, ents, {
    width: mapW, height: mapH, apron, maxHeight: Math.max(maxLevel * s.levelHeight + s.floors[1] * 128 + 768, around.top + 384),
    sunYaw: rng.int(20, 70), fogColor: theme.fog, cameraGround: levelBlocks(s), lowest,
  });
  doc.world.set('skyname', theme.sky);
  const out = finishDoc(doc, solids, ents, shift);
  return { doc: out, shift, heightAt: (x, y) => groundAt(x - shift.x, y - shift.y), poiLevels: pois.levels };
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
const PARKED = ['props_vehicles/car002a', 'props_vehicles/car003a', 'props_vehicles/car004a', 'props_vehicles/car005a', 'props_vehicles/car001a_hatchback'];
const BOLLARD = 'props_trainstation/trainstation_post001';

/**
 * Sofia's side streets: cars parked along both kerbs where the carriageway is wide enough for them and a lane
 * between, bollards along the pavement edges, all kept clear of the junctions at the road pieces' ends.
 */
function sofiaStreets(doc: VmfDocument, roads: RoadSpec[], top: (x: number, y: number) => { z: number } | null, rng: Rng): KVNode[] {
  const out: KVNode[] = [];
  const put = (model: string, x: number, y: number, yaw: number) => {
    const g = top(x, y);
    if (!g) return;
    const b = MODEL_BOUNDS[model];
    out.push(entity(doc, 'prop_static', new Vector3(Math.round(x), Math.round(y), Math.round(g.z - (b ? b[2] : 0))), { model: `models/${model}.mdl`, angles: `0 ${Math.round(yaw)} 0`, solid: '6' }));
  };
  for (const r of roads) {
    if (r.style !== 'asphalt' || r.points.length !== 2) continue;
    const a = r.points[0], b = r.points[r.points.length - 1];
    const dir = new Vector2(b.x - a.x, b.y - a.y);
    const len = dir.length();
    dir.normalize();
    const n = new Vector2(-dir.y, dir.x);
    const yaw = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    for (const side of [-1, 1]) {
      // The car models run along their x; two rows of them and a lane between need 288.
      if (r.width >= 288) {
        for (let t = 320; t < len - 320; t += 224) {
          if (!rng.chance(0.6)) continue;
          const off = side * (r.width / 2 - 44);
          put(rng.pick(PARKED), a.x + dir.x * t + n.x * off, a.y + dir.y * t + n.y * off, yaw + (rng.chance(0.5) ? 180 : 0) + rng.range(-3, 3));
        }
      }
      if (r.pavement >= 96) {
        for (let t = 256; t < len - 256; t += 96) {
          const off = side * (r.width / 2 + 14);
          put(BOLLARD, a.x + dir.x * t + n.x * off, a.y + dir.y * t + n.y * off, 0);
        }
      }
    }
  }
  return out;
}

/** A street grid for streetGrid, in cells. */
export interface GridOptions {
  /** Block side (each block varies by up to 2 either way). */
  block: number;
  /** Street width. */
  street: number;
  /** Boulevard width: two carriageways either side of a planted median. 0 for none. */
  boulevard: number;
  /** Every how many streets one is a boulevard. */
  every: number;
  /** Share of blocks left as small parks (0–1). */
  parks: number;
  seed: number;
}

/** Defaults after the blocks of central Sofia, at about half scale (a real block is ~25 cells). */
export const SOFIA_GRID: GridOptions = { block: 11, street: 4, boulevard: 8, every: 3, parks: 0.15, seed: 1 };

/**
 * Lays the whole sketch out as a street grid: blocks of buildings between streets (road cells), every
 * `every`-th street a boulevard with a median of grass and trees, some blocks small parks. Cells under POIs are
 * left clear (their POIs build there); heights and markers are kept.
 */
export function streetGrid(s: Sketch, o: GridOptions): void {
  const rng = new Rng(o.seed * 101 + 7);
  /** Bands along one axis: streets and blocks, starting and ending with a block. */
  const bands = (n: number): { kind: 'block' | 'street' | 'boulevard'; from: number; to: number }[] => {
    const out: { kind: 'block' | 'street' | 'boulevard'; from: number; to: number }[] = [];
    let at = 0, streets = 0;
    while (at < n) {
      const size = Math.max(4, o.block + rng.int(-2, 2));
      out.push({ kind: 'block', from: at, to: Math.min(n, at + size) });
      at += size;
      if (at >= n) break;
      streets++;
      const wide = o.boulevard > 0 && o.every > 0 && streets % o.every === 0;
      const w = wide ? o.boulevard : o.street;
      out.push({ kind: wide ? 'boulevard' : 'street', from: at, to: Math.min(n, at + w) });
      at += w;
    }
    return out;
  };
  const xs = bands(s.w), ys = bands(s.h);
  const underPoi = (x: number, y: number) => (s.pois ?? []).some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
  const city = s.theme === 'city' ? Surface.Paved : Surface.Grass;
  const parks = new Set<string>();
  for (const bx of xs) for (const by of ys) if (bx.kind === 'block' && by.kind === 'block' && rng.chance(o.parks)) parks.add(`${bx.from},${by.from}`);
  for (const bx of xs) for (const by of ys) {
    for (let y = by.from; y < by.to; y++) for (let x = bx.from; x < bx.to; x++) {
      const i = y * s.w + x;
      s.features[i] = Feature.None;
      s.surface[i] = city;
      if (underPoi(x, y)) continue;
      if (bx.kind === 'block' && by.kind === 'block') {
        if (parks.has(`${bx.from},${by.from}`)) {
          s.surface[i] = Surface.Grass;
          if ((x - bx.from) % 3 === 1 && (y - by.from) % 3 === 1) s.features[i] = Feature.Trees;
        } else s.features[i] = Feature.Building;
        continue;
      }
      // A boulevard's median: the middle cell (or two) of the band it runs along, grass with a row of trees.
      const median = (b: typeof bx, v: number) => b.kind === 'boulevard' && Math.abs(v - (b.from + b.to - 1) / 2) < 1;
      const onMedian = (bx.kind === 'boulevard' && by.kind === 'block' && median(bx, x)) || (by.kind === 'boulevard' && bx.kind === 'block' && median(by, y));
      if (onMedian) {
        s.surface[i] = Surface.Grass;
        if ((bx.kind === 'boulevard' ? y : x) % 3 === 1) s.features[i] = Feature.Trees;
      } else s.surface[i] = Surface.Road;
    }
  }
}

export function symmetricCells(s: Sketch, x: number, y: number, mode: 'none' | 'mirror' | 'rotate'): [number, number][] {
  const out: [number, number][] = [[x, y]];
  if (mode === 'mirror') out.push([s.w - 1 - x, y]);
  if (mode === 'rotate') out.push([s.w - 1 - x, s.h - 1 - y]);
  return out;
}
