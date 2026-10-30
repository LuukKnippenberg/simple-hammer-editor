import { describe, expect, it } from 'vitest';
import { Vector2, Vector3 } from 'three';
import { POLE_TYPES, WALL_MOUNT, decodePowerline, encodePowerline, polePlacements, powerlineEntities, powerlineOf, wallMount, wirePoint, type PowerlineSpec } from '../src/gen/powerlines.ts';
import { RopeRenderer } from '../src/render/ropeRenderer.ts';
import { MapEntity, VmfDocument } from '../src/vmf/map.ts';
import { entity } from '../src/gen/layout.ts';

const spec: PowerlineSpec = { points: [new Vector3(0, 0, 0), new Vector3(2000, 0, 0), new Vector3(2000, 1200, 64)], pole: 'wooden', spacing: 640, slack: 0.04, feeds: true };
const wrap = (es: ReturnType<typeof powerlineEntities>) => {
  const doc = VmfDocument.empty();
  return es.map((e) => new MapEntity(entity(doc, e.classname, e.origin, e.keys)));
};

describe('powerlines', () => {
  it('spaces poles evenly per leg, with one at every bend turned to bisect it', () => {
    const poles = polePlacements(spec);
    // 2000 / 640 → 3 spans, 1200 / 640 → 2 spans, plus the last pole.
    expect(poles).toHaveLength(6);
    expect(poles[0].yaw).toBeCloseTo(0, 5);
    expect(poles[3].at.x).toBe(2000);
    expect(poles[3].yaw).toBeCloseTo(45, 5);
    expect(poles[5].yaw).toBeCloseTo(90, 5);
    expect(poles[4].at.z).toBeCloseTo(32, 5);
  });

  it('puts wire points on the crossarm, across the line', () => {
    const p = wirePoint('wooden', new Vector3(100, 0, 0), 0, 1);
    expect([p.x, p.y, p.z]).toEqual([100, 40, 470]);
    const q = wirePoint('wooden', new Vector3(0, 0, 0), 90, 1);
    expect(q.x).toBeCloseTo(-40, 5);
    expect(q.y).toBeCloseTo(0, 5);
  });

  it('chains a rope per wire from pole to pole; the renderer finds every span', () => {
    const ents = powerlineEntities(spec, 'power1');
    const poles = ents.filter((e) => e.classname.startsWith('prop_'));
    expect(poles).toHaveLength(6);
    expect(ents.filter((e) => e.classname === 'move_rope')).toHaveLength(POLE_TYPES.wooden.wires.length);
    const spans = RopeRenderer.spans(wrap(ents));
    expect(spans).toHaveLength(5 * POLE_TYPES.wooden.wires.length);
    for (const [, , slack] of spans) expect(slack).toBeGreaterThan(10);
  });

  it('stores its definition on the first pole and finds all its parts from any of them', () => {
    expect(decodePowerline(encodePowerline(spec))).toEqual(spec);
    const ents = wrap(powerlineEntities(spec, 'power1'));
    const line = powerlineOf(ents, ents[ents.length - 1])!;
    expect(line.name).toBe('power1');
    expect(line.members).toHaveLength(ents.length);
    expect(line.spec.spacing).toBe(640);
  });
});

describe('wall brackets', () => {
  it('turn the arm (model +y) out from the wall, with the plate on the wall and the wire on the outer insulator', () => {
    const wall = new Vector3(100, 200, 300);
    for (const [out, yaw] of [[new Vector2(1, 0), -90], [new Vector2(0, 1), 0], [new Vector2(-1, 0), 90], [new Vector2(0, -1), 180]] as const) {
      const m = wallMount(wall, out);
      expect(((m.yaw % 360) + 360) % 360).toBe(((yaw % 360) + 360) % 360);
      // Model +y points along `out`.
      const r = (m.yaw * Math.PI) / 180;
      expect(-Math.sin(r)).toBeCloseTo(out.x);
      expect(Math.cos(r)).toBeCloseTo(out.y);
      // The plate (model y −42) is on the wall; the wire sits 49 out and 22 up.
      expect(m.origin.x - out.x * WALL_MOUNT.back).toBeCloseTo(wall.x);
      expect(m.origin.y - out.y * WALL_MOUNT.back).toBeCloseTo(wall.y);
      expect(m.wire.x).toBeCloseTo(wall.x + out.x * 49);
      expect(m.wire.y).toBeCloseTo(wall.y + out.y * 49);
      expect(m.wire.z).toBe(322);
    }
  });

  it('take the horizontal part of a sloped wall normal', () => {
    const m = wallMount(new Vector3(), new Vector3(0, -2, 0.2));
    expect(m.wire.x).toBeCloseTo(0);
    expect(m.wire.y).toBeCloseTo(-49);
  });
});
