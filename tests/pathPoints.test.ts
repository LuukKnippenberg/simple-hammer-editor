import { describe, expect, it } from 'vitest';
import {
  addPoint, insertPoint, isBranchTip, isTree, lastPoint, linkMiddle, movePoint, normalizePath, pathLabels, removePoint,
  type PathLink, type PointPath,
} from '../src/edit/pathPoints.ts';

const pt = (x: number, y = 0, z = 0) => ({ x, y, z });
/** A → B → C1 → D1, and B → C2 (the PathSpec anatomy). */
function tee(): PointPath {
  let path: PointPath = { points: [pt(0)], links: [] };
  for (const [from, at] of [[0, pt(100)], [1, pt(100, 100)], [2, pt(200, 100)], [1, pt(200)]] as const) path = addPoint(path, from, at).path;
  return path;
}

describe('path labels', () => {
  it('count A, B, C… along a chain', () => {
    const chain: PointPath = { points: [pt(0), pt(1), pt(2), pt(3)], links: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }] };
    expect(pathLabels(chain)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('number branches: C1 carries on, C2 branches, after C2 comes D2', () => {
    const path = tee();
    expect(pathLabels(path)).toEqual(['A', 'B', 'C1', 'D1', 'C2']);
    const on = addPoint(path, 4, pt(300));
    expect(pathLabels(on.path)[on.added]).toBe('D2');
  });

  it('a branch off a numbered branch keeps its number and takes the next free one', () => {
    const path = addPoint(tee(), 2, pt(100, 300)).path;
    const names = pathLabels(path);
    expect(names).toEqual(['A', 'B', 'C1', 'D1', 'D3', 'C2']);
  });

  it('go past Z', () => {
    let path: PointPath = { points: [pt(0)], links: [] };
    for (let i = 1; i < 28; i++) path = addPoint(path, i - 1, pt(i)).path;
    expect(pathLabels(path).slice(24)).toEqual(['Y', 'Z', 'AA', 'AB']);
  });

  it('name points A cannot reach by their place', () => {
    const broken: PointPath = { points: [pt(0), pt(1), pt(2)], links: [{ from: 0, to: 1 }] };
    expect(isTree(broken)).toBe(false);
    expect(pathLabels(broken)).toEqual(['A', 'B', '#3']);
  });
});

describe('path edits', () => {
  it('keep A first and each link pointing at the next point', () => {
    const path = tee();
    expect(isTree(path)).toBe(true);
    path.links.forEach((link, k) => expect(link.to).toBe(k + 1));
    const stored: PointPath = { points: [pt(0), pt(1), pt(2), pt(3)], links: [{ from: 0, to: 1 }, { from: 1, to: 3 }, { from: 3, to: 2 }] };
    expect(normalizePath(stored).points.map((p) => p.x)).toEqual([0, 1, 3, 2]);
  });

  it('insert a point in a stretch, with the stretch\'s own data on both halves', () => {
    const path: PointPath<PathLink & { width?: number }> = { points: [pt(0), pt(100)], links: [{ from: 0, to: 1, width: 96 }] };
    const r = insertPoint(path, 0, linkMiddle(path.points, path.links[0]));
    expect(r.added).toBe(1);
    expect(r.moved).toEqual([0, 2]);
    expect(r.path.points.map((p) => p.x)).toEqual([0, 50, 100]);
    expect(r.path.links).toEqual([{ from: 0, to: 1, width: 96 }, { from: 1, to: 2, width: 96 }]);
    expect(pathLabels(r.path)).toEqual(['A', 'B', 'C']);
  });

  it('insert into a branch letters the rest again', () => {
    const path = tee();
    const k = path.links.findIndex((l) => l.to === 4);
    const r = insertPoint(path, k, pt(150));
    expect(pathLabels(r.path)[r.added]).toBe('C2');
    expect(pathLabels(r.path)[r.moved[4]]).toBe('D2');
  });

  it('remove a point: its neighbours join up', () => {
    const r = removePoint(tee(), 1)!;
    expect(r.moved).toEqual([0, -1, 1, 2, 3]);
    expect(r.path.links.map((l) => [l.from, l.to])).toEqual([[0, 1], [1, 2], [0, 3]]);
    expect(pathLabels(r.path)).toEqual(['A', 'B1', 'C1', 'B2']);
  });

  it('remove A: the point after it is the new A', () => {
    const r = removePoint(tee(), 0)!;
    expect(r.path.points[0]).toEqual(pt(100));
    expect(isTree(r.path)).toBe(true);
    expect(pathLabels(r.path)).toEqual(['A', 'B1', 'C1', 'B2']);
    expect(r.moved[0]).toBe(-1);
    expect(r.moved[1]).toBe(0);
  });

  it('remove refuses to go under a minimum', () => {
    const two: PointPath = { points: [pt(0), pt(1)], links: [{ from: 0, to: 1 }] };
    expect(removePoint(two, 1, 2)).toBeNull();
    expect(removePoint(two, 1)!.path.points).toEqual([pt(0)]);
  });

  it('branch: adding from a point that already carries on', () => {
    const chain = addPoint(addPoint({ points: [pt(0)], links: [] }, 0, pt(1)).path, 1, pt(2)).path;
    const r = addPoint(chain, 1, pt(5));
    expect(pathLabels(r.path)).toEqual(['A', 'B', 'C1', 'C2']);
    expect(isBranchTip(r.path, r.added)).toBe(true);
    expect(isBranchTip(r.path, 2)).toBe(false);
    // Adding to the first branch afterwards puts it before C2 in the order; `moved` says where C2 went.
    const more = addPoint(r.path, 2, pt(3));
    expect(more.moved[3]).toBe(4);
    expect(pathLabels(more.path)).toEqual(['A', 'B', 'C1', 'D1', 'C2']);
  });

  it('move a point and find the one Backspace takes back', () => {
    const path = tee();
    expect(movePoint(path, 2, pt(9, 9, 9)).points[2]).toEqual(pt(9, 9, 9));
    expect(lastPoint(path, 4)).toBe(4);
    expect(lastPoint(path, 1)).toBe(4);
    expect(lastPoint(path, 3)).toBe(3);
  });
});
