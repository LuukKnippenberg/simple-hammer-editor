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
    const s = presetSpec('station', -512, 256, 8, 'abc', 42);
    s.links.push({ a: 'concourse', b: 'waiting', kind: 'open' });
    s.rooms[1].name = 'Main hall; with | odd: chars';
    const back = decodeRooms(encodeRooms(s))!;
    expect(back.rooms[1].name).toBe('Main hall  with   odd  chars');
    back.rooms[1].name = s.rooms[1].name;
    expect(back).toEqual(s);
  });

  it('builds, finds its parts, rebuilds in place and undoes', () => {
    const ed = stubEditor();
    const { detail } = applyRooms(ed, presetSpec('customs', 0, 0, 0, 'cu', 5), 'Add');
    const m = roomsMembers(ed.doc, 'cu');
    expect(m.detail).toBe(detail);
    expect(m.world.length).toBeGreaterThan(10);
    expect(m.entities.length).toBeGreaterThan(30);
    expect(m.handle).toBeTruthy();
    // Anything it made leads back to it: a prop, a wall.
    expect(roomsOwner(ed.doc, m.entities.find((e) => /^prop_/.test(e.classname)))).toBe(detail);
    expect(roomsOwner(ed.doc, null, m.world[0])).toBe(detail);
    const count = ed.doc.entities.length, solids = ed.doc.worldEntity.solids.length;
    // A rebuild with another room type replaces everything it made.
    const spec = roomsOf(detail)!;
    spec.rooms[2].type = 'rations';
    const again = regenerateRooms(ed, detail, { rooms: spec.rooms })!;
    expect(roomsOf(again)!.rooms[2].type).toBe('rations');
    expect(ed.doc.worldEntity.solids.length).toBe(solids);
    expect(roomsMembers(ed.doc, 'cu').handle).toBe(m.handle);
    expect(ed.doc.entities.filter((e) => e.get('classname') === 'func_detail' && roomsOf(e))).toHaveLength(1);
    expect(selectedRooms(ed)).toEqual([again]);
    ed.history.undo();
    expect(roomsOf(roomsMembers(ed.doc, 'cu').detail)!.rooms[2].type).toBe('waiting');
    expect(ed.doc.entities.length).toBe(count);
  });

  it('moves the building with its handle, and puts a resized handle back', () => {
    const ed = stubEditor();
    applyRooms(ed, presetSpec('rations', 0, 0, 0, 'ra', 5), 'Add');
    const h = findHandle(ed.doc, ROOMS_HANDLE, 'ra')!;
    for (const s of h.solids) translateSolid(s, new Vector3(512, -256, 0));
    roomsHandleDragged(ed, h, 'translate');
    const moved = roomsOf(roomsMembers(ed.doc, 'ra').detail)!;
    expect(moved.origin).toEqual({ x: 512, y: -256, z: 0 });
    const walls = roomsMembers(ed.doc, 'ra').world;
    expect(Math.min(...walls.map((w) => Math.min(...w.sides.flatMap((s) => s.plane.map((p) => p.x)))))).toBe(512 - 16);
    // A resize can't change the rooms: the handle goes back round them.
    const h2 = findHandle(ed.doc, ROOMS_HANDLE, 'ra')!;
    const before = handleBox(h2)!;
    for (const s of h2.solids) { const b = solidBounds(s); remapSolid(s, b, b.clone().expandByVector(new Vector3(256, 0, 0))); }
    roomsHandleDragged(ed, h2, 'scale');
    const b = handleBox(h2)!;
    expect([b.min.x, b.min.y, b.max.x, b.max.y]).toEqual([before.min.x, before.min.y, before.max.x, before.max.y]);
  });

  it('is deleted whole, and its handle is stripped for compiling', () => {
    const ed = stubEditor();
    const { detail } = applyRooms(ed, presetSpec('customs', 0, 0, 0, 'cu', 5), 'Add');
    const copy = VmfDocument.parse(ed.doc.serialize());
    expect(stripHandles(copy)).toBe(1);
    deleteRooms(ed, detail);
    expect(ed.doc.entities.filter((e) => e.get('she_rooms_id'))).toEqual([]);
    expect(ed.doc.worldEntity.solids).toHaveLength(0);
  });
});
