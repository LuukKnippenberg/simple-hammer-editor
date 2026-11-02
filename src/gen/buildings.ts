import { Box2, Box3, Vector2, Vector3 } from 'three';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import { MapSolid, type VmfDocument } from '../vmf/map.ts';
import { solidBounds, solidNode } from '../edit/brushes.ts';
import { Rng } from './rng.ts';
import { FLOOR, bayCount, ccw, cleanPolygon, convexHull, facadePrism, isConvexCcw, offsetPolygon, type FacadeTile } from './facade.ts';
import { planBlock, type BlockPlan, type BuildingPlan, type CornerOption, type Part, type PlanOptions, type WallPlan } from './buildingPlan.ts';
import { chooseRoof, inradius, roofSolids, type RoofKind, type RoofOption } from './roofs.ts';
import { chooseCap, towerSides, towerSolids } from './towers.ts';
import { entranceSteps, streetFacade, wallOf, type FeatureEntity, type Wall } from './facadeFeatures.ts';
import { ARCHITECTURES, FACADE_STYLES, type ArchitectureName, type FacadeStyle, type Style } from './styles.ts';
import { wallClutter, type Anchor, type BlockDressing } from './streets.ts';
import { interiorHouse } from './interiorHouse.ts';
import { greenYard, type YardStyle } from './yards.ts';
import { outlineOf } from './interiorPlan.ts';
import type { InteriorStyleName } from './styles.ts';
import { boxesOverlap, convexOverlap, cutBack, decodeCuts } from './sketchShapes.ts';
import { resolveExtras, type ExtraCategory, type Extras, type ExtrasOptions } from './extras.ts';
import { WALL_MOUNT } from './powerlines.ts';
import { hideCoveredFaces } from '../geom/hidden.ts';

export { ARCHITECTURES, FACADE_STYLES, type ArchitectureName, type FacadeStyle };

const t = (name: string, bays: number, widthPx?: number): FacadeTile => ({ material: `BUILDING_TEMPLATE/${name.toUpperCase()}`, bays, widthPx });
/** Weathering on street walls: water stains and dirt, with their size on the wall (texture × $decalscale). */
export const STAINS = [
  { texture: 'decals/decalstain001a', w: 128, h: 128 }, { texture: 'decals/decalstain002a', w: 128, h: 128 },
  { texture: 'decals/decalstain005a', w: 64, h: 64 }, { texture: 'decals/decalstain008a', w: 32, h: 32 },
  { texture: 'decals/decalstain010a', w: 64, h: 64 }, { texture: 'decals/decalstain012a', w: 128, h: 128 },
  { texture: 'decals/wallstain01a', w: 64, h: 128 },
];

const ROOF = 'CONCRETE/CONCRETEFLOOR028C';
const NODRAW = 'TOOLS/TOOLSNODRAW';
const ROOF_PROPS = [
  'models/props_rooftop/roof_vent003.mdl', 'models/props_rooftop/roof_vent004.mdl', 'models/props_rooftop/chimneypipe01a.mdl',
  'models/props_rooftop/antenna01a.mdl', 'models/props_rooftop/roof_dish001.mdl', 'models/props_rooftop/rooftopcluser01a.mdl',
];

/** A block's options; what it adds beyond the buildings (trees, lamps, cables, clutter) is in `ExtrasOptions`. */
export interface BuildingOptions extends ExtrasOptions {
  seed: number;
  minFloors: number;
  maxFloors: number;
  /** Leave alleys between buildings and link some of them with sky bridges. */
  alleys: boolean;
  /** Restrict to one facade style; the architecture's mix when omitted. */
  style?: FacadeStyle;
  /** Kind of buildings: facades, roofs, corners, towers and street features (default mixed). */
  architecture?: ArchitectureName;
  /** Water stains and dirt on street walls, 0 to 1 (default 0.5). */
  weathering?: number;
  roofProps: boolean;
  /** Corners of buildings on the block's corners: square, cut, rounded, or a mix (default). */
  corners?: CornerOption;
  /** Build large blocks as a ring of buildings around a courtyard (default on). */
  courtyards?: boolean;
  /** Low sheds in yards and courtyards (default on; green yards have none). */
  annexes?: boolean;
  /** What fills the courtyards and back yards: sheds (default), or green yards with lawns, trees, playgrounds and parking. */
  yards?: YardStyle;
  /** Share of a ring block's side lots left open, so its courtyard opens onto the street (0–1, default 0). */
  openYards?: number;
  /**
   * Convex polygons (world units, `encodeCuts`) the buildings keep off: diagonal or curved streets and round squares
   * drawn over the block. Lots are cut along them, and walls along a cut face the street.
   */
  cut?: string;
  /** Facade decoration (default 2: base course, ledges, columns, stepped cornice). */
  detail?: DetailLevel;
  /**
   * How much this block builds (default high): full detail near the action, less on filler blocks further
   * away. It caps the decoration and turns off interiors, towers and street features (see QUALITY).
   */
  quality?: BuildingQuality;
  /** Roof shape: one kind for every building, or the architecture's mix (default). */
  roofs?: RoofOption;
  /** Towers with domes, bells, onions or spires on some street corners (default on). */
  towers?: boolean;
  /**
   * Enterable open-top houses on small free-standing lots and sheds of 1–2 floors: none, some or all of them
   * (default from the architecture: none for the city architectures).
   */
  interiors?: 'none' | 'some' | 'all';
  /** Interior style for those houses; the architecture's mix when omitted. */
  interiorStyle?: InteriorStyleName;
  /** Wall height of interior houses (default 112). */
  cutHeight?: number;
  furnish?: 'none' | 'sparse' | 'full';
  interiorLights?: boolean;
  /** Brightness of the interior lights, as a factor of a believable bulb (default 1). */
  interiorLightLevel?: number;
  /** 128-wide doorways so the antlion guard fits through. */
  wideDoors?: boolean;
  /**
   * What the lot becomes: a city block (default), one building on the whole lot, or one enterable house
   * (1–2 floors, its yard round it).
   */
  layout?: BuildingLayout;
}

export type BuildingLayout = 'block' | 'single' | 'house';

export interface GeneratedBuildings {
  /** World brushes: the building shells. */
  solids: KVNode[];
  /** Decoration brushes, to be wrapped in a func_detail (see `detailEntityNode`). */
  detail: KVNode[];
  /** Point entities (rooftop props). */
  entities: { classname: string; origin: Vector3; keys: Record<string, string> }[];
  buildings: number;
  /** How many of them are enterable interior houses. */
  interiorHouses: number;
  /** Laid out as a ring of buildings round a courtyard. */
  ring?: boolean;
  /** For the street pass across blocks (`streetDressing`): outline, cable anchors, yards. */
  dressing: BlockDressing;
}

const inside = (poly: Vector2[], p: Vector2) => poly.every((a, i) => {
  const b = poly[(i + 1) % poly.length];
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
});

/** How much facade decoration to build: 0 a plain cornice, 1 + base course, 2 + ledges and columns, 3 + brackets. */
export type DetailLevel = 0 | 1 | 2 | 3;

export type BuildingQuality = 'high' | 'medium' | 'filler';

/**
 * What each quality builds. Decoration is what a generated city spends vbsp's t-junction buffer on (65536
 * indices): on sp_tutorial_combine, buildings at detail 2 use 98.8% of it, at detail 1 53%, at detail 0 18%
 * (scripts/tjunc-budget.mjs). Interiors, towers and street features cost far less but add up on many blocks.
 */
export const QUALITY: Record<BuildingQuality, { label: string; hint: string; maxDetail: DetailLevel; interiors: boolean; towers: boolean; streetFeatures: boolean }> = {
  high: { label: 'High', hint: 'Everything the settings ask for', maxDetail: 3, interiors: true, towers: true, streetFeatures: true },
  medium: { label: 'Medium', hint: 'Base course and cornice only, no enterable houses', maxDetail: 1, interiors: false, towers: true, streetFeatures: true },
  filler: { label: 'Filler', hint: 'Plain walls with their windows and a cornice; no towers, oriels or balconies', maxDetail: 0, interiors: false, towers: false, streetFeatures: false },
};

const BASE = t('building_template003a', 0);

/**
 * Another wing or wall of the block. Where one stands against a wall (a party wall), the decoration of
 * that wall stops at the corner instead of running on into the neighbour's facade.
 */
export interface Neighbour {
  poly: Vector2[];
  /** Height up to which it hides the wall it stands against (its parapet or roof included). */
  cover: number;
  /** How far its own bands, cornice and eaves stand out of its walls between two heights (only its eaves or parapet with `roof`). */
  reach: (zMin: number, zMax: number, roof?: boolean) => number;
}

/** A stretch of a wall (distances from its start) hidden by neighbours, with their reach at either end. */
interface PartySpan { from: number; to: number; reachFrom: number; reachTo: number }

/** Where neighbours standing higher than `zMin` hide the wall, sorted and merged. */
function partySpans(w: Wall, neighbours: Neighbour[], zMin: number, zMax: number): PartySpan[] {
  const spans: PartySpan[] = [];
  for (const nb of neighbours) {
    if (nb.cover <= zMin) continue;
    nb.poly.forEach((c, i) => {
      const d = nb.poly[(i + 1) % nb.poly.length];
      // A shared wall runs the other way round the neighbour, on the same line.
      if (new Vector2().subVectors(d, c).normalize().dot(w.dir) > -0.999) return;
      if (Math.abs(new Vector2().subVectors(c, w.a).dot(w.out)) > 0.5) return;
      const from = Math.max(0, new Vector2().subVectors(d, w.a).dot(w.dir)), to = Math.min(w.len, new Vector2().subVectors(c, w.a).dot(w.dir));
      const reach = nb.reach(zMin, zMax);
      if (to - from > 0.5) spans.push({ from, to, reachFrom: reach, reachTo: reach });
    });
  }
  spans.sort((a, b) => a.from - b.from);
  const out: PartySpan[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (!last || s.from > last.to + 0.5) out.push({ ...s });
    else if (s.to > last.to + 0.5) { last.to = s.to; last.reachTo = s.reachTo; }
    else if (s.to > last.to - 0.5) last.reachTo = Math.max(last.reachTo, s.reachTo);
  }
  return out;
}

/**
 * Inside corners between buildings that touch only at a corner: how far a neighbour reaches over the wall
 * from its start and from its end, where the neighbour's wall runs outwards from that corner. Of two
 * bands meeting there the one on the wall that ends at the corner gives way; a neighbour's eaves or
 * parapet can't, so a band gives way to those at either end.
 */
function cornerReach(w: Wall, neighbours: Neighbour[], zMin: number, zMax: number): { start: number; end: number } {
  const reach = { start: 0, end: 0 };
  for (const nb of neighbours) {
    if (nb.cover <= zMin) continue;
    nb.poly.forEach((c, i) => {
      const d = nb.poly[(i + 1) % nb.poly.length];
      if (c.distanceTo(w.b) < 0.5 && new Vector2().subVectors(d, c).dot(w.out) > 0.5) reach.end = Math.max(reach.end, nb.reach(zMin, zMax));
      if (d.distanceTo(w.a) < 0.5 && new Vector2().subVectors(c, d).dot(w.out) > 0.5) reach.start = Math.max(reach.start, nb.reach(zMin, zMax, true));
    });
  }
  return reach;
}

/** Where two lines (a point and a direction each) cross. */
function meet(p: Vector2, u: Vector2, q: Vector2, v: Vector2): Vector2 {
  const cross = u.x * v.y - u.y * v.x;
  if (Math.abs(cross) < 1e-9) return q.clone();
  const w = new Vector2().subVectors(q, p);
  return p.clone().addScaledVector(u, (w.x * v.y - w.y * v.x) / cross);
}

/**
 * A band around the footprint, `out` units proud of the wall, that stops at party walls: one slab over
 * the free walls (ending flush with the party walls) and strips along walls that neighbours hide only in
 * part. Where a strip meets a neighbour's wall at an inside corner it stops short by the neighbour's own
 * reach, so the two bands butt instead of overlapping.
 */
export function band(doc: VmfDocument, poly: Vector2[], out: number, zMin: number, zMax: number, tile: FacadeTile, neighbours: Neighbour[] = []): KVNode[] {
  const solid = (p: Vector2[]) => {
    const q = cleanPolygon(p);
    return isConvexCcw(q) ? [solidNode(doc, facadePrism(q, zMin, zMax, tile, tile.material, zMin, tile.material))] : [];
  };
  const n = poly.length;
  const walls = poly.map((a, i) => wallOf(a, poly[(i + 1) % n]));
  const party = walls.map((w) => partySpans(w, neighbours, zMin, zMax));
  const cut = walls.map((w) => cornerReach(w, neighbours, zMin, zMax));
  const strip = party.map((s, i) => s.length > 0 || cut[i].start > 0 || cut[i].end > 0);
  const solids = solid(offsetPolygon(poly, strip.map((s) => (s ? 0 : out))));
  const openStart = (k: number) => !party[k].some((s) => s.from < 0.5);
  const openEnd = (k: number) => !party[k].some((s) => s.to > walls[k].len - 0.5) && !cut[k].end;
  const at = (w: Wall, t: number, d: number) => w.a.clone().addScaledVector(w.dir, t).addScaledVector(w.out, d);
  walls.forEach((w, i) => {
    if (!strip[i]) return;
    const p = (i + n - 1) % n, q = (i + 1) % n;
    // The corner before a strip belongs to the strip; the one after it to the next wall when that is a
    // strip too, or to this one when the next wall is part of the slab.
    const dPrev = openEnd(p) ? out : 0;
    const dNext = openStart(q) && !strip[q] ? out : 0;
    const corner = (other: Wall, d: number) => [0, out].map((o) => meet(at(w, 0, o), w.dir, at(other, 0, d), other.dir));
    let from = 0, reachFrom: number | null = cut[i].start || null;
    for (const s of [...party[i], null]) {
      const reachTo = s ? s.reachFrom : cut[i].end || null;
      const t0 = from + (reachFrom ?? 0), t1 = (s ? s.from : w.len) - (reachTo ?? 0);
      if (t1 - t0 >= 8) {
        const [a0, a1] = reachFrom === null ? corner(walls[p], dPrev) : [at(w, t0, 0), at(w, t0, out)];
        const [b0, b1] = reachTo === null ? corner(walls[q], dNext) : [at(w, t1, 0), at(w, t1, out)];
        solids.push(...solid(ccw([a0, b0, b1, a1])));
      }
      if (s) { from = s.to; reachFrom = s.reachTo; }
    }
  });
  return solids;
}

/** Brackets under the cornice stand between these heights below the wall top. */
const BRACKETS_FROM = 36, BRACKETS_TO = 24;
/** Height of a flat roof's parapet. */
const PARAPET = 32;
/** How far the cornice's top band stands out of the wall (and a parapet or the eaves above it). */
const corniceOverhang = (main: boolean, level: DetailLevel) => (main && level >= 1 ? 14 : 8);

interface BandSpec { zMin: number; zMax: number; out: number; base?: boolean }

/** The bands of a wing: base course, ledges (a heavy one over the ground floor, thin ones on every `every` floor line), cornice. */
function partBands(part: Part, z0: number, level: DetailLevel, every = 1): BandSpec[] {
  const main = part.kind === 'main', top = z0 + part.floors * FLOOR;
  const bands: BandSpec[] = [];
  if (level >= 1) bands.push({ zMin: z0 - 32, zMax: z0 + 20, out: 4, base: true });
  if (level >= 2 && main && part.floors > 1) {
    bands.push({ zMin: z0 + FLOOR - 6, zMax: z0 + FLOOR + 6, out: 6 });
    for (let k = 2; k < part.floors; k++) if ((k - 1) % every === 0) bands.push({ zMin: z0 + k * FLOOR - 4, zMax: z0 + k * FLOOR + 4, out: 4 });
  }
  // Stepped cornice: a fascia, then the overhanging top band.
  if (main && level >= 1) bands.push({ zMin: top - 24, zMax: top - 16, out: 6 });
  bands.push({ zMin: top - 16, zMax: top, out: corniceOverhang(main, level) });
  return bands;
}

/** A wing as the other wings see it: hidden up to its parapet or roof, reaching out by its bands and eaves. */
function partNeighbour(part: Part, z0: number, level: DetailLevel, roof: RoofKind): Neighbour {
  const top = z0 + part.floors * FLOOR, main = part.kind === 'main';
  const overhang = corniceOverhang(main, level);
  // Pitched roofs: at least as high as the steepest roof over this footprint.
  const cover = roof !== 'flat' ? top + 1.2 * inradius(part.poly) + 32 : main ? top + PARAPET : top;
  const zones = partBands(part, z0, level);
  if (level >= 3 && main && part.floors > 1) zones.push({ zMin: top - BRACKETS_FROM, zMax: top - BRACKETS_TO, out: 12 });
  const eaves = { zMin: top, zMax: cover, out: roof !== 'flat' ? overhang + 2 : main ? overhang : 0 };
  zones.push(eaves);
  return { poly: part.poly, cover, reach: (zMin, zMax, r) => Math.max(0, ...(r ? [eaves] : zones).filter((b) => b.zMin < zMax && zMin < b.zMax).map((b) => b.out)) };
}

/** A small block standing on the wall at `at`, `width` along the wall and `depth` proud of it. */
function wallBlock(doc: VmfDocument, at: Vector2, dir: Vector2, width: number, depth: number, zMin: number, zMax: number, tile: FacadeTile): KVNode | null {
  const n = new Vector2(dir.y, -dir.x);
  const pts = [-1, 1].flatMap((sgn) => [-2, depth].map((d) => at.clone().addScaledVector(dir, (sgn * width) / 2).addScaledVector(n, d)));
  const p = cleanPolygon(convexHull(pts));
  return isConvexCcw(p) ? solidNode(doc, facadePrism(p, zMin, zMax, tile, tile.material, zMin, tile.material)) : null;
}

/** A quoin column wrapping the corner at poly[i]: `width` along both walls, `depth` proud. */
function cornerBlock(doc: VmfDocument, poly: Vector2[], i: number, width: number, depth: number, zMin: number, zMax: number, tile: FacadeTile): KVNode | null {
  const n = poly.length;
  const v = poly[i], prev = poly[(i + n - 1) % n], next = poly[(i + 1) % n];
  const dIn = new Vector2().subVectors(v, prev).normalize(), dOut = new Vector2().subVectors(next, v).normalize();
  const nIn = new Vector2(dIn.y, -dIn.x), nOut = new Vector2(dOut.y, -dOut.x);
  const a = v.clone().addScaledVector(dIn, -width), e = v.clone().addScaledVector(dOut, width);
  const corner = offsetPolygon([a, v, e], depth)[1];
  const inner = v.clone().addScaledVector(nIn.clone().add(nOut).normalize(), -width);
  const p = cleanPolygon(convexHull([a, a.clone().addScaledVector(nIn, depth), corner, e.clone().addScaledVector(nOut, depth), e, inner]));
  return isConvexCcw(p) ? solidNode(doc, facadePrism(p, zMin, zMax, tile, tile.material, zMin, tile.material)) : null;
}

/** The street a wing's walls may face, and what its street fronts add to the block. */
interface Street {
  isStreet?: (a: Vector2, b: Vector2) => boolean; rng: Rng; entities: FeatureEntity[]; keep: (c: ExtraCategory) => boolean;
  oriels: boolean; balconies: boolean; roofHuts: boolean; weathering: number; anchors: Anchor[];
}

/** What the steps of `partSolids` share about one wing. */
interface Wing {
  doc: VmfDocument; part: Part; s: Style; z0: number; level: DetailLevel;
  /** Height of its walls' tops. */
  top: number;
  main: boolean;
  windows: FacadeTile;
  walls: Wall[];
  neighbours: Neighbour[];
}

/** A column between window bays, `at` along wall `wall`. */
interface Column { wall: number; at: number }

/** Columns and quoins: 16 wide, standing 6 out, clear of the thin ledges' faces (4 out) they cross. */
const COLUMN_WIDTH = 16, COLUMN_OUT = 6;
/** Quoins go on corners that turn by more than 40° (not between the segments of a rounded corner). */
const QUOIN_MIN_TURN = Math.cos((40 * Math.PI) / 180);
/** Stretches of wall i that neighbours hide between two heights. */
const party = (w: Wing, i: number, zMin: number, zMax: number) => partySpans(w.walls[i], w.neighbours, zMin, zMax);
/** Whether neighbours hide any of wall i from `from` to `to` along it, between two heights. */
const hidden = (w: Wing, i: number, from: number, to: number, zMin: number, zMax: number) => party(w, i, zMin, zMax).some((p) => p.from < to && p.to > from);
/** Heights the columns and quoins span: from the ground-floor ledge to the cornice (or the brackets under it). */
const columnSpan = (w: Wing): [number, number] => [w.z0 + FLOOR + 6, w.level >= 3 ? w.top - BRACKETS_FROM : w.top - BRACKETS_TO];

/** The shell, as world brushes: the ground floor (sunk a little so the building sits on uneven ground) and the floors above. */
function shellSolids(w: Wing, groundTiles: FacadeTile[], pitched: boolean): KVNode[] {
  const { doc, part, z0, top } = w;
  const roofTop = pitched ? NODRAW : ROOF;
  const world = [solidNode(doc, facadePrism(part.poly, z0 - 32, Math.min(top, z0 + FLOOR), groundTiles, part.floors > 1 ? NODRAW : roofTop, z0))];
  if (part.floors > 1) world.push(solidNode(doc, facadePrism(part.poly, z0 + FLOOR, top, w.windows, roofTop, z0)));
  return world;
}

/** Quoins on the outer corners and columns between window bays on long walls (every second or third bay). */
function quoinsAndColumns(w: Wing, deco: Rng): { solids: KVNode[]; columns: Column[] } {
  const { doc, s } = w, poly = w.part.poly, n = poly.length;
  const [colMin, colTop] = columnSpan(w);
  const solids: KVNode[] = [];
  const add = (node: KVNode | null) => { if (node) solids.push(node); };
  // Not at party walls.
  poly.forEach((v, i) => {
    const prev = (i + n - 1) % n;
    const dIn = new Vector2().subVectors(v, poly[prev]).normalize(), dOut = new Vector2().subVectors(poly[(i + 1) % n], v).normalize();
    const free = !hidden(w, prev, w.walls[prev].len - 24, w.walls[prev].len, colMin, colTop) && !hidden(w, i, 0, 24, colMin, colTop);
    if (dIn.dot(dOut) < QUOIN_MIN_TURN && free) add(cornerBlock(doc, poly, i, COLUMN_WIDTH, COLUMN_OUT, colMin, colTop, s.plain));
  });
  const columns: Column[] = [];
  const step = deco.pick([2, 3]);
  poly.forEach((a, i) => {
    const { len, dir } = w.walls[i];
    const bays = bayCount(len, w.windows);
    if (len < 256 || bays < 4) return;
    for (let k = step; k <= bays - step; k += step) {
      const along = (k * len) / bays;
      if (hidden(w, i, along - 10, along + 10, colMin, colTop)) continue;
      add(wallBlock(doc, a.clone().addScaledVector(dir, along), dir, COLUMN_WIDTH, COLUMN_OUT, colMin, colTop, s.plain));
      columns.push({ wall: i, at: along });
    }
  });
  return { solids, columns };
}

/** Brackets under the cornice at every bay. */
function corniceBrackets(w: Wing): KVNode[] {
  const poly = w.part.poly, zMin = w.top - BRACKETS_FROM, zMax = w.top - BRACKETS_TO;
  const solids: KVNode[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const len = a.distanceTo(b);
    const bays = Math.max(1, bayCount(len, w.windows) || Math.round(len / 64));
    const dir = new Vector2().subVectors(b, a).normalize();
    for (let k = 0; k <= bays; k++) {
      if ((k === 0 || k === bays) && len < 96) continue;
      const along = Math.min(len - 6, Math.max(6, (k * len) / bays));
      if (hidden(w, i, along - 6, along + 6, zMin, zMax)) continue;
      const node = wallBlock(w.doc, a.clone().addScaledVector(dir, along), dir, 8, 12, zMin, zMax, w.s.trim);
      if (node) solids.push(node);
    }
  });
  return solids;
}

/** A pitched roof, and a TV antenna on some ridges. */
function pitchedRoof(w: Wing, roof: { kind: RoofKind; material: string }, deco: Rng, street: Street): { solids: KVNode[]; heightAt: (p: Vector2) => number } {
  const { doc, s, top, main, level } = w, poly = w.part.poly;
  // No eaves over party walls, nor on walls that meet a neighbour at an inside corner (the two roofs'
  // eaves would cross there).
  const eavesStop = w.walls.map((wall, i) => {
    const corner = cornerReach(wall, w.neighbours, top, top + 1);
    return party(w, i, top, top + 1).length > 0 || corner.start > 0 || corner.end > 0;
  });
  const r = roofSolids(doc, poly, top, {
    kind: roof.kind, material: roof.material, wall: s.plain, window: w.windows, overhang: corniceOverhang(main, level),
    dormers: main && level >= 1, chimneys: main && level >= 1, party: eavesStop,
  }, deco);
  if (main && level >= 1 && deco.chance(0.35)) {
    const c = new Box2().setFromPoints(poly).getCenter(new Vector2());
    if (inside(poly, c)) {
      const antenna = { classname: 'prop_static', origin: new Vector3(Math.round(c.x), Math.round(c.y), Math.round(r.heightAt(c) + 100)), keys: { model: 'models/props_rooftop/antenna04a.mdl', angles: `0 ${deco.int(0, 359)} 0`, solid: '0' } };
      if (street.keep('clutter')) street.entities.push(antenna);
    }
  }
  return { solids: r.solids, heightAt: r.heightAt };
}

/**
 * Parapet: one brush per edge between the cornice line and 4 units inside the wall; none on walls a
 * neighbour hides, and flush with the wall where one hides it in part.
 */
function parapet(w: Wing): KVNode[] {
  const { doc, s, top } = w, poly = w.part.poly;
  const shared = w.walls.map((_, i) => party(w, i, top, top + PARAPET));
  const outer = cleanPolygon(offsetPolygon(poly, shared.map((p) => (p.length ? 0 : corniceOverhang(w.main, w.level)))));
  const inner = cleanPolygon(offsetPolygon(poly, -4));
  if (inner.length !== outer.length || !isConvexCcw(inner)) return [];
  const solids: KVNode[] = [];
  outer.forEach((a, i) => {
    if (shared[i].some((p) => p.from < 0.5 && p.to > w.walls[i].len - 0.5)) return;
    const b = outer[(i + 1) % outer.length];
    const quad = [a, b, inner[(i + 1) % inner.length], inner[i]];
    if (isConvexCcw(quad)) solids.push(solidNode(doc, facadePrism(quad, top, top + PARAPET, s.plain, s.plain.material, top, NODRAW)));
  });
  return solids;
}

/** A stair house on the roof (lift machinery of the blocks), away from the edges. */
function roofHut(w: Wing, deco: Rng): KVNode[] {
  const { doc, s, top } = w, poly = w.part.poly;
  const box = new Box2().setFromPoints(poly);
  const size = box.getSize(new Vector2());
  if (size.x < 256 || size.y < 256) return [];
  const wide = deco.pick([96, 128]), deep = deco.pick([96, 128]);
  const cx = Math.round(deco.range(box.min.x + 64 + wide / 2, box.max.x - 64 - wide / 2)), cy = Math.round(deco.range(box.min.y + 64 + deep / 2, box.max.y - 64 - deep / 2));
  const hut = [new Vector2(cx - wide / 2, cy - deep / 2), new Vector2(cx + wide / 2, cy - deep / 2), new Vector2(cx + wide / 2, cy + deep / 2), new Vector2(cx - wide / 2, cy + deep / 2)];
  if (!hut.every((p) => inside(poly, p))) return [];
  return [
    solidNode(doc, facadePrism(hut, top, top + 96, s.plain, ROOF, top)),
    solidNode(doc, facadePrism(offsetPolygon(hut, 6), top + 96, top + 104, s.trim, s.trim.material, top + 96, s.trim.material)),
  ];
}

/**
 * Weathering on a street wall: stains running down from under the cornice and the ledges. An infodecal lands
 * on every brush face it covers, so each stays clear of the bands, the brackets and what stands on the wall
 * (oriels, balconies, columns, quoins).
 */
function wallStains(w: Wing, wall: Wall, i: number, facade: KVNode[], bands: BandSpec[], columns: Column[], street: Street): void {
  const { z0, top } = w;
  const [colMin, colTop] = columnSpan(w);
  const zones = bands.map((b) => [b.zMin, b.zMax]);
  if (w.level >= 3 && w.part.floors > 1) zones.push([top - BRACKETS_FROM, top - BRACKETS_TO]);
  const busy = facade.map((n) => {
    const box = solidBounds(new MapSolid(n, null));
    const along = [box.min, box.max].flatMap((p) => [box.min, box.max].map((q) => new Vector2(p.x, q.y).sub(wall.a).dot(wall.dir)));
    return { from: Math.min(...along), to: Math.max(...along), zMin: box.min.z, zMax: box.max.z };
  });
  busy.push(...columns.filter((c) => c.wall === i).map((c) => ({ from: c.at - COLUMN_WIDTH / 2, to: c.at + COLUMN_WIDTH / 2, zMin: colMin, zMax: colTop })));
  const drips = zones.map(([zMin]) => zMin).filter((z) => z > z0 + 20);
  const stains = Math.round((wall.len / 256) * street.weathering * 2 * street.rng.next());
  // A few tries per stain to find a free spot.
  for (let k = 0, tries = 0; k < stains && drips.length && tries < stains * 6; tries++) {
    const stain = street.rng.pick(STAINS);
    const along = street.rng.range(16 + stain.w / 2, wall.len - 16 - stain.w / 2);
    const z = street.rng.pick(drips) - 2 - stain.h / 2;
    const z1 = z - stain.h / 2, z2 = z + stain.h / 2, u1 = along - stain.w / 2, u2 = along + stain.w / 2;
    if (wall.len < 32 + stain.w || z1 < z0 + 22 || zones.some(([zMin, zMax]) => zMin < z2 + 2 && zMax > z1 - 2)) continue;
    if (busy.some((b) => b.from < u2 + 2 && b.to > u1 - 2 && b.zMin < z2 + 2 && b.zMax > z1 - 2)) continue;
    const p = wall.a.clone().addScaledVector(wall.dir, along).addScaledVector(wall.out, 2);
    street.entities.push({ classname: 'infodecal', origin: new Vector3(Math.round(p.x), Math.round(p.y), Math.round(z)), keys: { texture: stain.texture } });
    k++;
  }
}

/** Street fronts: oriels, balconies and awnings on walls that face the street, their clutter and stains; steps at a cut-corner entrance. */
function streetFronts(w: Wing, groundTiles: FacadeTile[], bands: BandSpec[], columns: Column[], street: Street): KVNode[] {
  const isStreet = street.isStreet;
  if (!isStreet) return [];
  const { doc, part, s, z0, level, windows } = w, poly = part.poly;
  const [colMin, colTop] = columnSpan(w);
  const solids: KVNode[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    if (part.cornerEdges.includes(i) || !isStreet(a, b)) return;
    const wall = wallOf(a, b);
    const f = streetFacade(doc, wall, {
      z0, floors: part.floors, windows, trim: s.trim, plain: s.plain, level, oriels: street.oriels, balconies: street.balconies,
    }, street.rng);
    solids.push(...f.solids);
    if (street.keep('awnings')) street.entities.push(...f.entities);
    // Pilasters, in the wall's plane (x along it, y height), for the street clutter to keep clear of.
    const pilasters = columns.filter((c) => c.wall === i).map((c) => new Box2(new Vector2(c.at - COLUMN_WIDTH / 2, colMin), new Vector2(c.at + COLUMN_WIDTH / 2, colTop)));
    // Cable brackets go with the cables; their anchors stay, so the street pass deals its cables as always.
    if (level >= 1) street.entities.push(...wallClutter(wall, z0, part.floors, street.rng, street.anchors, { windows, ground: groundTiles[i], taken: [...f.taken, ...pilasters] })
      .filter((e) => street.keep(e.keys.model === WALL_MOUNT.model ? 'cables' : 'clutter')));
    wallStains(w, wall, i, f.solids, bands, columns, street);
  });
  if (level >= 1 && part.cornerEdges.length === 1) {
    const i = part.cornerEdges[0];
    solids.push(...entranceSteps(doc, wallOf(poly[i], poly[(i + 1) % poly.length]), z0));
  }
  return solids;
}

/**
 * Brushes of one wing. The shell (ground floor, upper floors) is world geometry for visibility; the
 * decoration (base course, ledges, columns, cornice, brackets, parapet) goes to `detail` for func_detail.
 */
function partSolids(
  doc: VmfDocument, part: Part, s: Style, z0: number, rng: Rng, deco: Rng, level: DetailLevel, roof: { kind: RoofKind; material: string },
  street: Street, neighbours: Neighbour[] = [],
): { world: KVNode[]; detail: KVNode[]; roofHeight: (p: Vector2) => number; windows: FacadeTile } {
  const poly = part.poly, top = z0 + part.floors * FLOOR, main = part.kind === 'main';
  const ground = rng.pick(s.ground);
  const windows = rng.pick(s.windows);
  const groundTiles = poly.map((_, i) => (part.cornerEdges.includes(i) ? s.door : ground));
  const w: Wing = { doc, part, s, z0, level, top, main, windows, neighbours, walls: poly.map((a, i) => wallOf(a, poly[(i + 1) % poly.length])) };
  const world = shellSolids(w, groundTiles, roof.kind !== 'flat');
  // Base course of stone along the street; ledges, a heavier one over the ground floor and thin ones
  // between upper floors (all, or every other); the stepped cornice. All stop at party walls.
  const tall = main && part.floors > 1;
  const bands = partBands(part, z0, level, level >= 2 && tall ? deco.pick([1, 2]) : 1);
  const detail = bands.flatMap((b) => band(doc, poly, b.out, b.zMin, b.zMax, b.base ? BASE : s.trim, neighbours));
  const { solids: columnSolids, columns } = level >= 2 && tall ? quoinsAndColumns(w, deco) : { solids: [], columns: [] };
  detail.push(...columnSolids);
  if (level >= 3 && tall) detail.push(...corniceBrackets(w));
  let roofHeight = (_p: Vector2) => top + PARAPET;
  if (roof.kind !== 'flat') {
    const r = pitchedRoof(w, roof, deco, street);
    detail.push(...r.solids);
    roofHeight = r.heightAt;
  } else if (main) {
    detail.push(...parapet(w));
    if (street.roofHuts && level >= 1 && deco.chance(0.7)) detail.push(...roofHut(w, deco));
  }
  if (main) detail.push(...streetFronts(w, groundTiles, bands, columns, street));
  return { world, detail, roofHeight, windows };
}

/**
 * A tower on the building's street corner: on a rounded corner it continues the curved facade (up to a
 * radius of 160, touching the curve at its apex); on cut and square corners it stands tangent to both walls.
 */
function cornerTower(doc: VmfDocument, part: Part, s: Style, windows: FacadeTile, z0: number, roofHeight: (p: Vector2) => number, rng: Rng): KVNode[] {
  const c = part.corner!;
  const diag = c.inward.clone().normalize();
  let radius: number, centre: Vector2;
  if (c.shape === 'round') {
    radius = Math.min(c.size, 160);
    const arcCentre = c.at.clone().addScaledVector(c.inward, c.size);
    centre = arcCentre.addScaledVector(diag, -(c.size - radius));
  } else {
    radius = rng.pick([96, 112, 128]);
    centre = c.at.clone().addScaledVector(c.inward, radius);
  }
  const top = z0 + part.floors * FLOOR;
  let z1 = top + rng.int(1, 2) * FLOOR;
  while (z1 < roofHeight(centre) + 64) z1 += FLOOR;
  const { cap, material } = chooseCap(rng);
  return towerSolids(doc, {
    centre: new Vector2(Math.round(centre.x), Math.round(centre.y)), radius, sides: towerSides(radius),
    z0: top - 16, z1, windows, trim: s.trim, plain: s.plain, cap, capMaterial: material,
  }).solids;
}

/** A func_detail entity holding `solids` (decoration that should not cut visibility), or null when empty. */
export function detailEntityNode(doc: VmfDocument, solids: KVNode[]): KVNode | null {
  if (!solids.length) return null;
  const e = new KVNode('entity');
  e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', 'func_detail'), ...solids);
  const ed = new KVNode('editor');
  ed.items.push(new KVPair('color', '0 180 0'), new KVPair('visgroupshown', '1'), new KVPair('visgroupautoshown', '1'), new KVPair('logicalpos', '[0 0]'));
  e.items.push(ed);
  return e;
}

/** A 16-unit wall along a→b; a gateway leaves a 128-unit opening under a lintel. */
function wallSolids(doc: VmfDocument, w: WallPlan, s: Style, z0: number): KVNode[] {
  const dir = new Vector2().subVectors(w.b, w.a);
  const len = dir.length();
  dir.normalize();
  const side = new Vector2(dir.y, -dir.x).multiplyScalar(8);
  const seg = (from: number, to: number, zMin: number, zMax: number) => {
    const p = w.a.clone().addScaledVector(dir, from), q = w.a.clone().addScaledVector(dir, to);
    // Counter-clockwise: along the outer side, back along the inner side.
    const poly = cleanPolygon([p.clone().add(side), q.clone().add(side), q.clone().sub(side), p.clone().sub(side)]);
    return isConvexCcw(poly) ? [solidNode(doc, facadePrism(poly, zMin, zMax, s.plain, s.trim.material, z0))] : [];
  };
  const top = z0 + w.height;
  if (!w.gate || len < 256) return seg(0, len, z0 - 32, top);
  const g0 = Math.round((len / 2 - 64) / 16) * 16, g1 = g0 + 128;
  return [...seg(0, g0, z0 - 32, top), ...seg(g1, len, z0 - 32, top), ...seg(g0, g1, z0 + 160, top)];
}

/** A convex polygon as whole units, still convex (rounding can bend it a hair: then its hull). */
function wholeUnits(poly: Vector2[]): Vector2[] {
  const r = cleanPolygon(ccw(poly.map((p) => new Vector2(Math.round(p.x), Math.round(p.y)))));
  return isConvexCcw(r) ? r : cleanPolygon(convexHull(r));
}

const polyArea = (p: Vector2[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
const boxPoly = (b: Box2) => [b.min.clone(), new Vector2(b.max.x, b.min.y), b.max.clone(), new Vector2(b.min.x, b.max.y)];
const cutsInto = (poly: Vector2[], cuts: Vector2[][]) => cuts.some((c) => convexOverlap(ccw(poly), c));

/**
 * The options a layout implies: a house has 1–2 floors, square corners and is enterable; a single building
 * has no courtyard and no enterable houses of its own.
 */
export function layoutOptions(o: BuildingOptions): BuildingOptions {
  if (o.layout === 'house') {
    const lo = Math.min(2, Math.max(1, o.minFloors));
    return { ...o, minFloors: lo, maxFloors: Math.max(lo, Math.min(2, o.maxFloors)), corners: 'square', courtyards: false, annexes: false, alleys: false, interiors: 'all' };
  }
  if (o.layout === 'single') return { ...o, courtyards: false, interiors: 'none', alleys: false };
  return o;
}

/**
 * Cuts a block's plan along streets and squares drawn over it: every wing loses what lies in a cut; a wing cut in
 * two becomes two buildings; slivers too small to build are dropped, and so are the yards, sheds, walls and lots
 * a cut runs through.
 */
export function cutPlan(plan: ReturnType<typeof planBlock>, cuts: Vector2[][]): void {
  const pieces = (poly: Vector2[]) => cutBack(ccw(poly), cuts).map(wholeUnits).filter((p) => p.length >= 3 && polyArea(p) >= 128 * 160 && inradius(p) >= 56);
  const buildings: typeof plan.buildings = [];
  for (const b of plan.buildings) {
    const [main, ...rest] = b.parts;
    const mainPieces = pieces(main.poly).sort((p, q) => polyArea(q) - polyArea(p));
    if (!mainPieces.length) continue;
    const changed = !cutsInto(main.poly, cuts) ? null : mainPieces;
    const head = changed ? { ...main, poly: changed[0], cornerEdges: [], corner: undefined } : main;
    const annexes = rest.flatMap((part) => {
      if (!cutsInto(part.poly, cuts)) return [part];
      const ps = pieces(part.poly).sort((p, q) => polyArea(q) - polyArea(p));
      return ps.length ? [{ ...part, poly: ps[0], cornerEdges: [] }] : [];
    });
    buildings.push({ ...b, parts: [head, ...annexes] });
    for (const extra of changed?.slice(1) ?? []) buildings.push({ parts: [{ ...main, poly: extra, cornerEdges: [], corner: undefined }], styleSlot: b.styleSlot + 1 });
  }
  plan.buildings = buildings;
  plan.yards = plan.yards.filter((y) => !cutsInto(boxPoly(y), cuts));
  plan.sheds = plan.sheds.filter((y) => !cutsInto(boxPoly(y), cuts));
  plan.lots = plan.lots.filter((l) => !cutsInto(boxPoly(l.box), cuts));
  plan.walls = plan.walls.filter((w) => !cutsInto(boxPoly(new Box2().setFromPoints([w.a, w.b]).expandByScalar(8)), cuts));
}

type Arch = (typeof ARCHITECTURES)[ArchitectureName];

/** Lots are laid out on this grid. */
const LOT_GRID = 64;
/** An enterable house, or the wings of an L that become one, is at most this long either way. */
const MAX_HOUSE = 640;
/** Sky bridges: across alleys up to this wide, between lots facing each other over at least this much, 128 wide. */
const MAX_BRIDGE_GAP = 96, MIN_BRIDGE_FACING = 160, HALF_BRIDGE = 64;

/** What the steps of `generateBuildings` share about the block. */
interface Block {
  doc: VmfDocument; opts: BuildingOptions; out: GeneratedBuildings; plan: BlockPlan; area: Box2; z0: number; arch: Arch; level: DetailLevel;
  /** Which lots become enterable houses; drawn from their own sequence, so the other choices keep their seeds. */
  interiors: 'none' | 'some' | 'all'; intRng: Rng;
}

const boxOf = (p: Part) => new Box2().setFromPoints(p.poly);

/** The footprint shrunk to the lot grid. */
function gridArea(footprint: Box3): Box2 {
  return new Box2(
    new Vector2(Math.ceil(footprint.min.x / LOT_GRID) * LOT_GRID, Math.ceil(footprint.min.y / LOT_GRID) * LOT_GRID),
    new Vector2(Math.floor(footprint.max.x / LOT_GRID) * LOT_GRID, Math.floor(footprint.max.y / LOT_GRID) * LOT_GRID),
  );
}

/** What a block's quality builds. A house is enterable whatever the quality asks for elsewhere. */
function qualityFor(opts: BuildingOptions): (typeof QUALITY)[BuildingQuality] {
  const quality = QUALITY[opts.quality ?? 'high'];
  return opts.layout === 'house' ? { ...quality, interiors: true } : quality;
}

/** Walls on the block's outline face the street, and so do walls along a cut (the street that made it); the rest face courtyards, yards or neighbours. */
function streetTest(area: Box2, cuts: Vector2[][]): (a: Vector2, b: Vector2) => boolean {
  const onLine = (a: Vector2, b: Vector2, axis: 'x' | 'y', v: number) => Math.abs(a[axis] - v) < 1 && Math.abs(b[axis] - v) < 1;
  const alongCut = (a: Vector2, b: Vector2) => cuts.some((c) => c.some((p, i) => {
    const q = c[(i + 1) % c.length], d = new Vector2().subVectors(q, p), len = d.length();
    if (len < 1) return false;
    const off = (v: Vector2) => Math.abs((d.x * (v.y - p.y) - d.y * (v.x - p.x)) / len);
    return off(a) < 3 && off(b) < 3;
  }));
  return (a, b) => onLine(a, b, 'x', area.min.x) || onLine(a, b, 'x', area.max.x) || onLine(a, b, 'y', area.min.y) || onLine(a, b, 'y', area.max.y) || alongCut(a, b);
}

/** The block plan's options, from the block's options and its architecture. */
function planOptions(opts: BuildingOptions, arch: Arch): PlanOptions {
  return {
    minFloors: opts.minFloors, maxFloors: opts.maxFloors, alleys: opts.alleys,
    corners: opts.corners ?? arch.corners, courtyards: opts.courtyards ?? true, annexes: (opts.annexes ?? true) && opts.yards !== 'green',
    openings: opts.openYards, single: opts.layout === 'single' ? 'building' : opts.layout === 'house' ? 'house' : undefined,
  };
}

/**
 * Green yards are dressed here (lawns, trees, playgrounds, parking), so the street pass leaves them alone; from
 * their own sequence, so the buildings don't change with them. Other yards go to the street pass.
 */
function dressYards(doc: VmfDocument, plan: BlockPlan, opts: BuildingOptions, z0: number, extras: Extras, out: GeneratedBuildings): void {
  if (opts.yards !== 'green') { out.dressing.yards.push(...plan.yards); return; }
  const yardRng = new Rng(opts.seed * 43 + 19);
  const gates = plan.walls.filter((w) => w.gate).map((w) => new Box2().setFromPoints([w.a, w.b]).expandByScalar(96));
  for (const y of plan.yards) {
    const g = greenYard(doc, y, z0, yardRng, gates, extras);
    out.solids.push(...g.solids);
    out.entities.push(...g.entities);
  }
}

/** Each building's roof and its parts' roofs, from their own sequence. */
function chooseRoofs(plan: BlockPlan, opts: BuildingOptions, arch: Arch) {
  const roofRng = new Rng(opts.seed * 17 + 3);
  return plan.buildings.map((b) => {
    const roof = chooseRoof(roofRng, opts.roofs ?? 'mixed', b.parts[0].poly.length === 4, arch.roofs);
    // Sheds get a low metal roof half of the time.
    const shedRoof = roofRng.chance(0.5) ? { kind: 'hip' as const, material: 'METAL/METALROOF005A' } : { kind: 'flat' as const, material: ROOF };
    return { roof, parts: b.parts.map((part) => (part.kind === 'annex' ? shedRoof : roof.kind === 'gable' && part.poly.length !== 4 ? { ...roof, kind: 'hip' as const } : roof)) };
  });
}

/** A courtyard wall as the wings see it: 16 thick, hiding them up to its height, with nothing standing out. */
function courtWallNeighbour(w: WallPlan, z0: number): Neighbour {
  const side = new Vector2().subVectors(w.b, w.a).normalize().multiplyScalar(8);
  const n = new Vector2(side.y, -side.x);
  return { poly: ccw([w.a.clone().add(n), w.b.clone().add(n), w.b.clone().sub(n), w.a.clone().sub(n)]), cover: z0 + w.height, reach: () => 0 };
}

/**
 * The footprint of an enterable house on these parts, or null for a solid building: rectangles of 1–2
 * floors (ring buildings around courtyards stay solid). The wings of an L become one house of at most
 * 640 × 640; a single lot longer than that gets a smaller house at the street, the rest is its yard.
 */
function houseOn(k: Block, parts: Part[]): Vector2[] | null {
  const { interiors, intRng, plan, arch, area } = k;
  if (interiors === 'none' || !parts.length) return null;
  if (parts.some((p) => p.kind === 'main') && plan.ring) return null;
  if (parts.some((p) => p.floors > 2 || p.poly.length !== 4 || !p.poly.every((q, i) => { const r = p.poly[(i + 1) % 4]; return q.x === r.x || q.y === r.y; }))) return null;
  const lot = parts.reduce((b, p) => b.union(boxOf(p)), new Box2());
  const size = lot.getSize(new Vector2());
  if (parts.length > 1 && (size.x > MAX_HOUSE || size.y > MAX_HOUSE)) return null;
  if (interiors !== 'all' && !intRng.chance(arch.interiorShare)) return null;
  if (parts.length > 1) return outlineOf(parts.map(boxOf));
  const house = lot.clone();
  for (const ax of ['x', 'y'] as const) {
    if (size[ax] <= MAX_HOUSE) continue;
    const len = intRng.pick([384, 448, 512, 576]);
    const atMin = Math.abs(lot.min[ax] - area.min[ax]) < 1, atMax = Math.abs(lot.max[ax] - area.max[ax]) < 1;
    if (atMin && (!atMax || intRng.chance(0.5))) house.max[ax] = lot.min[ax] + len;
    else if (atMax) house.min[ax] = lot.max[ax] - len;
    else { house.min[ax] = Math.round((lot.min[ax] + lot.max[ax] - len) / 128) * 64; house.max[ax] = house.min[ax] + len; }
  }
  // What the house leaves of its lot is yard (trees may grow there).
  const yards = [
    new Box2(new Vector2(lot.min.x, lot.min.y), new Vector2(house.min.x, lot.max.y)), new Box2(new Vector2(house.max.x, lot.min.y), new Vector2(lot.max.x, lot.max.y)),
    new Box2(new Vector2(house.min.x, lot.min.y), new Vector2(house.max.x, house.min.y)), new Box2(new Vector2(house.min.x, house.max.y), new Vector2(house.max.x, lot.max.y)),
  ];
  k.out.dressing.yards.push(...yards.filter((y) => y.max.x - y.min.x >= 64 && y.max.y - y.min.y >= 64));
  return [new Vector2(house.min.x, house.min.y), new Vector2(house.max.x, house.min.y), new Vector2(house.max.x, house.max.y), new Vector2(house.min.x, house.max.y)];
}

/** Builds an enterable house on footprint `fp` in place of `parts`, keeping the ground in front of its doors free. */
function buildInterior(k: Block, parts: Part[], fp: Vector2[]): void {
  const { doc, opts, out, plan, arch, intRng } = k;
  const others = plan.buildings.flatMap((b) => b.parts).filter((p) => !parts.includes(p)).map((p) => boxOf(p).expandByScalar(1));
  const h = interiorHouse(doc, fp, k.z0, {
    seed: intRng.int(1, 1e9), storeys: Math.max(...parts.map((p) => p.floors)) >= 2 ? 2 : 1,
    style: opts.interiorStyle ?? intRng.pick(arch.interiorStyles), cutHeight: opts.cutHeight, furnish: opts.furnish,
    lights: opts.interiorLights, lightLevel: opts.interiorLightLevel, wideDoors: opts.wideDoors, weathering: opts.weathering, eaves: k.level >= 2,
    noEntrance: [...others, ...plan.walls.map((w) => new Box2().setFromPoints([w.a, w.b]).expandByScalar(9))],
  });
  out.solids.push(...h.world);
  out.detail.push(...h.detail);
  out.entities.push(...h.entities);
  out.interiorHouses++;
  // No lamps or trees there.
  for (const e of h.plan.entrances) {
    const w = h.plan.walls[e.wall], o = w.openings[e.opening];
    const half = (o.to - o.from) / 2 + 16;
    const side = new Vector2(-e.out.y, e.out.x);
    (out.dressing.doors ??= []).push(new Box2().setFromPoints([
      e.centre.clone().addScaledVector(side, -half), e.centre.clone().addScaledVector(side, half).addScaledVector(e.out, 128),
    ]));
  }
}

/** Builds a building's enterable houses: the wings of a lot become one house; each shed is a house of its own. Returns the parts they take. */
function buildHouses(k: Block, b: BuildingPlan): Set<Part> {
  const enterable = new Set<Part>();
  const mains = b.parts.filter((p) => p.kind === 'main');
  const lot = mains.reduce((x, p) => x.union(boxOf(p)), new Box2()).getSize(new Vector2());
  // An L too big for one house becomes a house per wing.
  const groups = mains.length > 1 && (lot.x > MAX_HOUSE || lot.y > MAX_HOUSE) ? mains.map((p) => [p]) : [mains];
  for (const g of groups) {
    const fp = houseOn(k, g);
    if (fp) { g.forEach((p) => enterable.add(p)); buildInterior(k, g, fp); }
  }
  for (const p of b.parts.filter((x) => x.kind === 'annex')) {
    const shed = houseOn(k, [p]);
    if (shed) { enterable.add(p); buildInterior(k, [p], shed); }
  }
  return enterable;
}

/**
 * Up to three rooftop props on a flat roof, away from its edges. They are dealt even when the extras leave them
 * out (`keep` false), so the walls and bridges dealt after them keep their seeds.
 */
function roofProps(main: Part, z0: number, rng: Rng, keep: boolean): GeneratedBuildings['entities'] {
  const box = new Box2().setFromPoints(main.poly);
  const size = box.getSize(new Vector2());
  const n = Math.min(3, Math.floor((size.x * size.y) / (256 * 256)));
  const top = z0 + main.floors * FLOOR;
  const props: GeneratedBuildings['entities'] = [];
  for (let i = 0; i < n; i++) {
    const p = new Vector2(Math.round(rng.range(box.min.x + 48, box.max.x - 48)), Math.round(rng.range(box.min.y + 48, box.max.y - 48)));
    if (!inside(cleanPolygon(offsetPolygon(main.poly, -40)), p)) continue;
    const prop = { classname: 'prop_static', origin: new Vector3(p.x, p.y, top), keys: { model: rng.pick(ROOF_PROPS), angles: `0 ${rng.int(0, 3) * 90} 0`, solid: '6' } };
    if (keep) props.push(prop);
  }
  return props;
}

/** The footprint of a sky bridge across the alley between two lots along `axis`, or null when they don't face each other across one. */
function bridgeFootprint(a: Box2, b: Box2, axis: 'x' | 'y'): Vector2[] | null {
  const other = axis === 'x' ? 'y' : 'x';
  const gap = b.min[axis] - a.max[axis];
  const gap2 = a.min[axis] - b.max[axis];
  const lo2 = Math.max(a.min[other], b.min[other]), hi2 = Math.min(a.max[other], b.max[other]);
  if (hi2 - lo2 < MIN_BRIDGE_FACING) return null;
  let from: number, to: number;
  if (gap > 0 && gap <= MAX_BRIDGE_GAP) { from = a.max[axis]; to = b.min[axis]; }
  else if (gap2 > 0 && gap2 <= MAX_BRIDGE_GAP) { from = b.max[axis]; to = a.min[axis]; }
  else return null;
  const mid = Math.round((lo2 + hi2) / 2 / 16) * 16;
  const min = new Vector2(), max = new Vector2();
  min[axis] = from; max[axis] = to;
  min[other] = mid - HALF_BRIDGE; max[other] = mid + HALF_BRIDGE;
  return [new Vector2(min.x, min.y), new Vector2(max.x, min.y), new Vector2(max.x, max.y), new Vector2(min.x, max.y)];
}

/** Sky bridges between neighbours that are both at least three floors high, one floor below the lower one's top. */
function skyBridges(doc: VmfDocument, lots: BlockPlan['lots'], rng: Rng, z0: number): KVNode[] {
  const solids: KVNode[] = [];
  for (let i = 0; i < lots.length; i++) {
    for (let j = i + 1; j < lots.length; j++) {
      const a = lots[i], b = lots[j];
      const floor = Math.min(a.floors, b.floors) - 1;
      if (floor < 2 || !rng.chance(0.6)) continue;
      const zb = z0 + floor * FLOOR;
      for (const axis of ['x', 'y'] as const) {
        const poly = bridgeFootprint(a.box, b.box, axis);
        if (poly) solids.push(solidNode(doc, facadePrism(poly, zb, zb + FLOOR, FACADE_STYLES.stone.windows[0], ROOF, z0, FACADE_STYLES.stone.plain.material)));
      }
    }
  }
  return solids;
}

/**
 * Fills a footprint with a block of buildings: a ring around a courtyard or a row of lots (some L-shaped),
 * shaped corners with entrances on the block corners, varying heights, annexes, walls with gateways,
 * cornices, parapets, optional rooftop props and (with alleys) sky bridges.
 */
export function generateBuildings(doc: VmfDocument, footprint: Box3, options: BuildingOptions): GeneratedBuildings {
  const opts = layoutOptions(options);
  const rng = new Rng(opts.seed);
  const area = gridArea(footprint);
  const z0 = footprint.min.z;
  const out: GeneratedBuildings = { solids: [], detail: [], entities: [], buildings: 0, interiorHouses: 0, dressing: { area, z0, anchors: [], yards: [], obstacles: [] } };
  const quality = qualityFor(opts);
  const level = Math.min(opts.detail ?? 2, quality.maxDetail) as DetailLevel;
  // Decoration draws from its own sequence, so the layout and textures don't change with the detail level.
  const deco = new Rng(opts.seed * 31 + 7);
  const towerRng = new Rng(opts.seed * 13 + 5);
  const arch = ARCHITECTURES[opts.architecture ?? 'mixed'];
  const cuts = decodeCuts(opts.cut).filter((c) => boxesOverlap(c, boxPoly(area)));
  const extras = resolveExtras(opts);
  const street: Street = {
    keep: extras.keep, isStreet: streetTest(area, cuts), rng: new Rng(opts.seed * 7 + 11), entities: out.entities,
    oriels: arch.oriels && quality.streetFeatures, balconies: arch.balconies && quality.streetFeatures, roofHuts: arch.roofHuts, weathering: opts.weathering ?? 0.5,
    anchors: out.dressing.anchors,
  };
  const plan = planBlock(area, rng, planOptions(opts, arch));
  if (cuts.length) cutPlan(plan, cuts);
  out.ring = !!plan.ring;
  dressYards(doc, plan, opts, z0, extras, out);
  out.dressing.obstacles.push(...plan.sheds);
  const styles: readonly FacadeStyle[] = arch.facades;
  const first = rng.int(0, styles.length - 1);
  const styleOf = (slot: number) => FACADE_STYLES[opts.style ?? styles[(first + slot) % styles.length]];

  // Roofs first: every wing's decoration stops at its neighbours' walls, up to their roofs.
  const roofs = chooseRoofs(plan, opts, arch);
  const wings = plan.buildings.flatMap((b, i) => b.parts.map((part, j) => ({ part, as: partNeighbour(part, z0, level, roofs[i].parts[j].kind) })));
  const courtWalls = plan.walls.map((w) => courtWallNeighbour(w, z0));
  const block: Block = { doc, opts, out, plan, area, z0, arch, level, interiors: quality.interiors ? opts.interiors ?? arch.interiors : 'none', intRng: new Rng(opts.seed * 41 + 17) };

  plan.buildings.forEach((b, bi) => {
    const s = styleOf(b.styleSlot);
    const main = b.parts[0];
    const enterable = buildHouses(block, b);
    b.parts.forEach((part, j) => {
      if (enterable.has(part)) return;
      const neighbours = [...wings.filter((w) => w.part !== part).map((w) => w.as), ...courtWalls];
      const r = partSolids(doc, part, s, z0, rng, deco, level, roofs[bi].parts[j], street, neighbours);
      out.solids.push(...r.world);
      out.detail.push(...r.detail);
      // Corner towers: most rounded corners, some cut and square ones.
      if (part.corner && part.floors >= 3 && (opts.towers ?? true) && quality.towers) {
        const chance = arch.towers * (part.corner.shape === 'round' ? 0.6 : part.corner.shape === 'chamfer' ? 0.35 : 0.2);
        if (towerRng.chance(chance)) out.detail.push(...cornerTower(doc, part, s, r.windows, z0, r.roofHeight, towerRng));
      }
    });
    if (main.kind === 'main') out.buildings++;
    if (opts.roofProps && main.kind === 'main' && roofs[bi].roof.kind === 'flat' && !enterable.has(main)) out.entities.push(...roofProps(main, z0, rng, extras.keep('roofProps')));
  });
  for (const w of plan.walls) out.detail.push(...wallSolids(doc, w, styleOf(rng.int(0, 4)), z0));
  if (opts.alleys) out.solids.push(...skyBridges(doc, plan.lots, rng, z0));
  // Wall caps under roofs, parts and wings against each other, relief backs on walls, bottoms on the ground.
  hideCoveredFaces([...out.solids, ...out.detail], { groundAt: () => z0 });
  return out;
}
