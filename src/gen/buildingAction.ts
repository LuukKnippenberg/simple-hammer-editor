import type { Editor } from '../editor.ts';
import type { MapEntity, MapSolid } from '../vmf/map.ts';
import { solidBounds } from '../edit/brushes.ts';
import { entityNode } from '../edit/actions.ts';
import { detailEntityNode, generateBuildings, type BuildingOptions } from './buildings.ts';

/** Replaces each selected block brush with a generated block of buildings (one undo step). */
export function buildingsFromSelection(editor: Editor, opts: Omit<BuildingOptions, 'seed'> & { seed?: number }): number {
  const solids = [...editor.selection.solids].filter((s) => !s.entity);
  if (!solids.length) return 0;
  const doc = editor.doc;
  const createdSolids: MapSolid[] = [];
  const createdEnts: MapEntity[] = [];
  let count = 0;
  editor.history.group('Generate buildings', () => {
    solids.forEach((s, i) => {
      const box = solidBounds(s);
      const footprint = box.clone();
      footprint.max.z = footprint.min.z;
      const r = generateBuildings(doc, footprint, { ...opts, seed: (opts.seed ?? Date.now()) + i * 7919 });
      count += r.buildings;
      for (const node of r.solids) createdSolids.push(doc.addSolid(node));
      const detail = detailEntityNode(doc, r.detail);
      if (detail) createdEnts.push(doc.addEntity(detail));
      for (const e of r.entities) createdEnts.push(doc.addEntity(entityNode(editor, e.classname, e.origin, e.keys)));
    });
    editor.history.remove('Remove block', solids);
    editor.history.added('Add buildings', createdSolids, createdEnts);
  });
  editor.selection.set(createdSolids);
  editor.changed();
  return count;
}
