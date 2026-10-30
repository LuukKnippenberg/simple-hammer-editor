import type { Box3 } from 'three';
import type { KVNode } from '../../vmf/keyvalues.ts';
import type { MapEntity, VmfDocument } from '../../vmf/map.ts';
import { findHandle, fitHandleTo, newHandle, POI_HANDLE } from '../handle.ts';
import { fitRect } from './registry.ts';
import type { PoiSpec, PoiType, Rect, Rotation } from './types.ts';

/**
 * A POI's handle: one translucent box over its rectangle (see `src/gen/handle.ts`, shared with building blocks).
 * Clicking it selects the whole POI; the move and resize gizmos drag it, and the POI is rebuilt to fit when the
 * drag ends.
 */
export const HANDLE_CLASS = POI_HANDLE.classname;
export const HANDLE_MATERIAL = POI_HANDLE.material;
export { HANDLE_HEIGHT, stripHandles } from '../handle.ts';

export const isHandle = (e: MapEntity | null | undefined): boolean => e?.classname === HANDLE_CLASS;

/** The handle of the POI with this uid, if it has one. */
export function handleOf(doc: VmfDocument, uid: string): MapEntity | null {
  return findHandle(doc, POI_HANDLE, uid);
}

export function handleNode(doc: VmfDocument, spec: PoiSpec): KVNode {
  return newHandle(doc, POI_HANDLE, spec.uid, spec.rect, spec.z);
}

/** Fits an existing handle's box to the spec (call inside a history step for undo). */
export function fitHandle(doc: VmfDocument, handle: MapEntity, spec: PoiSpec): void {
  fitHandleTo(doc, handle, spec.rect, spec.z);
}

/**
 * Where a POI goes after its handle was dragged to `box`. A move keeps the size and stands the POI on the ground
 * at its new spot (`groundAt`), unless the handle was also lifted or lowered; a resize keeps the height and is
 * clamped to the type's sizes.
 */
export function placeFromHandle(spec: PoiSpec, type: PoiType, box: Box3, mode: 'translate' | 'scale', groundAt: (x: number, y: number) => number): { rect: Rect; z: number } {
  const raw: Rect = { x0: Math.round(box.min.x), y0: Math.round(box.min.y), x1: Math.round(box.max.x), y1: Math.round(box.max.y) };
  if (mode === 'scale') return { rect: fitRect(type, raw, spec.rotation), z: spec.z };
  const rect = fitRect(type, raw, spec.rotation);
  const lifted = Math.abs(box.min.z - spec.z) >= 1;
  return { rect, z: lifted ? Math.round(box.min.z) : Math.round(groundAt((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)) };
}

/** A quarter turn: the rectangle turns around its centre and the layout turns with it. */
export function turned(spec: PoiSpec, type: PoiType, dir: 1 | -1): { rect: Rect; rotation: Rotation } {
  const rotation = (((spec.rotation + dir * 90) % 360) + 360) % 360 as Rotation;
  const r = spec.rect, cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const w = r.y1 - r.y0, h = r.x1 - r.x0;
  return { rect: fitRect(type, { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 }, rotation), rotation };
}
