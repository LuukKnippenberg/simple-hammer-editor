import { Euler, Quaternion, Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import { MapSolid, parseVec, vecStr } from '../vmf/map.ts';
import { prismFaces, rotateSolid } from '../edit/brushes.ts';

/**
 * Free rotation for generators that lay out in axis-aligned rectangles (POIs, blocks of buildings).
 *
 * An angle is split into a quarter turn (0, 90, 180, 270), which the generator handles itself exactly as before,
 * and a fine turn of at most ±45° that turns the finished output rigidly about the rectangle's centre: brush
 * planes and their texture axes (texture lock, so materials turn with the brush), entity origins, angles and
 * overlay bases. Angles that are whole quarter turns have no fine turn, so their output is what it always was.
 */

/** A turn about the vertical axis through (x, y), `deg` degrees counter-clockwise seen from above. */
export interface Turn { x: number; y: number; deg: number }

export interface TurnRect { x0: number; y0: number; x1: number; y1: number }

const D = Math.PI / 180;

/** An angle in [0, 360), to a tenth of a degree. */
export function normAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const r = Math.round(deg * 10) / 10;
  return Math.round((((r % 360) + 360) % 360) * 10) / 10 % 360 || 0;
}

/** Splits an angle into its nearest quarter turn and the rest (-45 < fine ≤ 45). */
export function splitAngle(deg: number): { quarter: 0 | 90 | 180 | 270; fine: number } {
  const a = normAngle(deg);
  const q = (((Math.round(a / 90) % 4) + 4) % 4) * 90 as 0 | 90 | 180 | 270;
  let fine = Math.round((a - q) * 10) / 10;
  if (fine > 180) fine -= 360;
  if (fine <= -180) fine += 360;
  return { quarter: q, fine };
}

/** True when the angle swaps the rectangle's width and depth (its quarter turn is 90 or 270). */
export const swapsSides = (deg: number): boolean => splitAngle(deg).quarter % 180 === 90;

export const rectCentre = (r: TurnRect): [number, number] => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];

/** The fine turn of a rectangle laid out at `deg`, or null when there is none. */
export function fineTurn(r: TurnRect, deg: number): Turn | null {
  const { fine } = splitAngle(deg);
  if (!fine) return null;
  const [x, y] = rectCentre(r);
  return { x, y, deg: fine };
}

export function turnPoint(t: Turn, x: number, y: number): [number, number] {
  const c = Math.cos(t.deg * D), s = Math.sin(t.deg * D);
  const dx = x - t.x, dy = y - t.y;
  return [t.x + dx * c - dy * s, t.y + dx * s + dy * c];
}

/** The inverse turn. */
export const unturn = (t: Turn): Turn => ({ ...t, deg: -t.deg });

/** A rectangle's corners turned (counter-clockwise). */
export function turnedCorners(r: TurnRect, t: Turn | null, pad = 0): Vector2[] {
  const pts: [number, number][] = [[r.x0 - pad, r.y0 - pad], [r.x1 + pad, r.y0 - pad], [r.x1 + pad, r.y1 + pad], [r.x0 - pad, r.y1 + pad]];
  return pts.map(([x, y]) => (t ? new Vector2(...turnPoint(t, x, y)) : new Vector2(x, y)));
}

/** The axis-aligned box round a turned rectangle. */
export function turnedBounds(r: TurnRect, t: Turn | null, pad = 0): TurnRect {
  const c = turnedCorners(r, t, pad);
  return { x0: Math.min(...c.map((p) => p.x)), y0: Math.min(...c.map((p) => p.y)), x1: Math.max(...c.map((p) => p.x)), y1: Math.max(...c.map((p) => p.y)) };
}

/** How far a point lies outside a turned rectangle, measured in the rectangle's own frame (0 inside). */
export function outsideTurned(r: TurnRect, t: Turn | null, x: number, y: number): number {
  const [lx, ly] = t ? turnPoint(unturn(t), x, y) : [x, y];
  return Math.max(r.x0 - lx, lx - r.x1, r.y0 - ly, ly - r.y1, 0);
}

export const insideTurned = (r: TurnRect, t: Turn | null, x: number, y: number): boolean => outsideTurned(r, t, x, y) <= 0;

/** A vertical prism's faces over a turned rectangle (a handle box that follows its owner's angle). */
export function turnedBoxFaces(r: TurnRect, t: Turn | null, z0: number, z1: number, material: string, pad = 0): ReturnType<typeof prismFaces> {
  return prismFaces(turnedCorners(r, t, pad), z0, z1, { top: material, bottom: material, sides: material });
}

/** Turns a brush node in place: its planes and, with texture lock, its texture axes. */
export function turnSolidNode(node: KVNode, t: Turn): void {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), t.deg * D);
  rotateSolid(new MapSolid(node, null), new Vector3(t.x, t.y, 0), q, true);
}

const wrap = (deg: number) => {
  const r = Math.round(deg * 1000) / 1000;
  return ((r % 360) + 360) % 360 || 0;
};
const num = (v: number) => String(Math.round(v * 1000) / 1000);

/** Source "pitch yaw roll" angles turned about the vertical axis. */
export function turnAngles(a: Vector3, deg: number): Vector3 {
  if (!a.x && !a.z) return new Vector3(0, wrap(a.y + deg), 0);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), deg * D);
  const cur = new Quaternion().setFromEuler(new Euler(a.z * D, a.x * D, a.y * D, 'ZYX'));
  const r = new Euler().setFromQuaternion(q.multiply(cur), 'ZYX');
  return new Vector3(wrap(r.y / D), wrap(r.z / D), wrap(r.x / D));
}

/**
 * A generated entity turned: its origin goes round the pivot, `angles` (or a lone `angle` yaw) turn with it,
 * an overlay's basis turns, and a brush entity's brushes turn. Returns new values; brush nodes turn in place.
 */
export function turnEntity<E extends { classname: string; origin?: Vector3 | null; keys: Record<string, string>; solids?: KVNode[] }>(e: E, t: Turn): E {
  const out = { ...e, keys: { ...e.keys } };
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), t.deg * D);
  const pivot = new Vector3(t.x, t.y, 0);
  const at = (v: Vector3) => v.clone().sub(pivot).applyQuaternion(q).add(pivot);
  if (e.origin) {
    const o = at(e.origin);
    // Point entities keep whole-unit origins, as the generators make them.
    out.origin = new Vector3(Math.round(o.x), Math.round(o.y), Math.round(o.z));
  }
  const k = out.keys;
  if (e.classname === 'info_overlay') {
    for (const key of ['BasisU', 'BasisV', 'BasisNormal']) {
      if (k[key]) { const v = parseVec(k[key]).applyQuaternion(q); k[key] = `${num(v.x)} ${num(v.y)} ${num(v.z)}`; }
    }
    if (k.BasisOrigin) { const v = at(parseVec(k.BasisOrigin)); k.BasisOrigin = `${num(v.x)} ${num(v.y)} ${num(v.z)}`; }
  } else if (k.angles !== undefined) {
    k.angles = vecStr(turnAngles(parseVec(k.angles), t.deg));
  } else if (k.angle !== undefined && Number(k.angle) >= 0) {
    // A lone yaw (-1 and -2 mean up and down).
    k.angle = String(wrap(Number(k.angle) + t.deg));
  } else if (e.origin && /^(prop_|unit_|info_player|info_start)/.test(e.classname)) {
    k.angles = vecStr(turnAngles(new Vector3(), t.deg));
  }
  for (const s of e.solids ?? []) turnSolidNode(s, t);
  return out;
}
