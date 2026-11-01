import { Box3, Plane, Ray, Vector2, Vector3 } from 'three';

/**
 * Snap move (V with the Select tool): the pure geometry. The selection offers handles (corners, edge middles,
 * face centres, entity origins); the cursor finds a target on everything else (corner > edge > face > grid);
 * a grabbed handle and a target resolve to the offset that puts one on the other.
 */

export type HandleKind = 'vertex' | 'edge' | 'face' | 'origin';
export type TargetKind = 'vertex' | 'edge' | 'face';
export type SnapKind = TargetKind | 'grid';

/** Corners, edges and faces of a brush, or of an entity's bounding box. */
export interface SnapShape {
  owner: object;
  verts: Vector3[];
  edges: [Vector3, Vector3][];
  faces: { normal: Vector3; verts: Vector3[] }[];
  /** An entity's origin, grabbable as its own handle. */
  origin?: Vector3;
  /** Precomputed bounds (screen culling). */
  bounds?: Box3;
}

export interface Handle {
  kind: HandleKind;
  /** The corner, edge middle, face centre or origin. */
  point: Vector3;
  /** Edge ends. */
  a?: Vector3;
  b?: Vector3;
  /** Face outward normal. */
  normal?: Vector3;
}

export interface Target {
  kind: TargetKind;
  shape: SnapShape;
  /** The corner, the edge middle, or where the cursor ray hits the face. */
  point: Vector3;
  a?: Vector3;
  b?: Vector3;
  normal?: Vector3;
  verts?: Vector3[];
  /** Pixels from the cursor (0 for a face hit). */
  dist: number;
  /** Distance along the pick ray (near-ties go to the nearer one). */
  depth?: number;
}

/** What the cursor sees: pixel projection and the pick ray. */
export interface SnapView {
  project(p: Vector3): Vector2 | null;
  ray: Ray;
}

export interface SnapKinds { vertex: boolean; edge: boolean; face: boolean; grid: boolean }
export const ALL_KINDS: SnapKinds = { vertex: true, edge: true, face: true, grid: true };

/** Targets within this many pixels of the cursor light up. */
export const REACH = 12;

const centre = (vs: Vector3[]) => vs.reduce((c, v) => c.add(v), new Vector3()).divideScalar(vs.length || 1);
export const snapTo = (v: number, g: number) => (g > 0 ? Math.round(v / g) * g : v);

/** The eight corners, twelve edges and six faces of a box. */
export function boxShape(owner: object, box: Box3, origin?: Vector3): SnapShape {
  const c = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  const edges = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    .map(([i, j]): [Vector3, Vector3] => [c[i], c[j]]);
  // Counter-clockwise seen from outside.
  const faces = ([
    [[4, 6, 2, 0], new Vector3(-1, 0, 0)], [[3, 7, 5, 1], new Vector3(1, 0, 0)],
    [[1, 5, 4, 0], new Vector3(0, -1, 0)], [[6, 7, 3, 2], new Vector3(0, 1, 0)],
    [[2, 3, 1, 0], new Vector3(0, 0, -1)], [[5, 7, 6, 4], new Vector3(0, 0, 1)],
  ] as [number[], Vector3][]).map(([ix, normal]) => ({ normal, verts: ix.map((i) => c[i]) }));
  return { owner, verts: c, edges, faces, origin: origin?.clone(), bounds: box.clone() };
}

/** Every handle of a shape: corners, edge middles, face centres and the origin. */
export function handlesOf(shape: SnapShape): Handle[] {
  const out: Handle[] = shape.verts.map((v) => ({ kind: 'vertex', point: v.clone() }));
  for (const [a, b] of shape.edges) out.push({ kind: 'edge', point: a.clone().add(b).multiplyScalar(0.5), a: a.clone(), b: b.clone() });
  for (const f of shape.faces) out.push({ kind: 'face', point: centre(f.verts), normal: f.normal.clone() });
  if (shape.origin) out.push({ kind: 'origin', point: shape.origin.clone() });
  return out;
}

/** The handle nearest the cursor within `reach` pixels; corners win near-ties over edge middles and face centres. */
export function nearestHandle(handles: Handle[], view: SnapView, cursor: Vector2, reach = 24): Handle | null {
  const bias: Record<HandleKind, number> = { vertex: 0, origin: 1, edge: 2, face: 3 };
  let best: Handle | null = null, bestD = Infinity;
  for (const h of handles) {
    const s = view.project(h.point);
    if (!s) continue;
    const d = s.distanceTo(cursor);
    if (d > reach) continue;
    const score = d + bias[h.kind];
    if (score < bestD) { bestD = score; best = h; }
  }
  return best;
}

function segDist(p: Vector2, a: Vector2, b: Vector2): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** Where the ray enters a convex polygon facing it, as a distance along the ray. */
function hitFace(ray: Ray, normal: Vector3, verts: Vector3[]): number | null {
  const denom = normal.dot(ray.direction);
  if (denom > -1e-6 || verts.length < 3) return null;
  const t = (verts[0].clone().sub(ray.origin)).dot(normal) / denom;
  if (t <= 0) return null;
  const p = ray.at(t, new Vector3());
  const e = new Vector3(), q = new Vector3(), x = new Vector3();
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    e.subVectors(b, a);
    q.subVectors(p, a);
    if (x.crossVectors(e, q).dot(normal) < -1e-3 * e.length()) return null;
  }
  return t;
}

/** True when a box can be within `reach` pixels of the cursor (its projected corners, padded). */
export function boxNearCursor(box: Box3, view: SnapView, cursor: Vector2, reach: number): boolean {
  if (box.isEmpty()) return false;
  if (box.containsPoint(view.ray.origin) || view.ray.intersectsBox(box)) return true;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const s = view.project(new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    if (!s) return true;
    x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
  }
  return cursor.x >= x0 - reach && cursor.x <= x1 + reach && cursor.y >= y0 - reach && cursor.y <= y1 + reach;
}

/**
 * Targets near the cursor and the best one: the nearest corner within `reach`, else the nearest edge, else the
 * face the cursor ray hits first. Corners and edges behind the first face hit are hidden by it. A grabbed face
 * only lands flush, so then only faces turned against it count.
 */
export function findTargets(shapes: SnapShape[], view: SnapView, cursor: Vector2, opts: { kinds?: SnapKinds; reach?: number; grabbed?: Handle } = {}): { best: Target | null; candidates: Target[] } {
  const kinds = opts.kinds ?? ALL_KINDS, reach = opts.reach ?? REACH, ray = view.ray;
  let face: Target | null = null, faceT = Infinity;
  for (const shape of shapes) {
    for (const f of shape.faces) {
      const t = hitFace(ray, f.normal, f.verts);
      if (t !== null && t < faceT) { faceT = t; face = { kind: 'face', shape, point: ray.at(t, new Vector3()), normal: f.normal.clone(), verts: f.verts, dist: 0 }; }
    }
  }
  // Depth along the ray past which corners and edges are behind the nearest face.
  const limit = faceT === Infinity ? Infinity : faceT * 1.002 + 8;
  const depth = (p: Vector3) => p.clone().sub(ray.origin).dot(ray.direction);
  const verts: Target[] = [], edges: Target[] = [];
  for (const shape of shapes) {
    if (kinds.vertex) {
      for (const v of shape.verts) {
        const s = view.project(v);
        if (!s) continue;
        const d = s.distanceTo(cursor);
        const z = depth(v);
        if (d <= reach && z <= limit) verts.push({ kind: 'vertex', shape, point: v.clone(), dist: d, depth: z });
      }
    }
    if (kinds.edge) {
      for (const [a, b] of shape.edges) {
        const sa = view.project(a), sb = view.project(b);
        if (!sa || !sb) continue;
        const d = segDist(cursor, sa, sb);
        if (d > reach) continue;
        const on = new Vector3();
        ray.distanceSqToSegment(a, b, undefined, on);
        const z = depth(on);
        if (z <= limit) edges.push({ kind: 'edge', shape, point: a.clone().add(b).multiplyScalar(0.5), a: a.clone(), b: b.clone(), dist: d, depth: z });
      }
    }
  }
  const byDist = (x: Target, y: Target) => (Math.abs(x.dist - y.dist) < 1 ? x.depth! - y.depth! : x.dist - y.dist);
  verts.sort(byDist);
  edges.sort(byDist);
  const g = opts.grabbed;
  const flush = !g || g.kind !== 'face' || (!!face && face.normal!.dot(g.normal!) < -0.999);
  const faceOk = kinds.face && face && flush ? face : null;
  const candidates = [...verts, ...edges, ...(faceOk ? [faceOk] : [])];
  return { best: verts[0] ?? edges[0] ?? faceOk ?? null, candidates };
}

/** Index of the largest component of `v` by size. */
const dominant = (v: Vector3) => {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  return ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
};

/**
 * The plane the grabbed point follows the mouse on when nothing is in reach: level through the point, unless the
 * camera looks nearly level, then upright facing the camera. Keep height (Ctrl) is always level.
 */
export function dragPlaneNormal(forward: Vector3, keepHeight: boolean): Vector3 {
  if (keepHeight || Math.abs(forward.z) > 0.35) return new Vector3(0, 0, 1);
  const n = new Vector3(-forward.x, -forward.y, 0);
  return n.lengthSq() > 1e-9 ? n.normalize() : new Vector3(0, 0, 1);
}

export interface SnapResult {
  kind: SnapKind;
  /** The offset to move the selection by. */
  delta: Vector3;
  /** Where the grabbed handle ends up. */
  landing: Vector3;
}

/**
 * The offset that puts the grabbed handle on the target:
 * - corner (any handle onto a corner): exactly on it;
 * - edge: onto the point of the edge nearest the cursor, in grid steps from its end (an edge grabbed onto an edge
 *   steps from the middle, so the middles line up first);
 * - face: where the cursor ray hits, the slide on the face in grid steps (a face onto a face lands flush);
 * - nothing: the grabbed point follows the mouse on `planeNormal` and snaps to the grid (unless grid is off).
 */
export function resolveSnap(grabbed: Handle, target: Target | null, ray: Ray, grid: number, planeNormal: Vector3, useGrid = true): SnapResult | null {
  const h = grabbed.point;
  if (target?.kind === 'vertex') return { kind: 'vertex', delta: target.point.clone().sub(h), landing: target.point.clone() };
  if (target?.kind === 'edge') {
    const a = target.a!, b = target.b!, dir = b.clone().sub(a);
    const on = new Vector3();
    ray.distanceSqToSegment(a, b, undefined, on);
    const k = dominant(dir);
    const base = grabbed.kind === 'edge' ? a.clone().add(b).multiplyScalar(0.5) : a;
    const v = base.getComponent(k) + snapTo(on.getComponent(k) - base.getComponent(k), grid);
    const t = Math.max(0, Math.min(1, (v - a.getComponent(k)) / dir.getComponent(k)));
    const landing = a.clone().addScaledVector(dir, t);
    return { kind: 'edge', delta: landing.clone().sub(h), landing };
  }
  if (target?.kind === 'face') {
    const n = target.normal!, c = n.dot(target.verts![0]);
    const raw = target.point.clone().sub(h);
    const k = dominant(n);
    const d = new Vector3();
    for (let i = 0; i < 3; i++) if (i !== k) d.setComponent(i, snapTo(raw.getComponent(i), grid));
    // The remaining component puts the handle on the plane.
    d.setComponent(k, (c - n.dot(h) - n.dot(d)) / n.getComponent(k));
    return { kind: 'face', delta: d, landing: h.clone().add(d) };
  }
  const t = ray.distanceToPlane(new Plane().setFromNormalAndCoplanarPoint(planeNormal, h));
  if (t === null || !Number.isFinite(t)) return null;
  const p = ray.at(t, new Vector3());
  const landing = useGrid ? new Vector3(snapTo(p.x, grid), snapTo(p.y, grid), snapTo(p.z, grid)) : p.round();
  // Moving on a level plane keeps the height exactly.
  if (Math.abs(planeNormal.z) > 0.999) landing.z = h.z;
  return { kind: 'grid', delta: landing.clone().sub(h), landing };
}

/** Shift: only the axis with the biggest move. Ctrl: keep height. */
export function constrain(delta: Vector3, mods: { oneAxis?: boolean; keepHeight?: boolean }): Vector3 {
  const d = delta.clone();
  if (mods.keepHeight) d.z = 0;
  if (mods.oneAxis) {
    const k = dominant(d);
    for (let i = 0; i < 3; i++) if (i !== k) d.setComponent(i, 0);
  }
  return d;
}

/** Tidy numbers for labels: whole units where close, else two decimals; no "-0". */
export function fmtNum(n: number): string {
  const r = Math.abs(n - Math.round(n)) < 1e-3 ? Math.round(n) : Math.round(n * 100) / 100;
  return (r === 0 ? 0 : r).toString().replace('-', '−');
}
export const fmtVec = (v: Vector3) => `${fmtNum(v.x)} ${fmtNum(v.y)} ${fmtNum(v.z)}`;
