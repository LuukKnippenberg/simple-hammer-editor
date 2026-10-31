import { describe, expect, it } from 'vitest';
import { VmfDocument } from '../src/vmf/map.ts';
import type { KVNode } from '../src/vmf/keyvalues.ts';
import { roomBuilding } from '../src/gen/rooms/build.ts';
import type { RoomBuildingSpec, RoomSpec } from '../src/gen/rooms/model.ts';
import { modelFootprint, overlaps, rect, walkable } from '../src/gen/poi/kit.ts';

const room = (id: string, type: string, x0: number, y0: number, x1: number, y1: number): RoomSpec => ({ id, type, cells: { x0, y0, x1, y1 } });

/** Every room type: the train hall along the south, concourse, customs and a waiting room above it, rations and a hallway on top. */
export const allTypes = (seed = 7): RoomBuildingSpec => ({
  uid: 'demo', seed, origin: { x: -1024, y: -1024, z: 0 }, cell: 128, height: 432,
  rooms: [
    room('hall', 'trainHall', 0, 0, 16, 7), room('conc', 'concourse', 0, 7, 10, 15), room('cust', 'customs', 10, 7, 16, 12),
    room('wait', 'waiting', 10, 12, 16, 15), room('rat', 'rations', 0, 15, 8, 21), room('corr', 'hallway', 8, 15, 16, 17),
  ],
  doors: [{ x: 0, y: 10, side: 'w', width: 2 }, { x: 15, y: 15, side: 'e', width: 1 }],
  links: [], bands: ['n', 'e'],
});

const props = (nodes: KVNode[]) => nodes.filter((n) => /^prop_/.test(n.get('classname') ?? ''));
const model = (n: KVNode) => (n.get('model') ?? '').replace(/^models\//, '').replace(/\.mdl$/, '');
const origin = (n: KVNode) => (n.get('origin') ?? '0 0 0').split(' ').map(Number);
const yaw = (n: KVNode) => Number((n.get('angles') ?? '0 0 0').split(' ')[1]);

describe('room dressers', () => {
  const doc = VmfDocument.empty();
  const b = roomBuilding(doc, allTypes());

  it('lays out the demo without issues', () => {
    expect(b.layout.issues).toEqual([]);
  });

  it('furnishes each room for its type', () => {
    const inRoom = (id: string) => {
      const r = b.layout.rooms.find((q) => q.spec.id === id)!.inner;
      return props(b.entities).filter((n) => { const [x, y] = origin(n); return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }).map(model);
    };
    expect(inRoom('hall')).toContain('props_trainstation/train001');
    expect(inRoom('hall')).toContain('pg_props/pg_obj/pg_rail_512');
    expect(inRoom('conc')).toContain('props_trainstation/bench_indoor001a');
    expect(inRoom('cust').some((m) => /interior_fence/.test(m))).toBe(true);
    expect(inRoom('cust')).toContain('props_combine/combine_booth_short01a');
    expect(inRoom('rat')).toContain('props_combine/railing_256');
    expect(inRoom('rat')).toContain('props_combine/combine_booth_med01a');
    expect(inRoom('wait')).toContain('props_trainstation/payphone001a');
    expect(inRoom('corr')).toContain('props_trainstation/bench_indoor001a');
  });

  it('keeps everything inside its room and off the doorways', () => {
    const inners = b.layout.rooms.map((r) => r.inner);
    for (const n of props(b.entities)) {
      const [x, y] = origin(n);
      expect(inners.some((r) => x >= r.x0 - 1 && x <= r.x1 + 1 && y >= r.y0 - 1 && y <= r.y1 + 1), `${model(n)} at ${x} ${y}`).toBe(true);
    }
    // In front of every doorway (both sides of the wall) a way through stays free of anything units bump into.
    for (const d of b.layout.doorways.filter((q) => q.kind !== 'open')) {
      const clear = d.axis === 'x' ? rect(d.from, d.at - 128, d.to, d.at + 128) : rect(d.at - 128, d.from, d.at + 128, d.to);
      for (const n of props(b.entities)) {
        const m = model(n);
        if (walkable(m)) continue;
        const [x, y] = origin(n);
        expect(overlaps(modelFootprint(m, x, y, yaw(n)), clear, -2), `${m} at ${x} ${y} blocks the ${d.kind} at ${d.at}`).toBe(false);
      }
    }
  });

  it('puts the floors, platform and counters in one func_detail and the roof in a func_brush', () => {
    const cls = b.entities.map((e) => e.get('classname'));
    expect(cls.filter((c) => c === 'func_detail')).toHaveLength(1);
    expect(b.entities.find((e) => e.get('classname') === 'func_brush' && /_roof$/.test(e.get('targetname') ?? ''))?.get('rendermode')).toBe('10');
    expect(b.counts.detail).toBeGreaterThan(b.layout.rooms.length);
    expect(b.counts.props).toBeGreaterThan(60);
  });
});
