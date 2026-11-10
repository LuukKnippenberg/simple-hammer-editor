import type { Editor } from '../editor.ts';
import type { MapEntity, MapSolid } from '../vmf/map.ts';
import { snap } from './tools.ts';
import { historyEdit, type PathCheck, type PathEdit, type PathTarget } from './pathPins.ts';
import { childrenOf, isTree, normalizePath, parentOf, pathLabels, type PathPoint, type PointPath } from './pathPoints.ts';
import { brushStyle, fenceLayout, fenceOutline, modelPieces, modelStyle, pieceUnit, postStations, snapToPieces, type FenceDoor, type FenceLink, type FenceSpec, type Ground } from '../gen/fences.ts';
import { FENCE_ID_KEY, fenceMembers, fenceOf } from '../gen/fenceStore.ts';
import { fenceGround, isFenceSolid, regenerateFence, selectedFences } from '../gen/fenceAction.ts';
import type { GenerateTool } from './generateTool.ts';
import type { FenceTool } from './fenceTool.ts';

/**
 * Fences as a path for the pins (`pathPins.ts`): a point is a corner (or an end) of the fence, a stretch carries its
 * doorways, and a point with a branch is a T in the fence. Points follow the ground. Doorways are kept as a distance
 * along their stretch, so they stay put when the points move; an inserted point hands each doorway to the half it is
 * on, and a removed one joins its two stretches' doorways (`carryDoors`). Used by the Fence tool while placing and by
 * the Select tool on placed fences.
 */

/** Shortest stretch. */
const MIN_STRETCH = 32;

export type FencePath = PointPath<FenceLink>;

/** A fence's points and stretches as a path (stored in the path's one order). */
export const fencePath = (spec: Pick<FenceSpec, 'points' | 'links'>): FencePath =>
  normalizePath({ points: spec.points.map((p) => ({ x: p.x, y: p.y, z: p.z })), links: spec.links.map((l) => ({ ...l, ...(l.doors ? { doors: l.doors.map((d) => ({ ...d })) } : {}) })) });

/** A spec with a path's points and stretches. */
export function withPath(spec: FenceSpec, path: PointPath): FenceSpec {
  return {
    ...spec,
    points: path.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    links: (path.links as FenceLink[]).map(({ from, to, doors }) => ({ from, to, ...(doors?.length ? { doors } : {}) })),
  };
}

/** What a fence's points and doorways snap to: its mode and model. */
export type FenceKind = Partial<Pick<FenceSpec, 'mode' | 'model'>>;

/**
 * A point dropped at `hit`: on the grid, on the ground there. Model fences (`unit`: their shortest piece) instead put
 * it a whole number of pieces from `from` (the point before it), along the line to the cursor, so the stretch fits.
 */
export function fenceSnap(hit: PathPoint, grid: number, ground?: Ground, from?: PathPoint | null, unit = 0): PathPoint {
  const { x, y } = from && unit ? snapToPieces(from, hit, unit) : { x: snap(hit.x, grid), y: snap(hit.y, grid) };
  return { x, y, z: ground?.(x, y) ?? Math.round(hit.z) };
}

/** The point a dragged point measures its stretch from: the one before it, or for A the one after it. */
export function snapAnchor(path: PointPath, i: number): PathPoint | null {
  const p = parentOf(path, i);
  if (p >= 0) return path.points[p];
  const c = childrenOf(path, i)[0];
  return c === undefined ? null : path.points[c];
}

const planLength = (path: PointPath, link: { from: number; to: number }) => {
  const a = path.points[link.from], b = path.points[link.to];
  return Math.hypot(b.x - a.x, b.y - a.y);
};

/**
 * Doorways after a change of the path's points (`moved`: old → new index, from `pathPoints`). Stretches that were
 * there before keep theirs. An inserted point splits its stretch: each doorway goes to the half it is on (measured
 * from the old stretch's start, where the new point projects onto it). A removed point joins its two stretches: the
 * second one's doorways move on by the first one's length.
 */
export function carryDoors(before: PointPath, after: PointPath, moved?: number[]): PointPath {
  if (!moved) return after;
  const old = before.links as FenceLink[];
  const back = new Map<number, number>();
  moved.forEach((to, from) => { if (to >= 0) back.set(to, from); });
  const linkOf = (from: number, to: number) => old.find((l) => l.from === from && l.to === to);
  const links = (after.links as FenceLink[]).map((link) => {
    const from = back.get(link.from), to = back.get(link.to);
    const keep = (doors: FenceDoor[] | undefined) => {
      const { doors: _drop, ...rest } = link;
      return doors?.length ? { ...rest, doors: doors.map((d) => ({ ...d })) } : rest;
    };
    if (from !== undefined && to !== undefined) {
      const same = linkOf(from, to);
      if (same) return keep(same.doors);
      // A removed point between them: its two stretches joined.
      const mid = old.find((l) => l.from === from && moved[l.to] === -1 && old.some((m) => m.from === l.to && m.to === to));
      const second = mid && linkOf(mid.to, to);
      if (mid && second) {
        const shift = planLength(before, mid);
        return keep([...(mid.doors ?? []), ...(second.doors ?? []).map((d) => ({ ...d, at: d.at + shift }))]);
      }
      return keep(undefined);
    }
    // A new point: find the stretch it split, and where along it the point is.
    const added = from === undefined ? link.from : link.to;
    const parent = after.links.find((l) => l.to === added)?.from, child = after.links.find((l) => l.from === added)?.to;
    const p = parent === undefined ? undefined : back.get(parent), c = child === undefined ? undefined : back.get(child);
    const split = p !== undefined && c !== undefined ? linkOf(p, c) : undefined;
    if (!split) return keep(undefined);
    const a = before.points[split.from], b = before.points[split.to], q = after.points[added];
    const len = planLength(before, split) || 1;
    const s = Math.max(0, Math.min(len, ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / len));
    const doors = split.doors ?? [];
    return from === undefined
      ? keep(doors.filter((d) => d.at >= s).map((d) => ({ ...d, at: d.at - s })))
      : keep(doors.filter((d) => d.at < s));
  });
  return { points: after.points, links };
}

/** How each stretch builds: its name, length, what fills it, its doorways and (model fences) what is left open. */
export function fenceStretches(spec: FenceSpec, path: PointPath = fencePath(spec)): { name: string; length: number; parts: number; doors: number; open: number }[] {
  const s = withPath(spec, path);
  const names = pathLabels(path);
  return fenceLayout(s).map((st, k) => {
    const link = path.links[k];
    const parts = st.runs.reduce((n, run) => n + (s.mode === 'brush' ? postStations(run, s.spacing).length - 1 : modelPieces(modelStyle(s.model), run).length), 0);
    return { name: `${names[link.from]} → ${names[link.to]}`, length: Math.round(st.length), parts, doors: st.gaps.length, open: st.open };
  });
}

/** What a stretch is filled with, for notes ("model", "panel", "segment"). */
function partName(spec: FenceSpec): string {
  if (spec.mode === 'model') return 'model';
  return brushStyle(spec.style).kind === 'wall' ? 'segment' : 'panel';
}

/**
 * The note by a dragged fence point: the stretches into and out of it. Red when a stretch is too short to build;
 * amber when a doorway had to move or shrink to fit the shorter stretch.
 */
export function fenceCheck(spec: FenceSpec, path: PointPath, i: number): PathCheck {
  const now = fenceStretches(spec, path);
  const unit = partName(spec);
  const touching = path.links.map((link, k) => ({ link: link as FenceLink, k })).filter(({ link }) => link.from === i || link.to === i);
  const numbers = touching.map(({ k }) => {
    const st = now[k];
    return `${st.name} · ${st.length} u · ${st.parts} ${unit}${st.parts === 1 ? '' : 's'}${st.doors ? ` · ${st.doors} doorway${st.doors === 1 ? '' : 's'}` : ''}${st.open ? ` · ${st.open} u open` : ''}`;
  });
  for (const { k } of touching) if (now[k].length < MIN_STRETCH) return { level: 'refused', note: `${now[k].name}: the two points are on top of each other`, numbers };
  for (const { link, k } of touching) {
    const length = now[k].length;
    const squeezed = (link.doors ?? []).some((d) => d.at + d.width / 2 > length || d.at - d.width / 2 < 0 || d.width > length);
    if (squeezed) return { level: 'adjusted', note: `${now[k].name}: a doorway moved to fit the stretch`, numbers };
  }
  const open = touching.find(({ k }) => now[k].open > 0);
  if (open) return { level: 'adjusted', note: `${now[open.k].name}: ${now[open.k].open} u left open at its end (not whole ${pieceUnit(spec)}-unit pieces)`, numbers };
  return { level: 'fine', note: 'moved', numbers };
}

/** A path with one stretch's doorways replaced. */
export function withDoors(path: PointPath, link: number, doors: FenceDoor[]): PointPath {
  return {
    points: path.points,
    links: (path.links as FenceLink[]).map((l, k) => {
      if (k !== link) return l;
      const { doors: _old, ...rest } = l;
      return doors.length ? { ...rest, doors } : rest;
    }),
  };
}

/** A doorway's opening as built: where it runs along its stretch (clamped, for models whole pieces). */
export function doorSpan(path: PointPath, link: number, door: number, kind: FenceKind = {}): { s0: number; s1: number } | null {
  const l = path.links[link] as FenceLink | undefined;
  const d = l?.doors?.[door];
  if (!l || !d) return null;
  // Alone on its stretch, so a doorway merged with another still has its own place.
  const lone = withDoors(path, link, [d]);
  const st = fenceLayout({ points: lone.points, links: lone.links as FenceLink[], ...kind })[link];
  return st.gaps[0] ?? null;
}

/** Where a doorway's middle is built, as a point along its stretch. */
export function doorPoint(path: PointPath, link: number, door: number, kind: FenceKind = {}): PathPoint | null {
  const l = path.links[link];
  const span = doorSpan(path, link, door, kind);
  if (!l || !span) return null;
  const a = path.points[l.from], b = path.points[l.to];
  const t = (span.s0 + span.s1) / 2 / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** A doorway as model fences build it (whole pieces): its stored middle and width set to that. Others unchanged. */
export function snapDoor(path: PointPath, link: number, door: FenceDoor, kind: FenceKind): FenceDoor {
  if (!pieceUnit(kind)) return door;
  const span = doorSpan(withDoors(path, link, [door]), link, 0, kind);
  return span ? { ...door, at: Math.round((span.s0 + span.s1) / 2), width: Math.round(span.s1 - span.s0) } : door;
}

/** The fence a pins' target stands for: a placed fence's spec, else the Fence tool's settings (mode and model). */
export function fenceKindFor(editor: Editor, target: PathTarget | null): FenceKind {
  const uid = target?.key.startsWith('fence:') ? target.key.slice(6) : null;
  const placed = uid ? fenceOf(fenceMembers(editor.doc, uid).detail) : null;
  return placed ?? (editor.tools.tools.fence as unknown as { settings: FenceKind }).settings;
}

/**
 * An edit that keeps doorways on the right stretches when points are inserted or removed (`moved` is relative to the
 * path the edit started from). Later moves of the same drag come with the stretches as the pins had them (the copy
 * `pathPoints` made, doorways on both halves), so those take the kept stretches; a path with other stretch data (a
 * doorway typed in the list) is used as it is.
 */
export function doorKeeping(edit: PathEdit, start: () => PointPath): PathEdit {
  const first = start();
  let raw = first, kept = first;
  const same = (a: PointPath, b: PointPath) => JSON.stringify(a.links) === JSON.stringify(b.links);
  return {
    set: (path, moved) => {
      if (moved) kept = carryDoors(first, path, moved);
      else kept = same(path, raw) ? { points: path.points, links: kept.links } : path;
      raw = path;
      edit.set(kept, moved);
    },
    done: () => edit.done(),
    cancel: () => edit.cancel(),
  };
}

/** The pins' key for a placed fence. */
export const fenceKey = (uid: string): string => `fence:${uid}`;

/** Carries on placing points on a placed fence from point `from` (a Shift+click on its pin): a branch or an extension. */
export function continueFence(editor: Editor, detail: MapEntity, from: number): void {
  (editor.tools.tools.generate as GenerateTool).pick('fence');
  (editor.tools.tools.fence as FenceTool).continueFence(detail, from);
}

/** A placed fence (by its id) for the pins: a drag shows its outline and rebuilds it once on release, one undo step. */
export function placedFenceTarget(editor: Editor, uid: string): PathTarget | null {
  const detail = () => fenceMembers(editor.doc, uid).detail;
  const spec = () => fenceOf(detail());
  const first = spec();
  if (!first || !isTree(fencePath(first))) return null;
  let own: { detail: MapEntity | null; world: Set<MapSolid> } = { detail: null, world: new Set() };
  return {
    key: fenceKey(uid), name: 'Fence', min: 2, ownHeight: false,
    path: () => fencePath(spec() ?? first),
    shown: (path) => path.points,
    snap: (path, i, hit) => fenceSnap(hit, editor.grid, fenceGround(editor), snapAnchor(path, i), pieceUnit(spec() ?? first)),
    check: (path, i) => fenceCheck(spec() ?? first, path, i),
    preview: (path) => fenceOutline(withPath(spec() ?? first, path), fenceGround(editor)),
    edit: (label) => doorKeeping(historyEdit(editor, label, (path) => {
      const d = detail();
      if (d) regenerateFence(editor, d, { points: withPath(first, path).points, links: withPath(first, path).links }, label);
    }), () => fencePath(spec() ?? first)),
    own: (solid) => {
      const d = detail();
      if (own.detail !== d) { const m = fenceMembers(editor.doc, uid); own = { detail: d, world: new Set(m.world) }; }
      return (!!d && solid.entity === d) || own.world.has(solid) || isFenceSolid(editor)(solid);
    },
    branch: (i) => { const d = detail(); if (d) continueFence(editor, d, i); },
  };
}

/** The fence the selection stands for (its handle, alone), for the pins (`pathTargets.ts`). */
export function selectedFenceTarget(editor: Editor): PathTarget | null {
  const fences = selectedFences(editor);
  return fences.length === 1 ? placedFenceTarget(editor, fences[0].get(FENCE_ID_KEY) ?? '') : null;
}
