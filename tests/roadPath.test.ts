import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildRoads, decodeRoad, defaultRoad, encodeRoad, keepJoined, roadCorners, roadGround, roadLine, type RoadSpec } from '../src/gen/roads.ts';
import { addPoint, type PointPath } from '../src/edit/pathPoints.ts';
import { roadBase, roadChains, roadCheck, roadPath, roadSpecs } from '../src/edit/roadPath.ts';
import { VmfDocument } from '../src/vmf/map.ts';

const V = (x: number, y: number, z = 0) => new Vector3(x, y, z);
const P = (x: number, y: number, z = 0) => ({ x, y, z });
const asphalt = (points: Vector3[], radius = 256): RoadSpec => ({ ...defaultRoad('asphalt', points), radius });
const pts = (r: RoadSpec) => r.points.map((p) => [p.x, p.y, p.z]);
/** A path from clicks: each [from, x, y] adds a point after `from`. */
const clicked = (first: [number, number], ...rest: [number, number, number][]): PointPath =>
  rest.reduce<PointPath>((path, [from, x, y]) => addPoint(path, from, P(x, y)).path, { points: [P(...first)], links: [] });

describe('road paths', () => {
  it('a chain is one road; a branch is a second road starting at its point', () => {
    // A-B-C1, and C2 branching from B.
    const path = clicked([0, 0], [0, 0, 1024], [1, 1024, 1024], [1, -1024, 1024]);
    expect(roadChains(path)).toEqual([[0, 1, 2], [1, 3]]);
  });

  it('a branch from A extends the first road backwards, through A', () => {
    const path = clicked([0, 0], [0, 1024, 0], [0, -1024, 0]);
    expect(roadChains(path)).toEqual([[2, 0, 1]]);
  });

  it('branches of branches are roads of their own; a lone point makes none', () => {
    const path = clicked([0, 0], [0, 0, 1024], [1, 0, 2048], [1, 1024, 1024], [3, 1024, 2048], [3, 2048, 1024]);
    expect(roadChains(path)).toEqual([[0, 1, 2], [1, 3, 4], [3, 5]]);
    expect(roadChains({ points: [P(0, 0)], links: [] })).toEqual([]);
  });

  it('a branch off a corner starts on the rounded centre line, so the T joins the road surface', () => {
    const path = clicked([0, 0], [0, 0, 1024], [1, 1024, 1024], [1, -1024, 1024]);
    const [main, branch] = roadSpecs(path, roadBase(asphalt([], 256)));
    expect(pts(main)).toEqual([[0, 0, 0], [0, 1024, 0], [1024, 1024, 0]]);
    const start = branch.points[0];
    // B is the corner's point, outside the arc; the branch starts on the arc instead.
    expect(Math.hypot(start.x, start.y - 1024)).toBeGreaterThan(50);
    const line = roadLine(main);
    expect(Math.min(...line.map((p) => p.distanceTo(start)))).toBeLessThan(40);
    expect(branch.points[1]).toEqual(V(-1024, 1024, 0));
  });

  it('keeps each point\'s own corner radius, stored with the road', () => {
    const road: RoadSpec = { ...asphalt([V(0, 0), V(0, 1024), V(1024, 1024), V(1024, 2048)]), radii: [undefined, 128, undefined, undefined] };
    const back = decodeRoad(encodeRoad(road))!;
    expect(back.radii).toEqual([undefined, 128, undefined, undefined]);
    expect(roadPath(back).points[1]).toEqual({ x: 0, y: 1024, z: 0, radius: 128 });
    expect(roadSpecs(roadPath(back), roadBase(back))[0].radii).toEqual(back.radii);
    // Without own radii the stored text is as before.
    expect(encodeRoad(asphalt([V(0, 0), V(64, 0)]))).not.toContain('0 0 0 ');
    expect(roadCorners(back).map((c) => c && Math.round(c.got))).toEqual([null, 128, 256, null]);
  });

  it('a corner shrinks when the stretches beside it are too short', () => {
    const corners = roadCorners(asphalt([V(0, 0), V(0, 200), V(1024, 200)], 256));
    expect(corners[1]!.turn).toBeCloseTo(90);
    expect(Math.round(corners[1]!.got)).toBe(100);
  });

  it('checks a dragged point: fine, amber when a corner shrank, red when it cannot be built, blue when it joins', () => {
    const base = roadBase(asphalt([], 256));
    const market = asphalt([V(-2048, 0), V(2048, 0)]);
    const path = (b: [number, number], c: [number, number]) => clicked([0, 2048], [0, b[0], b[1]], [1, c[0], c[1]]);
    expect(roadCheck(base, path([0, 1024], [1024, 1024]), 1, [market]).level).toBe('fine');
    const amber = roadCheck(base, path([0, 1024], [200, 1024]), 1, [market]);
    expect(amber.level).toBe('adjusted');
    expect(amber.note).toContain('256 → 100');
    expect(roadCheck(base, path([0, 1024], [16, 1024]), 2, [market]).level).toBe('refused');
    const hairpin = roadCheck(base, path([0, 1024], [64, 2048]), 1, [market]);
    expect(hairpin.level).toBe('refused');
    expect(hairpin.note).toContain('turns back on itself');
    // C dropped on Market street's centre line: a T junction.
    const joins = roadCheck(base, path([0, 1024], [1024, 0]), 2, [market]);
    expect(joins.level).toBe('joins');
    expect(joins.note).toContain('T junction');
  });

  it('a road ending on another one\'s centre line builds a T: the kerbs open, the far side stays', () => {
    const market = asphalt([V(-2048, 0), V(2048, 0)]);
    const branch = asphalt([V(0, 0), V(0, 1024)]);
    const ground = roadGround([market, branch]);
    // Market's kerb (128 to 136 off its centre) is open where the branch comes in…
    expect(ground(0, 132)?.kind).toBe('surface');
    expect(ground(100, 132)?.kind).toBe('surface');
    // …and runs on beside it and along the far side.
    expect(ground(400, 132)?.kind).toBe('kerb');
    expect(ground(0, -132)?.kind).toBe('kerb');
    // The branch's own kerbs run up to Market's kerb line.
    expect(ground(132, 300)?.kind).toBe('kerb');
    expect(ground(132, 60)?.kind).toBe('surface');
    expect(buildRoads(VmfDocument.empty(), [market, branch]).every((brushes) => brushes.length > 0)).toBe(true);
  });

  it('a branch stays joined when its main road moves', () => {
    const before = asphalt([V(-2048, 0), V(2048, 0)]);
    const branch = asphalt([V(0, 0), V(0, 1024)]);
    const away = asphalt([V(0, 2048), V(0, 3072)]);
    const moved = asphalt([V(-2048, 128), V(2048, 128)]);
    const [, joined, apart] = keepJoined([moved, branch, away], 0, before);
    expect(pts(joined)).toEqual([[0, 128, 0], [0, 1024, 0]]);
    expect(apart).toBe(away);
  });
});
