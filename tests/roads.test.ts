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
const KERB = 'CONCRETE/CONCRETEFLOOR027A';
const PAVEMENT = 'CONCRETE/CONCRETEFLOOR028A';
const polyArea = (p: Vector2[]) => p.reduce((a, v, i) => a + v.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * v.y, 0) / 2;
const areaOf = (ps: Vector2[][]) => ps.reduce((s, p) => s + Math.abs(polyArea(p)), 0);
/** A brush's outline seen from above: the counter-clockwise convex hull of its vertices. */
const footprint = (n: KVNode): Vector2[] => {
  const pts = buildBrushFaces(new MapSolid(n, null)).flatMap((f) => f.verts.map((v) => new Vector2(Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100)));
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (o: Vector2, a: Vector2, b: Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Vector2[]) => list.reduce<Vector2[]>((h, p) => {
    while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
    h.push(p);
    return h;
  }, []).slice(0, -1);
  return [...half(pts), ...half([...pts].reverse())];
};
const contains = (poly: Vector2[], p: Vector2) => poly.every((a, i) => {
  const b = poly[(i + 1) % poly.length];
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0;
});

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

  it('no two brushes overlap where roads cross, meet or continue each other', () => {
    const layouts: RoadSpec[][] = [
      // Crossing.
      [defaultRoad('asphalt', [V(-1024, 0), V(1024, 0)]), defaultRoad('asphalt', [V(0, -1024), V(0, 1024)])],
      // T-junction, a side street running on to the main road's centre.
      [defaultRoad('asphalt', [V(-1024, 0), V(1024, 0)]), defaultRoad('cobble', [V(0, 0), V(0, 1024)])],
      // Two pieces of one street overlapping end to end (as the sketch builds them).
      [defaultRoad('asphalt', [V(-1024, 0), V(128, 0)]), defaultRoad('asphalt', [V(-128, 0), V(1024, 0)])],
      // A dirt track across a street.
      [defaultRoad('asphalt', [V(-1024, 0), V(1024, 0)]), defaultRoad('dirt', [V(0, -1024), V(0, 1024)])],
    ];
    for (const roads of layouts) {
      const foot = buildRoads(VmfDocument.empty(), roads).flat().map(footprint);
      for (let i = 0; i < foot.length; i++) {
        for (let j = i + 1; j < foot.length; j++) expect(polyArea(foot[i]) - areaOf(subtract(foot[i], foot[j]))).toBeLessThan(1);
      }
    }
  });

  it('the kerb runs on unbroken around a block corner', () => {
    const a = defaultRoad('asphalt', [V(-1024, 0), V(1024, 0)]);
    const b = defaultRoad('asphalt', [V(0, -1024), V(0, 1024)]);
    const nodes = buildRoads(VmfDocument.empty(), [a, b]).flat();
    const kerbs = nodes.filter((n) => mats([n]).includes(KERB) && !mats([n]).includes(PAVEMENT)).map(footprint);
    const pavements = nodes.filter((n) => mats([n]).includes(PAVEMENT)).map(footprint);
    const w = a.width / 2;
    // Along the middle of the kerb, in an L around each of the four corners.
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      for (let t = w + 1; t < 1000; t += 4) {
        for (const p of [new Vector2(sx * t, sy * (w + 4)), new Vector2(sx * (w + 4), sy * t)]) {
          expect(kerbs.some((k) => contains(k, p))).toBe(true);
          expect(pavements.some((k) => contains(k, p))).toBe(false);
        }
      }
    }
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
