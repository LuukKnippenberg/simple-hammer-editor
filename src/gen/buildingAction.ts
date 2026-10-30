import type { Editor } from '../editor.ts';
import type { MapEntity, MapSolid } from '../vmf/map.ts';
import { solidBounds } from '../edit/brushes.ts';
import { entityNode } from '../edit/actions.ts';
import { detailEntityNode, generateBuildings, type BuildingOptions } from './buildings.ts';
import { streetDressing, type BlockDressing } from './streets.ts';
import { Rng } from './rng.ts';

/**
 * Replaces each selected block brush with a generated block of buildings, then dresses the streets
 * between them (one undo step).
 */
export function buildingsFromSelection(editor: Editor, opts: Omit<BuildingOptions, 'seed'> & { seed?: number; street?: boolean }): number {
  const solids = [...editor.selection.solids].filter((s) => !s.entity);
  if (!solids.length) return 0;
  const doc = editor.doc;
  const createdSolids: MapSolid[] = [];
  const createdEnts: MapEntity[] = [];
  let count = 0;
  const dressings: BlockDressing[] = [];
  editor.history.group('Generate buildings', () => {
    solids.forEach((s, i) => {
      const box = solidBounds(s);
      const footprint = box.clone();
      footprint.max.z = footprint.min.z;
      // The panel's seed for the first block, a derived one for each further block.
      const r = generateBuildings(doc, footprint, { ...opts, seed: (opts.seed ?? Date.now() % 100000) + i * 7919 });
      count += r.buildings;
      for (const node of r.solids) createdSolids.push(doc.addSolid(node));
      const detail = detailEntityNode(doc, r.detail);
      if (detail) createdEnts.push(doc.addEntity(detail));
      for (const e of r.entities) createdEnts.push(doc.addEntity(entityNode(editor, e.classname, e.origin, e.keys)));
      dressings.push(r.dressing);
    });
    // Cables across the streets between the selected blocks, lamps and trees.
    if (opts.street ?? true) {
      for (const e of streetDressing(dressings, new Rng((opts.seed ?? 1) * 3 + 1))) createdEnts.push(doc.addEntity(entityNode(editor, e.classname, e.origin, e.keys)));
    }
    editor.history.remove('Remove block', solids);
    editor.history.added('Add buildings', createdSolids, createdEnts);
  });
  editor.selection.set(createdSolids);
  editor.changed();
  return count;
}
