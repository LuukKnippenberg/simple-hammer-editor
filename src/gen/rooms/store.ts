import { KVNode } from '../../vmf/keyvalues.ts';
import type { MapEntity, MapSolid, VmfDocument } from '../../vmf/map.ts';
import { encodeIds, idTest } from '../buildingStore.ts';
import { findHandle, newHandle, ROOMS_HANDLE } from '../handle.ts';
import type { LinkKind } from './types.ts';
import { roomBuilding, ROOMS_ID_KEY, type RoomBuildingResult } from './build.ts';
import type { RoomBuildingSpec, Side } from './model.ts';
import type { RoomStyle } from './shell.ts';

/**
 * Stored interior buildings. A building keeps its spec on its func_detail in the `she_rooms` key (like blocks of
 * buildings keep theirs in `she_buildings`); `she_rooms_id` ties its brush entities, point entities and handle to
 * it, and `she_rooms_world` lists its world brushes (the walls), so a rebuild replaces exactly what it made.
 */
export const ROOMS_KEY = 'she_rooms';
export const ROOMS_WORLD_KEY = 'she_rooms_world';
export { ROOMS_ID_KEY };

const clean = (s: string) => s.replace(/[|;:,"]/g, ' ').trim();
const SIDES: Side[] = ['n', 'e', 's', 'w'];
const LINKS: LinkKind[] = ['wall', 'door', 'arches', 'open'];

/**
 * The spec as one key value: `uid|seed|x y z|cell|height|bands|rooms|doors|links`, rooms as
 * `id:type:x0,y0,x1,y1:name` and doors as `x,y,side,width`, each list joined by `;`.
 */
export function encodeRooms(s: RoomBuildingSpec): string {
  const o = s.origin;
  return [
    clean(s.uid), Math.round(s.seed), `${Math.round(o.x)} ${Math.round(o.y)} ${Math.round(o.z)}`, s.cell, s.height, s.bands.join(''),
    s.rooms.map((r) => `${clean(r.id)}:${clean(r.type)}:${r.cells.x0},${r.cells.y0},${r.cells.x1},${r.cells.y1}:${clean(r.name ?? '')}`).join(';'),
    s.doors.map((d) => `${d.x},${d.y},${d.side},${d.width}`).join(';'),
    s.links.map((l) => `${clean(l.a)},${clean(l.b)},${l.kind}`).join(';'),
  ].join('|');
}

export function decodeRooms(v: string): RoomBuildingSpec | null {
  const p = v.split('|');
  if (p.length < 9) return null;
  const [uid, seed, origin, cell, height, bands, rooms, doors, links] = p;
  const [x, y, z] = origin.split(' ').map(Number);
  if (!uid || ![x, y, z].every(Number.isFinite)) return null;
  const list = (s: string) => s.split(';').filter(Boolean);
  return {
    uid, seed: Number(seed) || 1, origin: { x, y, z }, cell: Number(cell) || 128, height: Number(height) || 384,
    bands: [...bands].filter((c): c is Side => SIDES.includes(c as Side)),
    rooms: list(rooms).map((r) => {
      const [id, type, cells, name] = r.split(':');
      const [x0, y0, x1, y1] = (cells ?? '').split(',').map(Number);
      return { id, type, cells: { x0, y0, x1, y1 }, ...(name ? { name } : {}) };
    }).filter((r) => r.id && [r.cells.x0, r.cells.y0, r.cells.x1, r.cells.y1].every(Number.isFinite)),
    doors: list(doors).map((d) => {
      const [dx, dy, side, width] = d.split(',');
      return { x: Number(dx), y: Number(dy), side: side as Side, width: Number(width) || 1 };
    }).filter((d) => SIDES.includes(d.side) && Number.isFinite(d.x) && Number.isFinite(d.y)),
    links: list(links).map((l) => {
      const [a, b, kind] = l.split(',');
      return { a, b, kind: kind as LinkKind };
    }).filter((l) => l.a && l.b && LINKS.includes(l.kind)),
  };
}

/** The stored spec of a building's func_detail, or null for anything else. */
export function roomsOf(e: MapEntity | null | undefined): RoomBuildingSpec | null {
  const v = e?.classname === 'func_detail' ? e.get(ROOMS_KEY) : undefined;
  return v ? decodeRooms(v) : null;
}

export interface RoomsMembers {
  detail: MapEntity | null;
  entities: MapEntity[];
  world: MapSolid[];
  handle: MapEntity | null;
}

/** Everything a building made: its func_detail, its other entities, its walls and its handle. */
export function roomsMembers(doc: VmfDocument, uid: string): RoomsMembers {
  const detail = doc.entities.find((e) => e.classname === 'func_detail' && e.get(ROOMS_KEY) && e.get(ROOMS_ID_KEY) === uid) ?? null;
  const handle = findHandle(doc, ROOMS_HANDLE, uid);
  const entities = doc.entities.filter((e) => e !== detail && e !== handle && e.get(ROOMS_ID_KEY) === uid);
  const has = idTest(detail?.get(ROOMS_WORLD_KEY));
  const world = detail?.get(ROOMS_WORLD_KEY) ? doc.worldEntity.solids.filter((s) => has(Number(s.node.get('id')))) : [];
  return { detail, entities, world, handle };
}

/** The building (its func_detail) an entity or world brush belongs to, if any. */
export function roomsOwner(doc: VmfDocument, e: MapEntity | null | undefined, solid?: MapSolid | null): MapEntity | null {
  if (e) {
    if (roomsOf(e)) return e;
    const uid = e.get(ROOMS_ID_KEY);
    return uid ? roomsMembers(doc, uid).detail : null;
  }
  if (!solid) return null;
  const id = Number(solid.node.get('id'));
  return doc.entities.find((d) => d.get(ROOMS_KEY) && idTest(d.get(ROOMS_WORLD_KEY))(id)) ?? null;
}

/** The handle's rectangle: around all rooms. */
export const handleRect = (r: RoomBuildingResult) => r.layout.bounds;

/**
 * Builds a building and stores it: the spec on its func_detail, its walls renumbered to one id range and listed
 * there. Returns the nodes to add (world brushes, entities) and the handle node.
 */
export function storedRoomBuilding(doc: VmfDocument, spec: RoomBuildingSpec, style?: RoomStyle): RoomBuildingResult & { detail: KVNode; handle: KVNode } {
  const r = roomBuilding(doc, spec, style);
  const ids = r.world.map((n) => { const id = doc.nextId(); n.set('id', String(id)); return id; });
  const detail = r.entities[0];
  detail.set(ROOMS_KEY, encodeRooms(spec));
  if (ids.length) detail.set(ROOMS_WORLD_KEY, encodeIds(ids));
  return { ...r, detail, handle: newHandle(doc, ROOMS_HANDLE, spec.uid, handleRect(r), spec.origin.z) };
}

/** Builds a stored building into a document (no editor, no undo). */
export function addStoredRoomBuilding(doc: VmfDocument, spec: RoomBuildingSpec, style?: RoomStyle): RoomBuildingResult {
  const r = storedRoomBuilding(doc, spec, style);
  for (const n of r.world) doc.addSolid(n);
  for (const e of [...r.entities, r.handle]) doc.addEntity(e);
  return r;
}
