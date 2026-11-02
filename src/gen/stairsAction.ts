import type { Editor } from '../editor.ts';
import { VmfDocument, type MapEntity } from '../vmf/map.ts';
import { findHandle, fitHandleTo, handleBox, kindOf, STAIRS_HANDLE } from './handle.ts';
import { stairsMembers, stairsOf, stairsOwner, storedStairs, STAIRS_ID_KEY } from './stairsStore.ts';
import { buildStairs, newStairsUid, type StairsOptions, type StairsResult, type StairsSpec } from './stairs.ts';

/**
 * Editor actions for generated stairs: build them from a spec, rebuild them in place after a change or a drag of
 * their handle, duplicate and delete them. Each is one undo step.
 */

/** Builds (or rebuilds, replacing `existing`'s parts) stairs from their spec. One undo step. */
export function applyStairs(editor: Editor, spec: StairsSpec, label: string, existing: MapEntity | null = null): { detail: MapEntity; result: StairsResult } {
  const doc = editor.doc;
  let detail!: MapEntity;
  let result!: StairsResult;
  editor.history.group(label, () => {
    const old = existing ? stairsMembers(doc, stairsOf(existing)?.uid ?? spec.uid) : null;
    if (old && (old.detail || old.world.length)) editor.history.remove('Remove old stairs', old.world, old.detail ? [old.detail] : []);
    const r = storedStairs(doc, spec);
    result = r.result;
    const world = r.world.map((n) => doc.addSolid(n));
    detail = doc.addEntity(r.detail);
    const ents = [detail];
    // The handle keeps its identity, so a selected handle stays selected.
    if (old?.handle) {
      const end = editor.history.begin('Fit stairs handle', [], [old.handle]);
      fitHandleTo(doc, old.handle, r.result.bounds, r.result.base);
      end();
    } else {
      ents.push(doc.addEntity(r.handle));
    }
    editor.history.added('Add stairs', world, ents);
  });
  editor.changed();
  return { detail, result };
}

/** Rebuilds stored stairs with changes to their spec (options are merged). */
export function regenerateStairs(editor: Editor, detail: MapEntity, patch: Partial<Omit<StairsSpec, 'options'>> & { options?: Partial<StairsOptions> } = {}, label = 'Edit stairs'): { detail: MapEntity; result: StairsResult } | null {
  const s = stairsOf(detail);
  if (!s) return null;
  const r = applyStairs(editor, { ...s, ...patch, options: { ...s.options, ...patch.options } }, label, detail);
  selectStairs(editor, r.detail);
  return r;
}

/** The stairs (their func_details) whose handles are selected, if the selection is nothing but such handles. */
export function selectedStairs(editor: Editor): MapEntity[] {
  const sel = editor.selection;
  if (sel.solids.size || !sel.entities.size || ![...sel.entities].every((e) => kindOf(e) === STAIRS_HANDLE)) return [];
  return [...sel.entities].map((h) => stairsOwner(editor.doc, h)).filter((d): d is MapEntity => !!d);
}

/** Selects stairs by their handle (or their func_detail if they have none). */
export function selectStairs(editor: Editor, detail: MapEntity): void {
  editor.selection.set([], [findHandle(editor.doc, STAIRS_HANDLE, detail.get(STAIRS_ID_KEY) ?? '') ?? detail]);
}

/**
 * Rebuilds stairs where their handle was moved to (call when the drag ends): every point moves with it, and up or
 * down when the handle was lifted or lowered. A resize only puts the handle back (the points set the size).
 */
export function stairsHandleDragged(editor: Editor, handle: MapEntity, mode: 'translate' | 'scale'): void {
  const detail = stairsOwner(editor.doc, handle);
  const s = detail && stairsOf(detail);
  const box = handleBox(handle);
  if (!detail || !s || !box) return;
  // Where the handle was before the drag: round what the stairs build now.
  const r = buildStairs(VmfDocument.empty(), s);
  const dx = Math.round(box.min.x - r.bounds.x0), dy = Math.round(box.min.y - r.bounds.y0), dz = Math.round(box.min.z - r.base);
  if (mode === 'scale' || (!dx && !dy && !dz)) {
    const end = editor.history.begin('Fit stairs handle', [], [handle]);
    fitHandleTo(editor.doc, handle, r.bounds, r.base);
    end();
    return;
  }
  regenerateStairs(editor, detail, { nodes: s.nodes.map((n) => ({ x: n.x + dx, y: n.y + dy, z: n.z + dz })) }, 'Move stairs');
}

/** Builds a copy of stairs (same points and options) next to them, along +x, and selects the copy. */
export function duplicateStairs(editor: Editor, detail: MapEntity): MapEntity | null {
  const s = stairsOf(detail);
  if (!s) return null;
  const xs = s.nodes.map((n) => n.x);
  const dx = Math.max(...xs) - Math.min(...xs) + s.options.width + 128;
  const r = applyStairs(editor, { ...s, uid: newStairsUid(), nodes: s.nodes.map((n) => ({ ...n, x: n.x + dx })) }, 'Duplicate stairs');
  selectStairs(editor, r.detail);
  return r.detail;
}

/** Deletes stairs and everything they made (one undo step). */
export function deleteStairs(editor: Editor, detail: MapEntity): void {
  const s = stairsOf(detail);
  if (!s) return;
  const m = stairsMembers(editor.doc, s.uid);
  editor.history.remove('Delete stairs', m.world, [detail, ...(m.handle ? [m.handle] : [])]);
  editor.selection.clear();
  editor.changed();
}
