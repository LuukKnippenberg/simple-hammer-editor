import { Vector3 } from 'three';
import type { MapEntity, VmfDocument } from '../vmf/map.ts';
import { getConnections, setConnections, type Connection } from '../vmf/io.ts';

/**
 * Cinematic pieces built from stock entities, as the shipped Lambda Wars missions do them:
 *
 * - Camera shot: a `point_viewcontrol` looking at an `info_target`, optionally moving along a
 *   `path_corner` chain (its `moveto`). Firing `Enable` on it takes over the player's view for `wait`
 *   seconds; the camera disables itself afterwards (it only does so while it has a target).
 * - Path: a chain of `path_track` nodes linked by `target`. A "send along" `logic_relay` gives a unit an
 *   `Order` to the first node and `QueueOrder`s to the others.
 *
 * Every entity of a piece carries `she_cine` = the piece's name so the editor can find and rebuild it.
 */

export const CINE_KEY = 'she_cine';
export const PATH_CLASSES = ['path_track', 'path_corner'];

const byName = (doc: VmfDocument) => {
  const m = new Map<string, MapEntity>();
  for (const e of doc.entities) {
    const n = e.get('targetname')?.toLowerCase();
    if (n && !m.has(n)) m.set(n, e);
  }
  return m;
};

export interface PathChain {
  nodes: MapEntity[];
  /** The last node leads back to the first. */
  loop: boolean;
}

/**
 * Chains of path nodes (path_track, path_corner) following their `target` keys. Every node belongs to
 * exactly one chain; chains start at nodes nothing points to (or anywhere in a loop).
 */
export function pathChains(doc: VmfDocument): PathChain[] {
  const nodes = doc.entities.filter((e) => PATH_CLASSES.includes(e.classname));
  const names = byName(doc);
  const next = (e: MapEntity) => {
    const t = e.get('target')?.toLowerCase();
    const n = t ? names.get(t) : undefined;
    return n && PATH_CLASSES.includes(n.classname) ? n : undefined;
  };
  const pointedAt = new Set(nodes.map(next).filter(Boolean));
  const done = new Set<MapEntity>();
  const chains: PathChain[] = [];
  const walk = (start: MapEntity) => {
    const chain: MapEntity[] = [];
    let cur: MapEntity | undefined = start;
    while (cur && !done.has(cur)) {
      done.add(cur);
      chain.push(cur);
      cur = next(cur);
    }
    chains.push({ nodes: chain, loop: !!cur && cur === start });
  };
  for (const n of nodes) if (!pointedAt.has(n)) walk(n);
  for (const n of nodes) if (!done.has(n)) walk(n);
  return chains;
}

/** The chain a node belongs to. */
export function chainOf(doc: VmfDocument, node: MapEntity): PathChain | undefined {
  return pathChains(doc).find((c) => c.nodes.includes(node));
}

export function pathLength(points: Vector3[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += points[i].distanceTo(points[i - 1]);
  return d;
}

/** Angles (pitch yaw roll, Source convention: positive pitch looks down) from `from` towards `to`. */
export function lookAngles(from: Vector3, to: Vector3): Vector3 {
  const d = to.clone().sub(from);
  const yaw = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  const pitch = (-Math.atan2(d.z, Math.hypot(d.x, d.y)) * 180) / Math.PI;
  return new Vector3(Math.round(pitch * 10) / 10, Math.round((((yaw % 360) + 360) % 360) * 10) / 10, 0);
}

export interface CameraShot {
  camera: MapEntity;
  target?: MapEntity;
  /** Where the camera looks (the target's origin). */
  lookAt: Vector3 | null;
  /** The camera's route: its own origin, then the moveto path_corner chain. */
  route: Vector3[];
  duration: number;
  speed: number;
}

/** point_viewcontrol spawnflags: freeze the player (needed for the camera to move) and snap to the goal angles. */
export const SHOT_FLAGS = 4 | 16;

/** Every point_viewcontrol in the map with its target and route. */
export function cameraShots(doc: VmfDocument): CameraShot[] {
  const names = byName(doc);
  return doc.entities.filter((e) => e.classname === 'point_viewcontrol').map((camera) => {
    const target = names.get(camera.get('target')?.toLowerCase() ?? '');
    const route = camera.origin ? [camera.origin.clone()] : [];
    let node = names.get(camera.get('moveto')?.toLowerCase() ?? '');
    const seen = new Set<MapEntity>();
    while (node && !seen.has(node) && PATH_CLASSES.includes(node.classname) && node.origin) {
      seen.add(node);
      route.push(node.origin.clone());
      node = names.get(node.get('target')?.toLowerCase() ?? '');
    }
    return {
      camera, target, lookAt: target?.origin?.clone() ?? null, route,
      duration: parseFloat(camera.get('wait') ?? '10') || 10,
      speed: parseFloat(camera.get('speed') ?? '0') || 0,
    };
  });
}

export interface ShotSpec {
  name: string;
  /** Camera start. */
  from: Vector3;
  /** Camera end; equal to `from` for a still shot. */
  to: Vector3;
  lookAt: Vector3;
  duration: number;
}

/** Entities as plain keyvalues, to be added by the caller (keeps this module free of editor state). */
export interface EntitySpec { classname: string; origin: Vector3; keys: Record<string, string> }

/**
 * A camera shot: the point_viewcontrol, its look-at target and (for a move) the path_corner it moves to.
 * The speed is set so the camera covers the route in about the shot's length; the engine ramps it up and
 * smooths it, which the editor's preview reproduces.
 */
export function shotEntities(s: ShotSpec): EntitySpec[] {
  const moving = s.from.distanceTo(s.to) > 8;
  const travel = Math.max(0.5, s.duration - 1);
  const speed = moving ? Math.max(16, Math.round(s.from.distanceTo(s.to) / travel)) : 0;
  const out: EntitySpec[] = [{
    classname: 'point_viewcontrol', origin: s.from.clone(),
    keys: {
      targetname: s.name, target: `${s.name}_look`, wait: String(s.duration), spawnflags: String(SHOT_FLAGS),
      speed: String(speed), acceleration: '500', deceleration: '500', interpolatepositiontoplayer: '0',
      angles: anglesStr(lookAngles(s.from, s.lookAt)), ...(moving ? { moveto: `${s.name}_to` } : {}), [CINE_KEY]: s.name,
    },
  }, { classname: 'info_target', origin: s.lookAt.clone(), keys: { targetname: `${s.name}_look`, [CINE_KEY]: s.name } }];
  if (moving) out.push({ classname: 'path_corner', origin: s.to.clone(), keys: { targetname: `${s.name}_to`, wait: '0', speed: '0', [CINE_KEY]: s.name } });
  return out;
}

export const anglesStr = (a: Vector3) => `${a.x} ${a.y} ${a.z}`;

/** All entities of a cinematic piece. */
export function pieceEntities(doc: VmfDocument, name: string): MapEntity[] {
  return doc.entities.filter((e) => e.get(CINE_KEY) === name);
}

/**
 * Simulates the point_viewcontrol's motion (CTriggerCamera::Move, server/triggers.cpp) at 60 Hz: the speed
 * approaches the target speed with `acceleration`, the velocity follows it with a 2·dt low-pass filter,
 * and each path corner is passed when the distance to it is covered. Returns positions per frame.
 */
export function simulateShot(route: Vector3[], speed: number, duration: number, accel = 500): Vector3[] {
  const dt = 1 / 60;
  const pos = route[0]?.clone() ?? new Vector3();
  const frames: Vector3[] = [pos.clone()];
  if (route.length < 2 || speed <= 0) {
    for (let t = 0; t < duration; t += dt) frames.push(pos.clone());
    return frames;
  }
  let leg = 1;
  let dir = route[1].clone().sub(pos);
  let remaining = dir.length();
  dir.normalize();
  let v = new Vector3(), s = 0;
  for (let t = 0; t < duration; t += dt) {
    if (leg < route.length && remaining <= 0) {
      leg++;
      if (leg < route.length) {
        dir = route[leg].clone().sub(pos);
        remaining = dir.length();
        dir.normalize();
      }
    }
    // Past the last corner the engine zeroes the velocity and stops moving.
    if (leg >= route.length) {
      frames.push(pos.clone());
      continue;
    }
    s = Math.min(speed, s + accel * dt);
    const f = 2 * dt;
    v = dir.clone().multiplyScalar(s * f).add(v.multiplyScalar(1 - f));
    const step = v.clone().multiplyScalar(dt);
    pos.add(step);
    remaining -= step.length();
    frames.push(pos.clone());
  }
  return frames;
}

export interface PathSpec { name: string; points: Vector3[]; loop?: boolean }

/** path_track nodes `<name>_1`, `<name>_2`, ... linked in order. */
export function pathEntities(p: PathSpec): EntitySpec[] {
  return p.points.map((pt, i) => ({
    classname: 'path_track', origin: pt.clone(),
    keys: {
      targetname: `${p.name}_${i + 1}`, [CINE_KEY]: p.name,
      ...(i < p.points.length - 1 ? { target: `${p.name}_${i + 2}` } : p.loop ? { target: `${p.name}_1` } : {}),
    },
  }));
}

/** Node names of a path in order, from any of its nodes. */
export function pathNodeNames(doc: VmfDocument, node: MapEntity): string[] {
  return (chainOf(doc, node)?.nodes ?? [node]).map((n) => n.get('targetname') ?? '').filter(Boolean);
}

/**
 * The outputs of a "send along the path" relay: cancel the unit's orders, order it to the first node and
 * queue the rest. `immortal` adds MakeImmortal, `scripted` MakeUncontrollable (AI-driven, the player
 * can't select it away from the route).
 */
export function sendAlongConnections(unit: string, nodes: string[], opts: { immortal?: boolean; scripted?: boolean } = {}): Connection[] {
  const c = (input: string, param = '', delay = 0): Connection => ({ output: 'OnTrigger', target: unit, input, param, delay, times: -1 });
  const out: Connection[] = [];
  if (opts.immortal) out.push(c('MakeImmortal'));
  if (opts.scripted) out.push(c('MakeUncontrollable'));
  out.push(c('CancelAllOrders'));
  nodes.forEach((n, i) => out.push(c(i === 0 ? 'Order' : 'QueueOrder', n, 0.1)));
  return out;
}

/** Replaces a relay's outputs to `unit` with new ones, keeping its other outputs. */
export function setRelayOrders(relay: MapEntity, unit: string, list: Connection[]): void {
  setConnections(relay, [...getConnections(relay).filter((c) => c.target.toLowerCase() !== unit.toLowerCase()), ...list]);
}

/** Scripted aircraft for flybys: the model a `func_tracktrain` carries along a path (no AI, can't be hurt). */
export const FLYBY_MODELS: { id: string; label: string; model: string; speed: number }[] = [
  { id: 'dropship', label: 'Combine dropship', model: 'models/combine_dropship.mdl', speed: 600 },
  { id: 'dropship_container', label: 'Dropship with container', model: 'models/combine_dropship_container.mdl', speed: 600 },
  { id: 'gunship', label: 'Combine gunship', model: 'models/gunship.mdl', speed: 700 },
  { id: 'helicopter', label: 'Combine helicopter', model: 'models/combine_helicopter.mdl', speed: 700 },
];

/** func_tracktrain spawnflags: no user control, passable, unblockable. */
export const FLYBY_TRAIN_FLAGS = 2 | 8 | 512;

/**
 * A flyby: a func_tracktrain (a small nodraw brush, built by the caller around `origin`) starting at the
 * path's first node, and the aircraft model parented to it. The train must stay renderable (no
 * rendermode 10): an entity that doesn't draw isn't sent to clients, and the model would lose its parent. `StartForward` on the train starts it; the
 * train follows the nodes' exact heights and turns with the path.
 */
export function flybyEntities(name: string, firstNode: string, at: Vector3, modelId: string, speed: number): EntitySpec[] {
  const m = FLYBY_MODELS.find((x) => x.id === modelId) ?? FLYBY_MODELS[0];
  return [
    {
      classname: 'func_tracktrain', origin: at.clone(),
      keys: {
        targetname: name, target: firstNode, startspeed: String(Math.round(speed || m.speed)), speed: '0', spawnflags: String(FLYBY_TRAIN_FLAGS),
        orientationtype: '2', velocitytype: '1', height: '0', wheels: '256', bank: '0', dmg: '0', [CINE_KEY]: name,
      },
    },
    {
      classname: 'prop_dynamic', origin: at.clone(),
      keys: { targetname: `${name}_model`, model: m.model, parentname: name, solid: '0', angles: '0 0 0', disableshadows: '1', [CINE_KEY]: name },
    },
  ];
}

/**
 * A screen that switches to static: the broadcast panel and, a unit in front of it, a static panel that
 * starts disabled. `Enable` on `<name>_static` covers the broadcast with static, `Disable` uncovers it.
 * Both are func_brush, so it works with any material (no ToggleTexture proxy needed).
 */
export const SCREEN_MATERIALS: { material: string; label: string }[] = [
  { material: 'PROPS/TVSCREEN001A', label: 'TV picture' },
  // A decal material: on a brush only its opaque middle shows.
  { material: 'DECALS/DECAL_POSTERBREEN', label: 'Breen (poster, see-through edges)' },
  { material: 'PROPS/SCREEN01', label: 'Screen glow' },
  { material: 'EFFECTS/SCREEN_MONITOR_BLANK', label: 'Static (scrolling noise)' },
];
export const STATIC_MATERIAL = 'EFFECTS/SCREEN_MONITOR_BLANK';

export interface AtmospherePreset {
  name: string;
  label: string;
  fogcolor: string;
  fogstart: number;
  fogend: number;
  /** Seconds the fog takes to blend to this preset. */
  seconds: number;
  /** Colour correction lookup table (.raw), or '' for none. */
  cc: string;
  ccWeight: number;
}

/** The Civil Protection lighting arc, as runtime-changeable fog and colour correction. */
export const ATMOSPHERE_PRESETS: AtmospherePreset[] = [
  { name: 'atmo_day', label: 'Grey daylight', fogcolor: '150 158 166', fogstart: 1024, fogend: 9000, seconds: 4, cc: '', ccWeight: 1 },
  { name: 'atmo_dusk', label: 'Dusk with fires', fogcolor: '150 84 46', fogstart: 512, fogend: 6000, seconds: 8, cc: 'scripts/colorcorrection/cc_thunder.raw', ccWeight: 0.6 },
  { name: 'atmo_citadel', label: 'Citadel glow', fogcolor: '96 128 170', fogstart: 384, fogend: 5000, seconds: 8, cc: 'scripts/colorcorrection/ep2_outland_01_blue.raw', ccWeight: 0.7 },
];

const ATMO_KEYS = ['fogcolor', 'fogstart', 'fogend', 'seconds', 'cc', 'ccWeight', 'label'] as const;

/** Preset settings are stored on the relay as `she_atmo_*` keys, so they can be edited and rebuilt. */
export function atmosphereOf(relay: MapEntity): AtmospherePreset | null {
  if (relay.classname !== 'logic_relay' || relay.get('she_atmo_fogcolor') === undefined) return null;
  const n = (k: string, d: number) => { const v = parseFloat(relay.get(`she_atmo_${k}`) ?? ''); return Number.isFinite(v) ? v : d; };
  return {
    name: relay.get('targetname') ?? 'atmo', label: relay.get('she_atmo_label') ?? relay.get('targetname') ?? '',
    fogcolor: relay.get('she_atmo_fogcolor') ?? '128 128 128', fogstart: n('fogstart', 512), fogend: n('fogend', 6000),
    seconds: n('seconds', 4), cc: relay.get('she_atmo_cc') ?? '', ccWeight: n('ccWeight', 1),
  };
}

export function atmosphereKeys(p: AtmospherePreset): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ATMO_KEYS) out[`she_atmo_${k}`] = String(p[k]);
  return out;
}

/**
 * The relay's outputs: blend the map's fog controller to the preset (lerp targets, the lerp time through
 * AddOutput, then StartFogTransition) and fade colour correction: this preset's `<name>_cc` on, every
 * other preset's off. Lightmaps and the sun are baked, so they can't follow.
 */
export function atmosphereConnections(p: AtmospherePreset, fog: string, otherCc: string[]): Connection[] {
  const c = (target: string, input: string, param = '', delay = 0): Connection => ({ output: 'OnTrigger', target, input, param, delay, times: -1 });
  const out = [
    c(fog, 'AddOutput', `foglerptime ${p.seconds}`),
    c(fog, 'SetColorLerpTo', p.fogcolor),
    c(fog, 'SetStartDistLerpTo', String(p.fogstart)),
    c(fog, 'SetEndDistLerpTo', String(p.fogend)),
    c(fog, 'StartFogTransition', '', 0.05),
  ];
  for (const o of otherCc) out.push(c(o, 'Disable'));
  if (p.cc) out.push(c(`${p.name}_cc`, 'Enable'));
  return out;
}

export function atmosphereCcSpec(p: AtmospherePreset, at: Vector3): EntitySpec {
  return {
    classname: 'color_correction', origin: at.clone(),
    keys: {
      targetname: `${p.name}_cc`, filename: p.cc, maxweight: String(p.ccWeight), minfalloff: '-1', maxfalloff: '-1',
      StartDisabled: '1', fadeInDuration: String(p.seconds), fadeOutDuration: String(p.seconds), [CINE_KEY]: p.name,
    },
  };
}

/**
 * A flyby the RTS camera rides along with: `<train>_go` (Trigger) starts the train and makes the
 * `<train>_cam` wars_player_follow_entity hold every player's camera on it, releasing it `seconds` later.
 * Follow entities only act for their owner's player unless `allplayers` is set, so it is set.
 */
export function followFlybyEntities(train: string, seconds: number, at: Vector3): { follow: EntitySpec; relay: EntitySpec; connections: Connection[] } {
  const cam = `${train}_cam`;
  const c = (target: string, input: string, param = '', delay = 0): Connection => ({ output: 'OnTrigger', target, input, param, delay, times: -1 });
  return {
    follow: { classname: 'wars_player_follow_entity', origin: at.clone(), keys: { targetname: cam, allplayers: '1', forced: '1', enabled: '1', triggeronce: '0', spawnflags: '1', ownernumber: '2', [CINE_KEY]: train } },
    relay: { classname: 'logic_relay', origin: at.clone().add(new Vector3(32, 0, 0)), keys: { targetname: `${train}_go`, spawnflags: '0', [CINE_KEY]: train } },
    connections: [c(train, 'StartForward'), c(cam, 'CamFollowEntity', `${train}_model`), c(cam, 'CamReleaseFollowEntity', '', Math.round(seconds * 10) / 10)],
  };
}
