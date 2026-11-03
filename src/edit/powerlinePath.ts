import { Raycaster, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { snap } from './tools.ts';
import { groundAt, historyEdit, type PathCheck, type PathTarget } from './pathPins.ts';
import { isTree, normalizePath, pathLabels, type PathPoint, type PointPath } from './pathPoints.ts';
import { pavementSnap, powerlineLinks, powerlineOf, powerlinePlan, wirePoint, type PowerlineSpec } from '../gen/powerlines.ts';
import { ROAD_STYLES, type RoadSpec } from '../gen/roads.ts';
import { roadEntities } from '../gen/roadAction.ts';
import { editPowerline, type PowerlineTool } from './powerlineTool.ts';
import type { GenerateTool } from './generateTool.ts';

/**
 * Powerlines as a path for the pins (`pathPins.ts`): a point is a pole, a stretch is a span that more poles fill
 * at the spacing, and a point with a branch is a tee pole with two crossarms. The route is one tree inside one
 * `PowerlineSpec` (its `links`), so one line has one set of pins, one tee pole and one rebuild. Points follow the
 * ground and snap to the pavement of streets. Used by the Powerline tool while placing and by the Select tool on
 * placed powerlines.
 */

/** How near (in plan) a point has to come to a street's pole line to snap onto its pavement. */
const PAVEMENT_REACH = 64;
/** Shortest span: two poles closer than this would stand in each other. */
const MIN_SPAN = 96;

/** A powerline's route as points (in the path's one order). */
export const powerlinePath = (spec: Pick<PowerlineSpec, 'points' | 'links'>): PointPath =>
  normalizePath({ points: spec.points.map((p) => ({ x: p.x, y: p.y, z: p.z })), links: powerlineLinks(spec).map(({ from, to }) => ({ from, to })) });

/** The spec's route for a path: its points, and its links when it branches (a plain line keeps none). */
export function routeOf(path: PointPath): Pick<PowerlineSpec, 'points' | 'links'> {
  const chain = path.links.every((l) => l.to === l.from + 1);
  return { points: path.points.map((p) => new Vector3(p.x, p.y, p.z)), links: chain ? undefined : path.links.map(({ from, to }) => ({ from, to })) };
}

/** What the generator looks at around a powerline: the streets (their pavements), the ground, and walls in the way. */
export interface PowerlineWorld {
  roads: RoadSpec[];
  ground?: (x: number, y: number) => number | null;
  /** Something in the way of a wire from a to b (its name), or null. */
  blocked?: (a: Vector3, b: Vector3) => string | null;
}

/** The editor's streets, ground and brushes for `powerlineCheck` and `powerlineSnap`. */
export function powerlineWorld(editor: Editor): PowerlineWorld {
  return {
    roads: roadEntities(editor.doc).map((r) => r.road),
    ground: (x, y) => groundAt(editor, x, y),
    blocked: (a, b) => {
      const d = b.clone().sub(a);
      const far = d.length() - 1;
      if (far <= 1) return null;
      return editor.world.raycast(new Raycaster(a, d.normalize(), 1, far)) ? 'a wall' : null;
    },
  };
}

/** A point dropped at `hit`: on the grid, then onto a street's pavement when near one, and on the ground there. */
export function powerlineSnap(world: PowerlineWorld, hit: PathPoint, grid: number): PathPoint {
  const at = { x: snap(hit.x, grid), y: snap(hit.y, grid) };
  const { x, y } = pavementSnap(world.roads, at, PAVEMENT_REACH) ?? at;
  return { x, y, z: world.ground?.(x, y) ?? Math.round(hit.z) };
}

/** Each stretch of a route: its name, length and number of spans (poles fill it at the spacing). */
export function powerlineSpans(spec: PowerlineSpec, path = powerlinePath(spec)): { name: string; length: number; spans: number }[] {
  const plan = powerlinePlan({ ...spec, ...routeOf(path) });
  const names = pathLabels(path);
  return path.links.map((l, k) => ({
    name: `${names[l.from]} → ${names[l.to]}`,
    length: Math.round(Math.hypot(path.points[l.to].x - path.points[l.from].x, path.points[l.to].y - path.points[l.from].y)),
    spans: plan.spans[k].length - 1,
  }));
}

/** The points of a route that are tee poles (a branch leaves them). */
export const teePoles = (path: PointPath): number[] =>
  path.points.flatMap((_, i) => (path.links.filter((l) => l.from === i).length > 1 ? [i] : []));

/**
 * The note by a dragged powerline point: the spans into and out of it as poles refill them. Red when it can't be
 * built (two poles in each other, a wire through a wall); amber when the generator adjusted something (poles
 * added or taken out of a span, the point put on a street's pavement).
 */
export function powerlineCheck(spec: PowerlineSpec, path: PointPath, i: number, before: PointPath, world: PowerlineWorld): PathCheck {
  const now = powerlineSpans(spec, path), was = powerlineSpans(spec, before);
  const touching = path.links.map((link, k) => ({ link, k })).filter(({ link }) => link.from === i || link.to === i);
  const numbers = touching.map(({ k }) => {
    const n = now[k].spans, old = was[k]?.spans ?? n;
    return `${now[k].name} · ${now[k].length} u · ${old !== n ? `${old} → ${n}` : n} span${n === 1 ? '' : 's'}`;
  });
  for (const { k } of touching) if (now[k].length < MIN_SPAN) return { level: 'refused', note: `${now[k].name}: the poles would stand in each other`, numbers };
  if (world.blocked) {
    const plan = powerlinePlan({ ...spec, ...routeOf(path) }, world.ground);
    const top = (p: number) => wirePoint(spec.pole, plan.poles[p].at, plan.poles[p].yaw, 0);
    for (const { k } of touching) {
      const poles = plan.spans[k];
      for (let j = 0; j + 1 < poles.length; j++) {
        const what = world.blocked(top(poles[j]), top(poles[j + 1]));
        if (what) return { level: 'refused', note: `${now[k].name}: the wires run into ${what}`, numbers };
      }
    }
  }
  const notes: string[] = [];
  const p = path.points[i];
  const edge = pavementSnap(world.roads, p, 1);
  if (edge) notes.push(`on the ${ROAD_STYLES[world.roads[edge.road].style].label.toLowerCase()}'s pavement`);
  const refilled = touching.filter(({ k }) => was[k] && was[k].spans !== now[k].spans);
  if (refilled.length) {
    const more = refilled.reduce((n, { k }) => n + now[k].spans - was[k].spans, 0);
    notes.push(more > 0 ? `${more} pole${more === 1 ? '' : 's'} added` : more < 0 ? `${-more} pole${more === -1 ? '' : 's'} fewer` : 'poles moved between spans');
  }
  return notes.length ? { level: 'adjusted', note: notes.join(' · '), numbers } : { level: 'fine', note: 'moved', numbers };
}

/** The pins' key for a placed powerline. */
export const powerlineKey = (name: string): string => `powerline:${name}`;

/** Carries on placing points on a placed powerline from point `from` (a Shift+click on its pin): a branch or an extension. */
export function continuePowerline(editor: Editor, pole: MapEntity, from: number): void {
  (editor.tools.tools.generate as GenerateTool).pick('powerline');
  (editor.tools.tools.powerline as PowerlineTool).continueLine(pole, from);
}

/**
 * A placed powerline (by its name) for the pins: every change rebuilds it with `editPowerline` (poles re-spaced,
 * house feeds rebuilt), one undo step per drag or click. The rebuild replaces its entities, so it is found again
 * by name each time.
 */
export function placedPowerlineTarget(editor: Editor, name: string): PathTarget | null {
  const first = () => editor.doc.entities.find((e) => e.get('targetname') === `${name}_pole` && powerlineOf(editor.doc.entities, e)?.name === name);
  const spec = () => { const f = first(); return f ? powerlineOf(editor.doc.entities, f)?.spec ?? null : null; };
  const start = spec();
  if (!start || !isTree(powerlinePath(start))) return null;
  return {
    key: powerlineKey(name), name: 'Powerline', min: 2, ownHeight: false,
    path: () => powerlinePath(spec() ?? start),
    shown: (path) => path.points,
    snap: (_path, _i, hit) => powerlineSnap(powerlineWorld(editor), hit, editor.grid),
    check: (path, i, before) => powerlineCheck(spec() ?? start, path, i, before, powerlineWorld(editor)),
    edit: (label) => historyEdit(editor, label, (path) => { const f = first(); if (f) editPowerline(editor, f, routeOf(path)); }),
    own: () => false,
    branch: (i) => { const f = first(); if (f) continuePowerline(editor, f, i); },
  };
}

/** The powerline the selection stands for (one of its props, alone), for the pins (`pathTargets.ts`). */
export function selectedPowerlineTarget(editor: Editor): PathTarget | null {
  const sel = editor.selection;
  if (sel.entities.size !== 1 || sel.solids.size) return null;
  const line = powerlineOf(editor.doc.entities, [...sel.entities][0]);
  return line ? placedPowerlineTarget(editor, line.name) : null;
}
