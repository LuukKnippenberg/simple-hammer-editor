import { describe, expect, it } from 'vitest';
import { Box3, Ray, Vector2, Vector3 } from 'three';
import {
  boxShape, constrain, dragPlaneNormal, findTargets, fmtNum, fmtVec, handlesOf, nearestHandle, resolveSnap,
  type Handle, type SnapShape, type SnapView, type Target,
} from '../src/edit/snapMove.ts';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
const box = (min: Vector3, max: Vector3, origin?: Vector3) => boxShape({}, new Box3(min, max), origin);

/** Looking straight down: one pixel per unit, pixel (x, y) over world (x, -y). */
function topView(cx: number, cy: number): { view: SnapView; cursor: Vector2 } {
  return {
    view: { project: (p) => new Vector2(p.x, -p.y), ray: new Ray(v(cx, -cy, 10000), v(0, 0, -1)) },
    cursor: new Vector2(cx, cy),
  };
}
/** Cursor over world point (x, y). */
const over = (x: number, y: number) => topView(x, -y);

describe('handles', () => {
  it('a box has 8 corners, 12 edge middles, 6 face centres and its origin', () => {
    const hs = handlesOf(box(v(0, 0, 0), v(64, 64, 64), v(32, 32, 0)));
    expect(hs.filter((h) => h.kind === 'vertex')).toHaveLength(8);
    expect(hs.filter((h) => h.kind === 'edge')).toHaveLength(12);
    expect(hs.filter((h) => h.kind === 'face')).toHaveLength(6);
    expect(hs.find((h) => h.kind === 'origin')!.point).toEqual(v(32, 32, 0));
    const top = hs.find((h) => h.kind === 'face' && h.normal!.z === 1)!;
    expect(top.point).toEqual(v(32, 32, 64));
  });

  it('box faces point outwards and wind counter-clockwise seen from outside', () => {
    for (const f of box(v(0, 0, 0), v(10, 20, 30)).faces) {
      const [a, b, c] = f.verts;
      const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      expect(n.dot(f.normal)).toBeCloseTo(1);
    }
  });

  it('grabs the handle nearest the cursor, corners first on a tie', () => {
    const hs = handlesOf(box(v(0, 0, 0), v(64, 64, 64)));
    const { view, cursor } = over(62, 63);
    expect(nearestHandle(hs, view, cursor)!.kind).toBe('vertex');
    const mid = over(32, 2);
    const h = nearestHandle(hs, mid.view, mid.cursor)!;
    expect(h.kind).toBe('edge');
    expect(h.point.x).toBe(32);
    const far = over(300, 300);
    expect(nearestHandle(hs, far.view, far.cursor)).toBeNull();
  });
});

describe('targets', () => {
  const wall = box(v(100, 0, 0), v(200, 50, 128));
  const floor = box(v(-500, -500, -16), v(500, 500, 0));

  it('prefers a corner, then an edge, then the face under the cursor', () => {
    const near = over(103, 48);
    expect(findTargets([wall, floor], near.view, near.cursor).best!.kind).toBe('vertex');
    const edge = over(150, 47);
    const e = findTargets([wall, floor], edge.view, edge.cursor).best!;
    expect(e.kind).toBe('edge');
    expect(e.point).toEqual(v(150, 50, 128));
    const face = over(150, 25);
    const f = findTargets([wall, floor], face.view, face.cursor).best!;
    expect(f.kind).toBe('face');
    expect(f.point.z).toBeCloseTo(128);
    expect(f.shape).toBe(wall);
  });

  it('respects the snap-to toggles', () => {
    const near = over(103, 48);
    const kinds = { vertex: false, edge: false, face: true, grid: true };
    expect(findTargets([wall], near.view, near.cursor, { kinds }).best!.kind).toBe('face');
    expect(findTargets([wall], near.view, near.cursor, { kinds: { ...kinds, face: false } }).best).toBeNull();
  });

  it('hides corners behind the face the cursor is on', () => {
    // A slab above the floor covers the floor's corner at (0, 0, 0) of a small block below it.
    const block = box(v(0, 0, 0), v(32, 32, 32));
    const roof = box(v(-100, -100, 200), v(100, 100, 220));
    const { view, cursor } = over(1, 1);
    const t = findTargets([block, roof], view, cursor);
    expect(t.best!.kind).toBe('face');
    expect(t.best!.shape).toBe(roof);
    expect(t.candidates.some((c) => c.shape === block)).toBe(false);
  });

  it('a grabbed face only lands on faces turned against it', () => {
    const { view, cursor } = over(150, 25);
    const down: Handle = { kind: 'face', point: v(0, 0, 0), normal: v(0, 0, -1) };
    const side: Handle = { kind: 'face', point: v(0, 0, 0), normal: v(1, 0, 0) };
    expect(findTargets([wall], view, cursor, { grabbed: down }).best!.kind).toBe('face');
    expect(findTargets([wall], view, cursor, { grabbed: side }).best).toBeNull();
  });
});

describe('snap pairs', () => {
  const ray = (x: number, y: number) => new Ray(v(x, y, 10000), v(0, 0, -1));
  const corner: Handle = { kind: 'vertex', point: v(150, 136, 0) };
  const shape: SnapShape = box(v(0, 0, 0), v(1, 1, 1));

  it('corner onto corner is exact, off the grid too', () => {
    const t: Target = { kind: 'vertex', shape, point: v(128, -224.5, 3), dist: 0 };
    const r = resolveSnap(corner, t, ray(0, 0), 16, v(0, 0, 1))!;
    expect(r.kind).toBe('vertex');
    expect(r.delta).toEqual(v(-22, -360.5, 3));
    expect(r.landing).toEqual(v(128, -224.5, 3));
  });

  it('corner onto an edge lands on it and slides in grid steps from its end', () => {
    const t: Target = { kind: 'edge', shape, point: v(64, 0, 0), a: v(0, 0, 0), b: v(128, 0, 0), dist: 0 };
    expect(resolveSnap(corner, t, ray(37, 5), 16, v(0, 0, 1))!.landing).toEqual(v(32, 0, 0));
    // Clamped to the edge.
    expect(resolveSnap(corner, t, ray(400, 5), 16, v(0, 0, 1))!.landing).toEqual(v(128, 0, 0));
  });

  it('edge onto edge lines up the middles, then slides', () => {
    const grabbed: Handle = { kind: 'edge', point: v(10, 10, 10), a: v(0, 10, 10), b: v(20, 10, 10) };
    const t: Target = { kind: 'edge', shape, point: v(50, 0, 0), a: v(0, 0, 0), b: v(100, 0, 0), dist: 0 };
    expect(resolveSnap(grabbed, t, ray(55, 0), 16, v(0, 0, 1))!.landing).toEqual(v(50, 0, 0));
    const r = resolveSnap(grabbed, t, ray(60, 0), 16, v(0, 0, 1))!;
    expect(r.landing).toEqual(v(66, 0, 0));
    expect(r.delta).toEqual(v(56, -10, -10));
  });

  it('face onto face lands flush and slides on it in grid steps', () => {
    const bottom: Handle = { kind: 'face', point: v(10, 10, 50), normal: v(0, 0, -1) };
    const t: Target = { kind: 'face', shape, point: v(37, 21, 128), normal: v(0, 0, 1), verts: [v(0, 0, 128), v(100, 0, 128), v(100, 100, 128)], dist: 0 };
    const r = resolveSnap(bottom, t, ray(37, 21), 16, v(0, 0, 1))!;
    expect(r.kind).toBe('face');
    expect(r.delta).toEqual(v(32, 16, 78));
    expect(r.landing.z).toBe(128);
  });

  it('corner onto a sloped roof ends on the roof plane', () => {
    const n = v(0, -3, 4).normalize();
    const p0 = v(0, 0, 100);
    const t: Target = { kind: 'face', shape, point: v(40, 30, 100 + 30 * 0.75), normal: n, verts: [p0, v(1, 0, 100), v(0, 1, 100.75)], dist: 0 };
    const r = resolveSnap({ kind: 'vertex', point: v(0, 0, 0) }, t, ray(40, 30), 16, v(0, 0, 1))!;
    expect(r.landing.x).toBe(48);
    expect(r.landing.y).toBe(32);
    expect(n.dot(r.landing)).toBeCloseTo(n.dot(p0));
  });

  it('with nothing in reach the grabbed point snaps to the grid on its level', () => {
    const h: Handle = { kind: 'vertex', point: v(3, 5, 8) };
    const r = resolveSnap(h, null, ray(37, -21), 16, v(0, 0, 1))!;
    expect(r.kind).toBe('grid');
    expect(r.landing).toEqual(v(32, -16, 8));
    // Grid off: follows the cursor in whole units.
    expect(resolveSnap(h, null, ray(37.4, -21.2), 16, v(0, 0, 1), false)!.landing).toEqual(v(37, -21, 8));
  });

  it('upright drag plane when the camera looks level', () => {
    expect(dragPlaneNormal(v(0, 1, -0.9).normalize(), false)).toEqual(v(0, 0, 1));
    expect(dragPlaneNormal(v(0, 1, -0.1).normalize(), false)).toEqual(v(-0, -1, 0));
    expect(dragPlaneNormal(v(0, 1, -0.1).normalize(), true)).toEqual(v(0, 0, 1));
    const h: Handle = { kind: 'vertex', point: v(0, 0, 0) };
    const r = resolveSnap(h, null, new Ray(v(20, -500, 37), v(0, 1, 0)), 16, v(0, -1, 0))!;
    expect(r.landing).toEqual(v(16, 0, 32));
  });
});

describe('modifiers and labels', () => {
  it('Shift keeps the biggest axis, Ctrl keeps height', () => {
    expect(constrain(v(-22, -360, 40), { oneAxis: true })).toEqual(v(0, -360, 0));
    expect(constrain(v(-22, -360, 40), { keepHeight: true })).toEqual(v(-22, -360, 0));
    expect(constrain(v(10, 5, 400), { oneAxis: true, keepHeight: true })).toEqual(v(10, 0, 0));
  });

  it('formats offsets like the design', () => {
    expect(fmtVec(v(-22, -360, -0))).toBe('−22 −360 0');
    expect(fmtNum(12.3456)).toBe('12.35');
    expect(fmtNum(7.0000001)).toBe('7');
  });
});
