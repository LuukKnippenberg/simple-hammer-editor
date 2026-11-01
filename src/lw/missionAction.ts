import { Box3, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { getConnections } from '../vmf/io.ts';
import { solidBounds } from '../edit/brushes.ts';
import { buildMissionInto, type BuildReport } from './missionBuild.ts';
import type { MissionGraph } from './mission.ts';

/** Where the mission logic entities go: beside the player start, else the middle of the map. */
export function logicAnchor(doc: VmfDocument): Vector3 {
  const start = doc.entities.find((e) => e.classname === 'info_player_wars' || e.classname === 'info_player_start');
  if (start?.origin) return start.origin.clone().add(new Vector3(256, 256, 0));
  const box = new Box3();
  for (const s of doc.worldEntity.solids.slice(0, 200)) box.union(solidBounds(s));
  return box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
}

/** Builds the flowchart into the open map as one undo step. */
export function buildMission(editor: Editor, g: MissionGraph): BuildReport {
  const doc = editor.doc;
  let report: BuildReport = { entities: 0, connections: 0, warnings: [] };
  editor.history.group('Build mission', () => {
    const old = doc.entities.filter((e) => e.get('she_mission') === '1');
    // Map entities whose outputs the build may change: named ones, and any with outputs to the old logic.
    const touched = doc.entities.filter((e) => e.get('she_mission') !== '1' && (e.get('targetname') || getConnections(e).some((c) => c.target.startsWith('mf_'))));
    const end = editor.history.begin('Mission outputs', [], touched);
    editor.history.remove('Remove old mission logic', [], old);
    report = buildMissionInto(doc, g, logicAnchor(doc));
    end();
    editor.history.added('Add mission logic', [], doc.entities.filter((e) => e.get('she_mission') === '1'));
  });
  editor.changed();
  return report;
}

/** After an edit to `editor.mission`: marks the map unsaved (the graph is saved with it) and tells the mission views. */
export function missionChanged(editor: Editor): void {
  editor.dirty = true;
  editor.emit('mission');
}
