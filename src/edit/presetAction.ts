import type { Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { entityNode } from './actions.ts';
import { nextPresetName, presetEntities, type SoundPreset } from '../lw/soundPresets.ts';

/** Adds a sound preset (standing alone, or onto an existing prop) as one undo step; selects its sound. */
export function addPreset(editor: Editor, preset: SoundPreset, at: Vector3, yaw: number, onto?: MapEntity): MapEntity[] {
  const doc = editor.doc;
  const name = nextPresetName(doc.entities, preset.id);
  const created = presetEntities(preset, name, at, yaw, onto).map((e) => doc.addEntity(entityNode(editor, e.classname, e.origin, e.keys)));
  editor.history.added(`Add ${preset.label.toLowerCase()}`, [], created);
  editor.changed();
  editor.selection.set([], created.filter((e) => e.classname === 'ambient_generic').slice(0, 1));
  return created;
}
