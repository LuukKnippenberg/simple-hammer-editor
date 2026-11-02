import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { remapSolid, solidBounds, translateSolid } from '../src/edit/brushes.ts';
import { ROOMS_HANDLE, findHandle, handleBox, stripHandles } from '../src/gen/handle.ts';
import { applyRooms, deleteRooms, regenerateRooms, roomsHandleDragged, selectedRooms } from '../src/gen/rooms/action.ts';
import { decodeRooms, encodeRooms, roomsMembers, roomsOf, roomsOwner } from '../src/gen/rooms/store.ts';
import { presetSpec } from '../src/gen/rooms/presets.ts';
import { stubEditor } from './stubEditor.ts';

describe('stored interior buildings', () => {
  it('keeps the whole spec in one key', () => {
    const spec = presetSpec('station', -512, 256, 8, 'abc', 42);
    spec.links.push({ a: 'concourse', b: 'waiting', kind: 'open' });
    spec.rooms[1].name = 'Main hall; with | odd: chars';
    const back = decodeRooms(encodeRooms(spec))!;
    expect(back.rooms[1].name).toBe('Main hall  with   odd  chars');
    back.rooms[1].name = spec.rooms[1].name;
    expect(back).toEqual(spec);
  });

  it('builds, finds its parts, rebuilds in place and undoes', () => {
    const editor = stubEditor();
    const { detail } = applyRooms(editor, presetSpec('customs', 0, 0, 0, 'cu', 5), 'Add');
    const members = roomsMembers(editor.doc, 'cu');
    expect(members.detail).toBe(detail);
    expect(members.world.length).toBeGreaterThan(10);
    expect(members.entities.length).toBeGreaterThan(30);
    expect(members.handle).toBeTruthy();
    // Anything it made leads back to it: a prop, a wall.
    expect(roomsOwner(editor.doc, members.entities.find((e) => /^prop_/.test(e.classname)))).toBe(detail);
    expect(roomsOwner(editor.doc, null, members.world[0])).toBe(detail);
    const count = editor.doc.entities.length, solids = editor.doc.worldEntity.solids.length;
    // A rebuild with another room type replaces everything it made.
    const spec = roomsOf(detail)!;
    spec.rooms[2].type = 'rations';
    const again = regenerateRooms(editor, detail, { rooms: spec.rooms })!;
    expect(roomsOf(again)!.rooms[2].type).toBe('rations');
    expect(editor.doc.worldEntity.solids.length).toBe(solids);
    expect(roomsMembers(editor.doc, 'cu').handle).toBe(members.handle);
    expect(editor.doc.entities.filter((e) => e.get('classname') === 'func_detail' && roomsOf(e))).toHaveLength(1);
    expect(selectedRooms(editor)).toEqual([again]);
    editor.history.undo();
    expect(roomsOf(roomsMembers(editor.doc, 'cu').detail)!.rooms[2].type).toBe('waiting');
    expect(editor.doc.entities.length).toBe(count);
  });

  it('moves the building with its handle, and puts a resized handle back', () => {
    const editor = stubEditor();
    applyRooms(editor, presetSpec('rations', 0, 0, 0, 'ra', 5), 'Add');
    const handle = findHandle(editor.doc, ROOMS_HANDLE, 'ra')!;
    for (const solid of handle.solids) translateSolid(solid, new Vector3(512, -256, 0));
    roomsHandleDragged(editor, handle, 'translate');
    const moved = roomsOf(roomsMembers(editor.doc, 'ra').detail)!;
    expect(moved.origin).toEqual({ x: 512, y: -256, z: 0 });
    const walls = roomsMembers(editor.doc, 'ra').world;
    expect(Math.min(...walls.map((w) => Math.min(...w.sides.flatMap((s) => s.plane.map((p) => p.x)))))).toBe(512 - 16);
    // A resize can't change the rooms: the handle goes back round them.
    const h2 = findHandle(editor.doc, ROOMS_HANDLE, 'ra')!;
    const before = handleBox(h2)!;
    for (const solid of h2.solids) { const bounds = solidBounds(solid); remapSolid(solid, bounds, bounds.clone().expandByVector(new Vector3(256, 0, 0))); }
    roomsHandleDragged(editor, h2, 'scale');
    const box = handleBox(h2)!;
    expect([box.min.x, box.min.y, box.max.x, box.max.y]).toEqual([before.min.x, before.min.y, before.max.x, before.max.y]);
  });

  it('is deleted whole, and its handle is stripped for compiling', () => {
    const editor = stubEditor();
    const { detail } = applyRooms(editor, presetSpec('customs', 0, 0, 0, 'cu', 5), 'Add');
    const copy = VmfDocument.parse(editor.doc.serialize());
    expect(stripHandles(copy)).toBe(1);
    deleteRooms(editor, detail);
    expect(editor.doc.entities.filter((e) => e.get('she_rooms_id'))).toEqual([]);
    expect(editor.doc.worldEntity.solids).toHaveLength(0);
  });
});
