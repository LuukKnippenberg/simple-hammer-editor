import { Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import { vecStr, type MapEntity, type MapSolid } from '../vmf/map.ts';
import { boxSolid, translateSolid } from './brushes.ts';
import { fgdClass } from '../assets/fgd.ts';

export function editorBlock(color = '220 30 220'): KVNode {
  const ed = new KVNode('editor');
  ed.items.push(new KVPair('color', color), new KVPair('visgroupshown', '1'), new KVPair('visgroupautoshown', '1'));
  return ed;
}

/** Builds an entity node with the FGD's default keys filled in. */
export function entityNode(editor: Editor, classname: string, origin: Vector3 | null, keys: Record<string, string> = {}): KVNode {
  const node = new KVNode('entity');
  node.items.push(new KVPair('id', String(editor.doc.nextId())), new KVPair('classname', classname));
  const cls = fgdClass(classname);
  const written = new Set(['id', 'classname', 'origin']);
  for (const [k, v] of Object.entries(keys)) {
    node.items.push(new KVPair(k, v));
    written.add(k.toLowerCase());
  }
  for (const k of cls?.keys ?? []) {
    if (written.has(k.name.toLowerCase()) || k.default === '' || k.type === 'flags') continue;
    node.items.push(new KVPair(k.name, k.default));
    written.add(k.name.toLowerCase());
  }
  if (cls?.keys.some((k) => k.name.toLowerCase() === 'angles') && !written.has('angles')) node.items.push(new KVPair('angles', '0 0 0'));
  if (origin) node.items.push(new KVPair('origin', vecStr(origin)));
  return node;
}

function nextControlPointName(editor: Editor): string {
  const used = new Set(editor.doc.entities.filter((e) => e.classname === 'control_point').map((e) => e.get('targetname')));
  let i = 1;
  while (used.has(String(i))) i++;
  return String(i);
}

/**
 * Places an entity. A control point also gets its trigger_capture_area, which is what makes it capturable.
 */
export function placeEntity(editor: Editor, classname: string, origin: Vector3, keys: Record<string, string> = {}): MapEntity[] {
  const doc = editor.doc;
  const created: MapEntity[] = [];
  if (classname === 'control_point') {
    const name = keys.targetname ?? nextControlPointName(editor);
    created.push(doc.addEntity(entityNode(editor, classname, origin, { targetname: name, ...keys })));
    const trig = new KVNode('entity');
    trig.items.push(
      new KVPair('id', String(doc.nextId())), new KVPair('classname', 'trigger_capture_area'),
      new KVPair('control_point', name), new KVPair('spawnflags', '3'), new KVPair('StartDisabled', '0'),
    );
    const e = doc.addEntity(trig);
    const r = 192;
    const solid = boxSolid(doc, new Vector3(origin.x - r, origin.y - r, origin.z - 16), new Vector3(origin.x + r, origin.y + r, origin.z + 128), 'TOOLS/TOOLSTRIGGER');
    trig.items.push(solid, editorBlock());
    e.reload();
    created.push(e);
  } else {
    created.push(doc.addEntity(entityNode(editor, classname, origin, keys)));
  }
  editor.history.added(`Place ${classname}`, created.flatMap((e) => e.solids), created);
  editor.changed();
  editor.selection.set([], created.slice(0, 1));
  return created;
}

export function deleteSelection(editor: Editor): void {
  const sel = editor.selection;
  if (sel.isEmpty) return;
  editor.history.remove('Delete', [...sel.solids], [...sel.entities]);
  sel.clear();
  editor.changed();
}

/** Copies the selection, offset by one grid step, and selects the copies. */
export function duplicateSelection(editor: Editor): void {
  const sel = editor.selection, doc = editor.doc;
  if (sel.isEmpty) return;
  const d = new Vector3(editor.grid, editor.grid, 0);
  const solids: MapSolid[] = [];
  const ents: MapEntity[] = [];
  for (const s of sel.solids) {
    if (s.entity && sel.entities.has(s.entity)) continue;
    const node = s.node.clone();
    doc.assignIds(node);
    const copy = doc.addSolid(node, s.entity);
    translateSolid(copy, d);
    solids.push(copy);
  }
  for (const e of sel.entities) {
    const node = e.node.clone();
    doc.assignIds(node);
    const copy = doc.addEntity(node);
    if (copy.origin) copy.origin = copy.origin.add(d);
    for (const s of copy.solids) translateSolid(s, d);
    ents.push(copy);
  }
  editor.history.added('Duplicate', solids, ents);
  sel.set(solids, ents);
  editor.changed();
}

export function applyMaterial(editor: Editor, solids: MapSolid[], material: string): void {
  if (!solids.length) return;
  const end = editor.history.begin('Apply material', solids);
  for (const s of solids) {
    for (const side of s.sides) side.material = material.toUpperCase();
    s.commit();
  }
  end();
  editor.changed();
}

/** Rotates selected point entities around Z. */
export function rotateEntities(editor: Editor, degrees: number): void {
  const ents = editor.selection.pointEntities();
  if (!ents.length) return;
  const end = editor.history.begin('Rotate', [], ents);
  for (const e of ents) {
    const a = e.angles;
    a.y = (((a.y + degrees) % 360) + 360) % 360;
    e.angles = a;
  }
  end();
  editor.changed();
}
