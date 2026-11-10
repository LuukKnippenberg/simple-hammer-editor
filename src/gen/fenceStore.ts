import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { MapEntity, MapSolid, VmfDocument } from '../vmf/map.ts';
import { editorBlock } from '../edit/actions.ts';
import { encodeIds, idTest } from './buildingStore.ts';
import { FENCE_HANDLE, findHandle, newHandle, type HandleRect } from './handle.ts';
import { entity } from './layout.ts';
import { buildFence, decodeFence, encodeFence, type FenceBuild, type FenceSpec, type Ground } from './fences.ts';

/**
 * Stored fences. A fence keeps its spec on a func_detail in the `she_fence` key (with its posts, panels and rails as
 * that func_detail's brushes; a model fence's holds none); `she_fence_id` ties the handle and the fence's props to
 * it, and `she_fence_world` lists its NPC clip (world brushes), so a rebuild replaces exactly what the fence made.
 * The handle is a small box at A.
 */
export const FENCE_KEY = 'she_fence';
export const FENCE_ID_KEY = FENCE_HANDLE.idKey;
export const FENCE_WORLD_KEY = 'she_fence_world';
const COLOR = '200 160 90';
/** Half the handle's width round point A. */
const HANDLE_HALF = 16;

/** The stored spec of a fence func_detail, or null for anything else. */
export function fenceOf(e: MapEntity | null | undefined): FenceSpec | null {
  const v = e?.classname === 'func_detail' ? e.get(FENCE_KEY) : undefined;
  return v ? decodeFence(v) : null;
}

export interface FenceMembers {
  detail: MapEntity | null;
  props: MapEntity[];
  world: MapSolid[];
  handle: MapEntity | null;
}

/** Everything a fence made: its func_detail, its props, its clip and its handle. */
export function fenceMembers(doc: VmfDocument, uid: string): FenceMembers {
  const detail = doc.entities.find((e) => e.classname === 'func_detail' && e.get(FENCE_KEY) && e.get(FENCE_ID_KEY) === uid) ?? null;
  const props = doc.entities.filter((e) => e !== detail && e.classname !== FENCE_HANDLE.classname && e.get(FENCE_ID_KEY) === uid);
  const has = idTest(detail?.get(FENCE_WORLD_KEY));
  const world = detail?.get(FENCE_WORLD_KEY) ? doc.worldEntity.solids.filter((s) => has(Number(s.node.get('id')))) : [];
  return { detail, props, world, handle: findHandle(doc, FENCE_HANDLE, uid) };
}

/** The fence (its func_detail) an entity or world brush belongs to, if any. */
export function fenceOwner(doc: VmfDocument, e: MapEntity | null | undefined, solid?: MapSolid | null): MapEntity | null {
  if (e) {
    if (fenceOf(e)) return e;
    const uid = e.get(FENCE_ID_KEY);
    return uid ? fenceMembers(doc, uid).detail : null;
  }
  if (!solid) return null;
  const id = Number(solid.node.get('id'));
  return doc.entities.find((d) => d.get(FENCE_KEY) && idTest(d.get(FENCE_WORLD_KEY))(id)) ?? null;
}

/** The handle's box: round point A, at A's height. */
export function fenceHandleRect(spec: Pick<FenceSpec, 'points'>): { rect: HandleRect; z: number } {
  const a = spec.points[0];
  return { rect: { x0: Math.round(a.x) - HANDLE_HALF, y0: Math.round(a.y) - HANDLE_HALF, x1: Math.round(a.x) + HANDLE_HALF, y1: Math.round(a.y) + HANDLE_HALF }, z: Math.round(a.z) };
}

/**
 * Builds a fence and stores it: the spec on the func_detail, the clip renumbered to one id range and listed there,
 * the props tagged with the fence's id. Returns the nodes to add and the handle node.
 */
export function storedFence(doc: VmfDocument, spec: FenceSpec, ground?: Ground): { build: FenceBuild; detail: KVNode; world: KVNode[]; props: KVNode[]; handle: KVNode } {
  const build = buildFence(doc, spec, ground);
  const ids = build.clip.map((n) => { const id = doc.nextId(); n.set('id', String(id)); return id; });
  const detail = new KVNode('entity');
  detail.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', 'func_detail'), new KVPair(FENCE_KEY, encodeFence(spec)), new KVPair(FENCE_ID_KEY, spec.uid));
  if (ids.length) detail.items.push(new KVPair(FENCE_WORLD_KEY, encodeIds(ids)));
  detail.items.push(...build.detail, editorBlock(COLOR));
  const props = build.props.map((p) => entity(doc, p.classname, p.origin, { ...p.keys, [FENCE_ID_KEY]: spec.uid }));
  const { rect, z } = fenceHandleRect(spec);
  return { build, detail, world: build.clip, props, handle: newHandle(doc, FENCE_HANDLE, spec.uid, rect, z) };
}

/** Builds a stored fence into a document (no editor, no undo), for scripts and tests. */
export function addStoredFence(doc: VmfDocument, spec: FenceSpec, ground?: Ground): FenceBuild {
  const r = storedFence(doc, spec, ground);
  for (const n of r.world) doc.addSolid(n);
  doc.addEntity(r.detail);
  for (const p of r.props) doc.addEntity(p);
  doc.addEntity(r.handle);
  return r.build;
}
