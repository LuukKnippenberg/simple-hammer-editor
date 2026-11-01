import { describe, expect, it } from 'vitest';
import { Vector2 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { hallBrushes, rectMinus, wallPieces, type HallWall } from '../src/gen/hall.ts';

const wall = (openings: HallWall['openings']): HallWall => ({ a: new Vector2(0, 0), b: new Vector2(1000, 0), thickness: 32, inside: 1, openings });

describe('hall builder', () => {
  it('cuts doors to the floor and windows with a pane', () => {
    const pieces = wallPieces(wall([{ from: 100, to: 300, z0: 0, z1: 200 }, { from: 500, to: 600, z0: 150, z1: 300 }]), 0, 400);
    const solid = pieces.filter((p) => !p.window).map((p) => [p.min.x, p.max.x, p.min.z, p.max.z]);
    expect(solid).toEqual([
      [0, 100, 0, 400], // up to the door
      [100, 300, 200, 400], // the lintel over it
      [300, 500, 0, 400],
      [500, 600, 0, 150], // under the window
      [500, 600, 300, 400], // over it
      [600, 1000, 0, 400],
    ]);
    // The wall is 32 thick around its centre line; the pane is a thin sheet in the middle.
    expect(pieces[0].min.y).toBe(-16);
    expect(pieces[0].max.y).toBe(16);
    const panes = pieces.filter((p) => p.window);
    expect(panes.map((p) => [p.min.x, p.max.x, p.min.y, p.max.y, p.min.z, p.max.z])).toEqual([[500, 600, -2, 2, 150, 300]]);
  });

  it('leaves skylights out of the roof', () => {
    const parts = rectMinus([0, 0, 1000, 600], [[200, 200, 800, 300]]);
    const area = (r: number[]) => (r[2] - r[0]) * (r[3] - r[1]);
    expect(parts.reduce((s, r) => s + area(r), 0)).toBe(1000 * 600 - 600 * 100);
    expect(parts.some((r) => r[0] < 500 && r[2] > 500 && r[1] < 250 && r[3] > 250)).toBe(false);
    // Rows are merged along x: the rows above and below the skylight are one brush each.
    expect(parts).toContainEqual([0, 0, 1000, 200]);
    expect(parts).toContainEqual([0, 300, 1000, 600]);
  });

  it('puts the outer finish on the outside face only, and blocks light with the roof', () => {
    const doc = VmfDocument.empty();
    const b = hallBrushes(doc, {
      floorZ: 0, height: 400,
      walls: [wall([{ from: 500, to: 600, z0: 150, z1: 300 }])],
      materials: { inner: 'PLASTER/INNER', outer: 'STONE/OUTER', cap: 'STONE/CAP', glass: 'GLASS/PANE' },
      roofs: [{ rect: [0, 0, 1000, 600], skylights: [[200, 200, 800, 300]] }],
      girders: [{ rect: [0, 0, 1000, 600], along: 'y', every: 250, size: 16, material: 'METAL/BEAM' }],
    });
    const mats = (n: (typeof b.world)[number]) => n.childrenNamed('side').map((s) => s.get('material'));
    const walls = b.world.filter((n) => mats(n).includes('PLASTER/INNER'));
    // Inside is the left of a→b (+y): the outer finish goes on -y, the face list's third side, and on the piece's
    // ends (the reveals of the window); the inside is plaster. Over the window the underside is the cap's.
    for (const w of walls) expect(mats(w).slice(2)).toEqual(['STONE/OUTER', 'STONE/OUTER', 'PLASTER/INNER', 'STONE/OUTER']);
    expect(walls.map((w) => mats(w)[1]).sort()).toEqual(['STONE/CAP', 'TOOLS/TOOLSNODRAW', 'TOOLS/TOOLSNODRAW', 'TOOLS/TOOLSNODRAW']);
    expect(b.roof).toHaveLength(4);
    expect(b.roof.every((n) => mats(n).every((m) => m === 'TOOLS/TOOLSBLOCKLIGHT'))).toBe(true);
    expect(b.glass).toHaveLength(1);
    expect(b.girders).toHaveLength(3);
  });
});
