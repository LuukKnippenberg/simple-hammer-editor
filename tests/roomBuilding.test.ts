import { describe, expect, it } from 'vitest';
import { VmfDocument } from '../src/vmf/map.ts';
import { roomLayout, WALL, type RoomBuildingSpec, type RoomSpec } from '../src/gen/rooms/model.ts';
import { roomShell, skylights } from '../src/gen/rooms/shell.ts';
import { boxPairs, scanBrushes } from './overlaps.ts';

const room = (id: string, type: string, x0: number, y0: number, x1: number, y1: number): RoomSpec => ({ id, type, cells: { x0, y0, x1, y1 } });

/** A small station: a train hall along the south, a concourse and a waiting room north of it, the door on the west. */
const station = (patch: Partial<RoomBuildingSpec> = {}): RoomBuildingSpec => ({
  uid: 't', seed: 1, origin: { x: 0, y: 0, z: 0 }, cell: 128, height: 432,
  rooms: [room('hall', 'trainHall', 0, 0, 12, 6), room('conc', 'concourse', 0, 6, 8, 12), room('wait', 'waiting', 8, 6, 12, 12)],
  doors: [{ x: 0, y: 8, side: 'w', width: 2 }],
  links: [], bands: ['n', 'e'],
  ...patch,
});

describe('interior building layout', () => {
  it('closes the outline with outer walls and puts partitions between rooms', () => {
    const l = roomLayout(station());
    expect(l.issues).toEqual([]);
    const outer = l.walls.filter((w) => w.lo === null || w.hi === null);
    const parts = l.walls.filter((w) => w.lo !== null && w.hi !== null);
    // South and north walls along x reach half a wall past the corners (the north one in two, one per room behind it); the west and east walls stop against them
    // (and the west and east walls are split where the partition along y = 6 meets them).
    expect(outer.filter((w) => w.axis === 'x').map((w) => [w.at, w.from, w.to]).sort()).toEqual([
      [0, -16, 1552], [1536, -16, 1024], [1536, 1024, 1552],
    ].sort());
    const west = outer.filter((w) => w.axis === 'y' && w.at === 0).map((w) => [w.from, w.to]);
    expect(west).toEqual([[16, 752], [784, 1520]]);
    expect(parts.map((w) => [w.axis, w.at, w.lo, w.hi]).sort()).toEqual([
      ['x', 768, 'hall', 'conc'], ['x', 768, 'hall', 'wait'], ['y', 1024, 'conc', 'wait'],
    ].sort());
  });

  it('opens rooms onto each other as their types prefer', () => {
    const l = roomLayout(station());
    const between = (a: string, b: string) => l.doorways.filter((d) => d.rooms.includes(a) && d.rooms.includes(b));
    // Train hall and concourse both like archways: a row of them; the waiting room wants a door.
    expect(between('hall', 'conc').every((d) => d.kind === 'arch')).toBe(true);
    expect(between('hall', 'conc').length).toBeGreaterThanOrEqual(2);
    expect(between('conc', 'wait').map((d) => d.kind)).toEqual(['door']);
    expect(between('hall', 'wait').map((d) => d.kind)).toEqual(['door']);
    // Doorways are cut into their walls, down to the floor, and stay off the wall's ends.
    for (const d of l.doorways.filter((q) => q.kind !== 'open')) {
      const w = l.walls.find((q) => q.axis === d.axis && q.at === d.at && q.from <= d.from && q.to >= d.to)!;
      expect(w).toBeTruthy();
      expect(w.openings.some((o) => o.from === d.from && o.to === d.to && o.z0 === l.floor - l.base)).toBe(true);
    }
    // A link in the spec wins: open (no wall at all) or closed.
    const open = roomLayout(station({ links: [{ a: 'conc', b: 'wait', kind: 'open' }] }));
    expect(open.walls.some((w) => w.axis === 'y' && w.at === 1024 && w.lo === 'conc')).toBe(false);
    expect(open.doorways.filter((d) => d.kind === 'open')).toHaveLength(1);
    // Their floors meet where they open onto each other.
    const conc = open.rooms.find((r) => r.spec.id === 'conc')!, wait = open.rooms.find((r) => r.spec.id === 'wait')!;
    expect(conc.inner.x1).toBe(wait.inner.x0);
    expect(conc.inner.x0).toBe(WALL / 2);
  });

  it('puts window bands in the north and east walls only, clear of doors and partitions', () => {
    const l = roomLayout(station({ doors: [{ x: 0, y: 8, side: 'w', width: 2 }, { x: 2, y: 11, side: 'n', width: 2 }] }));
    const bands = l.walls.flatMap((w) => w.openings.filter((o) => o.z0 > l.floor - l.base + 1).map((o) => ({ w, o })));
    expect(bands.length).toBeGreaterThan(0);
    for (const { w } of bands) expect(w.lo === null ? 'south or west' : w.hi === null ? 'north or east' : 'inside').toBe('north or east');
    const north = l.walls.filter((w) => w.axis === 'x' && w.at === 1536 && w.hi === null);
    const door = l.doorways.find((d) => d.kind === 'street' && d.axis === 'x')!;
    for (const w of north) for (const o of w.openings) if (o.z0 > 20) expect(o.to <= door.from - 64 || o.from >= door.to + 64).toBe(true);
    // The east wall's band stops short of the partition meeting it at y = 768.
    const east = l.walls.filter((w) => w.axis === 'y' && w.at === 1536).flatMap((w) => w.openings);
    for (const o of east) expect(o.to <= 768 - 64 || o.from >= 768 + 64).toBe(true);
  });

  it('reports overlapping rooms, misplaced doors and rooms you cannot reach', () => {
    const overlap = roomLayout(station({ rooms: [room('a', 'waiting', 0, 0, 4, 4), room('b', 'hallway', 3, 0, 6, 4)], doors: [{ x: 0, y: 1, side: 'w', width: 1 }] }));
    expect(overlap.issues.some((s) => /overlap/.test(s))).toBe(true);
    const inside = roomLayout(station({ doors: [{ x: 7, y: 6, side: 'e', width: 1 }] }));
    expect(inside.issues.some((s) => /not on one room's outer wall/.test(s))).toBe(true);
    const shut = roomLayout(station({ links: [{ a: 'wait', b: 'conc', kind: 'wall' }, { a: 'wait', b: 'hall', kind: 'wall' }] }));
    expect(shut.issues).toEqual(['Room wait can\'t be reached from the street']);
    expect(roomLayout(station({ doors: [] })).issues).toEqual(['The building has no street door']);
  });

  it('builds walls that never overlap, a roof with skylights over the halls, glass in the bands', () => {
    const doc = VmfDocument.empty();
    const l = roomLayout(station());
    const s = roomShell(doc, l);
    expect(boxPairs(scanBrushes(s.world))).toEqual([]);
    expect(s.glass.length).toBeGreaterThan(0);
    // The train hall and concourse let the sun in, the waiting room doesn't.
    const byId = (id: string) => l.rooms.find((r) => r.spec.id === id)!;
    expect(skylights(byId('hall'), 128).length).toBeGreaterThanOrEqual(2);
    expect(skylights(byId('wait'), 128)).toEqual([]);
    // The roof covers the building and overhangs its outer walls (it floats above them).
    const roof = scanBrushes(s.roof);
    const minX = Math.min(...roof.map((b) => b.box.min.x)), maxY = Math.max(...roof.map((b) => b.box.max.y));
    expect(minX).toBeLessThan(-WALL / 2);
    expect(maxY).toBeGreaterThan(1536 + WALL / 2);
    expect(Math.min(...roof.map((b) => b.box.min.z))).toBeGreaterThan(l.top);
  });
});
