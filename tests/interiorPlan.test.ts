import { describe, expect, it } from 'vitest';
import { Box2, Vector2 } from 'three';
import { doorGraph, planInterior, wallBox, wallLength, type InteriorPlan } from '../src/gen/interiorPlan.ts';
import { rectPoly } from '../src/gen/buildingPlan.ts';
import { Rng } from '../src/gen/rng.ts';

const rect = (w: number, h: number, x = 0, y = 0) => rectPoly(new Box2(new Vector2(x, y), new Vector2(x + w, y + h)));
/** An L: a 512 × 256 front range and a 256 × 256 wing on its left. */
const ell = [new Vector2(0, 0), new Vector2(512, 0), new Vector2(512, 256), new Vector2(256, 256), new Vector2(256, 512), new Vector2(0, 512)];
const FOOTPRINTS = [rect(256, 256), rect(384, 256), rect(512, 384), rect(640, 448, -320, 128), rect(320, 576), ell];
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 37 + 1);

const area = (b: Box2) => (b.max.x - b.min.x) * (b.max.y - b.min.y);
const polyArea = (p: Vector2[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
const overlap = (a: Box2, b: Box2) => Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)) * Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y));

function reachable(plan: InteriorPlan): Set<number> {
  const g = doorGraph(plan);
  const seen = new Set(plan.entrances.map((e) => e.room));
  const todo = [...seen];
  while (todo.length) for (const n of g.get(todo.pop()!) ?? []) if (n >= 0 && !seen.has(n)) { seen.add(n); todo.push(n); }
  return seen;
}

function each(fn: (plan: InteriorPlan, fp: Vector2[], seed: number) => void, opts = {}) {
  for (const fp of FOOTPRINTS) for (const seed of SEEDS) fn(planInterior(fp, new Rng(seed), opts), fp, seed);
}

describe('interior floor plans', () => {
  it('every room is reachable from an entrance', () => {
    for (const opts of [{}, { wideDoors: true }, { storeys: 2 as const }]) {
      each((plan, _fp, seed) => {
        expect(plan.entrances.length, `seed ${seed}`).toBeGreaterThan(0);
        expect(reachable(plan).size, `seed ${seed}`).toBe(plan.rooms.length);
      }, opts);
    }
  });

  it('doors are at least 64 wide, 128 with wide doors', () => {
    for (const [opts, min] of [[{}, 64], [{ wideDoors: true }, 128]] as const) {
      each((plan) => {
        for (const w of plan.walls) for (const o of w.openings) if (o.kind !== 'window') expect(o.to - o.from).toBeGreaterThanOrEqual(min);
      }, opts);
    }
  });

  it('openings stay off wall ends and apart from each other', () => {
    each((plan) => {
      for (const w of plan.walls) {
        const l = wallLength(w);
        w.openings.forEach((o, k) => {
          expect(o.from).toBeGreaterThanOrEqual(16);
          expect(o.to).toBeLessThanOrEqual(l - 16);
          expect(o.lintel).toBeGreaterThan(o.sill);
          if (k > 0) expect(o.from).toBeGreaterThan(w.openings[k - 1].to);
        });
      }
    });
  });

  it('openings stay clear of the walls that join a wall', () => {
    each((plan) => {
      for (const w of plan.walls) {
        const wb = wallBox(w);
        for (const x of plan.walls) {
          if (x === w || x.storey !== w.storey || x.axis === w.axis) continue;
          const xb = wallBox(x);
          if (overlap(wb.clone().expandByScalar(0.5), xb) <= 0) continue;
          const ax = w.axis;
          for (const o of w.openings) {
            const a = wb.min[ax] + o.from, b = wb.min[ax] + o.to;
            expect(b <= xb.min[ax] || a >= xb.max[ax]).toBe(true);
          }
        }
      }
    });
  });

  it('rooms tile the footprint exactly and walls never overlap', () => {
    each((plan, fp) => {
      const ground = plan.rooms.filter((r) => r.storey === 1);
      expect(ground.reduce((s, r) => s + area(r.box), 0)).toBeCloseTo(polyArea(fp));
      for (let i = 0; i < ground.length; i++) {
        const s = ground[i].box.getSize(new Vector2());
        expect(Math.min(s.x, s.y)).toBeGreaterThanOrEqual(128);
        for (let j = i + 1; j < ground.length; j++) expect(overlap(ground[i].box, ground[j].box)).toBe(0);
      }
      for (const storey of [1, 2]) {
        const ws = plan.walls.filter((w) => w.storey === storey).map(wallBox);
        for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) expect(overlap(ws[i], ws[j])).toBe(0);
      }
    });
  });

  it('walls close the outline: outer faces cover the footprint edges', () => {
    each((plan, fp) => {
      const outer = plan.walls.filter((w) => w.exterior && w.storey === 1).reduce((s, w) => s + wallLength(w), 0);
      const perimeter = fp.reduce((s, a, i) => s + a.distanceTo(fp[(i + 1) % fp.length]), 0);
      // Pieces run along the centre line: each corner shortens the outline by 8 per wall end at most.
      expect(outer).toBeGreaterThan(perimeter - fp.length * 32 - 1);
      expect(outer).toBeLessThanOrEqual(perimeter + 1);
    });
  });

  it('the same seed gives the same plan', () => {
    const a = planInterior(ell, new Rng(9), { storeys: 2 }), b = planInterior(ell, new Rng(9), { storeys: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(planInterior(rect(512, 384), new Rng(3)))).not.toBe(JSON.stringify(planInterior(rect(512, 384), new Rng(4))));
  });

  it('long houses get two entrances, requested edges get one', () => {
    each((plan, fp) => {
      const size = new Box2().setFromPoints(fp).getSize(new Vector2());
      if (Math.max(size.x, size.y) > 384) expect(plan.entrances.length).toBeGreaterThanOrEqual(2);
    });
    for (const seed of SEEDS) {
      const plan = planInterior(rect(512, 384), new Rng(seed), { entranceEdges: [2] });
      // Edge 2 runs along y = 384.
      expect(plan.entrances[0].out.y).toBe(1);
    }
  });

  it('L-shaped houses get rooms in both wings', () => {
    for (const seed of SEEDS) {
      const plan = planInterior(ell, new Rng(seed));
      const corner = new Box2(new Vector2(256, 256), new Vector2(512, 512));
      expect(plan.rooms.length).toBeGreaterThanOrEqual(2);
      for (const r of plan.rooms) expect(overlap(r.box, corner)).toBe(0);
    }
  });

  it('two storeys: stairs and an upper floor over at most half the house', () => {
    let withStairs = 0;
    each((plan, fp) => {
      if (plan.storeys !== 2) return;
      withStairs++;
      expect(area(plan.upperFloor!)).toBeLessThanOrEqual(polyArea(fp) / 2 + 1);
      const s = plan.stairs!;
      expect(s.rise * s.steps).toBe(128);
      expect(s.rise).toBeLessThanOrEqual(16);
      expect(Math.min(s.box.max.x - s.box.min.x, s.box.max.y - s.box.min.y)).toBeGreaterThanOrEqual(64);
      // The flight lies in one ground room, its head on the upper floor.
      expect(plan.rooms[s.room].box.containsBox(s.box)).toBe(true);
      expect(plan.upperFloor!.containsPoint(s.head)).toBe(true);
      expect(plan.rooms[s.room].box.containsPoint(s.foot)).toBe(true);
      // Its foot and head connect to a lane.
      expect(plan.lanes.some((l) => l.containsPoint(s.foot))).toBe(true);
      expect(plan.lanes.some((l) => l.containsPoint(s.head))).toBe(true);
    }, { storeys: 2 });
    // The three rectangles big enough for a flight (the small L's wings are too shallow).
    expect(withStairs).toBe(SEEDS.length * 3);
    const bigEll = [new Vector2(0, 0), new Vector2(640, 0), new Vector2(640, 384), new Vector2(256, 384), new Vector2(256, 640), new Vector2(0, 640)];
    for (const seed of SEEDS) {
      const plan = planInterior(bigEll, new Rng(seed), { storeys: 2 });
      expect(plan.storeys).toBe(2);
      expect(plan.upperFloor!.containsPoint(plan.stairs!.head)).toBe(true);
      expect(reachable(plan).size).toBe(plan.rooms.length);
    }
  });
});
