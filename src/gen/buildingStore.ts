import { Box3, Vector3 } from 'three';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import { MapSolid, VmfDocument, type MapEntity } from '../vmf/map.ts';
import { solidBounds } from '../edit/brushes.ts';
import { editorBlock } from '../edit/actions.ts';
import { generateBuildings, type BuildingOptions, type GeneratedBuildings } from './buildings.ts';
import { streetDressing, type BlockDressing } from './streets.ts';
import type { FeatureEntity } from './facadeFeatures.ts';
import { Rng } from './rng.ts';
import { BUILDING_HANDLE, findHandle, isGeneratorHandle, newHandle, type HandleRect } from './handle.ts';

/**
 * Stored blocks of buildings. A generated block keeps its footprint and options on its func_detail in the
 * `she_buildings` key (like roads keep theirs in `she_road`, POIs in `she_poi`); `she_building_id` ties its
 * point entities and handle to it, and `she_building_world` lists its world brushes, so a rebuild replaces
 * exactly what the block made. Blocks generated together form a group: the group's street dressing (cables,
 * lamps, trees between its blocks) carries `she_building_group` and is rebuilt with any of its blocks.
 */
export const BLOCK_KEY = 'she_buildings';
export const BLOCK_ID_KEY = BUILDING_HANDLE.idKey;
export const BLOCK_WORLD_KEY = 'she_building_world';
export const GROUP_KEY = 'she_building_group';
/** Where the block's first detail brush was built, so a block moved by its brushes is rebuilt where it now is. */
export const BLOCK_ANCHOR_KEY = 'she_building_anchor';

/** How the group's street dressing stands: on each block's level (`flat`), on the ground and roads under it, or none. */
export type StreetMode = 'flat' | 'ground' | 'none';

export interface BlockSpec {
  uid: string;
  group: string;
  street: StreetMode;
  /** Seed of the group's street dressing (the same on every block of the group). */
  groupSeed: number;
  rect: HandleRect;
  z: number;
  options: BuildingOptions;
}

const clean = (s: string) => s.replace(/[|;="]/g, ' ').trim();

/** Options as `key=value;...`: any option is stored, including ones added after this was written. */
export function encodeOptions(o: BuildingOptions): string {
  return Object.entries(o).filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${clean(k)}=${typeof v === 'number' ? Math.round(v * 1000) / 1000 : clean(String(v))}`).join(';');
}

export function decodeOptions(s: string): BuildingOptions {
  const o: Record<string, string | number | boolean> = {};
  for (const kv of s.split(';')) {
    const i = kv.indexOf('=');
    if (i <= 0) continue;
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    o[k] = v === 'true' ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return { seed: 1, minFloors: 3, maxFloors: 6, alleys: false, roofProps: true, ...o } as BuildingOptions;
}

export function encodeBlock(b: BlockSpec): string {
  const r = b.rect;
  return [b.uid, b.group, b.street, b.groupSeed, `${Math.round(r.x0)} ${Math.round(r.y0)} ${Math.round(r.x1)} ${Math.round(r.y1)}`, Math.round(b.z), encodeOptions(b.options)].join('|');
}

export function decodeBlock(s: string): BlockSpec | null {
  const parts = s.split('|');
  if (parts.length < 7) return null;
  const [uid, group, street, gseed, rs, z, opts] = parts;
  const [x0, y0, x1, y1] = rs.split(' ').map(Number);
  if (![x0, y0, x1, y1].every(Number.isFinite) || !uid) return null;
  return {
    uid, group: group || uid, street: (['flat', 'ground', 'none'].includes(street) ? street : 'flat') as StreetMode,
    groupSeed: Number(gseed) || 1, rect: { x0, y0, x1, y1 }, z: Number(z) || 0, options: decodeOptions(opts),
  };
}

/** A fresh short id for a new block or group. */
export const newBlockUid = (): string => Math.random().toString(36).slice(2, 8);

/** The stored spec of a block's func_detail, or null for anything else. */
export function blockOf(e: MapEntity | null | undefined): BlockSpec | null {
  const v = e?.classname === 'func_detail' ? e.get(BLOCK_KEY) : undefined;
  return v ? decodeBlock(v) : null;
}

/** The footprint generateBuildings takes. */
export const footprintOf = (b: BlockSpec): Box3 => new Box3(new Vector3(b.rect.x0, b.rect.y0, b.z), new Vector3(b.rect.x1, b.rect.y1, b.z));

// --- World brush ids ---------------------------------------------------------------------------------------

/** Ids as ranges, `"120-180 200"`: a block's world brushes get consecutive ids, so it is one range. */
export function encodeIds(ids: number[]): string {
  const s = [...ids].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}-${s[j]}` : String(s[i]));
    i = j + 1;
  }
  return out.join(' ');
}

export function idTest(ranges: string | undefined): (id: number) => boolean {
  const rs = (ranges ?? '').split(' ').filter(Boolean).map((r) => { const [a, b = a] = r.split('-').map(Number); return [a, b]; });
  return (id) => rs.some(([a, b]) => id >= a && id <= b);
}

/** Gives world brush nodes fresh consecutive ids and returns them as ranges. */
function renumber(doc: VmfDocument, nodes: KVNode[]): string {
  return encodeIds(nodes.map((n) => { const id = doc.nextId(); n.set('id', String(id)); return id; }));
}

// --- Members ----------------------------------------------------------------------------------------------

export interface BlockMembers {
  detail: MapEntity | null;
  entities: MapEntity[];
  world: MapSolid[];
  handle: MapEntity | null;
}

/** Everything a block made: its func_detail, its entities, its world brushes and its handle. */
export function blockMembers(doc: VmfDocument, uid: string): BlockMembers {
  const detail = doc.entities.find((e) => e.classname === 'func_detail' && e.get(BLOCK_KEY) && e.get(BLOCK_ID_KEY) === uid) ?? null;
  const entities = doc.entities.filter((e) => e !== detail && !isGeneratorHandle(e) && e.get(BLOCK_ID_KEY) === uid);
  const has = idTest(detail?.get(BLOCK_WORLD_KEY));
  const world = detail?.get(BLOCK_WORLD_KEY) ? doc.worldEntity.solids.filter((s) => has(Number(s.node.get('id')))) : [];
  return { detail, entities, world, handle: findHandle(doc, BUILDING_HANDLE, uid) };
}

/** The blocks (their func_details) of a group, in the order they were made. */
export function blocksInGroup(doc: VmfDocument, group: string): MapEntity[] {
  return doc.entities.filter((e) => blockOf(e)?.group === group);
}

/** The group's street dressing: cables, lamps and trees. */
export const groupDressing = (doc: VmfDocument, group: string): MapEntity[] => doc.entities.filter((e) => e.get(GROUP_KEY) === group);

/** The block a world brush belongs to (its func_detail), if any. */
export function blockOfSolid(doc: VmfDocument, solid: MapSolid): MapEntity | null {
  return blockFinder(doc)(solid);
}

/** Looks up the blocks of many brushes: the blocks' id ranges are read once. */
export function blockFinder(doc: VmfDocument): (solid: MapSolid) => MapEntity | null {
  const blocks = doc.entities.filter((e) => e.get(BLOCK_WORLD_KEY) && e.get(BLOCK_KEY)).map((e) => ({ e, has: idTest(e.get(BLOCK_WORLD_KEY)) }));
  return (solid) => {
    if (solid.entity) return blockOwner(doc, solid.entity);
    const id = Number(solid.node.get('id'));
    return blocks.find((b) => b.has(id))?.e ?? null;
  };
}

/** The block an entity belongs to (its func_detail), if any. */
export function blockOwner(doc: VmfDocument, e: MapEntity | null | undefined): MapEntity | null {
  if (!e) return null;
  if (blockOf(e)) return e;
  const uid = e.get(BLOCK_ID_KEY);
  return uid ? blockMembers(doc, uid).detail : null;
}

/** How far a block's brushes were moved (whole units in x and y) since it was built, or null. */
export function movedBy(detail: MapEntity): [number, number] | null {
  const mark = detail.solids[0];
  const stored = detail.get(BLOCK_ANCHOR_KEY);
  if (!mark || !stored) return null;
  const b = solidBounds(mark);
  const [ax, ay] = stored.split(' ').map(Number);
  const dx = Math.round(b.min.x - ax), dy = Math.round(b.min.y - ay);
  return dx || dy ? [dx, dy] : null;
}

// --- Building -------------------------------------------------------------------------------------------

/** The keys a block's func_detail carries (besides id and classname). */
function detailKeys(spec: BlockSpec, world: string, anchor: string | null): [string, string][] {
  const keys: [string, string][] = [[BLOCK_KEY, encodeBlock(spec)], [BLOCK_ID_KEY, spec.uid]];
  if (world) keys.push([BLOCK_WORLD_KEY, world]);
  if (anchor) keys.push([BLOCK_ANCHOR_KEY, anchor]);
  return keys;
}

const anchorOf = (detail: KVNode[], shift: Vector3): string | null => {
  if (!detail[0]) return null;
  const b = solidBounds(new MapSolid(detail[0], null));
  return `${Math.round(b.min.x + shift.x)} ${Math.round(b.min.y + shift.y)}`;
};

/**
 * Writes a generated block into a block func_detail node (new, or the existing one being rebuilt): its spec,
 * its world brushes' ids (renumbered to one range) and its detail brushes. `shift` is how far the document
 * will still be moved (`finishDoc`), for generators that build first and centre the map afterwards.
 */
export function storeBlock(doc: VmfDocument, spec: BlockSpec, out: GeneratedBuildings, node: KVNode | null, shift = new Vector3()): KVNode {
  const world = renumber(doc, out.solids);
  const e = node ?? new KVNode('entity');
  if (!node) e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', 'func_detail'), editorBlock('0 180 0'));
  e.items = e.items.filter((it) => !(it instanceof KVNode && it.name.toLowerCase() === 'solid'));
  for (const k of [BLOCK_WORLD_KEY, BLOCK_ANCHOR_KEY]) e.delete(k);
  for (const [k, v] of detailKeys(spec, world, anchorOf(out.detail, shift))) e.set(k, v);
  const ed = e.items.findIndex((it) => it instanceof KVNode && it.name.toLowerCase() === 'editor');
  e.items.splice(ed >= 0 ? ed : e.items.length, 0, ...out.detail);
  return e;
}

/** A block's handle node; `shift` as in `storeBlock` (the handle is built where the document still is). */
export function blockHandleNode(doc: VmfDocument, spec: BlockSpec, shift = new Vector3()): KVNode {
  const r = spec.rect;
  return newHandle(doc, BUILDING_HANDLE, spec.uid, { x0: r.x0 - shift.x, y0: r.y0 - shift.y, x1: r.x1 - shift.x, y1: r.y1 - shift.y }, spec.z);
}

type EntityMaker = (classname: string, origin: Vector3, keys: Record<string, string>) => KVNode;

/**
 * Generates a block into a new document (Sketch, Generate map): world brush nodes, its func_detail, its tagged
 * entities and its handle. The block's footprint is `spec`'s rectangle less `shift`.
 */
export function blockIntoDoc(doc: VmfDocument, spec: BlockSpec, entity: EntityMaker, shift = new Vector3()): { world: KVNode[]; entities: KVNode[]; out: GeneratedBuildings } {
  const fp = footprintOf(spec).translate(new Vector3(-shift.x, -shift.y, 0));
  const out = generateBuildings(doc, fp, spec.options);
  const detail = storeBlock(doc, spec, out, null, shift);
  const ents = out.entities.map((e) => entity(e.classname, e.origin, { ...e.keys, [BLOCK_ID_KEY]: spec.uid }));
  return { world: out.solids, entities: [detail, ...ents, blockHandleNode(doc, spec, shift)], out };
}

// --- Street dressing ---------------------------------------------------------------------------------------

/** Each block's street dressing input, by footprint and options (it doesn't depend on anything else). */
const dressings = new Map<string, BlockDressing>();
const dressingKey = (b: BlockSpec) => `${encodeBlock({ ...b, uid: '', group: '', groupSeed: 0, street: 'none' })}`;

export function rememberDressing(b: BlockSpec, d: BlockDressing): void {
  const k = dressingKey(b);
  dressings.delete(k);
  dressings.set(k, d);
  if (dressings.size > 400) dressings.delete(dressings.keys().next().value!);
}

/** What a block leaves for the street pass; generated again (into a scratch document) when not remembered. */
export function dressingOf(b: BlockSpec): BlockDressing {
  const known = dressings.get(dressingKey(b));
  if (known) return known;
  const d = generateBuildings(VmfDocument.empty(), footprintOf(b), b.options).dressing;
  rememberDressing(b, d);
  return d;
}

/**
 * The street dressing of a group of blocks, tagged with the group: cables across the streets between them,
 * lamps and trees. `groundAt` gives the height lamps and trees stand at (null: none there).
 */
export function groupStreet(blocks: BlockSpec[], groundAt?: (x: number, y: number) => number | null, known: BlockDressing[] = []): FeatureEntity[] {
  const lead = blocks[0];
  if (!lead || lead.street === 'none') return [];
  const ds = blocks.map((b, i) => known[i] ?? dressingOf(b));
  return streetDressing(ds, new Rng(lead.groupSeed * 3 + 1), { groundAt: lead.street === 'ground' ? groundAt : undefined })
    .map((e) => ({ ...e, keys: { ...ropeNames(e.keys, lead.group), [GROUP_KEY]: lead.group } }));
}

/** Cable keyframes named after the group, so two groups built with the same seed never link each other's. */
function ropeNames(keys: Record<string, string>, group: string): Record<string, string> {
  const out = { ...keys };
  for (const k of ['targetname', 'NextKey']) if (out[k]) out[k] = out[k].replace(/^wire\d+_/, `wire_${group}_`);
  return out;
}
