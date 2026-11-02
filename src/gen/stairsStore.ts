import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { MapEntity, MapSolid, VmfDocument } from '../vmf/map.ts';
import { editorBlock } from '../edit/actions.ts';
import { encodeIds, idTest } from './buildingStore.ts';
import { findHandle, newHandle, STAIRS_HANDLE } from './handle.ts';
import { buildStairs, decodeStairs, encodeStairs, type StairsResult, type StairsSpec } from './stairs.ts';

/**
 * Stored stairs. They keep their spec on their func_detail in the `she_stairs` key (like interior buildings keep
 * theirs in `she_rooms`); `she_stairs_id` ties the handle to it, and `she_stairs_world` lists the NPC clip ramps
 * (world brushes), so a rebuild replaces exactly what the stairs made.
 */
export const STAIRS_KEY = 'she_stairs';
export const STAIRS_ID_KEY = STAIRS_HANDLE.idKey;
export const STAIRS_WORLD_KEY = 'she_stairs_world';

/** The stored spec of a stairs func_detail, or null for anything else. */
export function stairsOf(e: MapEntity | null | undefined): StairsSpec | null {
  const v = e?.classname === 'func_detail' ? e.get(STAIRS_KEY) : undefined;
  return v ? decodeStairs(v) : null;
}

export interface StairsMembers {
  detail: MapEntity | null;
  world: MapSolid[];
  handle: MapEntity | null;
}

/** Everything stairs made: their func_detail, their clip ramps and their handle. */
export function stairsMembers(doc: VmfDocument, uid: string): StairsMembers {
  const detail = doc.entities.find((e) => e.classname === 'func_detail' && e.get(STAIRS_KEY) && e.get(STAIRS_ID_KEY) === uid) ?? null;
  const has = idTest(detail?.get(STAIRS_WORLD_KEY));
  const world = detail?.get(STAIRS_WORLD_KEY) ? doc.worldEntity.solids.filter((s) => has(Number(s.node.get('id')))) : [];
  return { detail, world, handle: findHandle(doc, STAIRS_HANDLE, uid) };
}

/** The stairs (their func_detail) an entity or world brush belongs to, if any. */
export function stairsOwner(doc: VmfDocument, e: MapEntity | null | undefined, solid?: MapSolid | null): MapEntity | null {
  if (e) {
    if (stairsOf(e)) return e;
    const uid = e.get(STAIRS_ID_KEY);
    return uid ? stairsMembers(doc, uid).detail : null;
  }
  if (!solid) return null;
  const id = Number(solid.node.get('id'));
  return doc.entities.find((d) => d.get(STAIRS_KEY) && idTest(d.get(STAIRS_WORLD_KEY))(id)) ?? null;
}

/**
 * Builds stairs and stores them: the spec on the func_detail, the clip ramps renumbered to one id range and listed
 * there. Returns the nodes to add and the handle node.
 */
export function storedStairs(doc: VmfDocument, spec: StairsSpec): { result: StairsResult; detail: KVNode; world: KVNode[]; handle: KVNode } {
  const result = buildStairs(doc, spec);
  const ids = result.clip.map((n) => { const id = doc.nextId(); n.set('id', String(id)); return id; });
  const detail = new KVNode('entity');
  detail.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', 'func_detail'), new KVPair(STAIRS_KEY, encodeStairs(spec)),
    new KVPair(STAIRS_ID_KEY, spec.uid));
  if (ids.length) detail.items.push(new KVPair(STAIRS_WORLD_KEY, encodeIds(ids)));
  detail.items.push(...result.detail, editorBlock('230 120 200'));
  return { result, detail, world: result.clip, handle: newHandle(doc, STAIRS_HANDLE, spec.uid, result.bounds, result.base) };
}

/** Builds stored stairs into a document (no editor, no undo), for scripts and tests. */
export function addStoredStairs(doc: VmfDocument, spec: StairsSpec): StairsResult {
  const r = storedStairs(doc, spec);
  for (const n of r.world) doc.addSolid(n);
  doc.addEntity(r.detail);
  doc.addEntity(r.handle);
  return r.result;
}
