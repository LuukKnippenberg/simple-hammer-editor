import { Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { groundAt, historyEdit, type PathCheck, type PathTarget } from './pathPins.ts';
import { childrenOf, pathLabels, type PathPoint, type PointPath } from './pathPoints.ts';
import { ROAD_STYLES, nearestOnLine, offsetLine, roadCorners, roadLine, roadOf, snapToRoads, type RoadSpec } from '../gen/roads.ts';
import { rebuildRoads, roadEntities } from '../gen/roadAction.ts';
import type { RoadTool } from './roadTool.ts';

/**
 * Streets as a path for the pins (`pathPins.ts`): a point is a corner or an end of the centre line, with its own
 * corner radius; height follows the ground. A branch (Shift+click a pin) is a second road joined at that point:
 * a T junction where the kerbs open. Used by the Road tool while placing and by the Select tool on placed roads.
 */

/** A street point: its own corner radius, over the road's. */
export type RoadPoint = PathPoint & { radius?: number };

/** A road's settings without its points (what every road of a path shares). */
export type RoadBase = Omit<RoadSpec, 'points' | 'radii'>;

/** Shortest stretch a road builds. */
const MIN_STRETCH = 32;
/** Sharpest turn: past it the road folds back over itself. */
const MAX_TURN = 150;

/** A placed road as a path: one chain A, B, C… with each point's own corner radius. */
export function roadPath(spec: RoadSpec): PointPath {
  return {
    points: spec.points.map((p, i): RoadPoint => ({ x: p.x, y: p.y, z: p.z, ...(spec.radii?.[i] === undefined ? {} : { radius: spec.radii[i] }) })),
    links: spec.points.slice(1).map((_, i) => ({ from: i, to: i + 1 })),
  };
}

/**
 * The roads a path of points makes, as lists of its points: the first carries on from A along each point's first
 * link; every other link out of a point starts another road there (a T). When A itself has two links the first
 * road runs through A (from the end of A's second link), so a branch from A extends the road backwards.
 */
export function roadChains(path: PointPath): number[][] {
  const used = new Set<number>();
  const follow = (from: number, next: number): number[] => {
    const out = [from];
    for (let k: number | undefined = next; k !== undefined; k = childrenOf(path, k)[0]) { out.push(k); used.add(k); }
    return out;
  };
  const first = childrenOf(path, 0);
  if (!first.length) return [];
  let main = follow(0, first[0]);
  if (first.length > 1) main = [...follow(0, first[1]).reverse(), ...main.slice(1)];
  const chains = [main];
  for (let c = 0; c < chains.length; c++) {
    for (const m of chains[c]) for (const k of childrenOf(path, m)) if (!used.has(k)) chains.push(follow(m, k));
  }
  return chains;
}

const vec = (p: PathPoint) => new Vector3(p.x, p.y, p.z);

/**
 * The roads of a path with `base`'s settings, one per chain (`roadChains`). A branch starts on its main road's
 * rounded centre line (a corner's point lies outside the arc), so the T joins the road's surface.
 */
export function roadSpecs(path: PointPath, base: RoadBase, chains = roadChains(path)): RoadSpec[] {
  const specs: RoadSpec[] = [];
  const roadOfPoint = new Map<number, number>();
  chains.forEach((chain, c) => {
    const points = chain.map((k) => vec(path.points[k]));
    const main = c > 0 ? specs[roadOfPoint.get(chain[0]) ?? 0] : null;
    const on = main && nearestOnLine(roadLine(main), points[0]);
    if (on) points[0] = new Vector3(Math.round(on.at.x), Math.round(on.at.y), Math.round(on.at.z));
    const radii = chain.map((k) => (path.points[k] as RoadPoint).radius);
    specs.push({ ...base, points, radii: radii.some((r) => r !== undefined) ? radii : undefined });
    for (const k of chain) if (!roadOfPoint.has(k)) roadOfPoint.set(k, c);
  });
  return specs;
}

/**
 * Lines along roads (segments, flat x, y, z pairs): the rounded centre line, the carriageway's edges and the outer
 * edges of the pavements, a little over the surface. The Road tool's preview, and a placed road's while its pin is
 * dragged. `length` is how long their centre lines are.
 */
export function roadOutline(roads: RoadSpec[]): { lines: number[]; length: number } {
  const lines: number[] = [];
  let length = 0;
  const strip = (line: { x: number; y: number }[], z: (i: number) => number) => {
    for (let i = 0; i + 1 < line.length; i++) lines.push(line[i].x, line[i].y, z(i), line[i + 1].x, line[i + 1].y, z(i + 1));
  };
  for (const road of roads) {
    const c = roadLine(road);
    const lift = (i: number) => c[i].z + 4;
    strip(c, lift);
    const edge = road.width / 2 + ((road.kerbs ?? ROAD_STYLES[road.style].kerb) ? 8 : 0) + road.pavement;
    for (const d of [-edge, edge, -road.width / 2, road.width / 2]) strip(offsetLine(c, d), lift);
    length += c.reduce((s, p, i) => s + (i ? p.distanceTo(c[i - 1]) : 0), 0);
  }
  return { lines, length };
}

/** The settings of a road without its points. */
export function roadBase(spec: RoadSpec): RoadBase {
  const { points: _points, radii: _radii, ...base } = spec;
  return base;
}

/**
 * The note by a dragged street point: the stretches and corners it touches. Red when a stretch is too short or a
 * corner turns back on itself, blue (joins) when it lands on another street's centre line, amber when a corner
 * radius had to shrink to fit.
 */
export function roadCheck(base: RoadBase, path: PointPath, i: number, others: RoadSpec[]): PathCheck {
  const names = pathLabels(path);
  const chains = roadChains(path);
  const specs = roadSpecs(path, base, chains);
  const numbers: string[] = [];
  let refused = '', shrunk = '';
  for (const link of path.links) {
    if (link.from !== i && link.to !== i) continue;
    const a = path.points[link.from], b = path.points[link.to];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const name = `${names[link.from]} → ${names[link.to]}`;
    numbers.push(`${name} · ${Math.round(length)} long`);
    if (length < MIN_STRETCH && !refused) refused = `${name}: the two points are on top of each other`;
  }
  chains.forEach((chain, c) => {
    const corners = roadCorners(specs[c]);
    chain.forEach((p, k) => {
      const corner = corners[k];
      if (!corner || (p !== i && chain[k - 1] !== i && chain[k + 1] !== i)) return;
      const want = Math.round(corner.want), got = Math.round(corner.got);
      numbers.push(`${names[p]} · corner ${Math.round(corner.turn)}° · radius ${want > got + 1 ? `${want} → ${got}` : want}`);
      if (corner.turn > MAX_TURN && !refused) refused = `${names[p]}: turns back on itself (${Math.round(corner.turn)}°); the road would fold over`;
      if (want > got + 1 && !shrunk) shrunk = `corner ${names[p]}: radius ${want} → ${got}, the stretches beside it are too short`;
    });
  });
  if (refused) return { level: 'refused', note: refused, numbers };
  const at = vec(path.points[i]);
  if (others.some((r) => (nearestOnLine(roadLine(r), at)?.d ?? Infinity) <= 1.5)) {
    const end = path.links.filter((link) => link.from === i || link.to === i).length < 2;
    return { level: 'joins', note: end ? 'joins a street: T junction, kerbs open' : 'crosses a street: kerbs open', numbers: shrunk ? [...numbers, shrunk] : numbers };
  }
  if (shrunk) return { level: 'adjusted', note: shrunk, numbers };
  return { level: 'fine', note: 'moved', numbers };
}

/**
 * Where a street point goes for a surface point: onto another street's centre line when near (`skip`: roads it
 * must not join, like itself), else on the grid at the ground's height (under a road's own top when it was hit).
 */
export function roadSnap(editor: Editor, hit: PathPoint, width: number, skip: (road: MapEntity) => boolean = () => false): PathPoint {
  const roads = roadEntities(editor.doc);
  const joined = snapToRoads(roads.filter((r) => !skip(r.entity)).map((r) => r.road), vec(hit), Math.max(48, width / 2));
  if (joined) return { x: joined.x, y: joined.y, z: joined.z };
  const g = editor.grid;
  const x = Math.round(hit.x / g) * g, y = Math.round(hit.y / g) * g;
  const mine = new Set(roads.map((r) => r.entity));
  const under = groundAt(editor, x, y, (solid) => !!solid.entity && mine.has(solid.entity));
  return { x, y, z: under !== null && Math.abs(under - hit.z) <= 16 ? under : Math.round(hit.z) };
}

/** The pins' key for a placed road. */
export const roadKey = (entity: MapEntity): string => `road:${entity.id}`;

/**
 * Shift+click on a placed road's pin: the Road tool (a Generate session) places on from it. From an end the road
 * goes on (Enter rebuilds it longer); from a corner a second road starts there, its A on this road's centre line.
 */
function placeFrom(editor: Editor, entity: MapEntity, i: number): void {
  const road = roadOf(entity);
  if (!road) return;
  editor.tools.set('road');
  editor.emit('toolchange');
  const tool = editor.tools.tools.road as RoadTool;
  if (i === 0 || i === road.points.length - 1) { tool.continueRoad(entity, i); return; }
  const on = nearestOnLine(roadLine(road), road.points[i])!.at;
  tool.startRoad({ x: Math.round(on.x), y: Math.round(on.y), z: Math.round(on.z) }, roadBase(road));
}

/**
 * A placed road for the pins: a drag shows the road's outline and rebuilds all roads (crossings depend on all of
 * them) once when the pin is let go; every change is one undo step. Shift+click on an end places on from it; on a
 * corner it starts a second road from there (a T).
 */
export function placedRoadTarget(editor: Editor, entity: MapEntity): PathTarget | null {
  const first = roadOf(entity);
  if (!first || first.points.length < 2) return null;
  const road = () => roadOf(entity) ?? first;
  const others = () => roadEntities(editor.doc).filter((r) => r.entity !== entity).map((r) => r.road);
  return {
    key: roadKey(entity), name: 'Road', min: 2, ownHeight: false,
    path: () => roadPath(road()),
    shown: (path) => path.points,
    snap: (_path, _i, hit) => roadSnap(editor, hit, road().width, (e) => e === entity),
    check: (path, i) => roadCheck(roadBase(road()), path, i, others()),
    preview: (path) => roadOutline(roadSpecs(path, roadBase(road())).slice(0, 1)).lines,
    edit: (label) => historyEdit(editor, label, (path) => {
      rebuildRoads(editor, label, { replace: [entity, roadSpecs(path, roadBase(road()))[0]] });
    }),
    own: (solid) => solid.entity === entity,
    branch: (i) => placeFrom(editor, entity, i),
  };
}

/** The road the selection stands for (the road, or brushes picked out of one), for the pins (`pathTargets.ts`). */
export function selectedRoadTarget(editor: Editor): PathTarget | null {
  const { entities, solids } = editor.selection;
  const owners = new Set([...solids].map((solid) => solid.entity));
  const entity = entities.size === 1 ? [...entities][0] : !entities.size && owners.size === 1 ? [...owners][0] : null;
  return entity && editor.doc.entities.includes(entity) ? placedRoadTarget(editor, entity) : null;
}
