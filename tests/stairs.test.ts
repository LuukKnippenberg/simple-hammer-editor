import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MapSolid, VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { hullVolume } from '../src/geom/hull.ts';
import { solidBounds } from '../src/edit/brushes.ts';
import type { KVNode } from '../src/vmf/keyvalues.ts';
import {
  DEFAULT_STAIRS, MAX_RISE, MAX_SLOPE, RAIL_STYLES, STRUCTURES, autoSteps, buildStairs, decodeStairs, encodeStairs, plannedNodes, pointNames,
  stairsSummary, type StairsOptions, type StairsSpec,
} from '../src/gen/stairs.ts';

const solid = (n: KVNode) => new MapSolid(n, null);
/** A valid convex solid: every side makes a face, with a real volume. */
function valid(node: KVNode): boolean {
  const brush = solid(node);
  const faces = buildBrushFaces(brush);
  if (faces.length !== brush.sides.length || faces.length < 4) return false;
  return hullVolume(faces.map((f) => ({ normal: f.plane.normal, verts: f.verts }))) > 1;
}
const mats = (node: KVNode) => solid(node).sides.map((side) => side.material);
const top = (node: KVNode) => solidBounds(solid(node)).max.z;

function spec(nodes: [number, number, number][], flights: [number, number][], options: Partial<StairsOptions> = {}): StairsSpec {
  return { uid: 'test', nodes: nodes.map(([x, y, z]) => ({ x, y, z })), flights: flights.map(([from, to]) => ({ from, to })), options: { ...DEFAULT_STAIRS, ...options } };
}
const build = (stairs: StairsSpec) => buildStairs(VmfDocument.empty(), stairs);

/** A to B, 336 long and 192 up: the board's 12 steps of 16 rise and 28 tread. */
const straight = (options: Partial<StairsOptions> = {}) => spec([[0, 0, 0], [336, 0, 192]], [[0, 1]], options);
/** Three points: A → B → C, turning at B. */
const chain = (options: Partial<StairsOptions> = {}) => spec([[0, 0, 0], [256, 0, 96], [256, 320, 192]], [[0, 1], [1, 2]], options);
/** A → B, then B → C1 and B → C2 (a T at B). */
const tee = (options: Partial<StairsOptions> = {}) => spec([[0, 0, 0], [0, 256, 128], [-320, 256, 192], [320, 256, 192]], [[0, 1], [1, 2], [1, 3]], options);

describe('stairs geometry', () => {
  it('rise and run: 192 over 336 is 12 steps of 16 by 28', () => {
    const result = build(straight());
    expect(result.flights).toHaveLength(1);
    const flight = result.flights[0];
    expect(flight.steps).toBe(12);
    expect(flight.rise).toBe(16);
    expect(flight.tread).toBe(28);
    expect(flight.steep).toBe(false);
    expect(stairsSummary(result)).toBe('12 steps · rise 16 · tread 28 · 336 × 128');
    // Solid: one block per step from the ground, the last one level with B.
    const steps = result.detail.filter((n) => mats(n).includes(DEFAULT_STAIRS.stepMaterial));
    expect(steps).toHaveLength(12);
    expect(Math.max(...steps.map(top))).toBe(192);
    expect(steps.map(top).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, k) => (k + 1) * 16));
  });

  it('never rises more than Recast climbs, whatever the step count asked for', () => {
    expect(autoSteps(100)).toBe(7);
    expect(autoSteps(16)).toBe(1);
    expect(autoSteps(-40)).toBe(3);
    const stairs = straight();
    stairs.flights[0].steps = 4;
    const flight = build(stairs).flights[0];
    expect(flight.steps).toBe(12);
    expect(flight.rise).toBeLessThanOrEqual(MAX_RISE);
    stairs.flights[0].steps = 16;
    expect(build(stairs).flights[0].steps).toBe(16);
    expect(build(stairs).flights[0].rise).toBe(12);
  });

  it('flags a flight steeper than units can walk', () => {
    const result = build(spec([[0, 0, 0], [128, 0, 192]], [[0, 1]]));
    expect(result.flights[0].steep).toBe(true);
    expect(stairsSummary(result)).toMatch(/too steep/);
    expect(Math.atan2(192, 336) * 180 / Math.PI).toBeLessThan(MAX_SLOPE);
  });

  it('lays an NPC clip ramp on the nosings, under 45 degrees', () => {
    const result = build(straight());
    expect(result.clip).toHaveLength(1);
    const clip = result.clip[0];
    expect(valid(clip)).toBe(true);
    expect(mats(clip).every((m) => m === 'TOOLS/TOOLSNPCCLIP')).toBe(true);
    const faces = buildBrushFaces(solid(clip));
    const slope = faces.find((f) => f.plane.normal.z > 0.1 && f.plane.normal.z < 0.99)!;
    expect(Math.acos(slope.plane.normal.z) * 180 / Math.PI).toBeLessThan(MAX_SLOPE);
    // It touches each step's front edge: at x = 28k the ramp is at the k-th step's top. It starts 24 in front of
    // the flight with a lip of 4/28 of a rise, so the floor before long treads stays flat.
    const bounds = solidBounds(solid(clip));
    expect(bounds.min.x).toBe(-24);
    const lip = faces.find((f) => f.plane.normal.x < -0.99)!;
    expect(Math.max(...lip.verts.map((v) => v.z))).toBeCloseTo(16 * 4 / 28);
    expect(bounds.max.x).toBe(308);
    expect(bounds.max.z).toBe(192);
    expect(build(straight({ clip: false })).clip).toHaveLength(0);
    expect(build(straight({ profile: 'ramp' })).clip).toHaveLength(0);
  });

  it.each(STRUCTURES.map(([structure]) => structure))('builds valid convex solids for every profile, rail style and plan: %s', (structure) => {
    for (const make of [straight, chain, tee]) {
      for (const [railStyle] of RAIL_STYLES) for (const profile of ['steps', 'ramp'] as const) for (const plan of ['blocky', 'angle'] as const) {
        for (const beams of ['none', 'both', 'under'] as const) {
          const result = build(make({ structure, railStyle, profile, plan, beams }));
          expect(result.detail.length).toBeGreaterThan(0);
          for (const n of [...result.detail, ...result.clip]) expect(valid(n), `${make.name} ${structure} ${railStyle} ${profile} ${plan} ${beams}`).toBe(true);
        }
      }
    }
  });

  it('any-angle flights follow the points and stay valid', () => {
    const stairs = spec([[0, 0, 0], [300, 180, 160], [520, -60, 64]], [[0, 1], [1, 2]], { plan: 'angle' });
    const result = build(stairs);
    expect(result.flights.map((f) => f.steps)).toEqual([10, 6]);
    for (const n of [...result.detail, ...result.clip]) expect(valid(n)).toBe(true);
    // Blocky squares the same points to the grid, in order along the chain.
    expect(plannedNodes({ ...stairs, options: { ...stairs.options, plan: 'blocky' } }).map((n) => [n.x, n.y])).toEqual([[0, 0], [300, 0], [300, -240]]);
  });

  it('chains: every point after A that a flight leaves from is a landing', () => {
    const r = build(chain());
    expect(r.flights.map((f) => [f.steps, f.rise])).toEqual([[6, 16], [6, 16]]);
    expect(r.landings).toEqual([{ node: 1, size: [128, 128], joins: 2 }]);
    // Each flight stops at the landing's edge: 256 - 64 = 192 long for the first, 320 - 64 for the second.
    expect(r.flights[0].tread).toBe(32);
    expect(r.flights[1].tread).toBeCloseTo(256 / 6);
    // The landing is solid down to the ground, its top at B's height.
    const landing = r.detail.find((n) => { const b = solidBounds(solid(n)); return b.min.x === 192 && b.max.x === 320 && b.min.y === -64 && b.max.y === 64; });
    expect(landing && top(landing)).toBe(96);
    // A flat stretch (C at B's height) is a walkway, not steps.
    const flat = build(spec([[0, 0, 0], [256, 0, 96], [256, 320, 96]], [[0, 1], [1, 2]]));
    expect(flat.flights[1].steps).toBe(0);
    expect(stairsSummary(flat)).toMatch(/^2 flights · 1 landing/);
  });

  it('going down builds from the low end', () => {
    const r = build(spec([[0, 0, 128], [256, 0, 0]], [[0, 1]]));
    expect(r.flights[0].height).toBe(-128);
    expect(r.flights[0].steps).toBe(8);
    expect(r.base).toBe(0);
    const steps = r.detail.filter((n) => mats(n).includes(DEFAULT_STAIRS.stepMaterial));
    // The highest step is the one next to A.
    const highest = steps.reduce((a, b) => (top(a) >= top(b) ? a : b));
    expect(solidBounds(solid(highest)).min.x).toBe(0);
  });

  it('T junctions: one landing joins three flights, with a rail only along its back', () => {
    const r = build(tee({ railStyle: 'parapet' }));
    expect(r.landings).toEqual([{ node: 1, size: [128, 128], joins: 3 }]);
    expect(r.flights.map((f) => f.steps)).toEqual([8, 4, 4]);
    expect(stairsSummary(r)).toBe('3 flights · 1 landing · 1 junction · 16 steps');
    expect(pointNames(tee())).toEqual(['A', 'B', 'C1', 'C2']);
    expect(pointNames(chain())).toEqual(['A', 'B', 'C']);
    // Parapets: two per flight, one on the landing's open (+y) edge; none across where the flights join it.
    const walls = r.detail.filter((n) => { const b = solidBounds(solid(n)); return b.max.z > 128 + 30 && mats(n).every((m) => m === DEFAULT_STAIRS.sideMaterial || m === 'TOOLS/TOOLSNODRAW'); });
    const onLanding = walls.filter((n) => { const b = solidBounds(solid(n)); return b.min.x >= -64 && b.max.x <= 64 && b.min.y >= 192 && b.max.y <= 320; });
    expect(onLanding).toHaveLength(1);
    expect(solidBounds(solid(onLanding[0])).max.y).toBe(320);
    // A cross: a fourth flight off the same landing leaves it with no rail at all.
    const cross = tee({ railStyle: 'parapet' });
    cross.nodes.push({ x: 0, y: 576, z: 192 });
    cross.flights.push({ from: 1, to: 4 });
    expect(build(cross).landings[0].joins).toBe(4);
  });

  it('no rails with sides off, one side with left or right', () => {
    const count = (rails: StairsOptions['rails']) => build(straight({ rails, railStyle: 'parapet' })).detail.length;
    expect(count('both') - count('none')).toBe(2);
    expect(count('left') - count('none')).toBe(1);
    // Left is left walking from A to B: +y for a flight along +x.
    const left = build(straight({ rails: 'left', railStyle: 'parapet' })).detail.filter((n) => mats(n).every((m) => m !== DEFAULT_STAIRS.stepMaterial));
    expect(solidBounds(solid(left[0])).max.y).toBe(64);
  });

  it('hides faces nobody sees: bottoms on the ground and step backs against the next step', () => {
    const r = build(straight({ rails: 'none' }));
    const sides = r.detail.flatMap((n) => solid(n).sides);
    expect(sides.filter((s) => s.material === 'TOOLS/TOOLSNODRAW').length).toBeGreaterThanOrEqual(12 + 11);
    for (const n of r.detail) {
      const s = solid(n);
      const bottom = s.sides.find((x) => x.plane[0].z === 0 && x.plane[1].z === 0 && x.plane[2].z === 0);
      expect(bottom?.material).toBe('TOOLS/TOOLSNODRAW');
    }
  });

  it('landing top and bottom runs shorten the steps', () => {
    const f = build(straight({ landingTop: 64, landingBottom: 32 })).flights[0];
    expect(f.tread).toBeCloseTo((336 - 96) / 12);
  });

  it('stores and reads back its spec', () => {
    const s = tee({ structure: 'posts', rails: 'left', clip: false, width: 96, stepMaterial: 'WOOD/WOODSTAIR002A' });
    s.flights[1].steps = 6;
    s.flights[2].width = 64;
    const v = encodeStairs(s);
    expect(decodeStairs(v)).toEqual(s);
    expect(encodeStairs(straight())).toBe('test|0,0,0;336,0,192|0,1,,|');
    expect(decodeStairs('nope')).toBeNull();
  });

  it('the bounds cover the points and the width; the base is the lowest point', () => {
    const r = build(chain());
    expect(r.bounds).toEqual({ x0: -64, y0: -64, x1: 320, y1: 384 });
    expect(r.base).toBe(0);
    for (const n of r.detail) {
      const b = solidBounds(solid(n));
      expect(b.min.z).toBeGreaterThanOrEqual(-UNDER_SLACK);
      expect(new Vector3(b.max.x, b.max.y, 0).x).toBeLessThanOrEqual(r.bounds.x1 + 1);
    }
  });
});

const UNDER_SLACK = 0.01;
