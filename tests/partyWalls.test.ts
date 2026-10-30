import { describe, expect, it } from 'vitest';
import { Box2, Box3, Vector2, Vector3 } from 'three';
import { band, generateBuildings, STAINS, type Neighbour } from '../src/gen/buildings.ts';
import { rectPoly } from '../src/gen/buildingPlan.ts';
import { VmfDocument } from '../src/vmf/map.ts';
import type { KVNode } from '../src/vmf/keyvalues.ts';
import { boxPairs, coplanarOverlaps, intersection, scanBrushes, type ScanBrush } from './overlaps.ts';

const tile = { material: 'TRIM', bays: 0 };
const rect = (x0: number, y0: number, x1: number, y1: number) => rectPoly(new Box2(new Vector2(x0, y0), new Vector2(x1, y1)));
/** A flat-roofed neighbour standing up to `cover`, with bands reaching `reach` out of its walls at every height. */
const nb = (poly: Vector2[], cover: number, reach = 6): Neighbour => ({ poly, cover, reach: (_zMin, _zMax, roof) => (roof ? 0 : reach) });
const crossing = (a: KVNode[], b: KVNode[]) => {
  const sa = scanBrushes(a), sb = scanBrushes(b);
  return sa.flatMap((x) => sb.filter((y) => intersection(x, y)));
};

describe('bands at party walls', () => {
  it('neighbours of different depth and height meet flush at the party wall', () => {
    const doc = VmfDocument.empty();
    const a = rect(0, 0, 256, 384), b = rect(256, 0, 640, 384);
    // A heavy ledge (6 out) and a thin one (4 out) at overlapping heights.
    const ledgeA = band(doc, a, 6, 122, 134, tile, [nb(b, 512)]);
    const ledgeB = band(doc, b, 4, 124, 132, tile, [nb(a, 640)]);
    expect(crossing(ledgeA, ledgeB)).toHaveLength(0);
    const boxA = scanBrushes(ledgeA)[0].box, boxB = scanBrushes(ledgeB)[0].box;
    // Each stops at x = 256 and still stands out on the other three walls.
    expect(boxA.max.x).toBe(256);
    expect(boxB.min.x).toBe(256);
    expect([boxA.min.x, boxA.min.y, boxA.max.y]).toEqual([-6, -6, 390]);
    // A neighbour lower than the band hides nothing: the band runs round the corner over its roof.
    const high = band(doc, a, 4, 636, 644, tile, [nb(b, 544)]);
    expect(scanBrushes(high)[0].box.max.x).toBe(260);
  });

  it('a wall hidden in part gets strips that stop short of the neighbour at an inside corner', () => {
    const doc = VmfDocument.empty();
    // An L of two neighbours: `deep` runs 640 back, `front` only 256, so the back of deep's side wall is free.
    const deep = rect(0, 0, 256, 640), front = rect(256, 0, 640, 256);
    const ledgeDeep = band(doc, deep, 6, 122, 134, tile, [nb(front, 512, 6)]);
    const ledgeFront = band(doc, front, 6, 122, 134, tile, [nb(deep, 512, 6)]);
    expect(crossing(ledgeDeep, ledgeFront)).toHaveLength(0);
    // The strip on deep's side wall starts 6 behind front's back wall (front's band reaches 6 out of it)
    // and turns round deep's back corner.
    const strip = scanBrushes(ledgeDeep).find((s) => s.box.min.x >= 256)!;
    expect([strip.box.min.y, strip.box.max.y, strip.box.max.x]).toEqual([262, 646, 262]);
  });

  it('buildings touching only at a corner: the wall that ends there gives way', () => {
    const doc = VmfDocument.empty();
    // Around a courtyard corner at (256, 256): one building south-west of it, one north-east.
    const sw = rect(0, 0, 256, 256), ne = rect(256, 256, 512, 512);
    const a = band(doc, sw, 6, 122, 134, tile, [nb(ne, 512)]);
    const b = band(doc, ne, 6, 122, 134, tile, [nb(sw, 512)]);
    expect(crossing(a, b)).toHaveLength(0);
  });
});

const block = new Box3(new Vector3(0, 0, 0), new Vector3(1280, 1152, 0));
const blocks = [3, 4, 9, 21, 33].map((seed) => {
  const doc = VmfDocument.empty();
  return generateBuildings(doc, block, { seed, minFloors: 3, maxFloors: 6, alleys: false, roofProps: false, architecture: 'tenement', detail: 2, weathering: 1 });
});

describe('generated blocks', () => {
  it('no decoration reaches into another wing', () => {
    for (const r of blocks) {
      // Shells grouped by footprint: a wing's ground floor and upper floors.
      const shells = scanBrushes(r.solids);
      const wing = (s: ScanBrush) => `${s.box.min.x},${s.box.min.y},${s.box.max.x},${s.box.max.y}`;
      for (const d of scanBrushes(r.detail)) {
        const wings = new Set(shells.filter((s) => intersection(d, s)).map(wing));
        expect(wings.size, `detail brush ${d.box.min.toArray()}..${d.box.max.toArray()}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('no two decoration brushes show faces on the same plane', () => {
    for (const r of blocks) {
      const all = scanBrushes([...r.solids, ...r.detail]);
      const detail = scanBrushes(r.detail);
      // Faces buried in another brush, or under the ground, don't show.
      const buried = (p: Vector3, a: ScanBrush, b: ScanBrush) => p.z < 0 || all.some((s) => s.box.containsPoint(p) && s.faces.every((f) => f.plane.normal.dot(p) - f.plane.dist < -0.05) && s !== a && s !== b);
      const fights = boxPairs(detail).flatMap(([a, b]) => coplanarOverlaps(a, b).filter((c) => !buried(c.at.clone().addScaledVector(c.normal, 0.1), a, b)));
      expect(fights.map((c) => c.at.toArray())).toEqual([]);
    }
  });

  it('stains stay clear of ledges, cornices and the other decoration', () => {
    let stains = 0;
    for (const r of blocks) {
      const detail = scanBrushes(r.detail);
      for (const e of r.entities.filter((x) => x.classname === 'infodecal' && /stain/.test(x.keys.texture))) {
        stains++;
        const size = STAINS.find((s) => s.texture === e.keys.texture)!;
        const o = e.origin;
        // Street walls are on the block's outline; the stain hangs 2 units in front of one.
        const alongY = o.x < block.min.x || o.x > block.max.x;
        const half = new Vector3(alongY ? 4 : size.w / 2, alongY ? size.w / 2 : 4, size.h / 2);
        const box = new Box3(o.clone().sub(half), o.clone().add(half));
        expect(detail.filter((d) => d.box.intersectsBox(box) && d.box.clone().intersect(box).getSize(new Vector3()).toArray().every((v) => v > 0)).map((d) => d.box.min.toArray())).toEqual([]);
      }
    }
    expect(stains).toBeGreaterThan(10);
  });
});
