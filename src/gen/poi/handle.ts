import { Box3, Vector3 } from 'three';
import { KVNode, KVPair } from '../../vmf/keyvalues.ts';
import type { MapEntity, VmfDocument } from '../../vmf/map.ts';
import { boxSolid } from '../../edit/brushes.ts';
import { editorBlock } from '../../edit/actions.ts';
import { fitRect } from './registry.ts';
import { POI_ID_KEY } from './spec.ts';
import type { PoiSpec, PoiType, Rect, Rotation } from './types.ts';

/**
 * A POI's handle: one translucent box over its rectangle. Clicking it selects the whole POI; the move and resize
 * gizmos drag it, and the POI is rebuilt to fit when the drag ends. It only exists in the editor: compiles strip
 * it (`stripHandles`), saved VMFs keep it.
 */
export const HANDLE_CLASS = 'she_poi_handle';
/** Not a game material: the editor draws it as a faint box (see materials.ts). */
export const HANDLE_MATERIAL = 'EDITOR/POI_HANDLE';
export const HANDLE_HEIGHT = 64;

export const isHandle = (e: MapEntity | null | undefined): boolean => e?.classname === HANDLE_CLASS;

/** The handle of the POI with this uid, if it has one. */
export function handleOf(doc: VmfDocument, uid: string): MapEntity | null {
  return doc.entities.find((e) => isHandle(e) && e.get(POI_ID_KEY) === uid) ?? null;
}

function handleSolid(doc: VmfDocument, spec: PoiSpec): KVNode {
  const r = spec.rect;
  return boxSolid(doc, new Vector3(r.x0, r.y0, spec.z), new Vector3(r.x1, r.y1, spec.z + HANDLE_HEIGHT), HANDLE_MATERIAL);
}

export function handleNode(doc: VmfDocument, spec: PoiSpec): KVNode {
  const e = new KVNode('entity');
  e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', HANDLE_CLASS), new KVPair(POI_ID_KEY, spec.uid),
    handleSolid(doc, spec), editorBlock('255 166 48'));
  return e;
}

/** Fits an existing handle's box to the spec (call inside a history step for undo). */
export function fitHandle(doc: VmfDocument, handle: MapEntity, spec: PoiSpec): void {
  handle.node.items = handle.node.items.filter((it) => !(it instanceof KVNode && it.name.toLowerCase() === 'solid'));
  const ed = handle.node.items.findIndex((it) => it instanceof KVNode && it.name.toLowerCase() === 'editor');
  handle.node.items.splice(ed >= 0 ? ed : handle.node.items.length, 0, handleSolid(doc, spec));
  handle.reload();
}

/** Removes every handle (for the copy of a map that gets compiled). Returns how many. */
export function stripHandles(doc: VmfDocument): number {
  const handles = doc.entities.filter((e) => isHandle(e));
  for (const h of handles) doc.removeEntity(h);
  return handles.length;
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
