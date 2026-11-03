/**
 * Point paths: the A, B, C… points stairs (and later streets and powerlines) are drawn with. A path is a tree:
 * point 0 is A, every other point hangs off one link from the point before it, and a point with two links out is
 * a branch. Pure functions: the names, and adding, inserting, moving and removing points. `pathPins.ts` draws the
 * pins and drags them; a generator turns the points into what it builds.
 *
 * Paths come back in one order (A first, then each branch in turn, depth first) with `links[k].to === k + 1`, so
 * every change says where the old points went (`moved`) for whoever keeps an index (the selected pin, the point
 * placing carries on from).
 */
export interface PathPoint { x: number; y: number; z: number }
/** A stretch from one point to the next; generators keep their own data on it (a flight's steps, a width). */
export interface PathLink { from: number; to: number }
export interface PointPath<L extends PathLink = PathLink> { points: PathPoint[]; links: L[] }

export interface PathChange<L extends PathLink = PathLink> {
  path: PointPath<L>;
  /** Where each old point went (-1: removed). */
  moved: number[];
  /** The new point, or -1. */
  added: number;
}

/** The point a link comes in from, or -1 (A, or not linked). */
export const parentOf = (path: PointPath, i: number): number => path.links.find((link) => link.to === i)?.from ?? -1;

/** The points linked from a point, the one that carries on first. */
export const childrenOf = (path: PointPath, i: number): number[] => path.links.filter((link) => link.from === i).map((link) => link.to);

export const isLeaf = (path: PointPath, i: number): boolean => !path.links.some((link) => link.from === i);

/** Every point but A has one link in, and all of them hang off A. */
export function isTree(path: PointPath): boolean {
  const n = path.points.length;
  if (!n || path.links.length !== n - 1) return false;
  const into = new Set(path.links.map((link) => link.to));
  if (into.size !== n - 1 || into.has(0) || path.links.some((link) => link.from < 0 || link.from >= n || link.to < 0 || link.to >= n)) return false;
  return preorder(path).length === n;
}

/** A, B, …, Z, AA, AB… */
function letters(depth: number): string {
  let out = '';
  for (let k = depth + 1; k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(65 + ((k - 1) % 26)) + out;
  return out;
}

/** Points from A, depth first, each point's links in order. */
function preorder(path: PointPath): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const walk = (i: number) => {
    if (seen.has(i)) return;
    seen.add(i);
    out.push(i);
    for (const child of childrenOf(path, i)) walk(child);
  };
  if (path.points.length) walk(0);
  return out;
}

/**
 * Names the boards use: letters count from A along the path; a branch adds a number. From B, C1 carries on and C2
 * branches; after C2 comes D2. A branch off a numbered branch keeps the number on the carrying-on side and takes
 * the next free one on the other. Points not reached from A are named by their place (#5).
 */
export function pathLabels(path: PointPath): string[] {
  const names = path.points.map((_, i) => `#${i + 1}`);
  if (!path.points.length) return names;
  let branches = 0;
  const seen = new Set<number>();
  const walk = (i: number, depth: number, branch: number) => {
    if (seen.has(i)) return;
    seen.add(i);
    names[i] = letters(depth) + (branch ? String(branch) : '');
    const kids = childrenOf(path, i);
    const numbers = kids.map((_, k) => (kids.length < 2 ? branch : k === 0 && branch ? branch : ++branches));
    kids.forEach((kid, k) => walk(kid, depth + 1, numbers[k]));
  };
  walk(0, 0, 0);
  return names;
}

/** The path in its one order; `moved` maps the given indices to the new ones. */
function ordered<L extends PathLink>(path: PointPath<L>): PathChange<L> {
  const order = preorder(path);
  const moved = path.points.map(() => -1);
  order.forEach((old, i) => (moved[old] = i));
  const points = order.map((old) => ({ ...path.points[old] }));
  const links = order.slice(1).map((old) => {
    const link = path.links.find((l) => l.to === old)!;
    return { ...link, from: moved[link.from], to: moved[old] };
  });
  return { path: { points, links }, moved, added: -1 };
}

/** Puts a path in its one order (stored paths may have been built in another). */
export const normalizePath = <L extends PathLink>(path: PointPath<L>): PointPath<L> => ordered(path).path;

/** Follows two changes: where an old point is after both. */
const chain = (first: number[], second: number[]) => first.map((i) => (i < 0 ? -1 : second[i] ?? -1));

/** Adds a point after `from` (the next click while placing; after a Shift+click, a branch). */
export function addPoint<L extends PathLink>(path: PointPath<L>, from: number, at: PathPoint, link: Omit<L, 'from' | 'to'> = {} as Omit<L, 'from' | 'to'>): PathChange<L> {
  const n = path.points.length;
  const grown: PointPath<L> = { points: [...path.points, { ...at }], links: n ? [...path.links, { ...link, from, to: n } as L] : [] };
  const r = ordered(grown);
  return { path: r.path, moved: r.moved.slice(0, n), added: r.moved[n] };
}

/** Inserts a point in a link's stretch; both halves keep the link's own data. */
export function insertPoint<L extends PathLink>(path: PointPath<L>, link: number, at: PathPoint): PathChange<L> {
  const old = path.links[link];
  if (!old) return { path, moved: path.points.map((_, i) => i), added: -1 };
  const n = path.points.length;
  const links = path.links.flatMap((l, k) => (k === link ? [{ ...l, to: n }, { ...l, from: n, to: old.to }] : [l]));
  const r = ordered({ points: [...path.points, { ...at }], links });
  return { path: r.path, moved: r.moved.slice(0, n), added: r.moved[n] };
}

/** Moves one point. */
export function movePoint<L extends PathLink>(path: PointPath<L>, i: number, at: PathPoint): PointPath<L> {
  return { points: path.points.map((p, k) => (k === i ? { ...at } : p)), links: path.links };
}

/**
 * Removes a point; its neighbours join up (each point after it links from the one before). Removing A makes the
 * point after it the new A. Null when that would leave fewer than `min` points.
 */
export function removePoint<L extends PathLink>(path: PointPath<L>, i: number, min = 1): PathChange<L> | null {
  if (i < 0 || i >= path.points.length || path.points.length - 1 < min) return null;
  const parent = parentOf(path, i);
  const kids = childrenOf(path, i);
  const joinTo = parent >= 0 ? parent : kids[0] ?? -1;
  const links = path.links
    .filter((l) => l.to !== i && !(parent < 0 && l.from === i && l.to === joinTo))
    .map((l) => (l.from === i ? { ...l, from: joinTo } : l));
  // Without point i, and A first.
  const keep = path.points.map((_, k) => k).filter((k) => k !== i);
  if (parent < 0 && joinTo >= 0) { keep.splice(keep.indexOf(joinTo), 1); keep.unshift(joinTo); }
  const index = path.points.map(() => -1);
  keep.forEach((old, k) => (index[old] = k));
  const r = ordered({ points: keep.map((k) => path.points[k]), links: links.map((l) => ({ ...l, from: index[l.from], to: index[l.to] })) });
  return { path: r.path, moved: chain(index, r.moved), added: -1 };
}

/** The point Backspace takes back: the one placing carries on from when nothing hangs off it, else the last one. */
export function lastPoint(path: PointPath, from: number): number {
  if (from > 0 && from < path.points.length && isLeaf(path, from)) return from;
  return path.points.length - 1;
}

/** Mid point of a link's stretch (where its + handle sits). */
export function linkMiddle(points: PathPoint[], link: PathLink): PathPoint {
  const a = points[link.from], b = points[link.to];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/** A branch's newest point (blue until placing goes on from it): it starts a second or later link of a point, and nothing hangs off it yet. */
export function isBranchTip(path: PointPath, i: number): boolean {
  const parent = parentOf(path, i);
  return parent >= 0 && childrenOf(path, parent).indexOf(i) > 0 && isLeaf(path, i);
}
