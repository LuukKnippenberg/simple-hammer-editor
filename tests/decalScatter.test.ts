import { describe, expect, it } from 'vitest';
import { alongWall, onFloor } from '../src/edit/decalScatter.ts';
import { Rng } from '../src/gen/rng.ts';

describe('decal scatter rules', () => {
  it('shoots along-wall placements at the wall from inside the room, skipping ranges', () => {
    const list = alongWall({ along: 'x', at: -608, n: -1, from: 0, to: 1000, every: 250, z: 160, materials: ['a', 'b'], size: [96, 96], rng: new Rng(1), skip: [[400, 600]] });
    expect(list.map((d) => d.from.x)).toEqual([0, 250, 750, 1000]);
    // 48 into the room (the room is towards -y), pointing back at the wall (+y).
    for (const d of list) {
      expect(d.from.y).toBe(-656);
      expect(d.from.z).toBe(160);
      expect(d.dir.toArray()).toEqual([0, 1, 0]);
      expect(d.size).toBe(96);
    }
    const west = alongWall({ along: 'y', at: -3776, n: 1, from: 0, to: 0, every: 1, z: 100, materials: ['a'], size: [64, 64], rng: new Rng(1) });
    expect(west[0].from.toArray()).toEqual([-3728, 0, 100]);
    expect(west[0].dir.toArray()).toEqual([-1, 0, 0]);
  });

  it('scatters floor placements inside the rectangle, shot down', () => {
    const list = onFloor({ rect: [0, 0, 500, 300], count: 50, top: 120, materials: ['x'], size: [64, 128], rng: new Rng(2) });
    expect(list).toHaveLength(50);
    for (const d of list) {
      expect(d.from.x).toBeGreaterThanOrEqual(0); expect(d.from.x).toBeLessThanOrEqual(500);
      expect(d.from.y).toBeGreaterThanOrEqual(0); expect(d.from.y).toBeLessThanOrEqual(300);
      expect(d.dir.toArray()).toEqual([0, 0, -1]);
      expect(d.size).toBeGreaterThanOrEqual(64); expect(d.size).toBeLessThanOrEqual(128);
    }
  });
});
