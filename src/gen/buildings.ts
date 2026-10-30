import { Box2, Box3, Vector2, Vector3 } from 'three';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { solidNode } from '../edit/brushes.ts';
import { Rng } from './rng.ts';
import { FLOOR, bayCount, cleanPolygon, convexHull, facadePrism, isConvexCcw, offsetPolygon, type FacadeTile } from './facade.ts';
import { planBlock, type CornerOption, type Part, type WallPlan } from './buildingPlan.ts';
import { chooseRoof, roofSolids, type RoofKind, type RoofOption } from './roofs.ts';
import { chooseCap, towerSides, towerSolids } from './towers.ts';
import { entranceSteps, streetFacade, wallOf, type FeatureEntity } from './facadeFeatures.ts';
import { ARCHITECTURES, FACADE_STYLES, type ArchitectureName, type FacadeStyle, type Style } from './styles.ts';
import { wallClutter, type Anchor, type BlockDressing } from './streets.ts';

export { ARCHITECTURES, FACADE_STYLES, type ArchitectureName, type FacadeStyle };

const t = (name: string, bays: number, widthPx?: number): FacadeTile => ({ material: `BUILDING_TEMPLATE/${name.toUpperCase()}`, bays, widthPx });
/** Weathering on street walls: water stains and dirt. */
const STAINS = ['decals/decalstain001a', 'decals/decalstain002a', 'decals/decalstain005a', 'decals/decalstain008a', 'decals/decalstain010a', 'decals/decalstain012a', 'decals/wallstain01a'];

const ROOF = 'CONCRETE/CONCRETEFLOOR028C';
const NODRAW = 'TOOLS/TOOLSNODRAW';
const ROOF_PROPS = [
  'models/props_rooftop/roof_vent003.mdl', 'models/props_rooftop/roof_vent004.mdl', 'models/props_rooftop/chimneypipe01a.mdl',
  'models/props_rooftop/antenna01a.mdl', 'models/props_rooftop/roof_dish001.mdl', 'models/props_rooftop/rooftopcluser01a.mdl',
];

export interface BuildingOptions {
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
  /** Low sheds in yards and courtyards (default on). */
  annexes?: boolean;
  /** Facade decoration (default 2: base course, ledges, columns, stepped cornice). */
  detail?: DetailLevel;
  /** Roof shape: one kind for every building, or the architecture's mix (default). */
  roofs?: RoofOption;
  /** Towers with domes, bells, onions or spires on some street corners (default on). */
  towers?: boolean;
}

export interface GeneratedBuildings {
  /** World brushes: the building shells. */
  solids: KVNode[];
  /** Decoration brushes, to be wrapped in a func_detail (see `detailEntityNode`). */
  detail: KVNode[];
  /** Point entities (rooftop props). */
  entities: { classname: string; origin: Vector3; keys: Record<string, string> }[];
  buildings: number;
  /** For the street pass across blocks (`streetDressing`): outline, cable anchors, yards. */
  dressing: BlockDressing;
}

const inside = (poly: Vector2[], p: Vector2) => poly.every((a, i) => {
  const b = poly[(i + 1) % poly.length];
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
});

/** How much facade decoration to build: 0 a plain cornice, 1 + base course, 2 + ledges and columns, 3 + brackets. */
export type DetailLevel = 0 | 1 | 2 | 3;

const BASE = t('building_template003a', 0);

/** A band around the footprint, `out` units proud of the wall. */
function band(doc: VmfDocument, poly: Vector2[], out: number, zMin: number, zMax: number, tile: FacadeTile): KVNode | null {
  const p = cleanPolygon(offsetPolygon(poly, out));
  return isConvexCcw(p) ? solidNode(doc, facadePrism(p, zMin, zMax, tile, tile.material, zMin, tile.material)) : null;
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

/**
 * Brushes of one wing. The shell (ground floor, upper floors) is world geometry for visibility; the
 * decoration (base course, ledges, columns, cornice, brackets, parapet) goes to `detail` for func_detail.
 */
function partSolids(
  doc: VmfDocument, part: Part, s: Style, z0: number, rng: Rng, deco: Rng, level: DetailLevel, roof: { kind: RoofKind; material: string },
  street: {
    isStreet?: (a: Vector2, b: Vector2) => boolean; rng: Rng; entities: FeatureEntity[];
    oriels: boolean; balconies: boolean; roofHuts: boolean; weathering: number; anchors: Anchor[];
  },
): { world: KVNode[]; detail: KVNode[]; roofHeight: (p: Vector2) => number; windows: FacadeTile } {
  const world: KVNode[] = [], detail: KVNode[] = [];
  let roofHeight = (_p: Vector2) => z0 + part.floors * FLOOR + 32;
  const add = (n: KVNode | null) => { if (n) detail.push(n); };
  const poly = part.poly;
  const top = z0 + part.floors * FLOOR;
  const ground = rng.pick(s.ground);
  const windows = rng.pick(s.windows);
  const groundTiles = poly.map((_, i) => (part.cornerEdges.includes(i) ? s.door : ground));
  const pitched = roof.kind !== 'flat';
  const roofTop = pitched ? NODRAW : ROOF;
  // Ground floor, sunk a little so the building sits on uneven ground.
  world.push(solidNode(doc, facadePrism(poly, z0 - 32, Math.min(top, z0 + FLOOR), groundTiles, part.floors > 1 ? NODRAW : roofTop, z0)));
  if (part.floors > 1) world.push(solidNode(doc, facadePrism(poly, z0 + FLOOR, top, windows, roofTop, z0)));
  const main = part.kind === 'main';
  // Pilasters per wall, in the wall's plane (x along it, y height), for the street clutter to keep clear of.
  const pilasters = poly.map((): Box2[] => []);

  // Base course of stone along the street.
  if (level >= 1) add(band(doc, poly, 4, z0 - 32, z0 + 20, BASE));
  // Ledges: a heavier one over the ground floor, thin ones between upper floors (all, or every other).
  if (level >= 2 && main && part.floors > 1) {
    add(band(doc, poly, 6, z0 + FLOOR - 6, z0 + FLOOR + 6, s.trim));
    const every = deco.pick([1, 2]);
    for (let k = 2; k < part.floors; k++) if ((k - 1) % every === 0) add(band(doc, poly, 4, z0 + k * FLOOR - 4, z0 + k * FLOOR + 4, s.trim));
  }
  // Stepped cornice: a fascia, then the overhanging top band.
  const overhang = main && level >= 1 ? 14 : 8;
  if (main && level >= 1) add(band(doc, poly, 6, top - 24, top - 16, s.trim));
  add(band(doc, poly, overhang, top - 16, top, s.trim));

  if (level >= 2 && main && part.floors > 1) {
    const colTop = level >= 3 ? top - 36 : top - 24;
    // Quoins on the outer corners (not between the segments of a rounded corner).
    poly.forEach((v, i) => {
      const n = poly.length;
      const dIn = new Vector2().subVectors(v, poly[(i + n - 1) % n]).normalize(), dOut = new Vector2().subVectors(poly[(i + 1) % n], v).normalize();
      if (dIn.dot(dOut) < Math.cos((40 * Math.PI) / 180)) add(cornerBlock(doc, poly, i, 16, 4, z0 + FLOOR + 6, colTop, s.plain));
    });
    // Columns between window bays on long walls: every second or third bay.
    const step = deco.pick([2, 3]);
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const len = a.distanceTo(b);
      const bays = bayCount(len, windows);
      if (len < 256 || bays < 4) return;
      const dir = new Vector2().subVectors(b, a).normalize();
      for (let k = step; k <= bays - step; k += step) {
        add(wallBlock(doc, a.clone().addScaledVector(dir, (k * len) / bays), dir, 16, 4, z0 + FLOOR + 6, colTop, s.plain));
        pilasters[i].push(new Box2(new Vector2((k * len) / bays - 8, z0 + FLOOR + 6), new Vector2((k * len) / bays + 8, colTop)));
      }
    });
  }
  // Brackets under the cornice at every bay.
  if (level >= 3 && main && part.floors > 1) {
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const len = a.distanceTo(b);
      const bays = Math.max(1, bayCount(len, windows) || Math.round(len / 64));
      const dir = new Vector2().subVectors(b, a).normalize();
      for (let k = 0; k <= bays; k++) {
        if ((k === 0 || k === bays) && len < 96) continue;
        const along = Math.min(len - 6, Math.max(6, (k * len) / bays));
        add(wallBlock(doc, a.clone().addScaledVector(dir, along), dir, 8, 12, top - 36, top - 24, s.trim));
      }
    });
  }
  if (pitched) {
    const r = roofSolids(doc, poly, top, {
      kind: roof.kind, material: roof.material, wall: s.plain, window: windows, overhang,
      dormers: main && level >= 1, chimneys: main && level >= 1,
    }, deco);
    detail.push(...r.solids);
    roofHeight = r.heightAt;
    // A TV antenna on some ridges.
    if (main && level >= 1 && deco.chance(0.35)) {
      const c = new Box2().setFromPoints(poly).getCenter(new Vector2());
      if (inside(poly, c)) street.entities.push({ classname: 'prop_static', origin: new Vector3(Math.round(c.x), Math.round(c.y), Math.round(r.heightAt(c) + 100)), keys: { model: 'models/props_rooftop/antenna04a.mdl', angles: `0 ${deco.int(0, 359)} 0`, solid: '0' } });
    }
  } else if (main) {
    // Parapet: one brush per edge between the cornice line and 4 units inside the wall.
    const outer = cleanPolygon(offsetPolygon(poly, overhang));
    const inner = cleanPolygon(offsetPolygon(poly, -4));
    if (inner.length === outer.length && isConvexCcw(inner)) {
      outer.forEach((a, i) => {
        const b = outer[(i + 1) % outer.length];
        const quad = [a, b, inner[(i + 1) % inner.length], inner[i]];
        if (isConvexCcw(quad)) detail.push(solidNode(doc, facadePrism(quad, top, top + 32, s.plain, s.plain.material, top, NODRAW)));
      });
    }
    // A stair house on the roof (lift machinery of the blocks), away from the edges.
    if (street.roofHuts && level >= 1 && deco.chance(0.7)) {
      const box = new Box2().setFromPoints(poly);
      const size = box.getSize(new Vector2());
      if (size.x >= 256 && size.y >= 256) {
        const w = deco.pick([96, 128]), d = deco.pick([96, 128]);
        const cx = Math.round(deco.range(box.min.x + 64 + w / 2, box.max.x - 64 - w / 2)), cy = Math.round(deco.range(box.min.y + 64 + d / 2, box.max.y - 64 - d / 2));
        const hut = [new Vector2(cx - w / 2, cy - d / 2), new Vector2(cx + w / 2, cy - d / 2), new Vector2(cx + w / 2, cy + d / 2), new Vector2(cx - w / 2, cy + d / 2)];
        if (hut.every((p) => inside(poly, p))) {
          detail.push(solidNode(doc, facadePrism(hut, top, top + 96, s.plain, ROOF, top)));
          detail.push(solidNode(doc, facadePrism(offsetPolygon(hut, 6), top + 96, top + 104, s.trim, s.trim.material, top + 96, s.trim.material)));
        }
      }
    }
  }
  // Street fronts: oriels, balconies, awnings and vents on walls that face the street; steps at a cut-corner entrance.
  const isStreet = street.isStreet;
  if (main && isStreet) {
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      if (part.cornerEdges.includes(i) || !isStreet(a, b)) return;
      const w = wallOf(a, b);
      const f = streetFacade(doc, w, {
        z0, floors: part.floors, windows, trim: s.trim, plain: s.plain, level, oriels: street.oriels, balconies: street.balconies,
      }, street.rng);
      detail.push(...f.solids);
      street.entities.push(...f.entities);
      if (level >= 1) street.entities.push(...wallClutter(w, z0, part.floors, street.rng, street.anchors, { windows, ground: groundTiles[i], taken: [...f.taken, ...pilasters[i]] }));
      // Weathering: stains running down from under the cornice and from window sills.
      const stains = Math.round((w.len / 256) * street.weathering * 2 * street.rng.next());
      for (let k = 0; k < stains; k++) {
        const p = a.clone().addScaledVector(w.dir, street.rng.range(32, w.len - 32)).addScaledVector(w.out, 2);
        const z = street.rng.chance(0.5) ? top - 64 - street.rng.int(0, 48) : z0 + street.rng.int(1, part.floors - 1) * FLOOR + 8;
        street.entities.push({ classname: 'infodecal', origin: new Vector3(Math.round(p.x), Math.round(p.y), Math.round(z)), keys: { texture: street.rng.pick(STAINS) } });
      }
    });
    if (level >= 1 && part.cornerEdges.length === 1) {
      const i = part.cornerEdges[0];
      detail.push(...entranceSteps(doc, wallOf(poly[i], poly[(i + 1) % poly.length]), z0));
    }
  }
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
    z0: top - 24, z1, windows, trim: s.trim, plain: s.plain, cap, capMaterial: material,
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

/**
 * Fills a footprint with a block of buildings: a ring around a courtyard or a row of lots (some L-shaped),
 * shaped corners with entrances on the block corners, varying heights, annexes, walls with gateways,
 * cornices, parapets, optional rooftop props and (with alleys) sky bridges.
 */
export function generateBuildings(doc: VmfDocument, footprint: Box3, opts: BuildingOptions): GeneratedBuildings {
  const rng = new Rng(opts.seed);
  const g = FLOOR;
  const area = new Box2(
    new Vector2(Math.ceil(footprint.min.x / 64) * 64, Math.ceil(footprint.min.y / 64) * 64),
    new Vector2(Math.floor(footprint.max.x / 64) * 64, Math.floor(footprint.max.y / 64) * 64),
  );
  const out: GeneratedBuildings = { solids: [], detail: [], entities: [], buildings: 0, dressing: { area, z0: footprint.min.z, anchors: [], yards: [], obstacles: [] } };
  const z0 = footprint.min.z;
  const level = opts.detail ?? 2;
  // Decoration draws from its own sequence, so the layout and textures don't change with the detail level.
  const deco = new Rng(opts.seed * 31 + 7);
  const roofRng = new Rng(opts.seed * 17 + 3);
  const towerRng = new Rng(opts.seed * 13 + 5);
  // Walls on the block's outline face the street; the rest face courtyards, yards or neighbours.
  const onLine = (a: Vector2, b: Vector2, axis: 'x' | 'y', v: number) => Math.abs(a[axis] - v) < 1 && Math.abs(b[axis] - v) < 1;
  const arch = ARCHITECTURES[opts.architecture ?? 'mixed'];
  const street = {
    isStreet: (a: Vector2, b: Vector2) => onLine(a, b, 'x', area.min.x) || onLine(a, b, 'x', area.max.x) || onLine(a, b, 'y', area.min.y) || onLine(a, b, 'y', area.max.y),
    rng: new Rng(opts.seed * 7 + 11),
    entities: out.entities,
    oriels: arch.oriels, balconies: arch.balconies, roofHuts: arch.roofHuts, weathering: opts.weathering ?? 0.5,
    anchors: out.dressing.anchors,
  };
  const plan = planBlock(area, rng, {
    minFloors: opts.minFloors, maxFloors: opts.maxFloors, alleys: opts.alleys,
    corners: opts.corners ?? arch.corners, courtyards: opts.courtyards ?? true, annexes: opts.annexes ?? true,
  });
  out.dressing.yards.push(...plan.yards);
  out.dressing.obstacles.push(...plan.sheds);
  const styles: readonly FacadeStyle[] = arch.facades;
  const first = rng.int(0, styles.length - 1);
  const styleOf = (slot: number) => FACADE_STYLES[opts.style ?? styles[(first + slot) % styles.length]];

  for (const b of plan.buildings) {
    const s = styleOf(b.styleSlot);
    const main = b.parts[0];
    const roof = chooseRoof(roofRng, opts.roofs ?? 'mixed', main.poly.length === 4, arch.roofs);
    // Sheds get a low metal roof half of the time.
    const shedRoof = roofRng.chance(0.5) ? { kind: 'hip' as const, material: 'METAL/METALROOF005A' } : { kind: 'flat' as const, material: ROOF };
    for (const part of b.parts) {
      const partRoof = part.kind === 'annex' ? shedRoof : roof.kind === 'gable' && part.poly.length !== 4 ? { ...roof, kind: 'hip' as const } : roof;
      const r = partSolids(doc, part, s, z0, rng, deco, level, partRoof, street);
      out.solids.push(...r.world);
      out.detail.push(...r.detail);
      // Corner towers: most rounded corners, some cut and square ones.
      if (part.corner && part.floors >= 3 && (opts.towers ?? true)) {
        const chance = arch.towers * (part.corner.shape === 'round' ? 0.6 : part.corner.shape === 'chamfer' ? 0.35 : 0.2);
        if (towerRng.chance(chance)) out.detail.push(...cornerTower(doc, part, s, r.windows, z0, r.roofHeight, towerRng));
      }
    }
    if (main.kind === 'main') out.buildings++;
    if (opts.roofProps && main.kind === 'main' && roof.kind === 'flat') {
      const box = new Box2().setFromPoints(main.poly);
      const size = box.getSize(new Vector2());
      const n = Math.min(3, Math.floor((size.x * size.y) / (256 * 256)));
      const top = z0 + main.floors * g;
      for (let i = 0; i < n; i++) {
        const p = new Vector2(Math.round(rng.range(box.min.x + 48, box.max.x - 48)), Math.round(rng.range(box.min.y + 48, box.max.y - 48)));
        if (!inside(cleanPolygon(offsetPolygon(main.poly, -40)), p)) continue;
        out.entities.push({
          classname: 'prop_static',
          origin: new Vector3(p.x, p.y, top),
          keys: { model: rng.pick(ROOF_PROPS), angles: `0 ${rng.int(0, 3) * 90} 0`, solid: '6' },
        });
      }
    }
  }
  for (const w of plan.walls) out.detail.push(...wallSolids(doc, w, styleOf(rng.int(0, 4)), z0));

  if (opts.alleys) {
    // Sky bridges between neighbours that are both at least three floors high.
    const placed = plan.lots;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const floor = Math.min(a.floors, b.floors) - 1;
        if (floor < 2 || !rng.chance(0.6)) continue;
        for (const axis of ['x', 'y'] as const) {
          const other = axis === 'x' ? 'y' : 'x';
          const gap = b.box.min[axis] - a.box.max[axis];
          const gap2 = a.box.min[axis] - b.box.max[axis];
          const lo2 = Math.max(a.box.min[other], b.box.min[other]), hi2 = Math.min(a.box.max[other], b.box.max[other]);
          if (hi2 - lo2 < 160) continue;
          let from: number, to: number;
          if (gap > 0 && gap <= 96) { from = a.box.max[axis]; to = b.box.min[axis]; }
          else if (gap2 > 0 && gap2 <= 96) { from = b.box.max[axis]; to = a.box.min[axis]; }
          else continue;
          const mid = Math.round((lo2 + hi2) / 2 / 16) * 16;
          const zb = z0 + floor * g;
          const min = new Vector2(), max = new Vector2();
          min[axis] = from; max[axis] = to;
          min[other] = mid - 64; max[other] = mid + 64;
          const poly = [new Vector2(min.x, min.y), new Vector2(max.x, min.y), new Vector2(max.x, max.y), new Vector2(min.x, max.y)];
          out.solids.push(solidNode(doc, facadePrism(poly, zb, zb + g, FACADE_STYLES.stone.windows[0], ROOF, z0, FACADE_STYLES.stone.plain.material)));
        }
      }
    }
  }
  return out;
}
