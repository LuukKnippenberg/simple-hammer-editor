import { describe, expect, it } from 'vitest';
import { VmfDocument } from '../src/vmf/map.ts';
import { roomBuilding } from '../src/gen/rooms/build.ts';
import { roomLayout } from '../src/gen/rooms/model.ts';
import { cameraFaces } from '../src/gen/rooms/relief.ts';
import { presetSpec, ROOM_PRESETS } from '../src/gen/rooms/presets.ts';
import { scanBrushes } from './overlaps.ts';

describe('relief, lamps and wear', () => {
  const spec = presetSpec('station', 0, 0, 0, 'st', 3);

  it('has presets that lay out without issues', () => {
    for (const p of ROOM_PRESETS) expect(roomLayout(presetSpec(p.id, 0, 0, 0, p.id)).issues, p.id).toEqual([]);
  });

  it('dresses only the north and west faces, and leaves the doorways open', () => {
    const l = roomLayout(spec);
    const faces = cameraFaces(l);
    expect(new Set(faces.map((f) => f.side))).toEqual(new Set(['n', 'w']));
    // Every room has at least one face the camera sees.
    for (const r of l.rooms) expect(faces.some((f) => f.room === r), r.spec.id).toBe(true);
    for (const f of faces) for (const p of f.pilasters) expect(f.cuts.some(([a, b]) => p > a - 72 && p < b + 72)).toBe(false);
  });

  it('puts the relief in a drawn func_brush that casts shadows, clear of the doorways', () => {
    const b = roomBuilding(VmfDocument.empty(), spec);
    const relief = b.entities.find((e) => /_relief$/.test(e.get('targetname') ?? ''))!;
    expect(relief.get('rendermode')).toBe('0');
    expect(relief.get('vrad_brush_cast_shadows')).toBe('1');
    const boxes = scanBrushes(relief.childrenNamed('solid'));
    expect(boxes.length).toBeGreaterThan(50);
    // Nothing of it stands in a doorway below the door's top.
    for (const d of b.layout.doorways.filter((q) => q.kind !== 'open')) {
      for (const bx of boxes) {
        const [lo, hi] = d.axis === 'x' ? [bx.box.min.x, bx.box.max.x] : [bx.box.min.y, bx.box.max.y];
        const [p0, p1] = d.axis === 'x' ? [bx.box.min.y, bx.box.max.y] : [bx.box.min.x, bx.box.max.x];
        const inWall = p1 > d.at - 48 && p0 < d.at + 48;
        const blocks = inWall && hi > d.from + 1 && lo < d.to - 1 && bx.box.min.z < b.layout.floor + d.top;
        expect(blocks, `relief in the ${d.kind} at ${d.at}`).toBe(false);
      }
    }
  });

  it('hangs lamps with lights, and puts wear on the floors and walls', () => {
    const b = roomBuilding(VmfDocument.empty(), spec);
    expect(b.counts.lights).toBeGreaterThan(20);
    expect(b.counts.overlays).toBeGreaterThan(60);
    // Under the map's 512 overlays with room to spare for the rest of a map.
    expect(b.counts.overlays).toBeLessThan(260);
    // Wall overlays point at sides of the wall brushes.
    const sideIds = new Set(b.world.flatMap((n) => n.childrenNamed('side').map((s) => s.get('id'))));
    const onWalls = b.entities.filter((e) => e.get('classname') === 'info_overlay' && e.get('BasisNormal') !== '0 0 1');
    expect(onWalls.length).toBeGreaterThan(10);
    for (const e of onWalls) for (const id of (e.get('sides') ?? '').split(' ')) expect(sideIds.has(id)).toBe(true);
  });
});
