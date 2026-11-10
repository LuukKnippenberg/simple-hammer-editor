import type { Box3 } from 'three';
import type { KVNode } from '../../vmf/keyvalues.ts';
import type { MapEntity, VmfDocument } from '../../vmf/map.ts';
import { findHandle, fitHandleTo, newHandle, POI_HANDLE, turnedHandleDrag, turnedHandleUnmoved } from '../handle.ts';
import { fitRect } from './registry.ts';
import type { PoiSpec, PoiType, Rect, Rotation } from './types.ts';
import { normAngle, rectCentre, swapsSides } from '../turn.ts';

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
  return newHandle(doc, POI_HANDLE, spec.uid, spec.rect, spec.z, spec.rotation);
}

/** Fits an existing handle's box to the spec (call inside a history step for undo). */
export function fitHandle(doc: VmfDocument, handle: MapEntity, spec: PoiSpec): void {
  fitHandleTo(doc, handle, spec.rect, spec.z, spec.rotation);
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

/**
 * Where a turned handle (a POI at an angle that isn't a quarter turn) was dragged to, or null for a quarter turn:
 * the gizmo's box is the box round the turned handle, so the POI keeps its angle and takes the new centre and the
 * new width and depth along its own sides.
 */
export function placeFromTurnedHandle(spec: PoiSpec, type: PoiType, handle: MapEntity, mode: 'translate' | 'scale', groundAt: (x: number, y: number) => number): { rect: Rect; z: number } | 'same' | null {
  const d = turnedHandleDrag(handle, spec.rect, spec.rotation);
  if (!d) return null;
  if (turnedHandleUnmoved(d, spec.rect, spec.z)) return 'same';
  const r = spec.rect;
  const [w, h] = mode === 'scale' ? [d.w, d.h] : [r.x1 - r.x0, r.y1 - r.y0];
  const rect = fitRect(type, { x0: d.cx - w / 2, y0: d.cy - h / 2, x1: d.cx + w / 2, y1: d.cy + h / 2 }, spec.rotation);
  if (mode === 'scale') return { rect, z: spec.z };
  const lifted = Math.abs(d.z - spec.z) >= 1;
  return { rect, z: lifted ? Math.round(d.z) : Math.round(groundAt(...rectCentre(rect))) };
}

/**
 * The rectangle a POI takes at another angle: it keeps its centre and its own width and depth, so the rectangle
 * (which is the POI's at its nearest quarter turn) swaps sides when that quarter turn does.
 */
export function rectForRotation(spec: PoiSpec, type: PoiType, rotation: Rotation): Rect {
  if (swapsSides(rotation) === swapsSides(spec.rotation)) return spec.rect;
  const r = spec.rect, [cx, cy] = rectCentre(r);
  const w = r.y1 - r.y0, h = r.x1 - r.x0;
  return fitRect(type, { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 }, rotation);
}

/** The POI turned `degrees` (counter-clockwise) about its centre: its new angle and rectangle. */
export function turnedBy(spec: PoiSpec, type: PoiType, degrees: number): { rect: Rect; rotation: Rotation } {
  const rotation = normAngle(spec.rotation + degrees);
  return { rect: rectForRotation(spec, type, rotation), rotation };
}

/** A quarter turn: the rectangle turns around its centre and the layout turns with it. */
export function turned(spec: PoiSpec, type: PoiType, dir: 1 | -1): { rect: Rect; rotation: Rotation } {
  return turnedBy(spec, type, dir * 90);
}
