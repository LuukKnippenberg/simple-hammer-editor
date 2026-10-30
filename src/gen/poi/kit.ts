import { Vector2, Vector3 } from 'three';
import type { KVNode } from '../../vmf/keyvalues.ts';
import { vecStr, type VmfDocument } from '../../vmf/map.ts';
import { boxSolid, prismFaces, solidNode, type PrismMaterials } from '../../edit/brushes.ts';
import { ellipse, frustumFaces, type ShapeMaterials } from '../../edit/shapes.ts';
import type { ParamValue } from '../../lw/kits.ts';
import { UNITS } from '../../lw/kits.ts';
import { Rng } from '../rng.ts';
import { modelInfo } from './models.ts';
import type { PoiEntity, PoiOutput, PoiSpec, PoiType, Rect } from './types.ts';

/**
 * The toolkit every POI builds on. A POI works in its own frame: x from 0 to `W`, y from 0 to `D`, heights
 * relative to the ground height `z`. The kit turns that into world brushes and entities, reserves the
 * through-routes first and keeps props off them, and stands props on the pads it laid (or the terrain).
 */

export const NODRAW = 'TOOLS/TOOLSNODRAW';
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
export type EdgeKind = 'fence' | 'chainlink' | 'wood' | 'wall' | 'hedge' | 'kerb' | 'railing' | 'combine';

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

  // --- Routes ----------------------------------------------------------------------------------------------

  /** Reserves an axis-aligned corridor between two local points (one coordinate shared), `width` wide. */
  route(a: [number, number], b: [number, number], width = ROUTE_WIDTH): Rect {
    const h = width / 2;
    const r = a[0] === b[0] ? rect(a[0] - h, a[1], a[0] + h, b[1]) : rect(a[0], a[1] - h, b[0], a[1] + h);
    this.reserved.push(r);
    this.out.routes.push(this.worldRect(r));
    return r;
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

  /** Local footprint of a model at a local point and yaw (the rotated bounds' box). */
  footprint(model: string, x: number, y: number, yaw: number): Rect {
    const m = modelInfo(model);
    const [x0, y0, x1, y1] = m ? [m.min[0], m.min[1], m.max[0], m.max[1]] : [-16, -16, 16, 16];
    const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([px, py]) => [x + px * c - py * s, y + px * s + py * c]);
    return rect(Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])));
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
    const z = ground + (o.dz ?? 0) - (m?.min[2] ?? 0);
    const w = this.world(x, y);
    const cls = o.cls ?? (m && !m.isStatic ? 'prop_dynamic' : 'prop_static');
    const keys: Record<string, string> = { model: path, angles: `${Math.round(o.pitch ?? 0)} ${this.yaw(yaw)} ${Math.round(o.roll ?? 0)}` };
    if (cls === 'prop_static') keys.solid = '6';
    if (cls === 'prop_dynamic') Object.assign(keys, { solid: '6', DisableBoneFollowers: '1' });
    if (cls === 'prop_physics') Object.assign(keys, { spawnflags: '256' });
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
    const MODEL: Partial<Record<EdgeKind, { model: string; len: number; yaw: number }>> = {
      fence: { model: 'props_c17/fence01a', len: 134, yaw: 90 },
      chainlink: { model: 'props_wasteland/interior_fence002d', len: 256, yaw: 90 },
      wood: { model: 'props_forest/fence_trail_256', len: 256, yaw: 90 },
      combine: { model: 'props_combine/combine_fence01a', len: 114, yaw: 90 },
      hedge: { model: (o.height ?? 96) > 100 ? 'props_foliage/hedge_256_128high' : 'props_foliage/hedge_256', len: 300, yaw: 0 },
    };
    const model = MODEL[kind];
    for (const [r0, r1] of runs) {
      if (r1 - r0 < 4) continue;
      if (model) {
        const n = Math.max(1, Math.round((r1 - r0) / model.len));
        const step = (r1 - r0) / n;
        // The combine fence piece is built from one end, not its centre.
        const offset = kind === 'combine' ? 0 : step / 2;
        for (let i = 0; i < n; i++) {
          const [x, y] = at(r0 + i * step + offset);
          this.prop(model.model, x, y, yaw + model.yaw, { force: true });
          this.occupied.push(this.footprint(model.model, x, y, yaw + model.yaw));
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
      this.overlay('decals/decalstreet008b', a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, len / n, width, yaw, [0.03, 0.1, 0.97, 0.13]);
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
    this.occupied.push(rect(x - 40, y - 40, x + 40, y + 40));
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
    const u = UNITS.find((q) => q.id === unitId);
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

function ccwPts(p: Vector2[]): Vector2[] {
  let a = 0;
  p.forEach((q, i) => { const r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; });
  return a < 0 ? [...p].reverse() : p;
}

export { grow };
