import { Vector2, Vector3 } from 'three';
import type { MapEntity } from '../vmf/map.ts';

/**
 * Powerlines: utility poles placed at even spacing along a drawn line, turned across it, with a sagging
 * cable per insulator between neighbouring poles (move_rope → keyframe_rope chains). The pole models have
 * no attachment points, so the insulator positions below were measured from their geometry: the crossarm
 * runs along the model's y axis.
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

export interface PowerlineSpec {
  points: Vector3[];
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

export function encodePowerline(s: PowerlineSpec): string {
  return [s.pole, s.spacing, s.slack, s.feeds ? 1 : 0, s.points.map((p) => `${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`).join(';')].join('|');
}

export function decodePowerline(v: string): PowerlineSpec | null {
  const [pole, spacing, slack, feeds, pts] = v.split('|');
  if (!(pole in POLE_TYPES) || !pts) return null;
  return {
    pole: pole as PoleType, spacing: Number(spacing), slack: Number(slack), feeds: feeds === '1',
    points: pts.split(';').map((p) => { const [x, y, z] = p.split(' ').map(Number); return new Vector3(x, y, z); }),
  };
}

/** Pole positions along the line: at every control point and evenly between them, each with its yaw. */
export function polePlacements(s: PowerlineSpec): { at: Vector3; yaw: number }[] {
  const out: { at: Vector3; yaw: number }[] = [];
  const pts = s.points;
  // The crossarm (model y) runs across the line, so the model's x axis follows the line.
  const yawOf = (d: Vector2) => (Math.atan2(d.y, d.x) * 180) / Math.PI;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = v2(b).sub(v2(a));
    const n = Math.max(1, Math.round(d.length() / s.spacing));
    let yaw = yawOf(d);
    for (let k = 0; k < n; k++) {
      // At a bend the pole bisects the turn.
      if (k === 0 && i > 0) {
        const prev = v2(a).sub(v2(pts[i - 1])).normalize();
        yaw = yawOf(prev.add(d.clone().normalize()));
      } else yaw = yawOf(d);
      out.push({ at: a.clone().lerp(b, k / n), yaw });
    }
  }
  if (pts.length >= 2) out.push({ at: pts[pts.length - 1].clone(), yaw: yawOf(v2(pts[pts.length - 1]).sub(v2(pts[pts.length - 2]))) });
  return out;
}

/** World position of a pole's wire point. */
export function wirePoint(pole: PoleType, at: Vector3, yaw: number, wire: number): Vector3 {
  const [x, y, z] = POLE_TYPES[pole].wires[wire];
  const r = (yaw * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return new Vector3(at.x + x * c - y * s, at.y + x * s + y * c, at.z + z);
}

/**
 * Entities for a powerline: the poles and, per wire, a chain of rope keyframes from pole to pole. The first
 * pole carries the line's definition, so the line can be edited and rebuilt. `name` must be unique.
 */
export function powerlineEntities(s: PowerlineSpec, name: string): LineEntity[] {
  const out: LineEntity[] = [];
  const poles = polePlacements(s);
  poles.forEach((p, i) => {
    const type = POLE_TYPES[s.pole];
    const keys: Record<string, string> = { model: type.model, angles: `0 ${Math.round(p.yaw)} 0`, solid: '6', targetname: `${name}_pole` };
    if (type.classname === 'prop_dynamic') keys.DisableBoneFollowers = '1';
    if (i === 0) keys[KEY] = encodePowerline(s);
    out.push({ classname: type.classname, origin: p.at.clone().round(), keys });
  });
  const wires = POLE_TYPES[s.pole].wires.length;
  for (let w = 0; w < wires; w++) {
    poles.forEach((p, i) => {
      const at = wirePoint(s.pole, p.at, p.yaw, w).round();
      const last = i === poles.length - 1;
      const span = last ? 0 : at.distanceTo(wirePoint(s.pole, poles[i + 1].at, poles[i + 1].yaw, w));
      const keys: Record<string, string> = {
        targetname: `${name}_w${w}_${i}`, RopeMaterial: 'cable/cable.vmt', Width: '1.5', TextureScale: '1', Subdiv: '2',
        Slack: String(Math.round(span * s.slack)), Type: '0', Collide: '0', Breakable: '0', Barbed: '0', Dangling: '0',
      };
      if (!last) keys.NextKey = `${name}_w${w}_${i + 1}`;
      // A chain starts with a move_rope; the rest are keyframes.
      out.push({ classname: i === 0 ? 'move_rope' : 'keyframe_rope', origin: at, keys: i === 0 ? { ...keys, PositionInterpolator: '2', MoveSpeed: '64' } : keys });
    });
  }
  return out;
}

/** The powerline a prop belongs to (its first pole carries the definition), with all its entities. */
export function powerlineOf(entities: MapEntity[], e: MapEntity): { spec: PowerlineSpec; name: string; members: MapEntity[] } | null {
  const tn = e.get('targetname') ?? '';
  const m = /^(.*?)_(pole|w\d+_\d+|f\d+[ab]_(\d+|mount))$/.exec(tn);
  if (!m) return null;
  const name = m[1];
  const members = entities.filter((x) => (x.get('targetname') ?? '').startsWith(`${name}_`));
  const def = members.find((x) => x.get(KEY));
  const spec = def ? decodePowerline(def.get(KEY)!) : null;
  return spec ? { spec, name, members } : null;
}

/** A free name for a new powerline. */
export function nextPowerlineName(entities: MapEntity[]): string {
  let n = 1;
  const used = new Set(entities.map((e) => e.get('targetname') ?? ''));
  while (used.has(`power${n}_pole`)) n++;
  return `power${n}`;
}
