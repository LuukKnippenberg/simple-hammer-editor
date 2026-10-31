import type { Editor } from '../../editor.ts';
import type { MapEntity } from '../../vmf/map.ts';
import { findHandle, fitHandleTo, handleBox, kindOf, ROOMS_HANDLE } from '../handle.ts';
import { roomsMembers, roomsOf, roomsOwner, storedRoomBuilding, ROOMS_ID_KEY } from './store.ts';
import type { RoomBuildingSpec } from './model.ts';
import type { RoomBuildingResult } from './build.ts';

/**
 * Editor actions for interior buildings: build one from a spec, rebuild it in place after its rooms changed or
 * its handle was moved, and delete it. Each is one undo step.
 */

/** A fresh short id for a new building. */
export const newRoomsUid = (): string => Math.random().toString(36).slice(2, 8);

/**
 * Builds (or rebuilds, replacing `existing`'s parts) an interior building from its spec. One undo step. Returns
 * its func_detail and what was built.
 */
export function applyRooms(editor: Editor, spec: RoomBuildingSpec, label: string, existing: MapEntity | null = null): { detail: MapEntity; result: RoomBuildingResult } {
  const doc = editor.doc;
  let detail!: MapEntity;
  let result!: RoomBuildingResult;
  editor.history.group(label, () => {
    const old = existing ? roomsMembers(doc, roomsOf(existing)?.uid ?? spec.uid) : null;
    const gone = old ? [...(old.detail ? [old.detail] : []), ...old.entities] : [];
    if (old && (gone.length || old.world.length)) editor.history.remove('Remove old building', old.world, gone);
    const r = storedRoomBuilding(doc, spec);
    result = r;
    const world = r.world.map((n) => doc.addSolid(n));
    const ents = r.entities.map((n) => doc.addEntity(n));
    detail = ents[0];
    // The handle keeps its identity, so a selected handle stays selected.
    if (old?.handle) {
      const end = editor.history.begin('Fit building handle', [], [old.handle]);
      fitHandleTo(doc, old.handle, r.layout.bounds, spec.origin.z);
      end();
    } else {
      ents.push(doc.addEntity(r.handle));
    }
    editor.history.added('Add interior building', world, ents);
  });
  editor.changed();
  return { detail, result };
}

/** Rebuilds a stored building with changes to its spec. */
export function regenerateRooms(editor: Editor, detail: MapEntity, patch: Partial<RoomBuildingSpec> = {}, label = 'Regenerate interior building'): MapEntity | null {
  const s = roomsOf(detail);
  if (!s) return null;
  const e = applyRooms(editor, { ...s, ...patch }, label, detail).detail;
  selectRooms(editor, e);
  return e;
}

/** The buildings (their func_details) whose handles are selected, if the selection is nothing but such handles. */
export function selectedRooms(editor: Editor): MapEntity[] {
  const sel = editor.selection;
  if (sel.solids.size || !sel.entities.size || ![...sel.entities].every((e) => kindOf(e) === ROOMS_HANDLE)) return [];
  return [...sel.entities].map((h) => roomsOwner(editor.doc, h)).filter((d): d is MapEntity => !!d);
}

/** Selects a building by its handle (or its func_detail if it has none). */
export function selectRooms(editor: Editor, detail: MapEntity): void {
  editor.selection.set([], [findHandle(editor.doc, ROOMS_HANDLE, detail.get(ROOMS_ID_KEY) ?? '') ?? detail]);
}

/**
 * Rebuilds a building where its handle was moved to (call when the drag ends). Its rooms keep their size: a
 * resize only puts the handle back. A move keeps the building's level unless the handle was lifted or lowered.
 */
export function roomsHandleDragged(editor: Editor, handle: MapEntity, mode: 'translate' | 'scale'): void {
  const detail = roomsOwner(editor.doc, handle);
  const s = detail && roomsOf(detail);
  const box = handleBox(handle);
  if (!detail || !s || !box) return;
  const dx = Math.round(box.min.x - s.origin.x), dy = Math.round(box.min.y - s.origin.y);
  const z = mode === 'translate' && Math.abs(box.min.z - s.origin.z) >= 1 ? Math.round(box.min.z) : s.origin.z;
  if (mode === 'scale' || (!dx && !dy && z === s.origin.z)) {
    // Nothing to rebuild: put the handle back around the rooms.
    const end = editor.history.begin('Fit building handle', [], [handle]);
    const c = s.cell, xs = s.rooms.map((q) => q.cells), w = Math.max(...xs.map((q) => q.x1)) * c, h = Math.max(...xs.map((q) => q.y1)) * c;
    fitHandleTo(editor.doc, handle, { x0: s.origin.x, y0: s.origin.y, x1: s.origin.x + w, y1: s.origin.y + h }, s.origin.z);
    end();
    return;
  }
  regenerateRooms(editor, detail, { origin: { x: s.origin.x + dx, y: s.origin.y + dy, z } }, 'Move interior building');
}

/** Deletes a building and everything it made (one undo step). */
export function deleteRooms(editor: Editor, detail: MapEntity): void {
  const s = roomsOf(detail);
  if (!s) return;
  const m = roomsMembers(editor.doc, s.uid);
  editor.history.remove('Delete interior building', m.world, [detail, ...m.entities, ...(m.handle ? [m.handle] : [])]);
  editor.selection.clear();
  editor.changed();
}
