import { Box3, Vector3 } from 'three';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { MapEntity, VmfDocument } from '../vmf/map.ts';
import { boxSolid, solidBounds, solidNode } from '../edit/brushes.ts';
import { editorBlock } from '../edit/actions.ts';
import { fineTurn, rectCentre, turnedBoxFaces, turnedBounds } from './turn.ts';

/**
 * Generator handles: one translucent box over what a generator made (a POI, a block of buildings). Clicking it
 * selects the whole thing; the move and resize gizmos drag it, and it is rebuilt to fit when the drag ends.
 * Handles only exist in the editor: compiles strip them (`stripHandles`), saved VMFs keep them.
 */
export interface HandleKind {
  classname: string;
  /** The key that ties the handle (and everything the generator made) to its owner. */
  idKey: string;
  /** Not a game material: the editor draws `EDITOR/...` as a faint box (see materials.ts). */
  material: string;
  color: string;
  /** How far the box stands out around the owner's rectangle (so it shows beside walls built on the edge). */
  pad: number;
}

export const HANDLE_HEIGHT = 64;

export interface HandleRect { x0: number; y0: number; x1: number; y1: number }

/** A point of interest's handle (`src/gen/poi/handle.ts`). */
export const POI_HANDLE: HandleKind = { classname: 'she_poi_handle', idKey: 'she_poi_id', material: 'EDITOR/POI_HANDLE', color: '255 166 48', pad: 0 };
/** A generated block of buildings' handle (`src/gen/buildingStore.ts`): a plinth just around the block's walls. */
export const BUILDING_HANDLE: HandleKind = { classname: 'she_building_handle', idKey: 'she_building_id', material: 'EDITOR/BUILDING_HANDLE', color: '64 168 255', pad: 16 };

/** An interior building's handle (`src/gen/rooms/store.ts`): around its rooms, outside its outer walls. */
export const ROOMS_HANDLE: HandleKind = { classname: 'she_rooms_handle', idKey: 'she_rooms_id', material: 'EDITOR/ROOMS_HANDLE', color: '96 200 120', pad: 24 };

/** Generated stairs' handle (`src/gen/stairsAction.ts`): a low box round their points. */
export const STAIRS_HANDLE: HandleKind = { classname: 'she_stairs_handle', idKey: 'she_stairs_id', material: 'EDITOR/STAIRS_HANDLE', color: '230 120 200', pad: 8 };

const kinds = [POI_HANDLE, BUILDING_HANDLE, ROOMS_HANDLE, STAIRS_HANDLE];

/** Keys holding a generator's settings (not its ids, which logic may still use to find members). */
const EDITOR_KEYS = ['she_buildings', 'she_road', 'she_rooms', 'she_rooms_world', 'she_building_world', 'she_building_anchor', 'she_stairs', 'she_stairs_world'];

/** The kind of a handle entity, or null when it is not a handle. */
export function kindOf(e: MapEntity | null | undefined): HandleKind | null {
  return (e && kinds.find((k) => k.classname === e.classname)) ?? null;
}

export const isGeneratorHandle = (e: MapEntity | null | undefined): boolean => !!kindOf(e);

/** The handle of the owner with this id, if it has one. */
export function findHandle(doc: VmfDocument, kind: HandleKind, uid: string): MapEntity | null {
  return doc.entities.find((e) => e.classname === kind.classname && e.get(kind.idKey) === uid) ?? null;
}

/**
 * The handle's brush: a box round the rectangle, turned with its owner when the owner stands at an angle that isn't
 * a quarter turn (`angle`, degrees: the rectangle is the owner's at the nearest quarter turn, see `src/gen/turn.ts`).
 */
function solidFor(doc: VmfDocument, kind: HandleKind, r: HandleRect, z: number, angle = 0): KVNode {
  const p = kind.pad;
  const turn = fineTurn(r, angle);
  if (turn) return solidNode(doc, turnedBoxFaces(r, turn, z, z + HANDLE_HEIGHT, kind.material, p));
  return boxSolid(doc, new Vector3(r.x0 - p, r.y0 - p, z), new Vector3(r.x1 + p, r.y1 + p, z + HANDLE_HEIGHT), kind.material);
}

export function newHandle(doc: VmfDocument, kind: HandleKind, uid: string, r: HandleRect, z: number, angle = 0): KVNode {
  const e = new KVNode('entity');
  e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', kind.classname), new KVPair(kind.idKey, uid),
    solidFor(doc, kind, r, z, angle), editorBlock(kind.color));
  return e;
}

/** Fits an existing handle's box to a rectangle (call inside a history step for undo). */
export function fitHandleTo(doc: VmfDocument, handle: MapEntity, r: HandleRect, z: number, angle = 0): void {
  const kind = kindOf(handle);
  if (!kind) return;
  handle.node.items = handle.node.items.filter((it) => !(it instanceof KVNode && it.name.toLowerCase() === 'solid'));
  const ed = handle.node.items.findIndex((it) => it instanceof KVNode && it.name.toLowerCase() === 'editor');
  handle.node.items.splice(ed >= 0 ? ed : handle.node.items.length, 0, solidFor(doc, kind, r, z, angle));
  handle.reload();
}

/** The handle's box without its padding: the rectangle and height it was dragged to. */
export function handleBox(handle: MapEntity): Box3 | null {
  const kind = kindOf(handle);
  if (!kind || !handle.solids[0]) return null;
  const b = solidBounds(handle.solids[0]);
  b.min.x += kind.pad; b.min.y += kind.pad; b.max.x -= kind.pad; b.max.y -= kind.pad;
  return b;
}

/**
 * Where a handle of an owner standing at `angle` was dragged to (a move or a resize with the gizmo, whose box is
 * the axis-aligned box round the turned handle): the owner's new centre and its rectangle's new width and depth
 * (along the rectangle's own sides). Null when the angle is a quarter turn (`handleBox` serves those).
 */
export function turnedHandleDrag(handle: MapEntity, r: HandleRect, angle: number): { cx: number; cy: number; w: number; h: number; z: number } | null {
  const kind = kindOf(handle);
  const turn = fineTurn(r, angle);
  if (!kind || !turn || !handle.solids[0]) return null;
  const b = solidBounds(handle.solids[0]);
  const was = turnedBounds(r, turn, kind.pad);
  // The gizmo scales the box along the world axes; each side of the rectangle grows by how its direction stretches.
  const sx = (b.max.x - b.min.x) / Math.max(1, was.x1 - was.x0), sy = (b.max.y - b.min.y) / Math.max(1, was.y1 - was.y0);
  const a = (turn.deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const w = (r.x1 - r.x0 + 2 * kind.pad) * Math.hypot(c * sx, s * sy) - 2 * kind.pad;
  const h = (r.y1 - r.y0 + 2 * kind.pad) * Math.hypot(s * sx, c * sy) - 2 * kind.pad;
  return { cx: (b.min.x + b.max.x) / 2, cy: (b.min.y + b.max.y) / 2, w, h, z: b.min.z };
}

/** True when a turned handle still stands where its owner is (nothing to rebuild). */
export function turnedHandleUnmoved(drag: { cx: number; cy: number; w: number; h: number; z: number }, r: HandleRect, z: number): boolean {
  const [cx, cy] = rectCentre(r);
  return Math.abs(drag.cx - cx) < 0.5 && Math.abs(drag.cy - cy) < 0.5 && Math.abs(drag.w - (r.x1 - r.x0)) < 1 && Math.abs(drag.h - (r.y1 - r.y0)) < 1 && Math.abs(drag.z - z) < 1;
}

/** Owners with nothing left to compile (a func_detail that only holds a generator's settings). */
const emptyHolder = (e: MapEntity) => e.classname === 'func_detail' && !e.solids.length && kinds.some((k) => e.get(k.idKey) !== undefined);

/**
 * Removes every handle (for the copy of a map that gets compiled), and func_details left holding only a
 * generator's settings. Returns how many handles.
 */
export function stripHandles(doc: VmfDocument): number {
  const handles = doc.entities.filter((e) => isGeneratorHandle(e));
  for (const h of handles) doc.removeEntity(h);
  for (const e of doc.entities.filter(emptyHolder)) doc.removeEntity(e);
  // The generators' stored settings are for the editor only, and some (a block cut by long curved streets) run past
  // vbsp's 1024-character limit for a key value, which hangs it while it reads the map.
  for (const e of doc.entities) for (const k of EDITOR_KEYS) if (e.get(k) !== undefined) e.node.delete(k);
  return handles.length;
}
