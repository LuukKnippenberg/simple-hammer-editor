import { Vector2, Vector3 } from 'three';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { MapEntity, TexAxis, VmfDocument } from '../vmf/map.ts';
import { planeBrush, type PlaneSpec } from './roofs.ts';
import { hideCoveredFaces } from '../geom/hidden.ts';
import { carriagewayMaterial, decodeMaterials, encodeMaterials, gutterChoice, gutterMaterial, kerbMaterial, pavementMaterial, type RoadMaterials } from './streetMaterials.ts';

/**
 * Roads drawn as a line of points: asphalt, cobble, tram or dirt surfaces, kerbs and pavements, as
 * func_detail brushes. Corners are rounded (filleted) so every piece stays a small convex brush. Roads are
 * rebuilt together: where roads meet, the earlier road's surface wins and kerbs and pavements give way to it,
 * which opens the crossing, while the kerbs run on around the block corners.
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
  /** Carriageway, pavement, kerb and gutter materials and rounded corners (see streetMaterials.ts). */
  materials?: RoadMaterials;
  /** A railway's tracks: the sketch lays rails along them (not stored with the road). */
  tracks?: number;
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
  const parts = [r.style, r.width, r.pavement, r.radius, flags, r.lift ?? '', pts];
  const m = encodeMaterials(r.materials);
  return (m ? [...parts, m] : parts).join('|');
}

export function decodeRoad(s: string): RoadSpec | null {
  const [style, width, pavement, radius, flags, lift, pts, materials] = s.split('|');
  if (!(style in ROAD_STYLES) || !pts) return null;
  const points = pts.split(';').map((p) => { const [x, y, z] = p.split(' ').map(Number); return new Vector3(x, y, z); });
  const r: RoadSpec = { style: style as RoadStyle, width: Number(width), pavement: Number(pavement), radius: Number(radius), points };
  if (flags?.includes('k')) r.kerbs = true;
  if (flags?.includes('K')) r.kerbs = false;
  if (flags?.includes('l')) r.lined = true;
  if (flags?.includes('L')) r.lined = false;
  if (lift) r.lift = Number(lift);
  const m = decodeMaterials(materials);
  if (m) r.materials = m;
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
  /** A gutter strip: part of the carriageway in its own material. */
  gutter?: boolean;
  /** A corner fillet: textured world-aligned, not along the road. */
  corner?: boolean;
  /**
   * A pavement or gutter strip: its texture runs along the road and fits across the strip, starting at `at` (a point
   * on the strip's kerb side) and going `across` (away from the kerb). `width` is the strip's width.
   */
  tex?: { at: Vector2; across: Vector2; width: number };
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
  // Bands across the road: [from, to, kind, top, gutter, kerb side]. A gutter strip runs along each kerb inside the
  // carriageway. Gutters and pavements note which of their edges is the kerb's, for their textures.
  const g = kerbs && gutterMaterial(r.materials?.gutter) ? Math.min(r.materials?.gutterWidth ?? 32, w / 3) : 0;
  const bands: [number, number, Kind, number, boolean?, number?][] = g
    ? [[-w + g, w - g, 'surface', 0], [w - g, w, 'surface', 0, true, w], [-w, -w + g, 'surface', 0, true, -w]]
    : [[-w, w, 'surface', 0]];
  if (kerbs) bands.push([w, w + KERB_W, 'kerb', kerbTop], [-w - KERB_W, -w, 'kerb', kerbTop]);
  if (r.pavement > 0) {
    const k = kerbs ? KERB_W : 0;
    bands.push([w + k, w + k + r.pavement, 'pavement', kerbTop, false, w + k], [-w - k - r.pavement, -w - k, 'pavement', kerbTop, false, -w - k]);
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
    for (const [d0, d1, kind, top, gutter, edge] of bands) {
      const l0 = off(d0), l1 = off(d1);
      const poly = ccwPoly([l0[i], l0[i + 1], l1[i + 1], l1[i]].map((p) => p.clone()));
      if (Math.abs(area(poly)) < 1) continue;
      // Away from the kerb: outwards for a pavement, in towards the middle for a gutter.
      const away = edge === undefined ? 0 : (edge === d0 ? 1 : -1);
      const tex = edge === undefined ? undefined
        : { at: off(edge)[i].clone(), across: new Vector2(-seg.dir.y, seg.dir.x).multiplyScalar(away), width: Math.abs(d1 - d0) };
      pieces.push({ road: index, kind, poly, seg, top, gutter, tex });
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
  const m = r.materials;
  if (piece.kind === 'surface' && piece.gutter) {
    top = gutterMaterial(m?.gutter) ?? st.surface;
  } else if (piece.kind === 'surface') {
    // A chosen carriageway material has no centre line, except the lined asphalt.
    const own = carriagewayMaterial(m?.carriageway);
    const lined = !piece.corner && (own ? own === ROAD_STYLES.asphalt.surface && (r.lined ?? true) : r.lined ?? st.lined);
    top = own ?? (lined ? st.surface : st.surface === ROAD_STYLES.asphalt.surface ? PLAIN_ASPHALT : st.surface);
    if (own === ROAD_STYLES.asphalt.surface && !lined) top = PLAIN_ASPHALT;
    if (lined) {
      // One texture tile across the carriageway puts the dashed line on the centre; dashes run along the road.
      const across = new Vector3(-s.dir.y, s.dir.x, 0), along = new Vector3(s.dir.x, s.dir.y, 0);
      const uScale = r.width / 512, vScale = 0.5;
      const uShift = 256 - (s.a.x * across.x + s.a.y * across.y) / uScale;
      const vShift = s.along / vScale - (s.a.x * along.x + s.a.y * along.y) / vScale;
      axes = { u: { axis: across, shift: ((uShift % 512) + 512) % 512, scale: uScale }, v: { axis: along, shift: ((vShift % 512) + 512) % 512, scale: vScale } };
    }
  } else if (piece.kind === 'kerb') { top = kerbMaterial(m?.kerb) ?? KERB; side = top; }
  else if (piece.kind === 'pavement') { top = pavementMaterial(m?.pavement) ?? PAVEMENT; side = kerbMaterial(m?.kerb) ?? KERB; }
  else { top = RAIL; side = RAIL; }
  if (piece.tex && (piece.kind === 'pavement' || piece.gutter)) axes = stripAxes(piece, s, m);
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

/** Texels across a pavement texture (they are all 512 square). */
const PAVEMENT_TEX = 512;

/**
 * Texture axes for a pavement or gutter strip: the texture runs along the road and starts at the kerb, so the
 * pattern lines up with the strip instead of the world. A pavement takes whole tiles across its width (square slabs
 * with their border strips along both edges); a gutter with a strip texture shows that strip only.
 */
function stripAxes(piece: Piece, s: Seg, m: RoadMaterials | undefined): { u: TexAxis; v: TexAxis } {
  const t = piece.tex!;
  let scale: number, texW: number;
  if (piece.gutter) {
    const g = gutterChoice(m?.gutter);
    texW = g?.width ?? 512;
    scale = g?.strip ? t.width / (g.strip * texW) : 0.25;
  } else {
    texW = PAVEMENT_TEX;
    scale = t.width / (Math.max(1, Math.round(t.width / 128)) * texW);
  }
  const mod = (x: number, n: number) => ((x % n) + n) % n;
  const across = new Vector3(t.across.x, t.across.y, 0), along = new Vector3(s.dir.x, s.dir.y, 0);
  return {
    u: { axis: across, scale, shift: mod(-(t.at.x * t.across.x + t.at.y * t.across.y) / scale, texW) },
    // Along the road like the centre line's dashes: collinear pieces continue the same pattern.
    v: { axis: along, scale, shift: mod(s.along / scale - (s.a.x * s.dir.x + s.a.y * s.dir.y) / scale, 512) },
  };
}

/**
 * Brushes for a set of roads, one list per road. Kerbs and pavements give way to other roads' surfaces, which
 * opens crossings, and pavements give way to other roads' kerbs, so the kerb runs on around a block corner.
 * Otherwise later roads give way to earlier ones (surface to surface, kerb to kerb, pavement to pavement), so
 * no two brushes overlap.
 */
export function buildRoads(doc: VmfDocument, roads: RoadSpec[]): KVNode[][] {
  const all = roads.map((r, i) => (r.points.length >= 2 ? roadPieces(r, i) : []));
  // Rounded kerbs where two straight streets cross: the corner squares are cut out of the kerbs and pavements
  // and filled with a fillet of carriageway, a curved kerb and a quarter disc of pavement.
  const corners = cornerFillets(roads);
  for (const c of corners) all[c.road].push(...c.pieces);
  // Corner pieces lie inside the corner squares, which are cut out of everything else: they cut nothing themselves.
  const of = (kind: Kind) => all.flat().filter((p) => p.kind === kind && !p.corner);
  const surfaces = of('surface'), kerbs = of('kerb'), pavements = of('pavement');
  const built = roads.map((r, i) => {
    const out: KVNode[] = [];
    for (const piece of all[i]) {
      // Corner fillets were fitted into the corner squares already.
      const cutters = piece.corner ? [] : piece.kind === 'surface' ? surfaces.filter((c) => c.road < i)
        : piece.kind === 'kerb' ? [...surfaces.filter((c) => c.road !== i), ...kerbs.filter((c) => c.road < i)]
          : piece.kind === 'pavement' ? [...surfaces, ...kerbs].filter((c) => c.road !== i).concat(pavements.filter((c) => c.road < i))
            : [];
      let polys = [piece.poly];
      if ((piece.kind === 'kerb' || piece.kind === 'pavement') && !piece.corner) for (const c of corners) polys = polys.flatMap((p) => subtract(p, c.square));
      for (const c of cutters) polys = polys.flatMap((p) => subtract(p, c.poly));
      for (const poly of polys) {
        if (Math.abs(area(poly)) < 4) continue;
        const brush = pieceBrush(doc, { ...piece, poly }, r);
        if (brush) out.push(brush);
      }
    }
    return out;
  });
  // Kerbs against pavements, pieces meeting along a road and in its bends: those faces are never seen.
  hideCoveredFaces(built.flat());
  return built;
}

/** Arc steps of a rounded corner. */
const CORNER_STEPS = 6;

/**
 * Rounded corners where two straight, axis-aligned streets with kerbs cross or meet (a T): one per corner where
 * both kerbs run on past the corner. The radius is the larger of the two roads' `materials.corner`, at most the
 * kerb and pavement width.
 */
export function cornerFillets(roads: RoadSpec[]): { road: number; square: Vector2[]; pieces: Piece[] }[] {
  const out: { road: number; square: Vector2[]; pieces: Piece[] }[] = [];
  const straight = (r: RoadSpec) => {
    if (r.points.length !== 2 || !(r.kerbs ?? ROAD_STYLES[r.style].kerb)) return null;
    const [a, b] = r.points;
    if (Math.abs(a.y - b.y) < 0.5) return { axis: 'x' as const, at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), z: (a.z + b.z) / 2 };
    if (Math.abs(a.x - b.x) < 0.5) return { axis: 'y' as const, at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), z: (a.z + b.z) / 2 };
    return null;
  };
  const lines = roads.map(straight);
  for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) {
    const li = lines[i], lj = lines[j];
    if (!li || !lj || li.axis === lj.axis) continue;
    const [ai, bi] = li.axis === 'x' ? [i, j] : [j, i];
    const A = lines[ai]!, B = lines[bi]!, ra = roads[ai], rb = roads[bi];
    const want = Math.max(ra.materials?.corner ?? 0, rb.materials?.corner ?? 0);
    if (want <= 0) continue;
    const wa = ra.width / 2, wb = rb.width / 2;
    // The streets must meet: B's line within A's extent and the other way round, give or take the other's half width
    // (the sketch's street pieces end inside the crossing, not at its centre).
    if (B.at < A.lo - wb || B.at > A.hi + wb || A.at < B.lo - wa || A.at > B.hi + wa) continue;
    const pav = Math.min(ra.pavement, rb.pavement);
    const R = Math.max(KERB_W + 8, Math.min(want, KERB_W + pav));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const c = new Vector2(B.at + sx * wb, A.at + sy * wa);
      // Both kerbs run on past the corner square.
      const aRuns = sx > 0 ? A.hi >= c.x + R + 16 : A.lo <= c.x - R - 16;
      const bRuns = sy > 0 ? B.hi >= c.y + R + 16 : B.lo <= c.y - R - 16;
      if (!aRuns || !bRuns) continue;
      const o = new Vector2(c.x + sx * R, c.y + sy * R);
      const t0 = Math.atan2(-sy, 0), t1 = Math.atan2(0, -sx);
      let d = t1 - t0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const arc = (rad: number) => Array.from({ length: CORNER_STEPS + 1 }, (_, k) => {
        const t = t0 + (d * k) / CORNER_STEPS;
        return new Vector2(o.x + Math.cos(t) * rad, o.y + Math.sin(t) * rad);
      });
      const outer = arc(R), inner = arc(R - KERB_W);
      // Along A (the street running along x), so the pavement's slabs carry on from A's pavement.
      const ax = Math.sign(ra.points[1].x - ra.points[0].x) || 1;
      const seg: Seg = { a: c.clone(), dir: new Vector2(ax, 0), za: A.z, slope: 0, along: c.x * ax };
      const tex = { at: new Vector2(c.x, c.y + sy * KERB_W), across: new Vector2(0, sy), width: ra.pavement };
      const pieces: Piece[] = [];
      const add = (kind: Kind, poly: Vector2[], top: number) => {
        const q = ccwPoly(poly);
        if (Math.abs(area(q)) > 1) pieces.push({ road: ai, kind, poly: q, seg, top, corner: true, ...(kind === 'pavement' ? { tex } : {}) });
      };
      for (let k = 0; k < CORNER_STEPS; k++) {
        add('surface', [c.clone(), outer[k], outer[k + 1]], 0);
        add('kerb', [outer[k], outer[k + 1], inner[k + 1], inner[k]], KERB_H);
        if (pav > 0) add('pavement', [o.clone(), inner[k], inner[k + 1]], KERB_H);
      }
      const square = ccwPoly([c.clone(), new Vector2(o.x, c.y), o.clone(), new Vector2(c.x, o.y)]);
      out.push({ road: ai, square, pieces });
    }
  }
  return out;
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

/** What a road network has under a point: the kind of brush and the height of its top. */
export interface RoadGround { kind: Kind; z: number }

/**
 * Looks up the top of the road brushes under a point, as `buildRoads` makes them, or null off the roads. A
 * road's surface wins over other roads' kerbs and pavements (they give way there); rails stand on it. Inside a
 * rounded corner's square only the corner's own pieces count (the straight kerbs and pavements were cut out there).
 */
export function roadGround(roads: RoadSpec[]): (x: number, y: number) => RoadGround | null {
  const pieces = roads.flatMap((r, i) => (r.points.length >= 2 ? roadPieces(r, i) : []));
  const corners = cornerFillets(roads);
  const lifts = roads.map((r) => r.lift ?? (ROAD_STYLES[r.style].kerb ? LIFT : 1));
  const inside = (poly: Vector2[], p: Vector2) => poly.every((a, i) => cross(a, poly[(i + 1) % poly.length], p) >= -1e-6);
  return (x, y) => {
    const p = new Vector2(x, y);
    const corner = corners.find((c) => inside(c.square, p));
    if (corner) {
      let best: RoadGround | null = null;
      for (const c of corner.pieces) {
        if (!inside(c.poly, p)) continue;
        const z = groundZ(c.seg, p) + lifts[c.road] + c.top;
        if (!best || z > best.z) best = { kind: c.kind, z };
      }
      if (best) return best;
    }
    const hits = pieces.filter((c) => inside(c.poly, p));
    const surfaced = new Set(hits.filter((c) => c.kind === 'surface').map((c) => c.road));
    let best: RoadGround | null = null;
    for (const c of hits) {
      if (surfaced.size && !(surfaced.has(c.road) && (c.kind === 'surface' || c.kind === 'rail'))) continue;
      const z = groundZ(c.seg, p) + lifts[c.road] + c.top;
      if (!best || z > best.z) best = { kind: c.kind, z };
    }
    return best;
  };
}
