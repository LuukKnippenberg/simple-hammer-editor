import type { KitParam, ParamValue } from '../../lw/kits.ts';
import { UNITS } from '../../lw/kits.ts';
import type { MapEntity, VmfDocument } from '../../vmf/map.ts';
import { EXTRA_UNITS, PoiKit } from './kit.ts';
import { decodePoi, newPoiUid, poiKeyOf } from './spec.ts';
import { drawnEntitySolids, hideCoveredFaces, overlaySides } from '../../geom/hidden.ts';
import type { Landscape, PoiOutput, PoiSpec, PoiType, Rect, Rotation } from './types.ts';

/** Every POI type. Each POI phase adds its types by registering them here (see ./catalogue.ts). */
export const POI_TYPES: PoiType[] = [];

export function registerPoi(...types: PoiType[]): void {
  for (const t of types) {
    const i = POI_TYPES.findIndex((p) => p.id === t.id);
    if (i >= 0) POI_TYPES[i] = t;
    else POI_TYPES.push(t);
  }
}

export function poiType(id: string): PoiType | null {
  return POI_TYPES.find((t) => t.id === id) ?? null;
}

/** Parameters the framework adds for a type's gameplay options (a type's own parameter of the same key wins). */
export function sharedParams(t: PoiType): KitParam[] {
  const out: KitParam[] = [];
  const g = t.gameplay ?? {};
  if (g.capture) out.push({ key: 'capture', label: 'Capture point', type: 'check', default: false, hint: 'A control point with its capture area at the POI\'s centre' });
  if (g.scrap) out.push({ key: 'scrap', label: 'Scrap piles', type: 'number', default: 0, hint: 'scrap_marker resource nodes' });
  if (g.units?.length) {
    out.push(
      { key: 'units', label: 'Unit group', type: 'select', default: 'none', options: [{ value: 'none', label: 'None' }, ...g.units.map((id) => ({ value: id, label: (UNITS.find((u) => u.id === id) ?? EXTRA_UNITS.find((u) => u.id === id))?.label ?? id }))] },
      { key: 'unitCount', label: 'Units', type: 'number', default: 5 },
    );
  }
  out.push({ key: 'level', label: 'Level terrain', type: 'check', default: true, hint: 'Flatten and paint displacement terrain under the POI' });
  return out;
}

/** All parameters of a type: its own, then the shared gameplay ones it doesn't define itself. */
export function poiParams(t: PoiType): KitParam[] {
  const own = new Set(t.params.map((p) => p.key));
  return [...t.params, ...sharedParams(t).filter((p) => !own.has(p.key))];
}

export function defaultParams(t: PoiType): Record<string, ParamValue> {
  return Object.fromEntries(poiParams(t).map((p) => [p.key, p.default]));
}

/** Snaps a dragged rectangle to 64 and clamps it to a type's sizes (local width and depth after rotation). */
export function fitRect(t: PoiType, r: Rect, rotation: Rotation, grid = 64): Rect {
  const turned = rotation === 90 || rotation === 270;
  const snap = (v: number) => Math.round(v / grid) * grid || 0;
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  // World x extent is the local width unless the POI is turned.
  const [minX, maxX, minY, maxY] = turned ? [t.minSize[1], t.maxSize[1], t.minSize[0], t.maxSize[0]] : [t.minSize[0], t.maxSize[0], t.minSize[1], t.maxSize[1]];
  const w = clamp(snap(Math.abs(r.x1 - r.x0)), minX, maxX), h = clamp(snap(Math.abs(r.y1 - r.y0)), minY, maxY);
  const x0 = snap(cx - w / 2), y0 = snap(cy - h / 2);
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/** A new spec for a type, filling a rectangle at ground height `z`. */
export function newSpec(t: PoiType, r: Rect, z: number, o: { rotation?: Rotation; seed?: number; landscape?: Landscape; params?: Record<string, ParamValue> } = {}): PoiSpec {
  const rotation = o.rotation ?? 0;
  return {
    type: t.id, uid: newPoiUid(), seed: o.seed ?? Math.floor(Math.random() * 100000), rect: fitRect(t, r, rotation), rotation, z: Math.round(z),
    landscape: o.landscape ?? t.landscapes[0], params: { ...defaultParams(t), ...o.params },
  };
}

/**
 * Builds a POI. `ground` gives the terrain height at a world point (without the POI itself); the result is
 * the same for the same spec and ground.
 */
export function buildPoi(doc: VmfDocument, spec: PoiSpec, ground: (x: number, y: number) => number = () => spec.z): PoiOutput {
  const t = poiType(spec.type);
  if (!t) throw new Error(`Unknown POI type ${spec.type}`);
  const k = new PoiKit(doc, { ...spec, params: { ...defaultParams(t), ...spec.params } }, t, ground);
  t.build(k);
  // Never-visible faces to nodraw. Bottoms only where there is no water, which would reflect them.
  const o = k.out;
  hideCoveredFaces([...o.world, ...o.detail, ...drawnEntitySolids(o.entities)], { keep: overlaySides(o.entities), groundAt: o.waterLevel === undefined ? ground : undefined });
  if (k.flag('level') || k.cuts.length) k.out.terrain = { rect: k.worldRect(k.bounds), z: spec.z, paint: k.flag('level'), cuts: k.cuts };
  return k.out;
}

/** The POI stored on an entity (its func_detail), typed by its type's parameters. */
export function poiOf(e: MapEntity): { spec: PoiSpec; type: PoiType } | null {
  const raw = poiKeyOf(e);
  if (!raw) return null;
  const typeId = raw.split('|')[0];
  const type = poiType(typeId);
  if (!type) return null;
  const spec = decodePoi(raw, type, sharedParams(type));
  return spec ? { spec, type } : null;
}
