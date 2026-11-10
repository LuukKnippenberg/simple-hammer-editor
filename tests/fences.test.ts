import { describe, expect, it } from 'vitest';
import { MapSolid, VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { hullVolume } from '../src/geom/hull.ts';
import { solidBounds } from '../src/edit/brushes.ts';
import type { KVNode } from '../src/vmf/keyvalues.ts';
import {
  DEFAULT_FENCE, FENCE_MODELS, FENCE_STYLES, buildFence, decodeFence, doorGaps, encodeFence, fenceLayout, fenceOutline, fencePatch,
  modelOrigin, modelPieces, modelYaw, pointAlong, postStations, type FenceSpec,
} from '../src/gen/fences.ts';
import { addStoredFence, fenceMembers, fenceOf, fenceOwner } from '../src/gen/fenceStore.ts';
import { carryDoors, fenceCheck, fencePath, withPath } from '../src/edit/fencePath.ts';
import { insertPoint, removePoint } from '../src/edit/pathPoints.ts';
import { stripHandles } from '../src/gen/handle.ts';
import { Vector2 } from 'three';

const solid = (n: KVNode) => new MapSolid(n, null);
/** A valid convex solid: every side makes a face, with a real volume. */
function valid(node: KVNode): boolean {
  const brush = solid(node);
  const faces = buildBrushFaces(brush);
  if (faces.length !== brush.sides.length || faces.length < 4) return false;
  return hullVolume(faces.map((f) => ({ normal: f.plane.normal, verts: f.verts }))) > 1;
}
const mats = (nodes: KVNode[]) => new Set(nodes.flatMap((n) => solid(n).sides.map((s) => s.material)));

function fence(points: [number, number, number][], links: FenceSpec['links'] = points.slice(1).map((_, i) => ({ from: i, to: i + 1 })), o: Partial<FenceSpec> = {}): FenceSpec {
  return { uid: 'f1', ...DEFAULT_FENCE, points: points.map(([x, y, z]) => ({ x, y, z })), links, ...o };
}
/** A → B → C: 512 east, then 384 north. */
const corner = (o: Partial<FenceSpec> = {}, doors: FenceSpec['links'][number]['doors'] = undefined) =>
  fence([[0, 0, 0], [512, 0, 0], [512, 384, 0]], [{ from: 0, to: 1, ...(doors ? { doors } : {}) }, { from: 1, to: 2 }], o);

describe('fence spec', () => {
  it('encodes and decodes, with doorways, gates and a branch', () => {
    const s = fence([[0, 0, 0], [512, 0, 16], [512, 384, 0], [900, 0, 8]], [
      { from: 0, to: 1, doors: [{ at: 128, width: 96, gate: true }, { at: 400, width: 64 }] },
      { from: 1, to: 2 },
      { from: 1, to: 3, doors: [{ at: 50.5, width: 48 }] },
    ], { mode: 'brush', style: 'rails', height: 72, spacing: 160, material: 'WOOD/WOODWALL009A', clip: false });
    const text = encodeFence(s);
    expect(decodeFence(text)).toEqual(s);
    expect(text).toBe('f1|brush|chainlink|rails|72|160|0|WOOD/WOODWALL009A|0,0,0;512,0,16;512,384,0;900,0,8|0@128,96,g@400,64;1;1@50.5,48');
  });
  it('a plain fence keeps no material and decodes its defaults', () => {
    const s = corner();
    expect(decodeFence(encodeFence(s))).toEqual(s);
    expect(decodeFence(encodeFence(s))!.material).toBeUndefined();
  });
  it('refuses broken values', () => {
    expect(decodeFence('')).toBeNull();
    expect(decodeFence('f1|model|nope|chainlink|112|128|1||0,0,0;1,1,1|0')).toBeNull();
    expect(decodeFence('f1|model|chainlink|chainlink|112|128|1||0,0,0;1,1,1|')).toBeNull();
    expect(decodeFence('f1|model|chainlink|chainlink|112|128|1||0,0,x;1,1,1|0')).toBeNull();
  });
  it('a new brush style brings its height and spacing, and drops a picked material', () => {
    expect(fencePatch({ style: 'chainlink' }, { style: 'rails' })).toEqual({ style: 'rails', height: FENCE_STYLES.rails.height, spacing: FENCE_STYLES.rails.spacing, material: undefined });
    expect(fencePatch({ style: 'rails' }, { height: 80 })).toEqual({ height: 80 });
  });
});

describe('fence layout', () => {
  it('one stretch per link, with plan length and direction', () => {
    const st = fenceLayout(corner());
    expect(st.map((s) => Math.round(s.length))).toEqual([512, 384]);
    expect(st[1].dir.toArray()).toEqual([0, 1]);
    expect(st[0].runs).toEqual([{ link: 0, s0: 0, s1: 512 }]);
  });
  it('a doorway cuts its stretch into two runs', () => {
    const st = fenceLayout(corner({}, [{ at: 256, width: 96 }]))[0];
    expect(st.gaps).toEqual([{ link: 0, door: 0, s0: 208, s1: 304, gate: false }]);
    expect(st.runs).toEqual([{ link: 0, s0: 0, s1: 208 }, { link: 0, s0: 304, s1: 512 }]);
  });
  it('doorways are clamped into the stretch, overlapping ones merge, and slivers at the ends go', () => {
    expect(doorGaps([{ at: 10, width: 96 }], 512)).toEqual([{ door: 0, s0: 0, s1: 96, gate: false }]);
    expect(doorGaps([{ at: 600, width: 96 }], 512)).toEqual([{ door: 0, s0: 416, s1: 512, gate: false }]);
    expect(doorGaps([{ at: 200, width: 96 }, { at: 260, width: 64, gate: true }], 512)).toEqual([{ door: 0, s0: 152, s1: 292, gate: true }]);
    // 4 units of fence left at the start: the opening takes it.
    expect(doorGaps([{ at: 52, width: 96 }], 512)[0].s0).toBe(0);
    // Wider than the stretch: the whole stretch is open, and no run is left.
    const st = fenceLayout(fence([[0, 0, 0], [80, 0, 0]], [{ from: 0, to: 1, doors: [{ at: 40, width: 200 }] }]))[0];
    expect(st.runs).toEqual([]);
  });
  it('points between the ends follow the ground (within reach), the ends are the points', () => {
    const st = fenceLayout(fence([[0, 0, 0], [512, 0, 64]]))[0];
    const ground = (x: number) => (x < 300 ? 100 : 5000);
    expect(pointAlong(st, 0, ground).z).toBe(0);
    expect(pointAlong(st, 256, ground).z).toBe(100);
    expect(pointAlong(st, 400, ground).z).toBe(50);
    expect(pointAlong(st, 256).z).toBe(32);
  });
  it('posts at both ends and evenly at about the spacing', () => {
    expect(postStations({ link: 0, s0: 0, s1: 512 }, 128)).toEqual([0, 128, 256, 384, 512]);
    expect(postStations({ link: 0, s0: 0, s1: 300 }, 128)).toEqual([0, 150, 300]);
    expect(postStations({ link: 0, s0: 0, s1: 40 }, 128)).toEqual([0, 40]);
  });
  it('model pieces: the longest that fits, then shorter, spread evenly', () => {
    const chain = FENCE_MODELS.chainlink;
    const run = (s1: number) => modelPieces(chain, { link: 0, s0: 0, s1 });
    expect(run(512).map((p) => [p.s, p.piece.step])).toEqual([[128, 256], [384, 256]]);
    expect(run(384).map((p) => p.piece.step)).toEqual([256, 128]);
    // 400: 256 + 128 and 16 left over at the joint; the ends stay at the run's ends.
    expect(run(400).map((p) => p.s)).toEqual([128, 336]);
    // 192: one 128 would leave 64 open, so two overlap (a closed fence beats a hole at a corner).
    expect(run(192).map((p) => p.piece.step)).toEqual([128, 128]);
    // 100 is most of a 128 piece: one, a little over the ends; 50 is too short for any.
    expect(run(100).map((p) => p.s)).toEqual([50]);
    expect(run(50)).toEqual([]);
  });
  it('model yaw turns the long axis along the stretch, and the origin centres the bounds', () => {
    expect(modelYaw('y', new Vector2(1, 0))).toBe(270);
    expect(modelYaw('y', new Vector2(0, 1))).toBe(0);
    expect(modelYaw('x', new Vector2(0, 1))).toBe(90);
    // exterior_fence_notbarbed's bounds sit at x -13..-8: its middle goes on the line.
    const piece = FENCE_MODELS.wasteland.pieces[1];
    expect(modelOrigin(piece, { x: 100, y: 0 }, 32, 0, 4).toArray()).toEqual([111, 0, 32 + 76 - 4]);
  });
});

describe('building fences', () => {
  const doc = () => VmfDocument.empty();

  it('model mode: props along every stretch with collision, none across a doorway, an NPC clip strip', () => {
    const b = buildFence(doc(), corner({ mode: 'model', model: 'chainlink' }, [{ at: 256, width: 128 }]));
    expect(b.props.every((p) => p.classname === 'prop_static' && p.keys.solid === '6')).toBe(true);
    expect(new Set(b.props.map((p) => p.keys.model))).toEqual(new Set(['models/props_c17/fence01a.mdl', 'models/props_c17/fence03a.mdl']));
    // A → B: 192 on each side of the doorway (two overlapping 128s each) and B → C 384 (256 + 128).
    expect(b.pieces).toBe(6);
    expect(b.detail).toEqual([]);
    expect(b.clip.length).toBeGreaterThan(0);
    expect(b.clip.every(valid)).toBe(true);
    expect([...mats(b.clip)]).toEqual(['TOOLS/TOOLSNPCCLIP']);
    // No prop and no clip stands in the opening (x 192..320 on y 0).
    for (const p of b.props) {
      if (Math.abs(p.origin.y) > 8) continue;
      const half = p.keys.model.includes('fence03a') ? 128 : 64;
      expect(p.origin.x + half <= 192 + 2 || p.origin.x - half >= 320 - 2).toBe(true);
    }
    for (const c of b.clip) {
      const box = solidBounds(solid(c));
      if (box.max.y > 16) continue;
      expect(box.max.x <= 193 || box.min.x >= 319).toBe(true);
    }
  });

  it('model mode: a gate adds an open gate leaf (not solid) on chain-link, gate posts on wooden models', () => {
    const chain = buildFence(doc(), corner({ mode: 'model', model: 'chainlink' }, [{ at: 256, width: 128, gate: true }]));
    const leaves = chain.props.filter((p) => p.keys.model === 'models/props_c17/gate_door02a.mdl');
    expect(leaves).toHaveLength(1);
    expect(leaves[0].keys.solid).toBe('0');
    const wood = buildFence(doc(), corner({ mode: 'model', model: 'planks' }, [{ at: 256, width: 128, gate: true }]));
    expect(wood.props.some((p) => p.keys.model.includes('gate'))).toBe(false);
    expect(wood.detail).toHaveLength(2);
    expect(wood.detail.every(valid)).toBe(true);
  });

  it('brush mode: posts, panels and top rails as valid brushes, posts shared at corners', () => {
    const b = buildFence(doc(), corner({ mode: 'brush', style: 'chainlink', height: 112, spacing: 128 }));
    // A → B 5 posts, B → C 4 more (B is shared).
    expect(b.posts).toBe(8);
    expect(b.detail.every(valid)).toBe(true);
    expect(mats(b.detail)).toEqual(new Set(['METAL/METALPIPE001A', 'METAL/METALFENCE004A']));
    // 8 posts + 7 panels + 7 rails.
    expect(b.detail).toHaveLength(22);
    const top = Math.max(...b.detail.map((n) => solidBounds(solid(n)).max.z));
    expect(top).toBeGreaterThanOrEqual(112);
    expect(b.props).toEqual([]);
  });

  it('brush mode: panels are textured along the fence, fitted to their height', () => {
    const b = buildFence(doc(), fence([[0, 0, 0], [256, 256, 0]], undefined, { mode: 'brush', style: 'boards', height: 96, spacing: 128 }));
    const panel = b.detail.map(solid).find((s) => s.sides.some((side) => side.material === 'WOOD/WOODFENCE001'))!;
    const face = panel.sides.find((side) => side.material === 'WOOD/WOODFENCE001' && /\[0\.7071/.test(side.node.get('uaxis') ?? ''));
    expect(face).toBeTruthy();
    expect(face!.node.get('uaxis')).toMatch(/ 0\.188$/);
  });

  it('brush mode: rails, the material override, and a doorway with gate posts', () => {
    const b = buildFence(doc(), corner({ mode: 'brush', style: 'rails', height: 64, spacing: 128, material: 'WOOD/WOODWALL009A' }, [{ at: 256, width: 96, gate: true }]));
    expect(b.detail.every(valid)).toBe(true);
    expect(mats(b.detail)).toEqual(new Set(['WOOD/WOODBEAM001A', 'WOOD/WOODWALL009A']));
    expect(b.doors).toBe(1);
    // The two gate posts stand taller than the fence.
    const tall = b.detail.filter((n) => solidBounds(solid(n)).max.z > 64 + 8);
    expect(tall).toHaveLength(2);
    // Nothing crosses the opening (x 208..304) low down, where units walk.
    for (const n of b.detail) {
      const box = solidBounds(solid(n));
      if (box.max.y > 16) continue;
      expect(box.max.x <= 208 + 8 || box.min.x >= 304 - 8).toBe(true);
    }
  });

  it('brush panels follow the ground between the points', () => {
    const ground = (x: number) => (x > 100 && x < 400 ? 40 : 0);
    const b = buildFence(doc(), fence([[0, 0, 0], [512, 0, 0]], undefined, { mode: 'brush', style: 'chainlink', spacing: 128, clip: false }), ground);
    const lows = b.detail.map((n) => solidBounds(solid(n))).filter((box) => box.max.x - box.min.x < 8).map((box) => box.min.z + 8);
    expect(lows).toEqual([0, 40, 40, 40, 0]);
  });

  it('every style and model builds valid brushes', () => {
    for (const style of Object.keys(FENCE_STYLES) as (keyof typeof FENCE_STYLES)[]) {
      const b = buildFence(doc(), corner({ mode: 'brush', style, height: FENCE_STYLES[style].height, spacing: FENCE_STYLES[style].spacing }, [{ at: 200, width: 96, gate: true }]));
      expect(b.detail.length).toBeGreaterThan(5);
      expect([...b.detail, ...b.clip].every(valid)).toBe(true);
    }
    for (const model of Object.keys(FENCE_MODELS) as (keyof typeof FENCE_MODELS)[]) {
      const b = buildFence(doc(), corner({ mode: 'model', model }, [{ at: 200, width: 96, gate: true }]));
      expect(b.pieces).toBeGreaterThan(2);
      expect([...b.detail, ...b.clip].every(valid)).toBe(true);
    }
  });

  it('the outline shows both modes and the doorways', () => {
    expect(fenceOutline(corner({ mode: 'model' }, [{ at: 256, width: 128 }])).length % 6).toBe(0);
    expect(fenceOutline(corner({ mode: 'brush', style: 'chainlink' })).length).toBeGreaterThan(fenceOutline(fence([[0, 0, 0], [512, 0, 0]], undefined, { mode: 'brush' })).length);
  });
});

describe('stored fences', () => {
  it('a stored fence keeps its spec, finds its members, and the compile copy loses the editor keys', () => {
    const doc = VmfDocument.empty();
    const s = corner({ mode: 'model', model: 'barbed' }, [{ at: 256, width: 96 }]);
    addStoredFence(doc, s);
    const m = fenceMembers(doc, 'f1');
    expect(fenceOf(m.detail)).toEqual(s);
    expect(m.props.length).toBeGreaterThan(2);
    expect(m.world.length).toBeGreaterThan(2);
    expect(m.handle).toBeTruthy();
    expect(fenceOwner(doc, m.props[0])).toBe(m.detail);
    expect(fenceOwner(doc, null, m.world[0])).toBe(m.detail);
    expect(fenceOwner(doc, m.handle)).toBe(m.detail);
    stripHandles(doc);
    // The model fence's func_detail held only the spec: gone, with the handle; props and clip stay.
    expect(doc.entities.some((e) => e.classname === 'she_fence_handle' || e.get('she_fence'))).toBe(false);
    expect(doc.entities.filter((e) => e.classname === 'prop_static').length).toBe(m.props.length);
  });
});

describe('doorways through point changes', () => {
  const path = () => fencePath(fence([[0, 0, 0], [512, 0, 0], [512, 384, 0]], [{ from: 0, to: 1, doors: [{ at: 100, width: 64 }, { at: 400, width: 64 }] }, { from: 1, to: 2, doors: [{ at: 200, width: 96 }] }]));

  it('a moved point keeps the doorways where they are along their stretch', () => {
    const p = path();
    const moved = { ...p, points: p.points.map((q, i) => (i === 1 ? { ...q, x: 700 } : q)) };
    expect(carryDoors(p, moved)).toBe(moved);
    expect(withPath(corner(), moved).links[0].doors).toEqual([{ at: 100, width: 64 }, { at: 400, width: 64 }]);
  });

  it('an inserted point hands each doorway to its half', () => {
    const p = path();
    const r = insertPoint(p, 0, { x: 256, y: 0, z: 0 });
    // pathPoints copies the stretch's data onto both halves; carryDoors sorts them out.
    expect((r.path.links[0] as { doors?: unknown[] }).doors).toHaveLength(2);
    const kept = carryDoors(p, r.path, r.moved).links as FenceSpec['links'];
    expect(kept[0].doors).toEqual([{ at: 100, width: 64 }]);
    expect(kept[1].doors).toEqual([{ at: 144, width: 64 }]);
    expect(kept[2].doors).toEqual([{ at: 200, width: 96 }]);
  });

  it('a removed point joins its stretches\' doorways', () => {
    const p = path();
    const r = removePoint(p, 1)!;
    const kept = carryDoors(p, r.path, r.moved).links as FenceSpec['links'];
    expect(kept).toHaveLength(1);
    expect(kept[0].doors).toEqual([{ at: 100, width: 64 }, { at: 400, width: 64 }, { at: 712, width: 96 }]);
  });

  it('the drag note: red for a stretch too short, amber when a doorway has to move', () => {
    const s = corner({}, [{ at: 400, width: 64 }]);
    const p = fencePath(s);
    const squeezed = { ...p, points: p.points.map((q, i) => (i === 1 ? { ...q, x: 300 } : q)) };
    expect(fenceCheck(s, squeezed, 1).level).toBe('adjusted');
    const onTop = { ...p, points: p.points.map((q, i) => (i === 1 ? { ...q, x: 8 } : q)) };
    expect(fenceCheck(s, onTop, 1).level).toBe('refused');
    expect(fenceCheck(s, p, 2).level).toBe('fine');
    expect(fenceCheck(s, p, 1).numbers[0]).toBe('A → B · 512 u · 3 models · 1 doorway');
  });
});
