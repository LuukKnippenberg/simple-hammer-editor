import { describe, expect, it } from 'vitest';
import { Box2, Vector2 } from 'three';
import { generateFromSketch } from '../src/gen/sketch.ts';
import { PROP_BOUNDS } from '../src/gen/props.ts';
import { buildDistrictSketch } from '../src/examples/district.ts';
import { solidBounds } from '../src/edit/brushes.ts';
import type { MapEntity } from '../src/vmf/map.ts';

const r = generateFromSketch(buildDistrictSketch());
const props = r.doc.entities.filter((e) => e.classname === 'prop_static');
const model = (e: MapEntity) => e.get('model') ?? '';
const cars = props.filter((e) => model(e).includes('props_vehicles'));

// The road brushes by kind (the district's roads run along x and y, so their bounds are exact).
const roadBrushes = r.doc.entities.filter((e) => e.classname === 'func_detail' && e.get('she_road')).flatMap((e) => e.solids);
const kindOf = (mats: string[]) => (mats.includes('CONCRETE/CONCRETEFLOOR028A') ? 'pavement' : mats.includes('CONCRETE/CONCRETEFLOOR027A') ? 'kerb' : 'surface');
const pieces = roadBrushes.map((s) => {
  const b = solidBounds(s);
  return { kind: kindOf(s.sides.map((x) => x.material.toUpperCase())), box: new Box2(new Vector2(b.min.x, b.min.y), new Vector2(b.max.x, b.max.y)), top: b.max.z };
});
const under = (x: number, y: number, kind: string) => pieces.filter((p) => p.kind === kind && p.box.containsPoint(new Vector2(x, y)));

/** A car's footprint from its model bounds, turned by its yaw. */
function footprint(e: MapEntity): Box2 {
  const [x0, y0, , x1, y1] = PROP_BOUNDS[model(e)];
  const yaw = (Number((e.get('angles') ?? '0 0 0').split(' ')[1]) * Math.PI) / 180;
  const o = e.origin!;
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([u, v]) => new Vector2(o.x + u * Math.cos(yaw) - v * Math.sin(yaw), o.y + u * Math.sin(yaw) + v * Math.cos(yaw)));
  return new Box2().setFromPoints(pts);
}

describe('props on the ground of a generated sketch map', () => {
  it('parks every car on its road\'s carriageway, wheels on the surface, parallel to the road', () => {
    expect(cars.length).toBeGreaterThanOrEqual(4);
    for (const car of cars) {
      const o = car.origin!;
      const road = under(o.x, o.y, 'surface');
      expect(road.length, `${model(car)} at ${o.toArray()}`).toBeGreaterThan(0);
      // The model's lowest point sinks 1 unit into the carriageway.
      expect(o.z + PROP_BOUNDS[model(car)][2]).toBe(Math.round(road[0].top) - 1);
      const d = ((Number(car.get('angles')!.split(' ')[1]) % 90) + 90) % 90;
      expect(Math.min(d, 90 - d)).toBeLessThanOrEqual(2);
    }
  });

  it('keeps cars clear of kerbs, pavements, each other, lamps and trees', () => {
    const boxes = cars.map(footprint);
    boxes.forEach((box, i) => {
      for (const p of pieces) {
        if (p.kind === 'surface') continue;
        const overlap = box.clone().intersect(p.box);
        expect(overlap.isEmpty() || overlap.max.x - overlap.min.x < 0.5 || overlap.max.y - overlap.min.y < 0.5, `${model(cars[i])} at ${cars[i].origin!.toArray()} touches a ${p.kind}`).toBe(true);
      }
      boxes.forEach((other, j) => { if (j !== i) expect(box.intersectsBox(other)).toBe(false); });
      for (const e of props) {
        if (!/lamppost|tree/.test(model(e))) continue;
        expect(box.distanceToPoint(new Vector2(e.origin!.x, e.origin!.y))).toBeGreaterThan(16);
      }
    });
  });

  it('stands lamps on the pavement and keeps street trees off the carriageway', () => {
    const lamps = props.filter((e) => model(e).includes('lamppost'));
    expect(lamps.length).toBeGreaterThan(10);
    for (const lamp of lamps) {
      const o = lamp.origin!;
      const pave = under(o.x, o.y, 'pavement');
      expect(pave.length, `lamp at ${o.toArray()}`).toBeGreaterThan(0);
      expect(o.z).toBe(Math.round(pave[0].top));
    }
    for (const tree of props.filter((e) => model(e).includes('props_foliage'))) {
      const o = tree.origin!;
      expect(under(o.x, o.y, 'surface'), `tree at ${o.toArray()}`).toHaveLength(0);
      // On a pavement or paving, its base 2 to 4 units into the ground under it.
      const pave = under(o.x, o.y, 'pavement');
      if (pave.length) expect(pave[0].top - o.z).toBeGreaterThanOrEqual(2);
      expect(o.z).toBeGreaterThanOrEqual(r.heightAt(o.x, o.y) - 4);
    }
  });
});
