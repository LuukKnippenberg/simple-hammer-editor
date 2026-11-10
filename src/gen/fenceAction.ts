import type { Editor } from '../editor.ts';
import type { MapEntity, MapSolid } from '../vmf/map.ts';
import { groundAt } from '../edit/pathPins.ts';
import { idTest } from './buildingStore.ts';
import { FENCE_HANDLE, findHandle, fitHandleTo, handleBox, kindOf } from './handle.ts';
import { FENCE_ID_KEY, FENCE_KEY, FENCE_WORLD_KEY, fenceHandleRect, fenceMembers, fenceOf, fenceOwner, storedFence } from './fenceStore.ts';
import { newFenceUid, type FenceBuild, type FenceSpec, type Ground } from './fences.ts';

/**
 * Editor actions for generated fences: build one from a spec, rebuild it in place after a change or a drag of its
 * handle, duplicate and delete it. Each is one undo step.
 */

/** Fence brushes (any fence's func_detail and clip), which the ground under a fence looks through. */
export function isFenceSolid(editor: Editor): (solid: MapSolid) => boolean {
  const lists = editor.doc.entities.filter((e) => e.get(FENCE_WORLD_KEY) && e.get(FENCE_KEY)).map((e) => idTest(e.get(FENCE_WORLD_KEY)));
  return (solid) => (solid.entity ? !!solid.entity.get(FENCE_KEY) : lists.some((has) => has(Number(solid.node.get('id')))));
}

/** The ground under a plan point for fences: the highest surface, through fences (their own and others'). */
export function fenceGround(editor: Editor): Ground {
  const skip = isFenceSolid(editor);
  return (x, y) => groundAt(editor, x, y, skip);
}

/** Builds (or rebuilds, replacing `existing`'s parts) a fence from its spec. One undo step. */
export function applyFence(editor: Editor, spec: FenceSpec, label: string, existing: MapEntity | null = null): { detail: MapEntity; build: FenceBuild } {
  const doc = editor.doc;
  let detail!: MapEntity;
  let build!: FenceBuild;
  // Read before anything is removed: the renderer still has the old brushes until the change is drawn.
  const ground = fenceGround(editor);
  editor.history.group(label, () => {
    const old = existing ? fenceMembers(doc, fenceOf(existing)?.uid ?? spec.uid) : null;
    if (old && (old.world.length || old.props.length)) editor.history.remove('Remove old fence', old.world, old.props);
    const r = storedFence(doc, spec, ground);
    build = r.build;
    const world = r.world.map((n) => doc.addSolid(n));
    const ents: MapEntity[] = [];
    if (old?.detail) {
      // Rebuilt in place: the func_detail stays the same entity, so what holds on to it (the Generate flow's Tune
      // step, the pins) lives through the rebuild and its undo.
      detail = old.detail;
      const end = editor.history.begin('Rebuild fence', [], [detail]);
      r.detail.set('id', String(detail.id));
      detail.node.items = r.detail.items;
      detail.reload();
      end();
    } else {
      detail = doc.addEntity(r.detail);
      ents.push(detail);
    }
    ents.push(...r.props.map((p) => doc.addEntity(p)));
    // The handle keeps its identity, so a selected handle stays selected.
    if (old?.handle) {
      const end = editor.history.begin('Fit fence handle', [], [old.handle]);
      const { rect, z } = fenceHandleRect(spec);
      fitHandleTo(doc, old.handle, rect, z);
      end();
    } else {
      ents.push(doc.addEntity(r.handle));
    }
    editor.history.added('Add fence', world, ents);
  });
  editor.changed();
  return { detail, build };
}

/** Rebuilds a stored fence with changes to its spec. */
export function regenerateFence(editor: Editor, detail: MapEntity, patch: Partial<Omit<FenceSpec, 'uid'>> = {}, label = 'Edit fence'): { detail: MapEntity; build: FenceBuild } | null {
  const s = fenceOf(detail);
  if (!s) return null;
  const r = applyFence(editor, { ...s, ...patch }, label, detail);
  selectFence(editor, r.detail);
  return r;
}

/** The fences (their func_details) whose handles are selected, if the selection is nothing but such handles. */
export function selectedFences(editor: Editor): MapEntity[] {
  const sel = editor.selection;
  if (sel.solids.size || !sel.entities.size || ![...sel.entities].every((e) => kindOf(e) === FENCE_HANDLE)) return [];
  return [...sel.entities].map((h) => fenceOwner(editor.doc, h)).filter((d): d is MapEntity => !!d);
}

/** Selects a fence by its handle (or its func_detail if it has none). */
export function selectFence(editor: Editor, detail: MapEntity): void {
  editor.selection.set([], [findHandle(editor.doc, FENCE_HANDLE, detail.get(FENCE_ID_KEY) ?? '') ?? detail]);
}

/**
 * Rebuilds a fence where its handle was moved to (call when the drag ends): every point moves with it, and up or
 * down. A resize only puts the handle back.
 */
export function fenceHandleDragged(editor: Editor, handle: MapEntity, mode: 'translate' | 'scale'): void {
  const detail = fenceOwner(editor.doc, handle);
  const s = detail && fenceOf(detail);
  const box = handleBox(handle);
  if (!detail || !s || !box) return;
  const { rect, z } = fenceHandleRect(s);
  const dx = Math.round(box.min.x - rect.x0), dy = Math.round(box.min.y - rect.y0), dz = Math.round(box.min.z - z);
  if (mode === 'scale' || (!dx && !dy && !dz)) {
    const end = editor.history.begin('Fit fence handle', [], [handle]);
    fitHandleTo(editor.doc, handle, rect, z);
    end();
    return;
  }
  regenerateFence(editor, detail, { points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz })) }, 'Move fence');
}

/** Builds a copy of a fence next to it, along +y, and selects the copy. */
export function duplicateFence(editor: Editor, detail: MapEntity): MapEntity | null {
  const s = fenceOf(detail);
  if (!s) return null;
  const ys = s.points.map((p) => p.y);
  const dy = Math.max(...ys) - Math.min(...ys) + 128;
  const r = applyFence(editor, { ...s, uid: newFenceUid(), points: s.points.map((p) => ({ ...p, y: p.y + dy })) }, 'Duplicate fence');
  selectFence(editor, r.detail);
  return r.detail;
}

/** Deletes a fence and everything it made (one undo step). */
export function deleteFence(editor: Editor, detail: MapEntity): void {
  const s = fenceOf(detail);
  if (!s) return;
  const m = fenceMembers(editor.doc, s.uid);
  editor.history.remove('Delete fence', m.world, [detail, ...m.props, ...(m.handle ? [m.handle] : [])]);
  editor.selection.clear();
  editor.changed();
}
