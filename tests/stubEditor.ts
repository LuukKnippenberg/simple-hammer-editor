import { VmfDocument, type MapEntity, type MapSolid } from '../src/vmf/map.ts';
import { History } from '../src/edit/history.ts';
import type { Editor } from '../src/editor.ts';

/**
 * Enough of an Editor for actions and generators in tests: a document, undo history, no-op change hooks, no world to
 * ray-cast against (handles count as visible), and a selection that remembers what was selected.
 */
export function stubEditor(doc = VmfDocument.empty()): Editor {
  const selection = {
    solids: new Set<MapSolid>(), entities: new Set<MapEntity>(),
    set(solids: MapSolid[], entities: MapEntity[] = []) { this.solids = new Set(solids); this.entities = new Set(entities); },
    clear() { this.solids.clear(); this.entities.clear(); },
  };
  return {
    doc, history: new History(() => doc), changed() {}, emit() {}, selection,
    world: { raycast: () => null, visibleKinds: { handle: true } },
  } as unknown as Editor;
}
