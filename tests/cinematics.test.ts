import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { KVNode, KVPair } from '../src/vmf/keyvalues.ts';
import {
  ATMOSPHERE_PRESETS, atmosphereConnections, atmosphereKeys, atmosphereOf, cameraShots, flybyEntities, lookAngles, pathChains,
  pathEntities, sendAlongConnections, shotEntities, simulateShot, type EntitySpec,
} from '../src/lw/cinematics.ts';

function docWith(specs: EntitySpec[]): VmfDocument {
  const doc = VmfDocument.empty();
  for (const s of specs) {
    const n = new KVNode('entity');
    n.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', s.classname), new KVPair('origin', `${s.origin.x} ${s.origin.y} ${s.origin.z}`));
    for (const [k, v] of Object.entries(s.keys)) n.items.push(new KVPair(k, v));
    doc.addEntity(n);
  }
  return doc;
}

describe('camera shots', () => {
  const spec = { name: 'shot_a', from: new Vector3(0, 0, 200), to: new Vector3(1000, 0, 200), lookAt: new Vector3(500, 1000, 0), duration: 6 };

  it('builds a point_viewcontrol that looks at a target and moves to a path_corner', () => {
    const ents = shotEntities(spec);
    expect(ents.map((e) => e.classname)).toEqual(['point_viewcontrol', 'info_target', 'path_corner']);
    const cam = ents[0].keys;
    expect(cam.target).toBe('shot_a_look');
    expect(cam.moveto).toBe('shot_a_to');
    expect(cam.wait).toBe('6');
    // Freeze the player (the camera only moves then) and snap to the target at the start.
    expect(Number(cam.spawnflags) & 4).toBe(4);
    expect(Number(cam.spawnflags) & 16).toBe(16);
    expect(Number(cam.speed)).toBe(200);
  });

  it('makes a still shot without a path_corner', () => {
    const ents = shotEntities({ ...spec, to: spec.from });
    expect(ents.map((e) => e.classname)).toEqual(['point_viewcontrol', 'info_target']);
    expect(ents[0].keys.moveto).toBeUndefined();
    expect(ents[0].keys.speed).toBe('0');
  });

  it('reads shots back with their route', () => {
    const shot = cameraShots(docWith(shotEntities(spec)))[0];
    expect(shot.route.map((p) => p.x)).toEqual([0, 1000]);
    expect(shot.lookAt?.toArray()).toEqual([500, 1000, 0]);
    expect(shot.duration).toBe(6);
  });

  it('points the angles at the target (positive pitch looks down)', () => {
    const a = lookAngles(new Vector3(0, 0, 100), new Vector3(100, 0, 0));
    expect(a.x).toBeCloseTo(45);
    expect(a.y).toBeCloseTo(0);
    expect(lookAngles(new Vector3(), new Vector3(0, -10, 0)).y).toBeCloseTo(270);
  });

  it('simulates the engine motion: ramps up, ends near the path end, no overshoot', () => {
    const frames = simulateShot([spec.from, spec.to], 200, 6);
    const end = frames[frames.length - 1];
    expect(frames[1].x).toBeLessThan(5);
    expect(end.x).toBeGreaterThan(700);
    expect(Math.max(...frames.map((f) => f.x))).toBeLessThanOrEqual(1010);
  });
});

describe('paths', () => {
  const pts = [new Vector3(0, 0, 0), new Vector3(100, 0, 0), new Vector3(100, 100, 0)];

  it('links path_track nodes in order and finds the chain', () => {
    const ents = pathEntities({ name: 'route', points: pts });
    expect(ents.map((e) => [e.keys.targetname, e.keys.target])).toEqual([['route_1', 'route_2'], ['route_2', 'route_3'], ['route_3', undefined]]);
    // Chains start at the node nothing points to, whatever the file order.
    const doc = docWith([ents[2], ents[0], ents[1]]);
    const chains = pathChains(doc);
    expect(chains).toHaveLength(1);
    expect(chains[0].nodes.map((n) => n.get('targetname'))).toEqual(['route_1', 'route_2', 'route_3']);
    expect(chains[0].loop).toBe(false);
  });

  it('detects loops', () => {
    const chains = pathChains(docWith(pathEntities({ name: 'loop', points: pts, loop: true })));
    expect(chains).toHaveLength(1);
    expect(chains[0].loop).toBe(true);
    expect(chains[0].nodes).toHaveLength(3);
  });

  it('sends a unit along with Order then QueueOrder, immortal and uncontrollable first', () => {
    const c = sendAlongConnections('strider_1', ['route_1', 'route_2', 'route_3'], { immortal: true, scripted: true });
    expect(c.map((x) => `${x.input}(${x.param})`)).toEqual(['MakeImmortal()', 'MakeUncontrollable()', 'CancelAllOrders()', 'Order(route_1)', 'QueueOrder(route_2)', 'QueueOrder(route_3)']);
    expect(c.every((x) => x.target === 'strider_1' && x.output === 'OnTrigger')).toBe(true);
  });

  it('builds a flyby train carrying the model', () => {
    const [train, model] = flybyEntities('route_flyby', 'route_1', new Vector3(), 'gunship', 0);
    expect(train.classname).toBe('func_tracktrain');
    expect(train.keys.target).toBe('route_1');
    expect(train.keys.startspeed).toBe('700');
    expect(model.keys.parentname).toBe('route_flyby');
    expect(model.keys.model).toBe('models/gunship.mdl');
  });
});

describe('atmosphere', () => {
  const p = ATMOSPHERE_PRESETS[1];

  it('blends the fog with lerp inputs, then starts the transition', () => {
    const c = atmosphereConnections(p, 'fog', ['atmo_day_cc']);
    const fog = c.filter((x) => x.target === 'fog').map((x) => x.input);
    expect(fog).toEqual(['AddOutput', 'SetColorLerpTo', 'SetStartDistLerpTo', 'SetEndDistLerpTo', 'StartFogTransition']);
    expect(c[0].param).toBe(`foglerptime ${p.seconds}`);
    expect(c.find((x) => x.input === 'StartFogTransition')!.delay).toBeGreaterThan(0);
    expect(c.find((x) => x.target === 'atmo_day_cc')?.input).toBe('Disable');
    expect(c.find((x) => x.target === `${p.name}_cc`)?.input).toBe('Enable');
  });

  it('round-trips the preset through the relay keys', () => {
    const doc = docWith([{ classname: 'logic_relay', origin: new Vector3(), keys: { targetname: p.name, ...atmosphereKeys(p) } }]);
    expect(atmosphereOf(doc.entities[0])).toEqual(p);
  });
});
