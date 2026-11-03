import { Vector3 } from 'three';
import { fmt, parseVec, vecStr } from '../vmf/map.ts';
import { decalBasis } from '../render/decalRenderer.ts';

/** Reads and writes an entity's keys (a MapEntity, or a plain map in tests). */
export interface Keys {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

/** The game can hold this many info_overlay entities in one map (MAX_MAP_OVERLAYS). */
export const MAX_OVERLAYS = 512;

const v3 = (v: Vector3) => vecStr(new Vector3(+fmt(v.x), +fmt(v.y), +fmt(v.z)));

/** An overlay's size in units, from its uv corners. */
export function overlaySize(e: Keys): { w: number; h: number } {
  const us: number[] = [], vs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = parseVec(e.get(`uv${i}`) ?? '0 0 0');
    us.push(p.x);
    vs.push(p.y);
  }
  return { w: Math.round((Math.max(...us) - Math.min(...us)) * 100) / 100, h: Math.round((Math.max(...vs) - Math.min(...vs)) * 100) / 100 };
}

/** Rewrites the uv corners for a size in units, centred on the basis origin (as the Decal tool places them). */
export function setOverlaySize(e: Keys, w: number, h: number): void {
  const x = w / 2, y = h / 2;
  e.set('uv0', `${fmt(-x)} ${fmt(-y)} 0`);
  e.set('uv1', `${fmt(-x)} ${fmt(y)} 0`);
  e.set('uv2', `${fmt(x)} ${fmt(y)} 0`);
  e.set('uv3', `${fmt(x)} ${fmt(-y)} 0`);
}

/**
 * The surface axes an overlay turns against: `s` (the texture's width at 0°) and `up` (−t, towards the texture's
 * top), so a positive turn is counter-clockwise seen from in front of the surface.
 */
function turnAxes(n: Vector3): { s: Vector3; up: Vector3 } {
  const { s, t } = decalBasis(n);
  return { s, up: t.negate() };
}

/** The overlay's turn in degrees: its U axis against the surface's own decal axes. */
export function overlayRotation(e: Keys): number {
  const n = parseVec(e.get('BasisNormal') ?? '0 0 1').normalize();
  const u = parseVec(e.get('BasisU') ?? '1 0 0');
  const { s, up } = turnAxes(n);
  const deg = (Math.atan2(u.dot(up), u.dot(s)) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360 * 100) / 100;
}

/**
 * Turns the overlay to `deg` about its normal (the U and V axes; the corners stay). V = U × N: the texture's
 * height runs along V (StartV at −V), so at 0° it is the way an infodecal would sit there: upright on walls, not
 * mirrored. vbsp keeps V's sign (it flags V = U × N against the N × U the engine would assume).
 */
export function setOverlayRotation(e: Keys, deg: number): void {
  const n = parseVec(e.get('BasisNormal') ?? '0 0 1').normalize();
  const { s, up } = turnAxes(n);
  const r = (deg * Math.PI) / 180;
  const U = s.clone().multiplyScalar(Math.cos(r)).addScaledVector(up, Math.sin(r));
  e.set('BasisU', v3(U));
  e.set('BasisV', v3(new Vector3().crossVectors(U, n).normalize()));
}

/** Whether the texture runs backwards along U or V (StartU > EndU). */
export function overlayFlipped(e: Keys, axis: 'U' | 'V'): boolean {
  return parseFloat(e.get(`Start${axis}`) ?? '0') > parseFloat(e.get(`End${axis}`) ?? '1');
}

/** Mirrors the texture along U or V by swapping Start and End. */
export function flipOverlay(e: Keys, axis: 'U' | 'V'): void {
  const a = e.get(`Start${axis}`) ?? '0', b = e.get(`End${axis}`) ?? '1';
  e.set(`Start${axis}`, b);
  e.set(`End${axis}`, a);
}

/** Overlay keys for a decal on a face: centred at `center`, `w` by `h` units, turned `rotation` degrees. */
export function overlayKeys(center: Vector3, normal: Vector3, w: number, h: number, rotation: number, sides: number[], flip: { u?: boolean; v?: boolean } = {}): Record<string, string> {
  const keys: Record<string, string> = {
    sides: sides.join(' '), BasisOrigin: v3(center), BasisNormal: v3(normal.clone().normalize()),
    StartU: flip.u ? '1' : '0', EndU: flip.u ? '0' : '1', StartV: flip.v ? '1' : '0', EndV: flip.v ? '0' : '1',
    fademindist: '-1',
  };
  const k: Keys = { get: (x) => keys[x], set: (x, v) => { keys[x] = v; } };
  setOverlayRotation(k, rotation);
  setOverlaySize(k, w, h);
  return keys;
}

/** Decal kinds the picker groups decals by, matched on their names. */
export const DECAL_KINDS: { id: string; label: string; color: string; re: RegExp }[] = [
  { id: 'combine', label: 'Combine', color: '#3b6cf0', re: /combine|citadel|metrocop|overwatch/ },
  { id: 'graffiti', label: 'Graffiti & paint', color: '#8fb8d8', re: /graffiti|spray|paint|playerlogo|lambda|revolution/ },
  { id: 'posters', label: 'Posters & signs', color: '#c9b48a', re: /poster|sign|bills|ad\d|propaganda|paper|welcome|font|number|logo|watchyourstep|help|objectives|bunker_decal|rationpapers|ghetto_(girl|pants|shirt)/ },
  { id: 'cracks', label: 'Cracks & damage', color: '#5a5650', re: /crack|break|plaster|bproof|rubble|debris|crater|artifacts/ },
  { id: 'scorch', label: 'Scorch & blast', color: '#2a2622', re: /scorch|burn|nuke|blast/ },
  { id: 'road', label: 'Road & street', color: '#e6e6e0', re: /road|street|drain|grate|manhole|holecover|tire|skid|stripe|marking|track|bootprint|arrow|vent|capturecircle|gravelpath/ },
  { id: 'dirt', label: 'Dirt & stains', color: '#6b5a40', re: /dirt|stain|puddle|mud|moss|ivy|leaves|trash|poop|murky|slime|grime|sand|rockslide|decomp|shadowgradient/ },
];

/** A decal's kind by its name, or 'other'. */
export function decalKind(name: string): string {
  const n = name.toLowerCase().split('/').pop()!;
  return DECAL_KINDS.find((k) => k.re.test(n))?.id ?? 'other';
}

/** Blood, gore, bullet impacts, model-only variants and engine helpers: not decals to place by hand. */
const NOT_PLACEABLE = /subrect|_model|model$|shot\d|blood|flesh|antlion_splat|manhackcut|shadow$|selection|testeffect|decals_lit|decals_mod2x|ycircle|turret_cone|unburrow|glowfade|combineballfade|scorchfade|extinguish|beersplash|^splash\d|decalsplash/;

/** Decal materials worth offering, from `materials/...vmt` paths of the decals and overlays folders. */
export function placeableDecals(paths: string[]): string[] {
  return paths.map((p) => p.replace(/^materials\//, '').replace(/\.vmt$/, ''))
    .filter((p) => /^(decals|overlays)\//.test(p) && !NOT_PLACEABLE.test(p.split('/').pop()!) && !/subrect/.test(p));
}
