import type { Editor } from '../editor.ts';
import { VmfDocument, type MapEntity, type MapSolid } from '../vmf/map.ts';
import { snap } from './tools.ts';
import { historyEdit, type PathCheck, type PathTarget } from './pathPins.ts';
import { isTree, normalizePath, parentOf, pathLabels, type PathPoint, type PointPath } from './pathPoints.ts';
import { buildStairs, plannedNodes, squareTo, type StairsFlight, type StairsSpec } from '../gen/stairs.ts';
import { STAIRS_ID_KEY, stairsMembers, stairsOf } from '../gen/stairsStore.ts';
import { regenerateStairs, selectedStairs } from '../gen/stairsAction.ts';
import type { GenerateTool } from './generateTool.ts';

/**
 * Stairs as a path for the pins (`pathPins.ts`): a point is a landing (A is the foot) with its own height, a
 * stretch is a flight. Used by the Stairs tool while placing and by the Select tool on placed stairs.
 */

export const stairsPath = (spec: StairsSpec): PointPath<StairsFlight> => ({ points: spec.nodes, links: spec.flights });
const withPath = (spec: StairsSpec, path: PointPath): StairsSpec => ({ ...spec, nodes: path.points, flights: path.links as StairsFlight[] });

/** Where the pins sit: where the stairs put the points (the blocky plan squares each flight). */
export const stairsShown = (spec: StairsSpec, path: PointPath): PathPoint[] => plannedNodes(withPath(spec, path));

/**
 * Where a dragged point goes: on the grid, square to the point before it with the blocky plan, at the height of the
 * surface under the cursor (or its own height with `keep`).
 */
export function stairsSnap(spec: StairsSpec, path: PointPath, i: number, hit: PathPoint, keep: boolean, grid: number): PathPoint {
  let at = { x: snap(hit.x, grid), y: snap(hit.y, grid) };
  const parent = parentOf(path, i);
  if (spec.options.plan === 'blocky' && parent >= 0) at = squareTo(stairsShown(spec, path)[parent], at);
  return { ...at, z: keep ? path.points[i].z : Math.round(hit.z) };
}

const fmt = (v: number) => String(Math.round(v * 10) / 10);

/**
 * The note by a dragged stairs point: the flights into and out of it as they rebuild (red when one can't be built:
 * too steep for units, or no room for steps), amber when the point took a surface's height.
 */
export function stairsCheck(spec: StairsSpec, path: PointPath, i: number, before: PointPath): PathCheck {
  const now = buildStairs(VmfDocument.empty(), withPath(spec, path));
  const was = buildStairs(VmfDocument.empty(), withPath(spec, before));
  const names = pathLabels(path);
  const touching = path.links.map((link, k) => ({ link, k })).filter(({ link }) => link.from === i || link.to === i);
  const numbers = touching.map(({ link, k }) => {
    const f = now.flights[k], old = was.flights[k];
    const name = `${names[link.from]} → ${names[link.to]}`;
    if (!f.steps) return `${name} · flat · ${Math.round(f.length)} long`;
    const steps = old && old.steps && old.steps !== f.steps ? `${old.steps} → ${f.steps}` : String(f.steps);
    return `${name} · ${steps} steps × ${fmt(f.rise)} rise · ${fmt(f.tread)} tread · ${Math.round(f.length)} long`;
  });
  for (const { link, k } of touching) {
    const f = now.flights[k];
    const name = `${names[link.from]} → ${names[link.to]}`;
    if (f.length < 16) return { level: 'refused', note: `${name}: the two points are on top of each other`, numbers };
    if (!f.steep) continue;
    const run = f.steps ? f.steps * f.tread : 0;
    return {
      level: 'refused', numbers,
      note: run <= 1 ? `${name}: no room for steps between the landings` : `${name}: a climb of ${Math.abs(Math.round(f.height))} needs more run than that; only ${Math.round(run)} — too steep for units`,
    };
  }
  const from = before.points[i], to = path.points[i];
  if (from && from.z !== to.z) return { level: 'adjusted', note: `dropped on a surface: height ${from.z} → ${to.z}`, numbers, hint: `keeps ${from.z}` };
  return { level: 'fine', note: 'moved', numbers };
}

/** The pins' key for placed stairs. */
export const stairsKey = (uid: string): string => `stairs:${uid}`;

/** Placed stairs (by their id) for the pins: every change rebuilds them in place, one undo step per drag or click. */
export function placedStairsTarget(editor: Editor, uid: string): PathTarget | null {
  const detail = () => stairsMembers(editor.doc, uid).detail;
  const spec = () => stairsOf(detail());
  const first = spec();
  if (!first || !isTree(stairsPath(first))) return null;
  // The stairs' own brushes, found again when a rebuild replaced them.
  let own: { detail: MapEntity | null; world: Set<MapSolid> } = { detail: null, world: new Set() };
  return {
    key: stairsKey(uid), name: 'Stairs', min: 2, ownHeight: true,
    path: () => normalizePath(stairsPath(spec() ?? first)),
    shown: (path) => stairsShown(spec() ?? first, path),
    snap: (path, i, hit, keep) => stairsSnap(spec() ?? first, path, i, hit, keep, editor.grid),
    check: (path, i, before) => stairsCheck(spec() ?? first, path, i, before),
    edit: (label) => historyEdit(editor, label, (path) => {
      const d = detail();
      if (d) regenerateStairs(editor, d, { nodes: path.points, flights: path.links as StairsFlight[] }, label);
    }),
    own: (solid) => {
      const d = detail();
      if (own.detail !== d) { const m = stairsMembers(editor.doc, uid); own = { detail: d, world: new Set(m.world) }; }
      return (!!d && solid.entity === d) || own.world.has(solid);
    },
    branch: (i) => { const d = detail(); if (d) (editor.tools.tools.generate as GenerateTool).continueStairs(d, i); },
  };
}

/** The stairs the selection stands for (their handle, alone), for the pins (`pathTargets.ts`). */
export function selectedStairsTarget(editor: Editor): PathTarget | null {
  const stairs = selectedStairs(editor);
  return stairs.length === 1 ? placedStairsTarget(editor, stairs[0].get(STAIRS_ID_KEY) ?? '') : null;
}
