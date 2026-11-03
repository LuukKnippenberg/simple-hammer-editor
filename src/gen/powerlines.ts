import { Vector2, Vector3 } from 'three';
import type { MapEntity } from '../vmf/map.ts';
import { ROAD_STYLES, centreline, offsetLine, type RoadSpec } from './roads.ts';

/**
 * Powerlines: utility poles placed at even spacing along a drawn route, turned across it, with a sagging
 * cable per insulator between neighbouring poles (move_rope → keyframe_rope chains). The route is a tree of
 * points (A, B, C…, see `edit/pathPoints.ts`): where a branch leaves a point, its pole is a tee pole with a
 * second crossarm (a second copy of the pole, sunk `TEE_DROP` into the ground and turned along the branch)
 * that carries the branch's wires. The pole models have no attachment points, so the insulator positions
 * below were measured from their geometry: the crossarm runs along the model's y axis.
 */

export const POLE_TYPES = {
  wooden: { label: 'Wooden, two wires', model: 'models/props_forest/utilitypole01b.mdl', classname: 'prop_static', wires: [[0, -40, 470], [0, 40, 470]] },
  // These two were moved from props_c17 and keep their old compiled-in name, which vbsp can't load as a
  // static prop; as prop_dynamic the game loads them by path.
  wooden3: { label: 'Wooden, three wires', model: 'models/props_forest/utilitypole01d.mdl', classname: 'prop_dynamic', wires: [[0, -40, 468], [0, 0, 487], [0, 40, 468]] },
  wide: { label: 'Wide crossarm', model: 'models/props_forest/utilitypole03a.mdl', classname: 'prop_dynamic', wires: [[0, -56, 439], [0, 56, 439], [0, -72, 432], [0, 72, 432]] },
  city: { label: 'City pole, side arm', model: 'models/props_c17/utilitypole02b.mdl', classname: 'prop_static', wires: [[0, 40, 458], [0, 80, 458]] },
} as const;
export type PoleType = keyof typeof POLE_TYPES;

/** A stretch of the route from one of its points to the next. */
export interface PowerlineLink { from: number; to: number }

export interface PowerlineSpec {
  points: Vector3[];
  /**
   * How the points join: every point but A has one link in, and a point with two links out is a tee pole.
   * None: a plain line A → B → C….
   */
  links?: PowerlineLink[];
  pole: PoleType;
  /** Distance between poles. */
  spacing: number;
  /** Extra cable length as a fraction of the span (sag). */
  slack: number;
  /** House feeds from each pole to the nearest wall. */
  feeds?: boolean;
}

export interface LineEntity { classname: string; origin: Vector3; keys: Record<string, string> }

const KEY = 'she_powerline';
const v2 = (p: Vector3) => new Vector2(p.x, p.y);

/** The route's links: the spec's own, or A → B → C… for a plain line. */
export const powerlineLinks = (s: Pick<PowerlineSpec, 'points' | 'links'>): PowerlineLink[] =>
  s.links ?? s.points.slice(1).map((_, i) => ({ from: i, to: i + 1 }));

/** The point each point after A hangs off (stored only when the route branches). */
function parentsOf(s: PowerlineSpec): number[] {
  const links = powerlineLinks(s);
  return s.points.slice(1).map((_, k) => links.find((l) => l.to === k + 1)?.from ?? k);
}

export function encodePowerline(s: PowerlineSpec): string {
  const parts = [s.pole, s.spacing, s.slack, s.feeds ? 1 : 0, s.points.map((p) => `${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`).join(';')];
  const parents = parentsOf(s);
  return (parents.some((from, k) => from !== k) ? [...parts, parents.join(',')] : parts).join('|');
}

export function decodePowerline(v: string): PowerlineSpec | null {
  const [pole, spacing, slack, feeds, pts, tree] = v.split('|');
  if (!(pole in POLE_TYPES) || !pts) return null;
  const spec: PowerlineSpec = {
    pole: pole as PoleType, spacing: Number(spacing), slack: Number(slack), feeds: feeds === '1',
    points: pts.split(';').map((p) => { const [x, y, z] = p.split(' ').map(Number); return new Vector3(x, y, z); }),
  };
  if (tree) spec.links = tree.split(',').map((from, k) => ({ from: Number(from), to: k + 1 }));
  return spec;
}

/** How far a tee pole's second crossarm (the copy of the pole that carries a branch) sits below the first. */
export const TEE_DROP = 40;
/** Poles between the points stand on the ground under them when it is within this of the straight line. */
const GROUND_REACH = 256;

export interface PolePlacement {
  at: Vector3;
  yaw: number;
  /** A tee pole's second crossarm: sunk `TEE_DROP` under its point, turned along its branch; no house feeds. */
  arm?: boolean;
}

export interface PowerlinePlan {
  /** A's pole first. */
  poles: PolePlacement[];
  /** Per link of the route: its poles in order, from the pole (or crossarm) at its start to the one at its end. */
  spans: number[][];
  /** The wires' runs: poles strung in a row, from A or a tee's crossarm to the end of a branch. */
  runs: number[][];
}

/**
 * Where a powerline's poles stand: one at every point, turned across the line (bisecting a bend), and more
 * evenly between them at about the spacing. A point with a second link out gets a crossarm for it (a tee
 * pole). `ground` puts the poles between the points on the ground under them.
 */
export function powerlinePlan(s: PowerlineSpec, ground?: (x: number, y: number) => number | null): PowerlinePlan {
  const pts = s.points, links = powerlineLinks(s);
  const plan: PowerlinePlan = { poles: [], spans: links.map(() => []), runs: [] };
  if (pts.length < 2 || !links.length) return plan;
  const add = (p: PolePlacement) => plan.poles.push(p) - 1;
  // The crossarm (model y) runs across the line, so the model's x axis follows the line.
  const yawOf = (d: Vector2) => (Math.atan2(d.y, d.x) * 180) / Math.PI;
  const dir = (k: number) => v2(pts[links[k].to]).sub(v2(pts[links[k].from]));
  const outOf = (i: number) => links.flatMap((l, k) => (l.from === i ? [k] : []));
  // At a bend the pole bisects the turn (between the link in and the first link out).
  const pointPole = (i: number) => {
    const into = links.findIndex((l) => l.to === i), out = outOf(i)[0];
    const d = into >= 0 && out !== undefined ? dir(into).normalize().add(dir(out).normalize()) : dir(into >= 0 ? into : out);
    return add({ at: pts[i].clone(), yaw: yawOf(d) });
  };
  const armFor = (k: number) => {
    const at = pts[links[k].from];
    return add({ at: new Vector3(at.x, at.y, at.z - TEE_DROP), yaw: yawOf(dir(k)), arm: true });
  };
  const between = (a: Vector3, b: Vector3, t: number) => {
    const at = a.clone().lerp(b, t);
    const z = ground?.(at.x, at.y);
    if (z != null && Math.abs(z - at.z) <= GROUND_REACH) at.z = z;
    return at;
  };
  // A run from a pole along link k, then on along each point's first link out; the others start runs of their own.
  const run = (start: number, k: number) => {
    const row = [start];
    plan.runs.push(row);
    const later: number[] = [];
    let pole = start;
    while (k >= 0 && !plan.spans[k].length) {
      const { from, to } = links[k];
      const n = Math.max(1, Math.round(dir(k).length() / s.spacing));
      const yaw = yawOf(dir(k));
      plan.spans[k].push(pole);
      for (let j = 1; j < n; j++) {
        pole = add({ at: between(pts[from], pts[to], j / n), yaw });
        plan.spans[k].push(pole);
        row.push(pole);
      }
      pole = pointPole(to);
      plan.spans[k].push(pole);
      row.push(pole);
      const outs = outOf(to);
      later.push(...outs.slice(1));
      k = outs[0] ?? -1;
    }
    for (const b of later) run(armFor(b), b);
  };
  const outs = outOf(0);
  run(pointPole(0), outs[0] ?? -1);
  for (const b of outs.slice(1)) run(armFor(b), b);
  return plan;
}

/** Pole positions along the route (`powerlinePlan`'s poles), each with its yaw. */
export function polePlacements(s: PowerlineSpec, ground?: (x: number, y: number) => number | null): PolePlacement[] {
  return powerlinePlan(s, ground).poles;
}

/** World position of a pole's wire point. */
export function wirePoint(pole: PoleType, at: Vector3, yaw: number, wire: number): Vector3 {
  return wirePointOf(POLE_TYPES[pole].wires[wire], at, yaw);
}

/** Kerb width of the streets (`KERB_W` in roads.ts). */
const KERB = 8;
/** Poles stand this far in from the kerb on a pavement, and this far beside a road without one. */
const POLE_INSET = 24;

/** How far from a street's centre its poles stand: on the pavement just in from the kerb, or just off a track. */
export function poleLineOffset(r: RoadSpec): number {
  const kerbs = r.kerbs ?? ROAD_STYLES[r.style].kerb;
  return r.width / 2 + (kerbs ? KERB : 0) + (r.pavement > 0 ? Math.min(POLE_INSET, r.pavement / 2) : POLE_INSET);
}

/**
 * The nearest point within `max` (in plan) of `p` on a street's pole line (`poleLineOffset`, on either side and
 * around its rounded corners), with the street's index; null when no street is that near.
 */
export function pavementSnap(roads: RoadSpec[], p: { x: number; y: number }, max: number): { x: number; y: number; road: number } | null {
  let best: { x: number; y: number; road: number } | null = null, bestD = max;
  const at = new Vector2(p.x, p.y);
  roads.forEach((r, road) => {
    if (r.points.length < 2) return;
    const line = centreline(r.points, r.radius);
    for (const side of [1, -1]) {
      const edge = offsetLine(line, side * poleLineOffset(r));
      for (let i = 0; i + 1 < edge.length; i++) {
        const a = edge[i], ab = edge[i + 1].clone().sub(a);
        const t = Math.max(0, Math.min(1, at.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
        const q = a.clone().addScaledVector(ab, t);
        const d = q.distanceTo(at);
        if (d <= bestD) { bestD = d; best = { x: Math.round(q.x), y: Math.round(q.y), road }; }
      }
    }
  });
  return best;
}

/**
 * The wall insulator bracket (measured like the poles): its plate is at model y −42 against the wall, the
 * arm points out along +y with three insulators on top, the outer one at y 7 with its top at z 22.
 */
export const WALL_MOUNT = { model: 'models/props_c17/utilitypolemount01a.mdl', back: 42, wire: [0, 7, 22] } as const;

/**
 * A wall bracket on the wall point `wall` facing out along the horizontal normal `out`: the prop's origin
 * and yaw, and the world position where a wire meets its outer insulator.
 */
export function wallMount(wall: Vector3, out: Vector2 | Vector3): { origin: Vector3; yaw: number; wire: Vector3 } {
  const n = new Vector2(out.x, out.y).normalize();
  const yaw = Math.round((Math.atan2(-n.x, n.y) * 180) / Math.PI);
  const origin = new Vector3(wall.x + n.x * WALL_MOUNT.back, wall.y + n.y * WALL_MOUNT.back, wall.z).round();
  return { origin, yaw, wire: wirePointOf(WALL_MOUNT.wire, origin, yaw) };
}

const wirePointOf = ([x, y, z]: readonly number[], at: Vector3, yaw: number) => {
  const r = (yaw * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return new Vector3(at.x + x * c - y * s, at.y + x * s + y * c, at.z + z);
};

/**
 * Entities for a powerline: the poles (a tee pole's second crossarm is a second pole) and, per wire, a chain of
 * rope keyframes along each run of poles. The first pole carries the line's definition, so the line can be
 * edited and rebuilt. `name` must be unique.
 */
export function powerlineEntities(s: PowerlineSpec, name: string, ground?: (x: number, y: number) => number | null): LineEntity[] {
  const out: LineEntity[] = [];
  const plan = powerlinePlan(s, ground);
  plan.poles.forEach((p, i) => {
    const type = POLE_TYPES[s.pole];
    const keys: Record<string, string> = { model: type.model, angles: `0 ${Math.round(p.yaw)} 0`, solid: '6', targetname: `${name}_pole` };
    if (type.classname === 'prop_dynamic') keys.DisableBoneFollowers = '1';
    if (i === 0) keys[KEY] = encodePowerline(s);
    out.push({ classname: type.classname, origin: p.at.clone().round(), keys });
  });
  const wires = POLE_TYPES[s.pole].wires.length;
  for (let w = 0; w < wires; w++) {
    for (const row of plan.runs) {
      row.forEach((pi, j) => {
        const p = plan.poles[pi], next = row[j + 1];
        const at = wirePoint(s.pole, p.at, p.yaw, w).round();
        const span = next === undefined ? 0 : at.distanceTo(wirePoint(s.pole, plan.poles[next].at, plan.poles[next].yaw, w));
        const keys: Record<string, string> = {
          targetname: `${name}_w${w}_${pi}`, RopeMaterial: 'cable/cable.vmt', Width: '1.5', TextureScale: '1', Subdiv: '2',
          Slack: String(Math.round(span * s.slack)), Type: '0', Collide: '0', Breakable: '0', Barbed: '0', Dangling: '0',
        };
        if (next !== undefined) keys.NextKey = `${name}_w${w}_${next}`;
        // A chain starts with a move_rope; the rest are keyframes.
        out.push({ classname: j === 0 ? 'move_rope' : 'keyframe_rope', origin: at, keys: j === 0 ? { ...keys, PositionInterpolator: '2', MoveSpeed: '64' } : keys });
      });
    }
  }
  return out;
}

/** The powerline a prop belongs to (its first pole carries the definition), with all its entities. */
export function powerlineOf(entities: MapEntity[], e: MapEntity): { spec: PowerlineSpec; name: string; members: MapEntity[]; first: MapEntity } | null {
  const tn = e.get('targetname') ?? '';
  const m = /^(.*?)_(pole|w\d+_\d+|f\d+[ab]_(\d+|mount))$/.exec(tn);
  if (!m) return null;
  const name = m[1];
  const members = entities.filter((x) => (x.get('targetname') ?? '').startsWith(`${name}_`));
  const first = members.find((x) => x.get(KEY));
  const spec = first ? decodePowerline(first.get(KEY)!) : null;
  return spec && first ? { spec, name, members, first } : null;
}

/** A free name for a new powerline. */
export function nextPowerlineName(entities: MapEntity[]): string {
  let n = 1;
  const used = new Set(entities.map((e) => e.get('targetname') ?? ''));
  while (used.has(`power${n}_pole`)) n++;
  return `power${n}`;
}
