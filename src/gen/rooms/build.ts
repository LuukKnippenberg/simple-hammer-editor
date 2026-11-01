import { Vector3 } from 'three';
import { KVNode, KVPair } from '../../vmf/keyvalues.ts';
import { vecStr, type VmfDocument } from '../../vmf/map.ts';
import { editorBlock } from '../../edit/actions.ts';
import { Rng } from '../rng.ts';
import type { PoiEntity } from '../poi/types.ts';
import { roomLayout, type RoomBuildingSpec, type RoomLayout } from './model.ts';
import { roomShell, STATION_STYLE, type RoomStyle } from './shell.ts';
import { dressRoom } from './dressers.ts';
import { cameraFaces, outerRelief, wallRelief, wallWear } from './relief.ts';
import { hideCoveredFaces, overlaySides } from '../../geom/hidden.ts';

/** Ties everything an interior building made to it (its func_detail, brush entities and point entities). */
export const ROOMS_ID_KEY = 'she_rooms_id';

export interface RoomBuildingResult {
  layout: RoomLayout;
  /** World brushes (walls). */
  world: KVNode[];
  /** Entities: the func_detail (floors, platforms, pillars, counters), the roof, glass and point entities. */
  entities: KVNode[];
  counts: { walls: number; detail: number; relief: number; props: number; lights: number; overlays: number };
}

function brushEntity(doc: VmfDocument, classname: string, keys: Record<string, string>, solids: KVNode[]): KVNode {
  const e = new KVNode('entity');
  e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', classname));
  for (const [k, v] of Object.entries(keys)) e.items.push(new KVPair(k, v));
  e.items.push(...solids, editorBlock());
  return e;
}

function pointEntity(doc: VmfDocument, pe: PoiEntity, uid: string): KVNode {
  const e = new KVNode('entity');
  e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', pe.classname));
  for (const [k, v] of Object.entries(pe.keys)) e.items.push(new KVPair(k, v));
  e.items.push(new KVPair(ROOMS_ID_KEY, uid), new KVPair('origin', vecStr(pe.origin ?? new Vector3())));
  return e;
}

/** Brush entity keys: never solid for the game's traces, drawn or not, casting vrad shadows or not. */
const FUNC_BRUSH = (name: string, draw: boolean, shadows: boolean) => ({
  targetname: name, Solidity: '1', spawnflags: '2', rendermode: draw ? '0' : '10', disableshadows: '1', vrad_brush_cast_shadows: shadows ? '1' : '0', StartDisabled: '0',
});

/**
 * Builds an interior building: lays out its rooms, makes the shell (walls as world brushes; roof and glass as
 * func_brushes, which cost vbsp no t-junctions) and furnishes every room by its type. Returns the nodes without
 * adding them (`addRoomBuilding` adds them to a document).
 */
export function roomBuilding(doc: VmfDocument, spec: RoomBuildingSpec, style: RoomStyle = STATION_STYLE): RoomBuildingResult {
  const layout = roomLayout(spec);
  const shell = roomShell(doc, layout, style);
  const uid = spec.uid;
  const rng = new Rng(spec.seed);
  const detail: KVNode[] = [], points: KVNode[] = [], extra: KVNode[] = [];
  // Relief, lanterns, posters and stains on the walls the camera sees.
  const faces = cameraFaces(layout);
  const walls = wallRelief(doc, layout, faces);
  const relief = [...walls.relief, ...outerRelief(doc, layout)];
  for (const pe of [...walls.entities, ...wallWear(layout, faces, shell.world, new Rng(spec.seed * 7 + 3))]) points.push(pointEntity(doc, pe, uid));
  for (const room of layout.rooms) {
    const { output, ctx } = dressRoom(doc, layout, room, rng.int(1, 1e9));
    relief.push(...ctx.relief);
    detail.push(...output.world, ...output.detail);
    for (const pe of output.entities) {
      if (pe.solids?.length) extra.push(brushEntity(doc, pe.classname, { ...pe.keys, [ROOMS_ID_KEY]: uid }, pe.solids));
      else points.push(pointEntity(doc, pe, uid));
    }
  }
  // Never-visible faces to nodraw (the roof is never drawn: the walls under it stay as they are).
  const drawn = [...shell.world, ...detail, ...relief, ...shell.glass, ...extra.filter((e) => /^func_(detail|brush)$/i.test(e.get('classname') ?? '') && e.get('rendermode') !== '10').flatMap((e) => e.childrenNamed('solid'))];
  hideCoveredFaces(drawn, { keep: overlaySides(points), groundAt: () => layout.floor });
  const entities = [
    brushEntity(doc, 'func_detail', { [ROOMS_ID_KEY]: uid }, detail),
    brushEntity(doc, 'func_brush', { ...FUNC_BRUSH(`rooms_${uid}_roof`, false, true), [ROOMS_ID_KEY]: uid }, shell.roof),
    ...(shell.glass.length ? [brushEntity(doc, 'func_brush', { ...FUNC_BRUSH(`rooms_${uid}_glass`, true, false), [ROOMS_ID_KEY]: uid }, shell.glass)] : []),
    ...(relief.length ? [brushEntity(doc, 'func_brush', { ...FUNC_BRUSH(`rooms_${uid}_relief`, true, true), [ROOMS_ID_KEY]: uid }, relief)] : []),
    ...extra, ...points,
  ];
  const cls = (n: KVNode) => n.get('classname') ?? '';
  return {
    layout, world: shell.world, entities,
    counts: {
      walls: shell.world.length, detail: detail.length, relief: relief.length,
      props: points.filter((n) => /^prop_/.test(cls(n))).length,
      lights: points.filter((n) => /^light/.test(cls(n))).length,
      overlays: points.filter((n) => cls(n) === 'info_overlay').length,
    },
  };
}

/** Builds an interior building into a document (no editor, no undo). */
export function addRoomBuilding(doc: VmfDocument, spec: RoomBuildingSpec, style: RoomStyle = STATION_STYLE): RoomBuildingResult {
  const r = roomBuilding(doc, spec, style);
  for (const n of r.world) doc.addSolid(n);
  for (const e of r.entities) doc.addEntity(e);
  return r;
}
