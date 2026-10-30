import { Vector2, Vector3 } from 'three';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { MapEntity, TexAxis, VmfDocument } from '../vmf/map.ts';
import { planeBrush, type PlaneSpec } from './roofs.ts';

/**
 * Roads drawn as a line of points: asphalt, cobble, tram or dirt surfaces, kerbs and pavements, as
 * func_detail brushes. Corners are rounded (filleted) so every piece stays a small convex brush. Roads are
 * rebuilt together: where roads meet, the earlier road's surface wins and kerbs and pavements give way, which
 * opens the crossing.
 */

export type RoadStyle = 'asphalt' | 'cobble' | 'tram' | 'dirt';

export const ROAD_STYLES: Record<RoadStyle, {
  label: string; surface: string; lined: boolean; kerb: boolean; width: number; pavement: number; rails: boolean;
}> = {
  asphalt: { label: 'Asphalt road', surface: 'CONCRETE/CONCRETEFLOOR033K', lined: true, kerb: true, width: 256, pavement: 96, rails: false },
  cobble: { label: 'Cobbled street', surface: 'STONE/STONEFLOOR006A', lined: false, kerb: true, width: 192, pavement: 64, rails: false },
  tram: { label: 'Tram street', surface: 'STONE/STONEFLOOR006A', lined: false, kerb: true, width: 320, pavement: 96, rails: true },
  dirt: { label: 'Dirt track', surface: 'NATURE/DIRTFLOOR005C', lined: false, kerb: false, width: 160, pavement: 0, rails: false },
};

const PLAIN_ASPHALT = 'CONCRETE/CONCRETEFLOOR033A';
const KERB = 'CONCRETE/CONCRETEFLOOR027A';
const PAVEMENT = 'CONCRETE/CONCRETEFLOOR028A';
const RAIL = 'METAL/METALTRACK001A';
const NODRAW = 'TOOLS/TOOLSNODRAW';
const KERB_W = 8;
const KERB_H = 8;
/** How far the road top stands above the picked ground (keeps it clear of the ground's own faces). */
const LIFT = 2;
const DEPTH = 8;

export interface RoadSpec {
  /** Control points; their z is the ground height. */
  points: Vector3[];
  style: RoadStyle;
  /** Carriageway width. */
  width: number;
  /** Pavement width on each side (0 for none). */
  pavement: number;
  /** Corner radius at bends. */
  radius: number;
  /** Override: kerbs (default from the style). */
  kerbs?: boolean;
  /** Override: centre line (default from the style). */
  lined?: boolean;
  lift?: number;
}

export function defaultRoad(style: RoadStyle, points: Vector3[] = []): RoadSpec {
  const s = ROAD_STYLES[style];
  return { points, style, width: s.width, pavement: s.pavement, radius: Math.max(128, s.width) };
}

// --- Storage on the road's func_detail -----------------------------------------------------------------

const KEY = 'she_road';

export function encodeRoad(r: RoadSpec): string {
  const pts = r.points.map((p) => `${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`).join(';');
  const flags = `${r.kerbs === undefined ? '' : r.kerbs ? 'k' : 'K'}${r.lined === undefined ? '' : r.lined ? 'l' : 'L'}`;
  return [r.style, r.width, r.pavement, r.radius, flags, r.lift ?? '', pts].join('|');
}

export function decodeRoad(s: string): RoadSpec | null {
  const [style, width, pavement, radius, flags, lift, pts] = s.split('|');
  if (!(style in ROAD_STYLES) || !pts) return null;
  const points = pts.split(';').map((p) => { const [x, y, z] = p.split(' ').map(Number); return new Vector3(x, y, z); });
  const r: RoadSpec = { style: style as RoadStyle, width: Number(width), pavement: Number(pavement), radius: Number(radius), points };
  if (flags?.includes('k')) r.kerbs = true;
  if (flags?.includes('K')) r.kerbs = false;
  if (flags?.includes('l')) r.lined = true;
  if (flags?.includes('L')) r.lined = false;
  if (lift) r.lift = Number(lift);
  return r;
}

export function roadOf(e: MapEntity): RoadSpec | null {
  const v = e.classname === 'func_detail' ? e.get(KEY) : undefined;
  return v ? decodeRoad(v) : null;
}

// --- Centre line ------------------------------------------------------------------------------------------

const v2 = (p: Vector3) => new Vector2(p.x, p.y);

/** The control points with rounded corners: each bend becomes an arc of at most `radius`. */
export function centreline(points: Vector3[], radius: number): Vector3[] {
  if (points.length < 3 || radius <= 0) return points.map((p) => p.clone());
  const out: Vector3[] = [points[0].clone()];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const d1 = v2(b).sub(v2(a)), d2 = v2(c).sub(v2(b));
    const l1 = d1.length(), l2 = d2.length();
    d1.normalize(); d2.normalize();
    const turn = Math.atan2(d1.x * d2.y - d1.y * d2.x, d1.dot(d2));
    if (Math.abs(turn) < 0.05 || l1 < 1 || l2 < 1) { out.push(b.clone()); continue; }
    const half = Math.tan(Math.abs(turn) / 2);
    const t = Math.min(radius * half, l1 / 2, l2 / 2);
    const r = t / half;
    const p1 = v2(b).addScaledVector(d1, -t);
    const z1 = b.z + (a.z - b.z) * (t / l1), z2 = b.z + (c.z - b.z) * (t / l2);
    // The arc's centre lies on the inside of the turn.
    const side = Math.sign(turn);
    const centre = p1.clone().add(new Vector2(-d1.y * side, d1.x * side).multiplyScalar(r));
    const a0 = Math.atan2(p1.y - centre.y, p1.x - centre.x);
    const n = Math.max(2, Math.ceil((Math.abs(turn) * r) / 48));
    for (let k = 0; k <= n; k++) {
      const ang = a0 + (turn * k) / n;
      out.push(new Vector3(centre.x + Math.cos(ang) * r, centre.y + Math.sin(ang) * r, z1 + ((z2 - z1) * k) / n));
    }
  }
  out.push(points[points.length - 1].clone());
  return out.filter((p, i) => i === 0 || p.distanceTo(out[i - 1]) > 0.5);
}

/** The line offset sideways by `d` (positive: left of the direction of travel), mitred at the joints. */
export function offsetLine(pts: Vector3[], d: number): Vector2[] {
  const n = pts.length;
  const normal = (i: number) => {
    const dir = v2(pts[i + 1]).sub(v2(pts[i])).normalize();
    return new Vector2(-dir.y, dir.x);
  };
  return pts.map((p, i) => {
    if (i === 0) return v2(p).addScaledVector(normal(0), d);
    if (i === n - 1) return v2(p).addScaledVector(normal(n - 2), d);
    const n1 = normal(i - 1), n2 = normal(i);
    const m = n1.clone().add(n2).normalize();
    const k = Math.min(2, 1 / Math.max(0.5, m.dot(n2)));
    return v2(p).addScaledVector(m, d * k);
  });
}

// --- Pieces and clipping ------------------------------------------------------------------------------------

type Kind = 'surface' | 'kerb' | 'pavement' | 'rail';

interface Seg { a: Vector2; dir: Vector2; za: number; slope: number; along: number }

interface Piece {
  road: number;
  kind: Kind;
  poly: Vector2[];
  seg: Seg;
  /** Top height above the segment's ground plane. */
  top: number;
}

const cross = (o: Vector2, a: Vector2, b: Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function area(poly: Vector2[]): number {
  let s = 0;
  poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; });
  return s / 2;
}

/** Keeps the part of a convex polygon on the left of p→q (or the right). */
function clipHalf(poly: Vector2[], p: Vector2, q: Vector2, left: boolean): Vector2[] {
  const out: Vector2[] = [];
  const side = (x: Vector2) => (left ? 1 : -1) * cross(p, q, x);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa >= -1e-6) out.push(a);
    if ((sa > 1e-6 && sb < -1e-6) || (sa < -1e-6 && sb > 1e-6)) out.push(a.clone().lerp(b, sa / (sa - sb)));
  }
  return out;
}

/** A minus B for convex counter-clockwise polygons, as convex pieces. */
export function subtract(a: Vector2[], b: Vector2[]): Vector2[][] {
  const box = (p: Vector2[]) => [Math.min(...p.map((v) => v.x)), Math.min(...p.map((v) => v.y)), Math.max(...p.map((v) => v.x)), Math.max(...p.map((v) => v.y))];
  const [ax0, ay0, ax1, ay1] = box(a), [bx0, by0, bx1, by1] = box(b);
  if (ax1 <= bx0 || bx1 <= ax0 || ay1 <= by0 || by1 <= ay0) return [a];
  const out: Vector2[][] = [];
  let rest = a;
  for (let i = 0; i < b.length && rest.length >= 3; i++) {
    const p = b[i], q = b[(i + 1) % b.length];
    const outside = clipHalf(rest, p, q, false);
    if (outside.length >= 3 && area(outside) > 1) out.push(outside);
    rest = clipHalf(rest, p, q, true);
  }
  // Nothing of A inside B: keep A whole rather than a split copy of it.
  return rest.length >= 3 && area(rest) > 1 ? out : [a];
}

function ccwPoly(p: Vector2[]): Vector2[] {
  return area(p) < 0 ? [...p].reverse() : p;
}

/** All pieces of one road before clipping. */
function roadPieces(r: RoadSpec, index: number): Piece[] {
  const st = ROAD_STYLES[r.style];
  // Long straights are cut into pieces of at most 512 units: very long faces collect more t-junctions
  // from the brushes along their edges than vbsp can fix.
  const line: Vector3[] = [];
  centreline(r.points, r.radius).forEach((p, i, all) => {
    if (i > 0) {
      const prev = all[i - 1];
      const n = Math.ceil(v2(p).distanceTo(v2(prev)) / 512);
      for (let k = 1; k < n; k++) line.push(prev.clone().lerp(p, k / n));
    }
    line.push(p);
  });
  const pieces: Piece[] = [];
  const w = r.width / 2;
  const kerbs = r.kerbs ?? st.kerb;
  const kerbTop = kerbs ? KERB_H : 0;
  // Bands across the road: [from, to, kind, top].
  const bands: [number, number, Kind, number][] = [[-w, w, 'surface', 0]];
  if (kerbs) bands.push([w, w + KERB_W, 'kerb', kerbTop], [-w - KERB_W, -w, 'kerb', kerbTop]);
  if (r.pavement > 0) {
    const k = kerbs ? KERB_W : 0;
    bands.push([w + k, w + k + r.pavement, 'pavement', kerbTop], [-w - k - r.pavement, -w - k, 'pavement', kerbTop]);
  }
  if (st.rails) {
    // Two tracks, standard gauge (about 56 units between rails).
    for (const track of [-w / 2.5, w / 2.5]) for (const rail of [-28, 28]) bands.push([track + rail - 3, track + rail + 3, 'rail', 4]);
  }
  const offsets = new Map<number, Vector2[]>();
  const off = (d: number) => {
    if (!offsets.has(d)) offsets.set(d, offsetLine(line, d));
    return offsets.get(d)!;
  };
  // Distance along the road, starting from the first point's position on its own axis, so the dashes of
  // collinear roads (sketch roads are built in pieces) line up.
  const dir0 = line.length > 1 ? v2(line[1]).sub(v2(line[0])).normalize() : new Vector2(1, 0);
  let along = v2(line[0]).dot(dir0);
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const len = v2(b).distanceTo(v2(a));
    const seg: Seg = { a: v2(a), dir: v2(b).sub(v2(a)).normalize(), za: a.z, slope: len > 0 ? (b.z - a.z) / len : 0, along };
    for (const [d0, d1, kind, top] of bands) {
      const l0 = off(d0), l1 = off(d1);
      const poly = ccwPoly([l0[i], l0[i + 1], l1[i + 1], l1[i]].map((p) => p.clone()));
      if (Math.abs(area(poly)) > 1) pieces.push({ road: index, kind, poly, seg, top });
    }
    along += len;
  }
  return pieces;
}

/** Height of a piece's ground plane at `p`. */
const groundZ = (s: Seg, p: Vector2) => s.za + s.slope * new Vector2().subVectors(p, s.a).dot(s.dir);

function pieceBrush(doc: VmfDocument, piece: Piece, r: RoadSpec): KVNode | null {
  const st = ROAD_STYLES[r.style];
  const s = piece.seg;
  // Dirt lies almost flush with the ground.
  const lift = r.lift ?? (st.kerb ? LIFT : 1);
  const topZ = s.za + lift + piece.top;
  const lowest = Math.min(...piece.poly.map((p) => groundZ(s, p))) - DEPTH;
  const normal = new Vector3(-s.slope * s.dir.x, -s.slope * s.dir.y, 1).normalize();
  let top = st.surface, side = NODRAW;
  let axes: { u?: TexAxis; v?: TexAxis } = {};
  if (piece.kind === 'surface') {
    const lined = r.lined ?? st.lined;
    top = lined ? st.surface : st.surface === ROAD_STYLES.asphalt.surface ? PLAIN_ASPHALT : st.surface;
    if (lined) {
      // One texture tile across the carriageway puts the dashed line on the centre; dashes run along the road.
      const across = new Vector3(-s.dir.y, s.dir.x, 0), along = new Vector3(s.dir.x, s.dir.y, 0);
      const uScale = r.width / 512, vScale = 0.5;
      const uShift = 256 - (s.a.x * across.x + s.a.y * across.y) / uScale;
      const vShift = s.along / vScale - (s.a.x * along.x + s.a.y * along.y) / vScale;
      axes = { u: { axis: across, shift: ((uShift % 512) + 512) % 512, scale: uScale }, v: { axis: along, shift: ((vShift % 512) + 512) % 512, scale: vScale } };
    }
  } else if (piece.kind === 'kerb') { top = KERB; side = KERB; }
  else if (piece.kind === 'pavement') { top = PAVEMENT; side = KERB; }
  else { top = RAIL; side = RAIL; }
  const planes: PlaneSpec[] = [
    { point: new Vector3(s.a.x, s.a.y, topZ), normal, material: top, ...axes },
    { point: new Vector3(s.a.x, s.a.y, lowest), normal: new Vector3(0, 0, -1), material: NODRAW },
  ];
  const poly = piece.poly;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const d = new Vector2().subVectors(b, a).normalize();
    if (d.lengthSq() === 0) return;
    planes.push({ point: new Vector3(a.x, a.y, lowest), normal: new Vector3(d.y, -d.x, 0), material: side });
  });
  return planeBrush(doc, planes);
}

/**
 * Brushes for a set of roads, one list per road. Surfaces of later roads give way to earlier ones; kerbs and
 * pavements give way to other roads' surfaces (and kerbs to other roads' pavements), which opens crossings.
 */
export function buildRoads(doc: VmfDocument, roads: RoadSpec[]): KVNode[][] {
  const all = roads.map((r, i) => (r.points.length >= 2 ? roadPieces(r, i) : []));
  const surfaces = all.flat().filter((p) => p.kind === 'surface');
  const pavements = all.flat().filter((p) => p.kind === 'pavement');
  return roads.map((r, i) => {
    const out: KVNode[] = [];
    for (const piece of all[i]) {
      const cutters = piece.kind === 'surface' ? surfaces.filter((c) => c.road < i)
        : piece.kind === 'pavement' ? surfaces.filter((c) => c.road !== i)
          : piece.kind === 'kerb' ? [...surfaces, ...pavements].filter((c) => c.road !== i)
            : [];
      let polys = [piece.poly];
      for (const c of cutters) polys = polys.flatMap((p) => subtract(p, c.poly));
      for (const poly of polys) {
        if (Math.abs(area(poly)) < 4) continue;
        const brush = pieceBrush(doc, { ...piece, poly }, r);
        if (brush) out.push(brush);
      }
    }
    return out;
  });
}

/** A func_detail node carrying a road's brushes and its definition. */
export function roadEntityNode(doc: VmfDocument, r: RoadSpec, solids: KVNode[]): KVNode {
  const e = new KVNode('entity');
  e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', 'func_detail'), new KVPair(KEY, encodeRoad(r)), ...solids);
  const ed = new KVNode('editor');
  ed.items.push(new KVPair('color', '200 160 60'), new KVPair('visgroupshown', '1'), new KVPair('visgroupautoshown', '1'), new KVPair('logicalpos', '[0 0]'));
  e.items.push(ed);
  return e;
}

/** Replaces the brushes of a road entity node with new ones (keeps its other keys and editor block). */
export function setRoadSolids(node: KVNode, r: RoadSpec, solids: KVNode[]): void {
  node.items = node.items.filter((it) => !(it instanceof KVNode && it.name.toLowerCase() === 'solid'));
  node.set(KEY, encodeRoad(r));
  const ed = node.items.findIndex((it) => it instanceof KVNode && it.name.toLowerCase() === 'editor');
  node.items.splice(ed >= 0 ? ed : node.items.length, 0, ...solids);
}

/**
 * The nearest point on any road's centre line within `max` units (for joining roads), with that road's z.
 * Ends of roads are preferred, so a new road continues an old one cleanly.
 */
export function snapToRoads(roads: RoadSpec[], p: Vector3, max: number): Vector3 | null {
  let best: Vector3 | null = null, bestD = max;
  for (const r of roads) {
    for (const end of [r.points[0], r.points[r.points.length - 1]]) {
      const d = v2(end).distanceTo(v2(p));
      if (d < Math.min(bestD, 64)) { best = end.clone(); bestD = d * 0.5; }
    }
    const line = centreline(r.points, r.radius);
    for (let i = 0; i + 1 < line.length; i++) {
      const a = v2(line[i]), b = v2(line[i + 1]);
      const ab = new Vector2().subVectors(b, a);
      const t = Math.max(0, Math.min(1, new Vector2().subVectors(v2(p), a).dot(ab) / (ab.lengthSq() || 1)));
      const q = a.clone().addScaledVector(ab, t);
      const d = q.distanceTo(v2(p));
      if (d < bestD) { bestD = d; best = new Vector3(q.x, q.y, line[i].z + (line[i + 1].z - line[i].z) * t); }
    }
  }
  return best ? new Vector3(Math.round(best.x), Math.round(best.y), Math.round(best.z)) : null;
}
