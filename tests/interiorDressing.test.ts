import { describe, expect, it } from 'vitest';
import { Box2, Vector2 } from 'three';
import { planInterior, wallBox } from '../src/gen/interiorPlan.ts';
import { dressInterior, roomInterior, STATIC_MODELS } from '../src/gen/interiorDressing.ts';
import { interiorHouse } from '../src/gen/interiorHouse.ts';
import { rectPoly } from '../src/gen/buildingPlan.ts';
import { Rng } from '../src/gen/rng.ts';
import { VmfDocument } from '../src/vmf/map.ts';

const rect = (w: number, h: number) => rectPoly(new Box2(new Vector2(0, 0), new Vector2(w, h)));
const ell = [new Vector2(0, 0), new Vector2(512, 0), new Vector2(512, 256), new Vector2(256, 256), new Vector2(256, 512), new Vector2(0, 512)];
const overlaps = (a: Box2, b: Box2) => Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x) > 0.01 && Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y) > 0.01;
const CASES = [rect(384, 256), rect(512, 384), rect(640, 448), ell].flatMap((fp) => Array.from({ length: 12 }, (_, i) => ({ fp, seed: i * 11 + 2 })));

describe('interior dressing', () => {
  it('props stay inside their room and clear of lanes, door zones and each other', () => {
    let props = 0;
    for (const { fp, seed } of CASES) {
      const plan = planInterior(fp, new Rng(seed));
      const d = dressInterior(plan, 0, new Rng(seed * 23 + 13), { furnish: 'full', weathering: 1 });
      props += d.props.length;
      for (const p of d.props) {
        expect(roomInterior(plan, p.room).containsBox(p.box)).toBe(true);
        for (const b of [...plan.lanes, ...plan.doorZones, ...plan.keepClear]) expect(overlaps(b, p.box)).toBe(false);
      }
      for (let i = 0; i < d.props.length; i++) for (let j = i + 1; j < d.props.length; j++) expect(overlaps(d.props[i].box, d.props[j].box)).toBe(false);
    }
    expect(props).toBeGreaterThan(CASES.length * 3);
  });

  it('only checked static models become prop_static; others are prop_dynamic', () => {
    for (const { fp, seed } of CASES) {
      const plan = planInterior(fp, new Rng(seed));
      for (const e of dressInterior(plan, 0, new Rng(seed), { furnish: 'full' }).entities) {
        if (e.classname === 'prop_static') expect(STATIC_MODELS.has(e.keys.model)).toBe(true);
        if (e.classname === 'prop_dynamic') expect(e.keys.solid).toBe('6');
      }
    }
  });

  it('one lamp and one HDR light per lit room', () => {
    let lit = 0;
    for (const { fp, seed } of CASES) {
      const plan = planInterior(fp, new Rng(seed));
      const d = dressInterior(plan, 0, new Rng(seed), {});
      const lights = d.entities.filter((e) => e.classname === 'light');
      expect(lights.length).toBe(d.litRooms.length);
      expect(new Set(d.litRooms).size).toBe(d.litRooms.length);
      for (const l of lights) expect(l.keys._lightHDR).toBeDefined();
      expect(d.entities.filter((e) => e.keys.model?.includes('cagelight')).length).toBe(lights.length);
      lit += lights.length;
      expect(dressInterior(plan, 0, new Rng(seed), { lights: false }).entities.some((e) => e.classname === 'light')).toBe(false);
    }
    expect(lit).toBeGreaterThan(0);
  });

  it('furnish none places no furniture; the plan never depends on furnishing', () => {
    for (const { fp, seed } of CASES.slice(0, 8)) {
      const plan = planInterior(fp, new Rng(seed));
      expect(dressInterior(plan, 0, new Rng(seed), { furnish: 'none' }).props.length).toBe(0);
      const a = interiorHouse(VmfDocument.empty(), fp, 0, { seed, furnish: 'none' }), b = interiorHouse(VmfDocument.empty(), fp, 0, { seed, furnish: 'full' });
      expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
    }
  });

  it('two storeys: sealed rooms stay empty; furniture closes off some doorways', () => {
    let blockers = 0;
    for (const { fp, seed } of CASES) {
      const plan = planInterior(fp, new Rng(seed), { storeys: 2 });
      const d = dressInterior(plan, 0, new Rng(seed * 23 + 13), { furnish: 'full' });
      for (const p of d.props) {
        expect(plan.rooms[p.room].sealed).toBeFalsy();
        // Furniture closing a doorway stays out of the lanes to the doors people use too.
        for (const b of [...plan.lanes, ...plan.keepClear]) expect(overlaps(b, p.box)).toBe(false);
      }
      for (const e of d.entities) {
        const p = new Vector2(e.origin.x, e.origin.y);
        const r = plan.rooms.findIndex((x) => x.storey === 1 && x.box.containsPoint(p));
        if (e.origin.z < 120 && r >= 0) expect(plan.rooms[r].sealed).toBeFalsy();
      }
      const closed = plan.walls.flatMap((w) => w.openings.filter((o) => o.blocked === 'furniture').map((o) => ({ w, o })));
      for (const { w, o } of closed) {
        const wb = wallBox(w), ax = w.axis;
        const hole = wb.clone();
        hole.min[ax] = wb.min[ax] + o.from; hole.max[ax] = wb.min[ax] + o.to;
        if (d.props.some((p) => overlaps(p.box, hole.clone().expandByScalar(4)))) blockers++;
      }
    }
    expect(blockers).toBeGreaterThan(4);
  });
});
