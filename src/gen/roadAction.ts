import type { Editor } from '../editor.ts';
import type { MapEntity, VmfDocument } from '../vmf/map.ts';
import { buildRoads, roadEntityNode, roadOf, setRoadSolids, type RoadSpec } from './roads.ts';

/** Road entities in document order, with their definitions. */
export function roadEntities(doc: VmfDocument): { entity: MapEntity; road: RoadSpec }[] {
  const out: { entity: MapEntity; road: RoadSpec }[] = [];
  for (const e of doc.entities) {
    const road = roadOf(e);
    if (road) out.push({ entity: e, road });
  }
  return out;
}

/**
 * Rebuilds every road (crossings depend on all of them), optionally adding a new road or replacing one
 * road's definition. One undo step. Returns the new road's entity, if any.
 */
export function rebuildRoads(editor: Editor, label: string, change: { add?: RoadSpec; replace?: [MapEntity, RoadSpec] } = {}): MapEntity | null {
  const doc = editor.doc;
  const existing = roadEntities(doc);
  const specs = existing.map((r) => (change.replace && r.entity === change.replace[0] ? change.replace[1] : r.road));
  if (change.add) specs.push(change.add);
  let created: MapEntity | null = null;
  editor.history.group(label, () => {
    const solids = buildRoads(doc, specs);
    const end = editor.history.begin('Rebuild roads', [], existing.map((r) => r.entity));
    existing.forEach((r, i) => {
      setRoadSolids(r.entity.node, specs[i], solids[i]);
      r.entity.reload();
    });
    end();
    if (change.add) {
      created = doc.addEntity(roadEntityNode(doc, change.add, solids[solids.length - 1]));
      editor.history.added('Add road', [], [created]);
    }
  });
  editor.changed();
  return created;
}
