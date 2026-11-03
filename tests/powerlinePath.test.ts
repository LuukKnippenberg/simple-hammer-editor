import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { POLE_TYPES, TEE_DROP, decodePowerline, encodePowerline, pavementSnap, poleLineOffset, powerlineEntities, powerlinePlan, powerlineOf, type PowerlineSpec } from '../src/gen/powerlines.ts';
import { defaultRoad } from '../src/gen/roads.ts';
import { RopeRenderer } from '../src/render/ropeRenderer.ts';
import { MapEntity, VmfDocument } from '../src/vmf/map.ts';
import { entity } from '../src/gen/layout.ts';
import { addPoint, movePoint, pathLabels } from '../src/edit/pathPoints.ts';
import { powerlineCheck, powerlinePath, powerlineSnap, powerlineSpans, routeOf, teePoles } from '../src/edit/powerlinePath.ts';

const base = { pole: 'wooden' as const, spacing: 640, slack: 0.04 };
const v = (x: number, y: number, z = 0) => new Vector3(x, y, z);
/** A → B → C1 along x, and C2 branching off B to the north: B is a tee pole. */
const tee: PowerlineSpec = { ...base, points: [v(0, 0), v(1280, 0), v(2560, 0), v(1280, 1280)], links: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 1, to: 3 }] };
const wrap = (es: ReturnType<typeof powerlineEntities>) => {
  const doc = VmfDocument.empty();
  return es.map((e) => new MapEntity(entity(doc, e.classname, e.origin, e.keys)));
};

describe('powerline routes with branches', () => {
  it('fills every span at the spacing and gives a branching point a second crossarm (a tee pole)', () => {
    const plan = powerlinePlan(tee);
    // 2 spans per stretch: A, 1, B, 1, C1, then the crossarm at B, 1, C2.
    expect(plan.spans.map((s) => s.length - 1)).toEqual([2, 2, 2]);
    expect(plan.poles).toHaveLength(8);
    const arms = plan.poles.filter((p) => p.arm);
    expect(arms).toHaveLength(1);
    expect([arms[0].at.x, arms[0].at.y, arms[0].at.z]).toEqual([1280, 0, -TEE_DROP]);
    expect(arms[0].yaw).toBeCloseTo(90, 5);
    // B's own pole runs on along A → C1; the branch starts at its crossarm.
    const b = plan.spans[0][2];
    expect(plan.spans[1][0]).toBe(b);
    expect(plan.poles[b].yaw).toBeCloseTo(0, 5);
    expect(plan.poles[plan.spans[2][0]].arm).toBe(true);
    expect(plan.runs.map((r) => r.length)).toEqual([5, 3]);
  });

  it('strings the branch from the tee crossarm; one chain per wire per run', () => {
    const ents = powerlineEntities(tee, 'power1');
    expect(ents.filter((e) => e.classname.startsWith('prop_'))).toHaveLength(8);
    expect(ents.filter((e) => e.classname === 'move_rope')).toHaveLength(2 * POLE_TYPES.wooden.wires.length);
    const spans = RopeRenderer.spans(wrap(ents));
    expect(spans).toHaveLength(6 * POLE_TYPES.wooden.wires.length);
    // Every keyframe name is unique, so the chains stay apart.
    const names = ents.filter((e) => e.classname.endsWith('_rope')).map((e) => e.keys.targetname);
    expect(new Set(names).size).toBe(names.length);
  });

  it('stores the branches with the line and finds them again; a plain line stores none', () => {
    expect(decodePowerline(encodePowerline(tee))).toEqual({ ...tee, feeds: false });
    expect(encodePowerline(tee).split('|')).toHaveLength(6);
    const plain: PowerlineSpec = { ...base, points: [v(0, 0), v(640, 0)], feeds: true };
    expect(encodePowerline(plain).split('|')).toHaveLength(5);
    expect(decodePowerline(encodePowerline(plain))).toEqual(plain);
    const ents = wrap(powerlineEntities(tee, 'power3'));
    expect(powerlineOf(ents, ents[ents.length - 1])!.spec.links).toEqual(tee.links);
  });

  it('turns a path into the route and back, with A, B, C1, C2 and B as the tee', () => {
    const path = powerlinePath(tee);
    expect(pathLabels(path)).toEqual(['A', 'B', 'C1', 'C2']);
    expect(teePoles(path)).toEqual([1]);
    expect(routeOf(path).links).toEqual(tee.links);
    expect(routeOf(powerlinePath({ points: tee.points.slice(0, 3) })).links).toBeUndefined();
    const added = addPoint(path, 3, { x: 1280, y: 2560, z: 0 });
    expect(pathLabels(added.path)).toEqual(['A', 'B', 'C1', 'C2', 'D2']);
  });

  it('counts the spans of each stretch', () => {
    expect(powerlineSpans(tee)).toEqual([
      { name: 'A → B', length: 1280, spans: 2 }, { name: 'B → C1', length: 1280, spans: 2 }, { name: 'B → C2', length: 1280, spans: 2 },
    ]);
  });
});

describe('powerline points while dragging', () => {
  const world = { roads: [] };
  const path = powerlinePath(tee);
  it('is fine when the poles only move', () => {
    const c = powerlineCheck(tee, movePoint(path, 3, { x: 1408, y: 1280, z: 0 }), 3, path, world);
    expect(c.level).toBe('fine');
    expect(c.numbers).toEqual(['B → C2 · 1286 u · 2 spans']);
  });

  it('is amber when a span gets another pole, and says how many', () => {
    const c = powerlineCheck(tee, movePoint(path, 1, { x: 1280, y: -640, z: 0 }), 1, path, world);
    expect(c.level).toBe('adjusted');
    expect(c.note).toBe('1 pole added');
    expect(c.numbers[0]).toBe('A → B · 1431 u · 2 spans');
    expect(c.numbers[2]).toBe('B → C2 · 1920 u · 2 → 3 spans');
  });

  it('is red when two poles would stand in each other, or a wire runs into a wall', () => {
    expect(powerlineCheck(tee, movePoint(path, 2, { x: 1300, y: 0, z: 0 }), 2, path, world)).toMatchObject({ level: 'refused', note: 'B → C1: the poles would stand in each other' });
    const walled = { roads: [], blocked: (a: Vector3, b: Vector3) => (a.x < 2000 && b.x > 2000 ? 'a wall' : null) };
    expect(powerlineCheck(tee, movePoint(path, 2, { x: 2600, y: 0, z: 0 }), 2, path, walled)).toMatchObject({ level: 'refused', note: 'B → C1: the wires run into a wall' });
  });
});

describe('powerline points on streets', () => {
  const road = defaultRoad('asphalt', [v(-2000, 512), v(2000, 512)]);
  it('stand on the pavement just in from the kerb', () => {
    // 256 wide: half 128, kerb 8, 24 in on the 96 pavement.
    expect(poleLineOffset(road)).toBe(160);
    expect(poleLineOffset(defaultRoad('dirt'))).toBe(104);
  });

  it('snap onto the nearest pavement within reach, on either side', () => {
    expect(pavementSnap([road], { x: 100, y: 300 }, 64)).toEqual({ x: 100, y: 352, road: 0 });
    expect(pavementSnap([road], { x: 100, y: 700 }, 64)).toEqual({ x: 100, y: 672, road: 0 });
    expect(pavementSnap([road], { x: 100, y: 100 }, 64)).toBeNull();
  });

  it('a dropped point goes on the pavement and its ground, else on the grid; the note says so', () => {
    const world = { roads: [road], ground: () => 10 };
    expect(powerlineSnap(world, { x: 103, y: 320, z: 0 }, 16)).toEqual({ x: 96, y: 352, z: 10 });
    expect(powerlineSnap(world, { x: 103, y: 100, z: 0 }, 16)).toEqual({ x: 96, y: 96, z: 10 });
    const path = powerlinePath(tee);
    const moved = movePoint(path, 0, { x: 0, y: 352, z: 10 });
    expect(powerlineCheck(tee, moved, 0, path, world).note).toBe('on the asphalt road\'s pavement');
  });
});
