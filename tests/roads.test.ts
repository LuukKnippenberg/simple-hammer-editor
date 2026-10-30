import { describe, expect, it } from 'vitest';
import { Vector2, Vector3 } from 'three';
import { buildRoads, centreline, decodeRoad, defaultRoad, encodeRoad, snapToRoads, subtract, type RoadSpec } from '../src/gen/roads.ts';
import { MapSolid, VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import type { KVNode } from '../src/vmf/keyvalues.ts';

const V = (x: number, y: number, z = 0) => new Vector3(x, y, z);
const valid = (n: KVNode) => {
  const s = new MapSolid(n, null);
  return s.sides.length >= 5 && buildBrushFaces(s).length === s.sides.length;
};
const mats = (nodes: KVNode[]) => nodes.flatMap((n) => new MapSolid(n, null).sides.map((s) => s.material));

describe('roads', () => {
  it('rounds bends with arcs that keep the corner radius', () => {
    const line = centreline([V(0, 0), V(1000, 0), V(1000, 1000)], 256);
    expect(line.length).toBeGreaterThan(5);
    // The arc passes about r·(√2 − 1) inside the corner.
    const inner = Math.min(...line.map((p) => Math.hypot(p.x - 1000, p.y)));
    expect(inner).toBeGreaterThan(90);
    expect(inner).toBeLessThan(120);
  });

  it('every style builds valid brushes, including bends and slopes', () => {
    for (const style of ['asphalt', 'cobble', 'tram', 'dirt'] as const) {
      const r = defaultRoad(style, [V(0, 0, 0), V(1024, 0, 0), V(1600, 600, 64), V(1600, 1400, 64)]);
      const [solids] = buildRoads(VmfDocument.empty(), [r]);
      // At least one surface piece per segment of the rounded line (dirt tracks have nothing else).
      expect(solids.length).toBeGreaterThan(5);
      for (const s of solids) expect(valid(s)).toBe(true);
      if (style === 'tram') expect(mats(solids)).toContain('METAL/METALTRACK001A');
      if (style === 'dirt') expect(mats(solids)).not.toContain('CONCRETE/CONCRETEFLOOR027A');
    }
  });

  it('a crossing removes the kerbs and pavements that would block it', () => {
    const a = defaultRoad('asphalt', [V(-1024, 0), V(1024, 0)]);
    const b = defaultRoad('asphalt', [V(0, -1024), V(0, 1024)]);
    const [sa, sb] = buildRoads(VmfDocument.empty(), [a, b]);
    for (const s of [...sa, ...sb]) expect(valid(s)).toBe(true);
    // No kerb or pavement of either road is left inside the other road's carriageway.
    const inside = (n: KVNode, box: [number, number, number, number]) => {
      const faces = buildBrushFaces(new MapSolid(n, null));
      const xs = faces.flatMap((f) => f.verts.map((v) => v.x)), ys = faces.flatMap((f) => f.verts.map((v) => v.y));
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      return cx > box[0] && cx < box[2] && cy > box[1] && cy < box[3];
    };
    const kerbs = (nodes: KVNode[]) => nodes.filter((n) => mats([n]).includes('CONCRETE/CONCRETEFLOOR027A'));
    expect(kerbs(sa).some((n) => inside(n, [-127, -127, 127, 127]))).toBe(false);
    expect(kerbs(sb).some((n) => inside(n, [-127, -127, 127, 127]))).toBe(false);
  });

  it('subtracts convex polygons into convex pieces covering the rest', () => {
    const sq = [new Vector2(0, 0), new Vector2(100, 0), new Vector2(100, 100), new Vector2(0, 100)];
    const hole = [new Vector2(40, -10), new Vector2(60, -10), new Vector2(60, 110), new Vector2(40, 110)];
    const pieces = subtract(sq, hole);
    const area = pieces.reduce((s, p) => s + Math.abs(p.reduce((a, v, i) => a + v.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * v.y, 0) / 2), 0);
    expect(area).toBeCloseTo(8000, 0);
    expect(subtract(sq, hole.map((v) => v.clone().add(new Vector2(500, 0))))).toEqual([sq]);
  });

  it('stores its definition and joins new roads onto old ones', () => {
    const r: RoadSpec = { ...defaultRoad('tram', [V(0, 0, 16), V(512, 0, 16)]), kerbs: false };
    expect(decodeRoad(encodeRoad(r))).toEqual(r);
    const p = snapToRoads([r], V(200, 30, 0), 64)!;
    expect([p.x, p.y, p.z]).toEqual([200, 0, 16]);
    expect(snapToRoads([r], V(200, 300, 0), 64)).toBeNull();
  });
});
