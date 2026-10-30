import { Euler, Vector2, Vector3 } from 'three';
import type { KVNode } from '../../vmf/keyvalues.ts';
import { vecStr, type VmfDocument } from '../../vmf/map.ts';
import { boxSolid, prismFaces, solidNode, type PrismMaterials } from '../../edit/brushes.ts';
import { ellipse, frustumFaces, type ShapeMaterials } from '../../edit/shapes.ts';
import type { ParamValue } from '../../lw/kits.ts';
import { UNITS } from '../../lw/kits.ts';
import { Rng } from '../rng.ts';
import { modelInfo } from './models.ts';
import { interiorHouse, type InteriorHouseOptions } from '../interiorHouse.ts';
import type { PoiEntity, PoiOutput, PoiSpec, PoiType, Rect } from './types.ts';

/**
 * The toolkit every POI builds on. A POI works in its own frame: x from 0 to `W`, y from 0 to `D`, heights
 * relative to the ground height `z`. The kit turns that into world brushes and entities, reserves the
 * through-routes first and keeps props off them, and stands props on the pads it laid (or the terrain).
 */

export const NODRAW = 'TOOLS/TOOLSNODRAW';
/** Units the POIs place beyond the mission kits' list. */
export const EXTRA_UNITS = [
  { id: 'antlion', label: 'Antlion', cls: 'unit_antlion', unittype: '' },
  { id: 'antlionguard', label: 'Antlion guard', cls: 'unit_antlionguard', unittype: '' },
];
/** Large units have a radius of 58: routes and gaps are at least this wide. */
export const ROUTE_WIDTH = 128;
/** Pads and paths stand this far above the ground (keeps them clear of the ground's own faces). */
const LIFT = 2;
/** Longest pad piece: very long faces collect more t-junctions than vbsp can fix. */
const PIECE = 1024;

export const rect = (x0: number, y0: number, x1: number, y1: number): Rect =>
  ({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
export const overlaps = (a: Rect, b: Rect, margin = 0) =>
  a.x0 < b.x1 + margin && b.x0 < a.x1 + margin && a.y0 < b.y1 + margin && b.y0 < a.y1 + margin;
export const inside = (a: Rect, outer: Rect) => a.x0 >= outer.x0 && a.y0 >= outer.y0 && a.x1 <= outer.x1 && a.y1 <= outer.y1;
const grow = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });

export interface PropOptions {
  /** Height above the ground under the prop (default 0). */
  dz?: number;
  /** Absolute height instead of standing on the ground. */
  z?: number;
  /** Skip the route and spacing checks (decoration that units walk through or over). */
  force?: boolean;
  /** Extra clearance around the prop for the spacing check. */
  margin?: number;
  /** Override the entity class (prop_physics for explosive barrels, ...). */
  cls?: string;
  keys?: Record<string, string>;
  /** Pitch and roll (for wrecks). */
  pitch?: number;
  roll?: number;
  /** Not solid for units (small clutter): no footprint is taken. */
  noOccupy?: boolean;
}

/** Edge kinds: models along a line, or brushes. */
export type EdgeKind = 'fence' | 'chainlink' | 'wood' | 'border' | 'barbed' | 'farm' | 'rail' | 'wall' | 'hedge' | 'kerb' | 'railing' | 'combine';

export class PoiKit {
  readonly doc: VmfDocument;
  readonly spec: PoiSpec;
  readonly type: PoiType;
  readonly rng: Rng;
  readonly params: Record<string, ParamValue>;
  /** Local width (along local x) and depth (along local y). */
  readonly W: number;
  readonly D: number;
  /** Ground height. */
  readonly z: number;
  readonly out: PoiOutput = { world: [], detail: [], entities: [], routes: [] };
  /** Areas where the terrain is lowered (world rectangles and heights), filled in by `sea()` and `pit()`. */
  readonly cuts: { rect: Rect; z: number }[] = [];
  /** Reserved routes and other no-go areas (local). */
  readonly reserved: Rect[] = [];
  /** Footprints of what has been placed (local). */
  readonly occupied: Rect[] = [];
  private pads: { r: Rect; top: number; sides: string[] }[] = [];
  private origin: Vector2;
  private u: Vector2;
  private v: Vector2;
  private terrain: (x: number, y: number) => number;

  constructor(doc: VmfDocument, spec: PoiSpec, type: PoiType, ground: (x: number, y: number) => number) {
    this.doc = doc;
    this.spec = spec;
    this.type = type;
    this.rng = new Rng(spec.seed);
    this.params = spec.params;
    this.z = spec.z;
    this.terrain = ground;
    const r = spec.rect;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    const turned = spec.rotation === 90 || spec.rotation === 270;
    this.W = turned ? h : w;
    this.D = turned ? w : h;
    const a = (spec.rotation * Math.PI) / 180;
    this.u = new Vector2(Math.round(Math.cos(a)), Math.round(Math.sin(a)));
    this.v = new Vector2(-this.u.y, this.u.x);
    this.origin = { 0: new Vector2(r.x0, r.y0), 90: new Vector2(r.x1, r.y0), 180: new Vector2(r.x1, r.y1), 270: new Vector2(r.x0, r.y1) }[spec.rotation];
  }

  // --- Frame -------------------------------------------------------------------------------------------

  /** World position of a local point. */
  world(x: number, y: number): Vector2 {
    return this.origin.clone().addScaledVector(this.u, x).addScaledVector(this.v, y);
  }
  /** World yaw (degrees) for a local yaw. */
  yaw(local: number): number {
    return (((Math.round(local) + this.spec.rotation) % 360) + 360) % 360;
  }
  worldRect(r: Rect): Rect {
    const a = this.world(r.x0, r.y0), b = this.world(r.x1, r.y1);
    return rect(a.x, a.y, b.x, b.y);
  }
  get centre(): [number, number] {
    return [this.W / 2, this.D / 2];
  }
  get bounds(): Rect {
    return rect(0, 0, this.W, this.D);
  }
  num(key: string, fallback = 0): number {
    const v = Number(this.params[key]);
    return Number.isFinite(v) ? v : fallback;
  }
  flag(key: string): boolean {
    const v = this.params[key];
    return v === true || v === 'true' || v === 1 || v === '1';
  }
  str(key: string): string {
    return String(this.params[key] ?? '');
  }

  // --- Ground --------------------------------------------------------------------------------------------

  /** Absolute ground height at a local point: the top of a pad there, else the terrain. */
  groundAt(x: number, y: number): number {
    let top = -Infinity;
    for (const p of this.pads) if (x >= p.r.x0 && x <= p.r.x1 && y >= p.r.y0 && y <= p.r.y1) top = Math.max(top, p.top);
    if (top > -Infinity) return top;
    const w = this.world(x, y);
    return this.terrain(w.x, w.y);
  }

  /** Ground height ignoring pads: the terrain, or the bottom of a cut. */
  terrainAt(x: number, y: number): number {
    const w = this.world(x, y);
    return this.terrain(w.x, w.y);
  }

  /** Lowest terrain under a local rectangle (corners, edge midpoints and centre). */
  private lowestUnder(r: Rect): number {
    let low = Infinity;
    for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) {
      const w = this.world(r.x0 + (r.x1 - r.x0) * fx, r.y0 + (r.y1 - r.y0) * fy);
      low = Math.min(low, this.terrain(w.x, w.y));
    }
    return Math.min(low, this.z);
  }

  /**
   * A flat surface (paving, asphalt, grass, sand) over a local rectangle, `top` above the ground and reaching
   * down below the lowest terrain under it. Pads cut into pieces; later pads may lie on top of earlier ones.
   */
  pad(r: Rect, material: string, top = LIFT, side = NODRAW): void {
    const nx = Math.max(1, Math.ceil((r.x1 - r.x0) / PIECE)), ny = Math.max(1, Math.ceil((r.y1 - r.y0) / PIECE));
    const topZ = this.z + top;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const piece = rect(
        Math.round(r.x0 + ((r.x1 - r.x0) * i) / nx), Math.round(r.y0 + ((r.y1 - r.y0) * j) / ny),
        Math.round(r.x0 + ((r.x1 - r.x0) * (i + 1)) / nx), Math.round(r.y0 + ((r.y1 - r.y0) * (j + 1)) / ny),
      );
      const bottom = Math.floor(this.lowestUnder(piece)) - 8 - this.z;
      const node = this.box(piece, bottom, top, { top: material, bottom: NODRAW, sides: side });
      const topSide = node.childrenNamed('side')[0].get('id')!;
      this.pads.push({ r: piece, top: topZ, sides: [topSide] });
    }
  }

  /** Top side ids of the pads under a local rectangle (for overlays). */
  padSides(r: Rect): string[] {
    const out: string[] = [];
    for (const p of [...this.pads].reverse()) if (overlaps(p.r, r)) out.push(...p.sides);
    return [...new Set(out)].slice(0, 32);
  }

  // --- Brushes ---------------------------------------------------------------------------------------------

  /** A box over a local rectangle from z0 to z1 (relative to the ground height). */
  box(r: Rect, z0: number, z1: number, material: string | PrismMaterials, opts: { world?: boolean; occupy?: boolean } = {}): KVNode {
    const w = this.worldRect(r);
    const node = boxSolid(this.doc, new Vector3(w.x0, w.y0, this.z + z0), new Vector3(w.x1, w.y1, this.z + z1), material);
    (opts.world ? this.out.world : this.out.detail).push(node);
    if (opts.occupy) this.occupied.push(r);
    return node;
  }

  /** A vertical prism over a convex local polygon (any winding), heights relative to the ground. */
  prism(poly: [number, number][], z0: number, z1: number, material: string | PrismMaterials, opts: { world?: boolean; occupy?: boolean } = {}): KVNode {
    let pts = poly.map(([x, y]) => this.world(x, y).round());
    let area = 0;
    pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; area += a.x * b.y - b.x * a.y; });
    if (area < 0) pts = pts.reverse();
    const mats = typeof material === 'string' ? { top: material, bottom: material, sides: material } : material;
    const node = solidNode(this.doc, prismFaces(pts, this.z + z0, this.z + z1, mats));
    (opts.world ? this.out.world : this.out.detail).push(node);
    if (opts.occupy) {
      const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
      this.occupied.push(rect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
    }
    return node;
  }

  /** A cylinder (or frustum when `rTop` differs) standing at a local point. */
  cylinder(x: number, y: number, r: number, z0: number, z1: number, material: string | ShapeMaterials, sides = 12, rTop = r): KVNode {
    const c = this.world(x, y);
    const mats = typeof material === 'string' ? { top: material, bottom: material, sides: material } : material;
    const bottom = ellipse(c.x, c.y, r, r, sides);
    const top = rTop > 0 ? ellipse(c.x, c.y, rTop, rTop, sides) : new Vector2(Math.round(c.x), Math.round(c.y));
    const node = solidNode(this.doc, frustumFaces(bottom, top, this.z + z0, this.z + z1, mats));
    this.out.detail.push(node);
    return node;
  }

  /**
   * A round rim (fountain basin, pond edge, tower wall) as one convex brush per side: the ring between
   * `rOut` and `rIn` around a local point.
   */
  ring(x: number, y: number, rOut: number, rIn: number, z0: number, z1: number, material: string | ShapeMaterials, sides = 16, from = 0, to = Math.PI * 2): KVNode[] {
    const m = typeof material === 'string' ? { top: material, bottom: material, sides: material } : material;
    const out: KVNode[] = [];
    for (let i = 0; i < sides; i++) {
      const a0 = from + (i / sides) * (to - from), a1 = from + ((i + 1) / sides) * (to - from);
      const pts: [number, number][] = [
        [x + Math.cos(a0) * rIn, y + Math.sin(a0) * rIn], [x + Math.cos(a0) * rOut, y + Math.sin(a0) * rOut],
        [x + Math.cos(a1) * rOut, y + Math.sin(a1) * rOut], [x + Math.cos(a1) * rIn, y + Math.sin(a1) * rIn],
      ];
      out.push(this.prism(pts, z0, z1, { top: m.top, bottom: m.bottom, sides: m.sides }));
    }
    this.occupied.push(rect(x - rOut, y - rOut, x + rOut, y + rOut));
    return out;
  }

  /**
   * A convex cross-section (`profile`: [across, up] pairs, any winding) extruded along local x (`along` 'x',
   * across = local y) or local y, from `a` to `b`. Logs, pipes, roof ridges, prisms lying down.
   */
  extrude(profile: [number, number][], along: 'x' | 'y', a: number, b: number, material: string | ShapeMaterials): KVNode {
    const m = typeof material === 'string' ? { top: material, bottom: material, sides: material } : material;
    const p = (s: number, c: number, h: number) => {
      const w = along === 'x' ? this.world(s, c) : this.world(c, s);
      return new Vector3(w.x, w.y, this.z + h);
    };
    const A = profile.map(([c, h]) => p(a, c, h)), B = profile.map(([c, h]) => p(b, c, h));
    const centre = [...A, ...B].reduce((s, q) => s.add(q), new Vector3()).divideScalar(A.length * 2);
    const faces: { points: [Vector3, Vector3, Vector3]; material: string }[] = [
      { points: [A[0], A[1], A[2]], material: m.sides },
      { points: [B[0], B[2], B[1]], material: m.sides },
    ];
    for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length;
      const up = (profile[i][1] + profile[j][1]) / 2 > (Math.max(...profile.map((q) => q[1])) + Math.min(...profile.map((q) => q[1]))) / 2;
      faces.push({ points: [A[i], A[j], B[j]], material: up ? m.top : m.bottom });
    }
    for (const f of faces) {
      const [x, y, z] = f.points;
      const n = new Vector3().subVectors(z, x).cross(new Vector3().subVectors(y, x));
      if (n.dot(new Vector3().subVectors(x, centre)) < 0) f.points = [x, z, y];
    }
    const node = solidNode(this.doc, faces);
    this.out.detail.push(node);
    return node;
  }

  /** A log (or pipe) lying along local x or y: an octagonal prism of radius r, resting on the ground. */
  log(along: 'x' | 'y', a: number, b: number, at: number, r: number, material: string, dz = 0): KVNode {
    const prof: [number, number][] = [];
    for (let i = 0; i < 8; i++) {
      const t = ((i + 0.5) / 8) * Math.PI * 2;
      prof.push([Math.round(at + Math.cos(t) * r), Math.round(dz + r + Math.sin(t) * r)]);
    }
    return this.extrude(prof, along, a, b, { top: material, bottom: material, sides: 'WOOD/WOODBEAM001A' });
  }

  /** A sloped slab (ramp, awning): a quad whose top rises from `za` along one local edge to `zb` at the other. */
  slope(r: Rect, along: 'x' | 'y', za: number, zb: number, thick: number, material: string | ShapeMaterials): KVNode {
    const m = typeof material === 'string' ? { top: material, bottom: material, sides: material } : material;
    // Built as a prism in the side view: corners in (along, up), extruded across.
    const [a0, a1] = along === 'x' ? [r.x0, r.x1] : [r.y0, r.y1];
    const [c0, c1] = along === 'x' ? [r.y0, r.y1] : [r.x0, r.x1];
    const p = (s: number, c: number, h: number) => {
      const w = along === 'x' ? this.world(s, c) : this.world(c, s);
      return new Vector3(w.x, w.y, this.z + h);
    };
    const corners = [[a0, za - thick], [a1, zb - thick], [a1, zb], [a0, za]] as const;
    const faces: { points: [Vector3, Vector3, Vector3]; material: string }[] = [];
    // Two side faces (across the slope) and four faces around the profile.
    const left = corners.map(([s, h]) => p(s, c0, h)), right = corners.map(([s, h]) => p(s, c1, h));
    const add = (a: Vector3, b: Vector3, c: Vector3, mat: string) => faces.push({ points: [a, b, c], material: mat });
    // Orientation is fixed below by checking the face normals against the solid's centre.
    add(left[0], left[1], left[2], m.sides);
    add(right[0], right[2], right[1], m.sides);
    add(left[3], left[2], right[2], m.top);
    add(left[0], right[0], right[1], m.bottom);
    add(left[1], right[1], right[2], m.sides);
    add(left[0], left[3], right[3], m.sides);
    const centre = [...left, ...right].reduce((s, q) => s.add(q), new Vector3()).divideScalar(8);
    for (const f of faces) {
      const [a, b, c] = f.points;
      const n = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(b, a));
      if (n.dot(new Vector3().subVectors(a, centre)) < 0) f.points = [a, c, b];
    }
    const node = solidNode(this.doc, faces);
    this.out.detail.push(node);
    return node;
  }

  /**
   * An enterable house on a local rectangle, built by the interior generator (`interiorHouse()`). `doors` are
   * the local sides that get an entrance: 's' (y0), 'e' (x1), 'n' (y1), 'w' (x0).
   */
  house(r: Rect, opts: Omit<InteriorHouseOptions, 'seed' | 'entranceEdges'> & { doors?: ('s' | 'e' | 'n' | 'w')[] } = {}): void {
    // Counter-clockwise in the local frame stays counter-clockwise in the world (the frame only turns).
    const fp = [this.world(r.x0, r.y0), this.world(r.x1, r.y0), this.world(r.x1, r.y1), this.world(r.x0, r.y1)].map((p) => p.round());
    const edges = (opts.doors ?? ['s']).map((d) => ({ s: 0, e: 1, n: 2, w: 3 })[d]);
    const { doors: _doors, ...rest } = opts;
    const h = interiorHouse(this.doc, fp, this.z, { ...rest, seed: this.rng.int(1, 99999), entranceEdges: edges });
    this.out.world.push(...h.world);
    this.out.detail.push(...h.detail);
    for (const e of h.entities) this.out.entities.push({ classname: e.classname, origin: e.origin.clone(), keys: { ...e.keys } });
    this.occupied.push(r);
  }

  /**
   * Water: a world brush over a convex local polygon whose top face is a water material at `level` (above
   * the ground height), reaching down to `bottom`. Water has to be a world brush, not func_detail. The
   * navmesh drops the water surface but keeps the ground under it, so deep water must sit in a basin whose
   * walls are higher than units can climb (18): its floor is then an island units can't reach.
   */
  water(poly: [number, number][], level: number, bottom: number, material = 'NATURE/WATER_CANALS_WATER2'): void {
    const node = this.prism(poly, bottom, level, { top: material, bottom: NODRAW, sides: NODRAW }, { world: true });
    void node;
    this.out.waterLevel = Math.max(this.out.waterLevel ?? -Infinity, this.z + level);
  }

  /**
   * Sea or a lake over a local rectangle: displacement terrain under it is lowered `depth` below the ground
   * (with a short, steep shore), a water surface sits `level` below the ground, and a func_nav_blocker under
   * the surface keeps units out of the water (decks and piers above it stay walkable). On brush ground
   * the ground has to be cut away there by hand.
   */
  sea(r: Rect, o: { level?: number; depth?: number; material?: string } = {}): void {
    const level = o.level ?? -16, depth = o.depth ?? 128;
    this.cuts.push({ rect: this.worldRect(r), z: this.z - depth });
    this.water([[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]], level, -depth - 8, o.material ?? 'NATURE/WATER_COAST01');
    const w = this.worldRect(r);
    this.out.entities.push({
      classname: 'func_nav_blocker', keys: { StartDisabled: '0' },
      solids: [boxSolid(this.doc, new Vector3(w.x0, w.y0, this.z - depth - 8), new Vector3(w.x1, w.y1, this.z + level - 2), NODRAW)],
    });
    this.reserved.push(r);
  }

  /** Lowers the terrain under a local rectangle `depth` below the ground (a quarry pit, a canal). */
  pit(r: Rect, depth: number): void {
    this.cuts.push({ rect: this.worldRect(r), z: this.z - depth });
  }

  /** A round water surface (pond, fountain basin): `sides`-gon of radius r. */
  waterDisc(x: number, y: number, r: number, level: number, bottom: number, material?: string, sides = 16): void {
    const pts: [number, number][] = [];
    for (let i = 0; i < sides; i++) {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      pts.push([Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r)]);
    }
    this.water(pts, level, bottom, material);
  }

  // --- Routes ----------------------------------------------------------------------------------------------

  /** Reserves an axis-aligned corridor between two local points (one coordinate shared), `width` wide. */
  route(a: [number, number], b: [number, number], width = ROUTE_WIDTH): Rect {
    const h = width / 2;
    const r = a[0] === b[0] ? rect(a[0] - h, a[1], a[0] + h, b[1]) : rect(a[0], a[1] - h, b[0], a[1] + h);
    this.reserved.push(r);
    this.out.routes.push(this.worldRect(r));
    return r;
  }

  /**
   * A path along a local polyline: a strip of `material` (one convex brush per segment, discs at the bends)
   * raised `top` above the ground, reserved as a route by squares along it.
   */
  path(points: [number, number][], material: string, width = ROUTE_WIDTH, top = 4): void {
    const h = width / 2;
    for (let i = 0; i + 1 < points.length; i++) {
      const [a, b] = [points[i], points[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) continue;
      const n = [-(b[1] - a[1]) / len * h, (b[0] - a[0]) / len * h];
      this.prism([[a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]], -6, top, { top: material, bottom: NODRAW, sides: NODRAW });
      // Squares along the segment keep props off it.
      const steps = Math.max(1, Math.ceil(len / 48));
      for (let k = 0; k <= steps; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / steps, y = a[1] + ((b[1] - a[1]) * k) / steps;
        this.reserved.push(rect(x - h, y - h, x + h, y + h));
      }
      this.out.routes.push(this.worldRect(rect(a[0] - h, a[1] - h, a[0] + h, a[1] + h)));
    }
    for (const p of points.slice(1, -1)) this.cylinder(p[0], p[1], h, -6, top, { top: material, bottom: NODRAW, sides: NODRAW }, 8);
  }

  /** A route across the POI through its middle: 'x' runs from the left edge to the right edge. */
  crossRoute(axis: 'x' | 'y', at?: number, width = ROUTE_WIDTH): Rect {
    return axis === 'x' ? this.route([0, at ?? this.D / 2], [this.W, at ?? this.D / 2], width) : this.route([at ?? this.W / 2, 0], [at ?? this.W / 2, this.D], width);
  }

  /** Keeps an area free of props without making it a route. */
  keepClear(r: Rect): void {
    this.reserved.push(r);
  }

  /** True when a local footprint stays inside the POI, off the routes and away from what was placed. */
  isFree(r: Rect, margin = 8): boolean {
    if (!inside(r, this.bounds)) return false;
    if (this.reserved.some((q) => overlaps(q, r))) return false;
    return !this.occupied.some((q) => overlaps(q, r, margin));
  }

  // --- Props -----------------------------------------------------------------------------------------------

  /** Local footprint of a model at a local point and yaw (see `modelFootprint`). */
  footprint(model: string, x: number, y: number, yaw: number): Rect {
    return modelFootprint(model, x, y, yaw);
  }

  /**
   * Places a model at a local point with a local yaw, standing on the ground (its lowest point at the ground,
   * from the measured bounds). Returns false when the spot is taken or on a route.
   */
  prop(model: string, x: number, y: number, yaw = 0, o: PropOptions = {}): boolean {
    const m = modelInfo(model);
    const fp = this.footprint(model, x, y, yaw);
    if (!o.force && !this.isFree(fp, o.margin ?? 8)) return false;
    if (!o.noOccupy) this.occupied.push(fp);
    const path = m?.path ?? `models/${model.replace(/^models\//, '').replace(/\.mdl$/, '')}.mdl`;
    const ground = o.z !== undefined ? this.z + o.z : this.groundAt(x, y);
    const z = ground + (o.dz ?? 0) - lowest(m?.min ?? [0, 0, 0], m?.max ?? [0, 0, 0], o.pitch ?? 0, o.roll ?? 0);
    const w = this.world(x, y);
    const cls = o.cls ?? (m && !m.isStatic ? 'prop_dynamic' : 'prop_static');
    const keys: Record<string, string> = { model: path, angles: `${Math.round(o.pitch ?? 0)} ${this.yaw(yaw)} ${Math.round(o.roll ?? 0)}` };
    if (cls === 'prop_static') keys.solid = '6';
    if (cls === 'prop_dynamic') Object.assign(keys, { solid: '6', DisableBoneFollowers: '1' });
    this.out.entities.push({ classname: cls, origin: new Vector3(Math.round(w.x), Math.round(w.y), Math.round(z)), keys: { ...keys, ...o.keys } });
    return true;
  }

  /** Tries random spots in an area until `count` models are placed (or tries run out). Returns how many. */
  scatter(models: readonly string[], area: Rect, count: number, o: PropOptions & { yaw?: 'any' | 'right' | number; tries?: number } = {}): number {
    let placed = 0;
    for (let t = 0; t < (o.tries ?? count * 12) && placed < count; t++) {
      const model = this.rng.pick(models);
      const yaw = o.yaw === 'right' ? this.rng.int(0, 3) * 90 : typeof o.yaw === 'number' ? o.yaw : this.rng.int(0, 359);
      const x = Math.round(this.rng.range(area.x0, area.x1)), y = Math.round(this.rng.range(area.y0, area.y1));
      if (this.prop(model, x, y, yaw, o)) placed++;
    }
    return placed;
  }

  /** Models in a row from a to b every `step` units (spots that are taken are skipped). */
  row(models: readonly string[], a: [number, number], b: [number, number], step: number, yaw: number, o: PropOptions = {}): number {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.floor(len / step) + 1);
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      if (this.prop(this.rng.pick(models), a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, yaw, o)) placed++;
    }
    return placed;
  }

  // --- Edges -----------------------------------------------------------------------------------------------

  /**
   * A fence, wall, hedge, kerb or railing along a local line, leaving gaps (distances along the line,
   * [from, to]). Model edges are filled with whole fence pieces; brush edges are cut at the gaps.
   * Returns the pieces' footprints. Hedges and high walls can carry a fog-of-war blocker.
   */
  edge(kind: EdgeKind, a: [number, number], b: [number, number], gaps: [number, number][] = [], o: { height?: number; fow?: boolean } = {}): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 8) return;
    const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const at = (s: number): [number, number] => [a[0] + dir[0] * s, a[1] + dir[1] * s];
    const yaw = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
    // Runs of the line outside the gaps.
    const sorted = [...gaps].map(([g0, g1]) => [Math.max(0, Math.min(g0, g1)), Math.min(len, Math.max(g0, g1))]).sort((p, q) => p[0] - q[0]);
    const runs: [number, number][] = [];
    let s = 0;
    for (const [g0, g1] of sorted) { if (g0 > s) runs.push([s, g0]); s = Math.max(s, g1); }
    if (s < len) runs.push([s, len]);
    const pieces = EDGE_MODELS[kind];
    for (const [r0, r1] of runs) {
      if (r1 - r0 < 4) continue;
      if (pieces) {
        for (const p of fillRun(pieces, r1 - r0)) {
          // The piece covers [s0, s0 + len] along the line. Turned by 90° the model's +y points back
          // along the line, so its far end (max y) lies at s0.
          const s0 = r0 + p.at;
          const off = p.piece.yawOff === 90 ? s0 + p.piece.max : s0 - p.piece.min;
          const [x, y] = at(off);
          this.prop(p.piece.model, x, y, yaw + p.piece.yawOff, { force: true });
        }
        if (o.fow) this.fowStrip(at(r0), at(r1), 48, kind === 'hedge' ? 160 : 128);
        continue;
      }
      const spec = {
        wall: { w: 16, h: o.height ?? 64, mat: { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'BRICK/BRICKWALL045A' } },
        kerb: { w: 12, h: o.height ?? 8, mat: { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'CONCRETE/CONCRETEFLOOR027A' } },
        railing: { w: 4, h: o.height ?? 40, mat: { top: 'METAL/METALRAIL001A', bottom: NODRAW, sides: 'METAL/METALRAIL001A' } },
      }[kind as 'wall' | 'kerb' | 'railing'];
      const p0 = at(r0), p1 = at(r1);
      const n = [-dir[1] * spec.w / 2, dir[0] * spec.w / 2];
      const quad: [number, number][] = [[p0[0] - n[0], p0[1] - n[1]], [p1[0] - n[0], p1[1] - n[1]], [p1[0] + n[0], p1[1] + n[1]], [p0[0] + n[0], p0[1] + n[1]]];
      this.prism(quad, -8, spec.h, spec.mat, { occupy: true });
      if (o.fow) this.fowStrip(p0, p1, spec.w, spec.h + 32);
    }
  }

  /**
   * A sandbag wall along a local line: rows of bags (48 × 24 × 12) laid in staggered layers, each turned a
   * little, the top layer set back. Units can't climb it from 3 layers up (36 high).
   */
  sandbags(a: [number, number], b: [number, number], layers = 3): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 24) return;
    const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], nrm = [-dir[1], dir[0]];
    const mat = { top: 'NATURE/DIRTFLOOR004A', bottom: NODRAW, sides: 'NATURE/DIRTFLOOR004A' };
    for (let l = 0; l < layers; l++) {
      const inset = l === layers - 1 && layers > 1 ? 6 : 0;
      const shift = l % 2 ? 24 : 0;
      for (let s = shift; s + 40 <= len; s += 48) {
        const c = [a[0] + dir[0] * (s + 24), a[1] + dir[1] * (s + 24)];
        const t = this.rng.range(-0.07, 0.07), ct = Math.cos(t), st = Math.sin(t);
        const u = [dir[0] * ct - dir[1] * st, dir[0] * st + dir[1] * ct], v = [-u[1], u[0]];
        const hl = 23, hw = 12 - inset / 2;
        const o = [c[0] + nrm[0] * (l % 2 ? 1 : -1) * 1.5, c[1] + nrm[1] * (l % 2 ? 1 : -1) * 1.5];
        const q: [number, number][] = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([p, w]) => [o[0] + u[0] * p + v[0] * w, o[1] + u[1] * p + v[1] * w]);
        this.prism(q, l * 12 - (l === 0 ? 4 : 0), l * 12 + 12, mat);
      }
    }
    const x0 = Math.min(a[0], b[0]) - 14, x1 = Math.max(a[0], b[0]) + 14, y0 = Math.min(a[1], b[1]) - 14, y1 = Math.max(a[1], b[1]) + 14;
    this.occupied.push(rect(x0, y0, x1, y1));
  }

  /** A fog-of-war blocker (invisible brush entity) along a local line: units can't see past it. */
  fowStrip(a: [number, number], b: [number, number], width: number, height: number): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 8) return;
    const n = [-(b[1] - a[1]) / len * width / 2, (b[0] - a[0]) / len * width / 2];
    const quad = [[a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]];
    const w = quad.map(([x, y]) => this.world(x, y).round());
    const node = solidNode(this.doc, prismFaces(ccwPts(w), this.z, this.z + height, { top: NODRAW, bottom: NODRAW, sides: NODRAW }));
    this.out.entities.push({ classname: 'fow_blocker', keys: {}, solids: [node] });
  }

  /** Edges around the whole POI with gaps where the routes leave it. `inset` moves the line inwards. */
  perimeter(kind: EdgeKind, inset = 16, o: { height?: number; fow?: boolean; extraGaps?: Partial<Record<'s' | 'e' | 'n' | 'w', [number, number][]>> } = {}): void {
    const W = this.W, D = this.D, i = inset;
    const sides: { key: 's' | 'e' | 'n' | 'w'; a: [number, number]; b: [number, number]; axis: 'x' | 'y'; at: number }[] = [
      { key: 's', a: [i, i], b: [W - i, i], axis: 'x', at: i },
      { key: 'e', a: [W - i, i], b: [W - i, D - i], axis: 'y', at: W - i },
      { key: 'n', a: [W - i, D - i], b: [i, D - i], axis: 'x', at: D - i },
      { key: 'w', a: [i, D - i], b: [i, i], axis: 'y', at: i },
    ];
    for (const s of sides) {
      const gaps: [number, number][] = [];
      for (const r of this.reserved) {
        // A reserved strip that crosses this side's line opens a gap there.
        if (s.axis === 'x' ? r.y0 <= s.at && r.y1 >= s.at : r.x0 <= s.at && r.x1 >= s.at) {
          const [lo, hi] = s.axis === 'x' ? [r.x0, r.x1] : [r.y0, r.y1];
          const from = s.key === 's' ? lo - i : s.key === 'n' ? (W - i) - hi : s.key === 'e' ? lo - i : (D - i) - hi;
          gaps.push([from, from + (hi - lo)]);
        }
      }
      gaps.push(...(o.extraGaps?.[s.key] ?? []));
      this.edge(kind, s.a, s.b, gaps, o);
    }
  }

  // --- Entities, overlays, lights ------------------------------------------------------------------------------

  /** A point entity at a local point, `dz` above the ground there. */
  entity(classname: string, x: number, y: number, dz: number, keys: Record<string, string> = {}): PoiEntity {
    const w = this.world(x, y);
    const e: PoiEntity = { classname, origin: new Vector3(Math.round(w.x), Math.round(w.y), Math.round(this.groundAt(x, y) + dz)), keys };
    this.out.entities.push(e);
    return e;
  }

  /**
   * A street lamp at a local point whose arm reaches towards `facing` (local degrees), with a light under its
   * head when the POI's `lights` option is on.
   */
  lamp(x: number, y: number, facing: number, o: PropOptions = {}): boolean {
    // The pole stands at the model's origin; the arm reaches 96 units along the model's +y.
    if (!this.prop('props_c17/lamppost03a_off', x, y, facing - 90, o)) return false;
    const a = (facing * Math.PI) / 180;
    if (this.flag('lights')) this.light(x + Math.cos(a) * 96, y + Math.sin(a) * 96, 420, '255 214 160 160');
    return true;
  }

  /** A point light (lamp heads, floodlights). */
  light(x: number, y: number, dz: number, color = '255 214 160 120', distance = 0): void {
    this.entity('light', x, y, dz, { _light: color, _constant_attn: '0', _linear_attn: '0', _quadratic_attn: '1', _distance: String(distance), style: '0' });
  }

  /**
   * An info_overlay lying on the pads, centred on a local point: `w` along the local yaw, `h` across it.
   * `uv` picks part of the texture ([u0, v0, u1, v1]), for example one bar of a stripe texture as a line.
   */
  overlay(material: string, x: number, y: number, w: number, h: number, yaw = 0, uv: [number, number, number, number] = [0, 0, 1, 1]): boolean {
    const a = (yaw * Math.PI) / 180;
    const ext = Math.abs(Math.cos(a)) * w / 2 + Math.abs(Math.sin(a)) * h / 2, eyt = Math.abs(Math.sin(a)) * w / 2 + Math.abs(Math.cos(a)) * h / 2;
    const sides = this.padSides(rect(x - ext, y - eyt, x + ext, y + eyt));
    if (!sides.length) return false;
    const c = this.world(x, y);
    const wy = (this.yaw(yaw) * Math.PI) / 180;
    const U = new Vector3(Math.cos(wy), Math.sin(wy), 0), V = new Vector3(-Math.sin(wy), Math.cos(wy), 0);
    const z = this.groundAt(x, y);
    const r = (n: number) => String(Math.round(n * 1000) / 1000);
    const v3 = (p: Vector3) => vecStr(new Vector3(+r(p.x), +r(p.y), +r(p.z)));
    this.out.entities.push({
      classname: 'info_overlay', origin: new Vector3(Math.round(c.x), Math.round(c.y), Math.round(z)), keys: {
        material: material.toLowerCase(), sides: sides.join(' '),
        BasisOrigin: v3(new Vector3(c.x, c.y, z)), BasisNormal: '0 0 1', BasisU: v3(U), BasisV: v3(V),
        StartU: String(uv[0]), StartV: String(uv[1]), EndU: String(uv[2]), EndV: String(uv[3]),
        uv0: `${r(-w / 2)} ${r(-h / 2)} 0`, uv1: `${r(-w / 2)} ${r(h / 2)} 0`, uv2: `${r(w / 2)} ${r(h / 2)} 0`, uv3: `${r(w / 2)} ${r(-h / 2)} 0`,
        fademindist: '-1',
      },
    });
    return true;
  }

  /** A painted white line between two local points on the pads (one bar of the street stripe texture). */
  line(a: [number, number], b: [number, number], width = 8): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) return;
    // Long lines in pieces, so each overlay touches few faces.
    const n = Math.max(1, Math.ceil(len / 512));
    const yaw = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      // One of the texture's four bars, lengthwise: its u runs across the line, v along it.
      this.overlay('decals/decalstreet008b', a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, width, len / n, yaw + 90, [0.09, 0.1, 0.19, 0.9]);
    }
  }

  // --- Gameplay ------------------------------------------------------------------------------------------------

  /** A control point with its capture area at a local point (kept free of props). */
  capturePoint(x: number, y: number, radius = 192): void {
    const name = `poi_${this.spec.uid}_point`;
    this.entity('control_point', x, y, 0, { targetname: name, ownernumber: '0', constructed: '2', autoconstruct: '1' });
    const c = this.world(x, y), z = this.groundAt(x, y);
    this.out.entities.push({
      classname: 'trigger_capture_area', keys: { control_point: name, spawnflags: '3', StartDisabled: '0' },
      solids: [boxSolid(this.doc, new Vector3(Math.round(c.x - radius), Math.round(c.y - radius), Math.round(z - 16)), new Vector3(Math.round(c.x + radius), Math.round(c.y + radius), Math.round(z + 128)), 'TOOLS/TOOLSTRIGGER')],
    });
    this.occupied.push(rect(x - 96, y - 96, x + 96, y + 96));
  }

  /** A scrap pile rebels harvest (needs room around it for workers). */
  scrap(x: number, y: number, small = false): boolean {
    const fp = rect(x - 96, y - 96, x + 96, y + 96);
    if (!this.isFree(fp, 16)) return false;
    this.occupied.push(fp);
    this.entity(small ? 'scrap_marker_small' : 'scrap_marker', x, y, 0, { angles: `0 ${this.yaw(this.rng.int(0, 359))} 0`, autoconstruct: '1', constructed: '2' });
    return true;
  }

  /** A group of units (owner 1, the enemy) around a local point, in free spots. */
  unitGroup(unitId: string, x: number, y: number, count: number, owner = '1'): number {
    const u = UNITS.find((q) => q.id === unitId) ?? EXTRA_UNITS.find((q) => q.id === unitId);
    if (!u) return 0;
    let placed = 0;
    for (let t = 0; t < count * 10 && placed < count; t++) {
      const px = x + this.rng.range(-160, 160), py = y + this.rng.range(-160, 160);
      const fp = rect(px - 20, py - 20, px + 20, py + 20);
      if (!inside(fp, this.bounds) || this.occupied.some((q) => overlaps(q, fp, 4))) continue;
      this.entity(u.cls, Math.round(px), Math.round(py), 4, {
        targetname: `poi_${this.spec.uid}_units`, ownernumber: owner, angles: `0 ${this.rng.int(0, 359)} 0`, ...(u.unittype ? { unittype: u.unittype } : {}),
      });
      placed++;
    }
    return placed;
  }

  /** The gameplay options every POI type shares (capture point, scrap, unit groups), at a focus spot. */
  gameplay(focus: [number, number], scrapSpots: [number, number][] = []): void {
    const g = this.type.gameplay ?? {};
    if (g.capture && this.flag('capture')) this.capturePoint(focus[0], focus[1]);
    if (g.scrap) {
      let n = this.num('scrap');
      for (const [x, y] of scrapSpots) if (n > 0 && this.scrap(x, y)) n--;
      for (let t = 0; t < 40 && n > 0; t++) {
        const x = this.rng.range(128, this.W - 128), y = this.rng.range(128, this.D - 128);
        if (this.scrap(Math.round(x), Math.round(y))) n--;
      }
    }
    if (g.units?.length) {
      const unit = this.str('units');
      if (unit && unit !== 'none') this.unitGroup(unit, focus[0] + this.rng.range(-128, 128), focus[1] + this.rng.range(-128, 128), Math.max(1, this.num('unitCount', 5)));
    }
  }
}

/** Models along a fence line: each piece's length runs along its model y (yawOff 90) or x (yawOff 0). */
interface EdgePiece { model: string; yawOff: 0 | 90; min: number; max: number; len: number }

function edgePiece(model: string, yawOff: 0 | 90): EdgePiece {
  const m = modelInfo(model)!;
  const axis = yawOff === 90 ? 1 : 0;
  return { model, yawOff, min: m.min[axis], max: m.max[axis], len: m.max[axis] - m.min[axis] };
}

const EDGE_MODELS: Partial<Record<EdgeKind, EdgePiece[]>> = {
  fence: [edgePiece('props_c17/fence03a', 90), edgePiece('props_c17/fence01a', 90), edgePiece('props_c17/fence01b', 90)],
  chainlink: [edgePiece('props_wasteland/interior_fence002d', 90), edgePiece('props_wasteland/interior_fence002e', 90), edgePiece('props_wasteland/interior_fence002a', 90)],
  wood: [edgePiece('props_forest/fence_trail_512', 90), edgePiece('props_forest/fence_trail_256', 90), edgePiece('props_forest/fence_trail_128', 90)],
  border: [edgePiece('props_forest/fence_border_512', 90), edgePiece('props_forest/fence_border_256', 90), edgePiece('props_forest/fence_border_128', 90)],
  barbed: [edgePiece('props_wasteland/exterior_fence002e', 90), edgePiece('props_wasteland/exterior_fence002d', 90), edgePiece('props_wasteland/exterior_fence002b', 90)],
  combine: [edgePiece('props_combine/combine_fence01b', 90)],
  hedge: [edgePiece('props_foliage/hedge_256', 0), edgePiece('props_foliage/hedge_128', 0)],
  farm: [edgePiece('brush/fence_wood_512', 90), edgePiece('brush/fence_wood_256', 90), edgePiece('brush/fence_wood_128', 90)],
  rail: [edgePiece('props_wasteland/wood_fence01a', 90), edgePiece('props_wasteland/wood_fence01c', 90)],
};

/**
 * Whole pieces filling a run of length `len`, longest first; what is left over is spread as small gaps
 * between the pieces, so no piece reaches past the run's ends (into a gap left for a route).
 */
function fillRun(pieces: EdgePiece[], len: number): { piece: EdgePiece; at: number }[] {
  const chosen: EdgePiece[] = [];
  let left = len;
  for (const p of pieces) while (left >= p.len - 1) { chosen.push(p); left -= p.len; }
  if (!chosen.length) return [];
  const gap = chosen.length > 1 ? Math.max(0, left) / (chosen.length - 1) : 0;
  const out: { piece: EdgePiece; at: number }[] = [];
  let at = chosen.length > 1 ? 0 : Math.max(0, left) / 2;
  for (const p of chosen) { out.push({ piece: p, at }); at += p.len + gap; }
  return out;
}

/** Flat models units walk over (rails, planks, blankets): they may lie on routes. */
const WALKABLE = /pg_rail|dockplank|pg_beach_blanket|wood_pallet001a_static/;
export const walkable = (model: string) => WALKABLE.test(model);

/** Models whose collision is their trunk only: their canopy may hang over routes. */
const TRUNKS = /props_foliage\/(tree_|oak_|mall_tree)|pg_forest\/pg_palm/;

/**
 * Footprint of a model at a point and yaw: its bounds rotated, as a box (trees: just the trunk).
 */
export function modelFootprint(model: string, x: number, y: number, yaw: number): Rect {
  if (TRUNKS.test(model) && !/stump|fallen/.test(model)) return rect(x - 24, y - 24, x + 24, y + 24);
  const m = modelInfo(model);
  const [x0, y0, x1, y1] = m ? [m.min[0], m.min[1], m.max[0], m.max[1]] : [-16, -16, 16, 16];
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([px, py]) => [x + px * c - py * s, y + px * s + py * c]);
  return rect(Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])));
}

/** Lowest point of a model's bounds tipped by pitch and roll (wrecks on their side or roof). */
function lowest(min: number[], max: number[], pitch: number, roll: number): number {
  if (!pitch && !roll) return min[2];
  const e = new Euler((roll * Math.PI) / 180, (pitch * Math.PI) / 180, 0, 'ZYX');
  let low = Infinity;
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) low = Math.min(low, new Vector3(x, y, z).applyEuler(e).z);
  return low;
}

function ccwPts(p: Vector2[]): Vector2[] {
  let a = 0;
  p.forEach((q, i) => { const r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; });
  return a < 0 ? [...p].reverse() : p;
}

export { grow };
