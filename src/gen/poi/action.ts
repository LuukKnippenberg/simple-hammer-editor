import { Raycaster, Vector3 } from 'three';
import type { Editor } from '../../editor.ts';
import { KVNode, KVPair } from '../../vmf/keyvalues.ts';
import type { MapEntity, MapSolid } from '../../vmf/map.ts';
import { editorBlock, entityNode } from '../../edit/actions.ts';
import { solidBounds } from '../../edit/brushes.ts';
import { readDisp, vertexPos, type Disp } from '../../edit/terrain.ts';
import { buildPoi, newSpec, poiOf } from './registry.ts';
import { encodePoi, POI_ID_KEY, POI_KEY, POI_WORLD_KEY } from './spec.ts';
import type { PoiEntity, PoiSpec, PoiType, Rect } from './types.ts';
import type { ParamValue } from '../../lw/kits.ts';
import type { Landscape, Rotation } from './types.ts';

/**
 * Editor actions for POIs: generate one into a rectangle, rebuild it in place from its stored spec (after
 * a parameter change, or with a new seed), delete it. Each is one undo step.
 */

export interface PoiMembers {
  detail: MapEntity | null;
  entities: MapEntity[];
  world: MapSolid[];
}

/** Everything a POI made: its func_detail, its entities and its world brushes. */
export function poiMembers(editor: Editor, uid: string): PoiMembers {
  const doc = editor.doc;
  const detail = doc.entities.find((e) => e.classname === 'func_detail' && e.get(POI_KEY) && e.get(POI_ID_KEY) === uid) ?? null;
  const entities = doc.entities.filter((e) => e !== detail && e.get(POI_ID_KEY) === uid);
  const ids = new Set((detail?.get(POI_WORLD_KEY) ?? '').split(' ').filter(Boolean));
  const world = ids.size ? doc.worldEntity.solids.filter((s) => ids.has(s.node.get('id') ?? '')) : [];
  return { detail, entities, world };
}

/** The POI an entity or brush belongs to (its func_detail), if any. */
export function poiOwner(editor: Editor, e: MapEntity | null | undefined): MapEntity | null {
  if (!e) return null;
  if (poiOf(e)) return e;
  const uid = e.get(POI_ID_KEY);
  return uid ? poiMembers(editor, uid).detail : null;
}

const ANCHOR_KEY = 'she_poi_anchor';
const SKIP = /^(trigger_|fow_blocker|func_nav_blocker|func_clip|func_areaportal)/;

/** Terrain height under a world point, ignoring the POI's own brushes (and triggers and blockers). */
export function groundSampler(editor: Editor, uid: string | null, fallback: number, levelled: Rect | null, levelZ: number): (x: number, y: number) => number {
  const own = uid ? poiMembers(editor, uid) : null;
  const ownWorld = new Set(own?.world ?? []);
  const ray = new Raycaster();
  return (x, y) => {
    if (levelled && x >= levelled.x0 && x <= levelled.x1 && y >= levelled.y0 && y <= levelled.y1) return levelZ;
    let top = fallback + 4096;
    for (let i = 0; i < 8; i++) {
      ray.set(new Vector3(x, y, top), new Vector3(0, 0, -1));
      const hit = editor.world.raycast(ray);
      if (!hit) return fallback;
      const ent = hit.solid.entity;
      const mine = ownWorld.has(hit.solid) || (ent && (ent.get(POI_ID_KEY) === uid && uid !== null)) || (ent && SKIP.test(ent.classname));
      if (!mine) return hit.point.z;
      top = hit.point.z - 1;
    }
    return fallback;
  };
}

function writeRows(disp: KVNode, name: string, size: number, stride: number, data: Float32Array): void {
  let block = disp.child(name);
  if (!block) {
    block = new KVNode(name);
    disp.items.push(block);
  }
  const fmt = (v: number) => String(Math.round(v * 100) / 100);
  for (let r = 0; r < size; r++) {
    const vals: string[] = [];
    for (let k = 0; k < size * stride; k++) vals.push(fmt(data[r * size * stride + k]));
    block.set('row' + r, vals.join(' '));
  }
}

/**
 * Levels displacement terrain under a rectangle to `z`, blending back to the old height over `margin`, and
 * paints the terrain's second texture there. Returns the patches it changed (already recorded for undo).
 */
export function levelTerrain(editor: Editor, r: Rect, z: number, paint: boolean, margin = 192): Disp[] {
  const disps = editor.doc.allSolids().filter((s) => s.isDisplacement).map(readDisp).filter((d): d is Disp => !!d)
    .filter((d) => d.bounds.max.x >= r.x0 - margin && d.bounds.min.x <= r.x1 + margin && d.bounds.max.y >= r.y0 - margin && d.bounds.min.y <= r.y1 + margin);
  if (!disps.length) return [];
  const end = editor.history.begin('Level terrain', disps.map((d) => d.solid));
  for (const d of disps) {
    for (let i = 0; i < d.size * d.size; i++) {
      const p = vertexPos(d, i);
      const out = Math.max(r.x0 - p.x, p.x - r.x1, r.y0 - p.y, p.y - r.y1, 0);
      const t = out <= 0 ? 1 : Math.max(0, 1 - out / margin);
      if (t <= 0) continue;
      const w = t * t * (3 - 2 * t);
      const nz = d.normals[i * 3 + 2] || 1;
      d.dists[i] += ((z - p.z) * w) / nz;
      if (paint) d.alphas[i] = Math.max(d.alphas[i], 255 * Math.min(1, w * 1.2));
    }
    writeRows(d.node, 'distances', d.size, 1, d.dists);
    if (paint) writeRows(d.node, 'alphas', d.size, 1, d.alphas);
    d.solid.reload();
  }
  end();
  return disps;
}

function detailNode(editor: Editor, spec: PoiSpec, solids: KVNode[]): KVNode {
  const e = new KVNode('entity');
  e.items.push(new KVPair('id', String(editor.doc.nextId())), new KVPair('classname', 'func_detail'),
    new KVPair(POI_KEY, encodePoi(spec)), new KVPair(POI_ID_KEY, spec.uid), ...solids, editorBlock('90 200 120'));
  return e;
}

function entityFor(editor: Editor, uid: string, e: PoiEntity): KVNode {
  if (e.solids?.length) {
    const node = new KVNode('entity');
    node.items.push(new KVPair('id', String(editor.doc.nextId())), new KVPair('classname', e.classname));
    for (const [k, v] of Object.entries(e.keys)) node.items.push(new KVPair(k, v));
    node.items.push(new KVPair(POI_ID_KEY, uid), ...e.solids, editorBlock());
    return node;
  }
  return entityNode(editor, e.classname, e.origin ?? null, { ...e.keys, [POI_ID_KEY]: uid });
}

/**
 * Builds (or rebuilds) a POI: levels the terrain, builds the brushes and entities from the spec, and swaps
 * them in for the old ones. One undo step. Returns the POI's func_detail.
 */
export function applyPoi(editor: Editor, spec: PoiSpec, label: string, existing: MapEntity | null = null): MapEntity {
  const doc = editor.doc;
  let detail: MapEntity | null = existing;
  editor.history.group(label, () => {
    const old = existing ? poiMembers(editor, existing.get(POI_ID_KEY) ?? spec.uid) : { detail: null, entities: [], world: [] };
    const level = spec.params.level !== false && spec.params.level !== '0';
    const levelled = level ? levelTerrain(editor, spec.rect, spec.z, true).length > 0 : false;
    const ground = groundSampler(editor, existing ? spec.uid : null, spec.z, levelled ? spec.rect : null, spec.z);
    const out = buildPoi(doc, spec, ground);
    if (old.entities.length || old.world.length) editor.history.remove('Remove old POI parts', old.world, old.entities);
    const world = out.world.map((n) => doc.addSolid(n));
    if (detail) {
      const end = editor.history.begin('Rebuild POI', [], [detail]);
      detail.node.items = detail.node.items.filter((it) => !(it instanceof KVNode && it.name.toLowerCase() === 'solid'));
      const ed = detail.node.items.findIndex((it) => it instanceof KVNode && it.name.toLowerCase() === 'editor');
      detail.node.items.splice(ed >= 0 ? ed : detail.node.items.length, 0, ...out.detail);
      detail.node.set(POI_KEY, encodePoi(spec));
      detail.node.set(POI_ID_KEY, spec.uid);
      detail.reload();
      end();
    } else {
      detail = doc.addEntity(detailNode(editor, spec, out.detail));
    }
    // Where the first brush was built, so a POI moved with the gizmo is rebuilt where it now is.
    if (detail.solids[0]) { const b = solidBounds(detail.solids[0]); detail.set(ANCHOR_KEY, `${Math.round(b.min.x)} ${Math.round(b.min.y)}`); }
    if (world.length) detail.set(POI_WORLD_KEY, world.map((s) => s.node.get('id')).join(' '));
    else detail.node.delete(POI_WORLD_KEY);
    const ents = out.entities.map((e) => doc.addEntity(entityFor(editor, spec.uid, e)));
    editor.history.added('Add POI', world, existing ? ents : [detail, ...ents]);
  });
  editor.changed();
  return detail!;
}

/** Generates a new POI of a type into a world rectangle standing at `z`. */
export function generatePoi(editor: Editor, type: PoiType, r: Rect, z: number, o: { rotation?: Rotation; seed?: number; landscape?: Landscape; params?: Record<string, ParamValue> } = {}): MapEntity {
  const spec = newSpec(type, r, z, o);
  const e = applyPoi(editor, spec, `Generate ${type.label.toLowerCase()}`);
  editor.selection.set([], [e]);
  return e;
}

/** Rebuilds a POI with changes to its spec (parameters, seed, rotation, rectangle). */
export function regeneratePoi(editor: Editor, detail: MapEntity, patch: Partial<PoiSpec> = {}, label = 'Regenerate POI'): MapEntity | null {
  const p = poiOf(detail);
  if (!p) return null;
  const spec: PoiSpec = { ...p.spec, ...patch, params: { ...p.spec.params, ...patch.params } };
  // The POI was moved with the gizmo: follow it (its brushes moved, the stored rectangle didn't).
  if (!patch.rect) {
    const moved = movedBy(detail);
    if (moved) spec.rect = { x0: spec.rect.x0 + moved[0], y0: spec.rect.y0 + moved[1], x1: spec.rect.x1 + moved[0], y1: spec.rect.y1 + moved[1] };
  }
  const e = applyPoi(editor, spec, label, detail);
  editor.selection.set([], [e]);
  return e;
}

/** How far a POI's brushes were moved (whole units in x and y) since it was built, or null. */
function movedBy(detail: MapEntity): [number, number] | null {
  const mark = detail.solids[0];
  const stored = detail.get(ANCHOR_KEY);
  if (!mark || !stored) return null;
  const b = solidBounds(mark);
  const [ax, ay] = stored.split(' ').map(Number);
  const dx = Math.round(b.min.x - ax), dy = Math.round(b.min.y - ay);
  return dx || dy ? [dx, dy] : null;
}

/** Deletes a POI and everything it made (one undo step). */
export function deletePoi(editor: Editor, detail: MapEntity): void {
  const uid = detail.get(POI_ID_KEY);
  if (!uid) return;
  const m = poiMembers(editor, uid);
  editor.history.remove('Delete POI', m.world, [detail, ...m.entities]);
  editor.selection.clear();
  editor.changed();
}

/** Turns selected world block brushes into POIs of a type (each block's top is the ground). */
export function poisFromBlocks(editor: Editor, type: PoiType, solids: MapSolid[], o: { rotation?: Rotation; seed?: number; landscape?: Landscape; params?: Record<string, ParamValue> }): MapEntity[] {
  const blocks = solids.filter((s) => !s.entity && !s.isDisplacement);
  const out: MapEntity[] = [];
  if (!blocks.length) return out;
  editor.history.group(`Generate ${type.label.toLowerCase()}`, () => {
    blocks.forEach((s, i) => {
      const b = solidBounds(s);
      const r = { x0: b.min.x, y0: b.min.y, x1: b.max.x, y1: b.max.y };
      editor.history.remove('Remove block', [s]);
      const spec = newSpec(type, r, b.min.z, { ...o, seed: (o.seed ?? Math.floor(Math.random() * 100000)) + i * 7919 });
      out.push(applyPoi(editor, spec, 'Generate POI'));
    });
  });
  editor.selection.set([], out);
  return out;
}

/** Re-exported for scripts, which must reach the registry through the same module graph as the app. */
export { poiType, POI_TYPES } from './registry.ts';
