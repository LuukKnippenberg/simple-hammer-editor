import type { KitParam, ParamValue } from '../../lw/kits.ts';
import type { MapEntity } from '../../vmf/map.ts';
import type { Landscape, PoiSpec, PoiType, Rotation } from './types.ts';
import { LANDSCAPES } from './types.ts';
import { normAngle } from '../turn.ts';

/**
 * A POI's definition lives on its func_detail in the `she_poi` key, like roads keep theirs in `she_road`;
 * `she_poi_id` ties its point entities (and the ids of any world brushes) to it, so a rebuild replaces
 * exactly what the POI made.
 */
export const POI_KEY = 'she_poi';
export const POI_ID_KEY = 'she_poi_id';
export const POI_WORLD_KEY = 'she_poi_world';

const clean = (s: string) => s.replace(/[|;="]/g, ' ').trim();

export function encodePoi(p: PoiSpec): string {
  const params = Object.entries(p.params).map(([k, v]) => `${clean(k)}=${typeof v === 'boolean' ? (v ? '1' : '0') : clean(String(v))}`).join(';');
  const r = p.rect;
  return [p.type, p.uid, p.seed, `${Math.round(r.x0)} ${Math.round(r.y0)} ${Math.round(r.x1)} ${Math.round(r.y1)}`, normAngle(p.rotation), Math.round(p.z), p.landscape, params].join('|');
}

/** Reads a stored POI. Parameters are typed from the POI type's parameter list when it is given. */
export function decodePoi(s: string, type?: PoiType | null, extra: KitParam[] = []): PoiSpec | null {
  const parts = s.split('|');
  if (parts.length < 7) return null;
  const [t, uid, seed, rs, rot, z, landscape, params = ''] = parts;
  const [x0, y0, x1, y1] = rs.split(' ').map(Number);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const rotation = Number(rot);
  // Any angle (older maps only have quarter turns).
  if (!rot.trim() || !Number.isFinite(rotation)) return null;
  const defs = new Map([...(type?.params ?? []), ...extra].map((p) => [p.key, p]));
  const out: Record<string, ParamValue> = {};
  for (const kv of params.split(';')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    const def = defs.get(k);
    out[k] = def?.type === 'check' ? v === '1' || v === 'true' : def?.type === 'number' ? Number(v) : v;
  }
  return {
    type: t, uid, seed: Number(seed) || 1, rect: { x0, y0, x1, y1 }, rotation: normAngle(rotation) as Rotation, z: Number(z) || 0,
    landscape: (LANDSCAPES.some((l) => l.id === landscape) ? landscape : 'city') as Landscape, params: out,
  };
}

/** A fresh short id for a new POI. */
export function newPoiUid(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** The raw stored spec of a POI func_detail (typing happens in the registry). */
export function poiKeyOf(e: MapEntity): string | null {
  return e.classname === 'func_detail' ? e.get(POI_KEY) ?? null : null;
}
