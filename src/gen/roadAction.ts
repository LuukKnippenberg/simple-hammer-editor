import { Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity, VmfDocument } from '../vmf/map.ts';
import { ROAD_STYLES, buildRoads, keepJoined, offsetLine, roadEntityNode, roadLine, roadOf, setRoadSolids, type RoadSpec } from './roads.ts';
import { dab, readDisp, type Disp } from '../edit/terrain.ts';

/**
 * Paints the terrain's second texture (dirt, mud, ...) along a road: a worn verge along both outer edges,
 * or the whole width under a dirt track. One undo step. Returns how many terrain patches changed.
 */
export function blendRoadIntoGround(editor: Editor, road: RoadSpec): number {
  const disps = editor.doc.allSolids().filter((s) => s.isDisplacement).map(readDisp).filter((d): d is Disp => !!d);
  if (!disps.length) return 0;
  const line = roadLine(road);
  const st = ROAD_STYLES[road.style];
  const edge = road.width / 2 + ((road.kerbs ?? st.kerb) ? 8 : 0) + road.pavement;
  // Terrain vertices are 64 apart, so the dabs must be wide enough to catch two rows of them.
  const passes: [number, number, number][] = st.kerb ? [[edge + 48, 128, 0.75], [-edge - 48, 128, 0.75]] : [[0, edge + 64, 0.9]];
  const touched = new Set<Disp>();
  const end = editor.history.begin('Blend road into ground', disps.map((d) => d.solid));
  for (const [offset, radius, strength] of passes) {
    const pts = offsetLine(line, offset);
    for (let i = 0; i + 1 < pts.length; i++) {
      const n = Math.max(1, Math.ceil(pts[i].distanceTo(pts[i + 1]) / (radius * 0.4)));
      for (let k = 0; k <= n; k++) {
        const p = pts[i].clone().lerp(pts[i + 1], k / n);
        for (const d of dab(disps, new Vector3(p.x, p.y, 0), { mode: 'paint', radius, strength })) touched.add(d);
      }
    }
  }
  for (const d of touched) d.solid.reload();
  end();
  editor.changed();
  return touched.size;
}

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
 * Rebuilds every road (crossings depend on all of them), optionally adding new roads or replacing one road's
 * definition; roads that ended on the replaced road's centre line (T junctions) move with it. One undo step.
 * Returns the first new road's entity, if any.
 */
export function rebuildRoads(editor: Editor, label: string, change: { add?: RoadSpec | RoadSpec[]; replace?: [MapEntity, RoadSpec] } = {}): MapEntity | null {
  const doc = editor.doc;
  const existing = roadEntities(doc);
  let specs = existing.map((r) => (change.replace && r.entity === change.replace[0] ? change.replace[1] : r.road));
  const replaced = change.replace ? existing.findIndex((r) => r.entity === change.replace![0]) : -1;
  if (replaced >= 0) specs = keepJoined(specs, replaced, existing[replaced].road);
  const added = change.add ? (Array.isArray(change.add) ? change.add : [change.add]) : [];
  specs.push(...added);
  let created: MapEntity | null = null;
  editor.history.group(label, () => {
    const solids = buildRoads(doc, specs);
    const end = editor.history.begin('Rebuild roads', [], existing.map((r) => r.entity));
    existing.forEach((r, i) => {
      setRoadSolids(r.entity.node, specs[i], solids[i]);
      r.entity.reload();
    });
    end();
    added.forEach((road, k) => {
      const e = doc.addEntity(roadEntityNode(doc, road, solids[existing.length + k]));
      editor.history.added('Add road', [], [e]);
      created ??= e;
    });
  });
  editor.changed();
  return created;
}
