import { describe, expect, it } from 'vitest';
import { MapSolid, VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { hullVolume } from '../src/geom/hull.ts';
import { solidBounds } from '../src/edit/brushes.ts';
import type { KVNode } from '../src/vmf/keyvalues.ts';
import {
  DEFAULT_FENCE, FENCE_MODELS, FENCE_STYLES, buildFence, decodeFence, doorGaps, encodeFence, fenceLayout, fenceOutline, fencePatch,
  modelOrigin, modelPieces, modelPlacements, modelYaw, pieceUnit, pointAlong, postStations, snapToPieces, type FenceSpec, type ModelPlacement,
} from '../src/gen/fences.ts';
import { addStoredFence, fenceMembers, fenceOf, fenceOwner } from '../src/gen/fenceStore.ts';
import { carryDoors, doorSpan, fenceCheck, fencePath, fenceSnap, snapDoor, withPath } from '../src/edit/fencePath.ts';
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
    const st = fenceLayout(corner({ mode: 'brush' }));
    expect(st.map((s) => Math.round(s.length))).toEqual([512, 384]);
    expect(st[1].dir.toArray()).toEqual([0, 1]);
    expect(st[0].runs).toEqual([{ link: 0, s0: 0, s1: 512 }]);
  });
  it('a doorway cuts its stretch into two runs', () => {
    const st = fenceLayout(corner({ mode: 'brush' }, [{ at: 256, width: 96 }]))[0];
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
    expect(postStations({ s0: 0, s1: 512 }, 128)).toEqual([0, 128, 256, 384, 512]);
    expect(postStations({ s0: 0, s1: 300 }, 128)).toEqual([0, 150, 300]);
    expect(postStations({ s0: 0, s1: 40 }, 128)).toEqual([0, 40]);
  });
  it('model pieces: at their own length, the longest that fits first, the rest left open at the end', () => {
    const chain = FENCE_MODELS.chainlink;
    const run = (s1: number) => modelPieces(chain, { s0: 0, s1 });
    expect(run(512).map((p) => [p.s, p.piece.step])).toEqual([[128, 256], [384, 256]]);
    expect(run(384).map((p) => [p.s, p.piece.step])).toEqual([[128, 256], [320, 128]]);
    // 400: 256 + 128, and 16 open at the end (never squeezed or stretched).
    expect(run(400).map((p) => [p.s, p.piece.step])).toEqual([[128, 256], [320, 128]]);
    expect(run(192).map((p) => p.s)).toEqual([64]);
    // A length rounded down by a unit still takes its piece.
    expect(run(127.4).map((p) => p.piece.step)).toEqual([128]);
    expect(run(100)).toEqual([]);
    const st = fenceLayout({ ...fence([[0, 0, 0], [400, 0, 0]]), mode: 'model', model: 'chainlink' })[0];
    expect([st.runs[0].filled, st.open]).toEqual([384, 16]);
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
    // The doorway in the middle of A → B opens 256..384: whole pieces either side.
    const b = buildFence(doc(), corner({ mode: 'model', model: 'chainlink' }, [{ at: 320, width: 128 }]));
    expect(b.props.every((p) => p.classname === 'prop_static' && p.keys.solid === '6')).toBe(true);
    expect(new Set(b.props.map((p) => p.keys.model))).toEqual(new Set(['models/props_c17/fence01a.mdl', 'models/props_c17/fence03a.mdl']));
    // A → B: 256 before the doorway, 128 after; B → C 384 (256 + 128).
    expect(b.pieces).toBe(4);
    expect(b.detail).toEqual([]);
    expect(b.clip.length).toBeGreaterThan(0);
    expect(b.clip.every(valid)).toBe(true);
    expect([...mats(b.clip)]).toEqual(['TOOLS/TOOLSNPCCLIP']);
    // No prop and no clip stands in the opening (x 256..384 on y 0), past its end posts.
    for (const p of b.props) {
      if (Math.abs(p.origin.y) > 8) continue;
      const half = p.keys.model.includes('fence03a') ? 128 : 64;
      expect(p.origin.x + half <= 256 + 0.5 || p.origin.x - half >= 384 - 0.5).toBe(true);
    }
    for (const c of b.clip) {
      const box = solidBounds(solid(c));
      if (box.max.y > 16) continue;
      expect(box.max.x <= 257 || box.min.x >= 383).toBe(true);
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
    // The doorway opens 384..512 (whole pieces): 256 + 128 before it.
    expect(fenceCheck(s, p, 1).numbers[0]).toBe('A → B · 512 u · 2 models · 1 doorway');
  });
});

// --- Overlap checks ----------------------------------------------------------------------------------------------

type P2 = { x: number; y: number };
/** Signed area of a polygon. */
const area = (poly: P2[]) => poly.reduce((n, p, i) => n + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0) / 2;
/** Clips a convex polygon by another convex (counter-clockwise) one. */
function clip(subject: P2[], by: P2[]): P2[] {
  let out = subject;
  for (let i = 0; i < by.length && out.length; i++) {
    const a = by[i], b = by[(i + 1) % by.length];
    const inside = (p: P2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-9;
    const cut = (p: P2, q: P2): P2 => {
      const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x), d2 = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
      const t = d1 / (d1 - d2);
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    };
    const input = out;
    out = [];
    input.forEach((p, k) => {
      const q = input[(k + 1) % input.length];
      if (inside(q)) { if (!inside(p)) out.push(cut(p, q)); out.push(q); } else if (inside(p)) out.push(cut(p, q));
    });
  }
  return out;
}
const ccw = (poly: P2[]) => (area(poly) < 0 ? [...poly].reverse() : poly);
/** A placed model's bounds in plan (its full length, end posts included). */
function rect(m: ModelPlacement): P2[] {
  const l = { x: -m.dir.y, y: m.dir.x }, h = m.length / 2;
  const at = (s: number, t: number) => ({ x: m.centre.x + m.dir.x * s + l.x * t, y: m.centre.y + m.dir.y * s + l.y * t });
  return ccw([at(-h, -m.half), at(h, -m.half), at(h, m.half), at(-h, m.half)]);
}
/**
 * Every pair of model pieces overlaps at most where their end posts are: along a stretch by their two overhangs, and
 * across a corner only within the end post's square round the shared point.
 */
function overlapProblems(spec: FenceSpec, placed = modelPlacements(spec)): string[] {
  const problems: string[] = [];
  // No piece reaches past either end of its stretch by more than its end post (over a corner, into the next one).
  const lengths = fenceLayout(spec).map((st) => st.length);
  for (const p of placed) {
    if (p.s - p.length / 2 < -p.over - 0.5 || p.s + p.length / 2 > lengths[p.link] + p.over + 0.5) problems.push(`stretch ${p.link}: the piece at ${p.s} reaches past its stretch`);
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const both = clip(rect(a), rect(b));
      if (both.length < 3 || Math.abs(area(both)) < 0.5) continue;
      if (a.link === b.link) {
        const along = a.length / 2 + b.length / 2 - Math.abs(b.s - a.s);
        if (along > a.over + b.over + 0.5) problems.push(`stretch ${a.link}: pieces at ${a.s} and ${b.s} overlap ${along}`);
        continue;
      }
      // Across stretches: inside the end post's reach of a point both stretches share.
      const reach = Math.max(a.half, b.half) + Math.max(a.over, b.over);
      const shared = spec.points.filter((p) => both.every((q) => Math.hypot(q.x - p.x, q.y - p.y) <= reach * Math.SQRT2 + 0.5));
      if (!shared.length) problems.push(`stretches ${a.link} and ${b.link}: pieces at ${a.s} and ${b.s} cross (area ${Math.round(Math.abs(area(both)))})`);
    }
  }
  return problems;
}

describe('model fences never overlap more than their end posts', () => {
  it('the check itself finds squeezed and crossing pieces', () => {
    const s = fence([[0, 0, 0], [512, 0, 0], [512, 512, 0]], undefined, { mode: 'model', model: 'chainlink' });
    const placed = modelPlacements(s);
    // Two pieces of a stretch pushed 32 together, as the old spreading did.
    const squeezed = placed.map((p, i) => (i === 1 ? { ...p, s: p.s - 32, centre: p.centre.clone().addScaledVector(p.dir, -32) } : p));
    expect(overlapProblems(s, squeezed).length).toBeGreaterThan(0);
    // The second stretch's first piece pulled back over the corner.
    const k = placed.findIndex((p) => p.link === 1);
    const crossing = placed.map((p, i) => (i === k ? { ...p, s: p.s - 64, centre: p.centre.clone().addScaledVector(p.dir, -64) } : p));
    expect(overlapProblems(s, crossing).length).toBeGreaterThan(0);
    expect(overlapProblems(s)).toEqual([]);
  });
  it("the user's chain-link A → B → C, any lengths, with a doorway", () => {
    for (const [ab, bc] of [[1000, 700], [1024, 768], [517, 333], [1300, 90]]) {
      const s = fence([[0, 0, 0], [ab, 0, 0], [ab, bc, 0]], [{ from: 0, to: 1, doors: [{ at: ab / 3, width: 100 }] }, { from: 1, to: 2 }], { mode: 'model', model: 'chainlink' });
      expect(overlapProblems(s)).toEqual([]);
      // The pieces sit at their own length: each starts a whole number of pieces after its run starts.
      for (const st of fenceLayout(s)) for (const run of st.runs) {
        const pieces = modelPieces(FENCE_MODELS.chainlink, run);
        pieces.forEach((p, k) => { if (k) expect(p.s - pieces[k - 1].s).toBe((p.piece.step + pieces[k - 1].piece.step) / 2); });
      }
    }
  });
  it('every model, square and sharp corners, and a branch', () => {
    for (const model of Object.keys(FENCE_MODELS) as (keyof typeof FENCE_MODELS)[]) {
      const square = fence([[0, 0, 0], [512, 0, 0], [512, 512, 0]], undefined, { mode: 'model', model });
      expect(overlapProblems(square)).toEqual([]);
      // 45° back: the second stretch starts past the first one's pieces.
      const sharp = fence([[0, 0, 0], [768, 0, 0], [256, 512, 0]], undefined, { mode: 'model', model });
      expect(overlapProblems(sharp)).toEqual([]);
      expect(fenceLayout(sharp)[1].start).toBeGreaterThan(0);
      const tee = fence([[0, 0, 0], [512, 0, 0], [1024, 0, 0], [512, 512, 0], [512, -384, 0]], [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 1, to: 3 }, { from: 1, to: 4 }], { mode: 'model', model });
      expect(overlapProblems(tee)).toEqual([]);
    }
  });
  it('a sharp corner pushes the next stretch past the corner post', () => {
    const sharp = fence([[0, 0, 0], [768, 0, 0], [256, 512, 0]], undefined, { mode: 'model', model: 'barbed' });
    const layout = fenceLayout(sharp);
    expect(layout[0].start).toBe(0);
    // Half-width 13 at 45°: 13 / tan(22.5°) + the end post.
    expect(layout[1].start).toBe(Math.ceil(13 / Math.tan(Math.PI / 8) + 1));
    expect(layout[1].runs[0].s0).toBe(layout[1].start);
    // A square corner shares its post.
    expect(fenceLayout(fence([[0, 0, 0], [512, 0, 0], [512, 512, 0]], undefined, { mode: 'model', model: 'barbed' }))[1].start).toBe(0);
  });
  it('the old squeezing is gone: no piece is closer to the next than its own length', () => {
    const s = fence([[0, 0, 0], [450, 0, 0]], undefined, { mode: 'model', model: 'chainlink' });
    const placed = modelPlacements(s);
    expect(placed.map((p) => [p.s, p.piece.step])).toEqual([[128, 256], [320, 128]]);
    expect(fenceLayout(s)[0].open).toBe(66);
    // The clip stops where the pieces do: the open end stays open.
    const b = buildFence(VmfDocument.empty(), s);
    expect(Math.max(...b.clip.map((c) => solidBounds(solid(c)).max.x))).toBe(384);
  });
});

describe('model fences snap to whole pieces', () => {
  it('a point goes a whole number of the shortest piece from the one before, along the cursor', () => {
    expect(pieceUnit({ mode: 'model', model: 'chainlink' })).toBe(128);
    expect(pieceUnit({ mode: 'brush', model: 'chainlink' })).toBe(0);
    expect(snapToPieces({ x: 0, y: 0 }, { x: 300, y: 10 }, 128)).toEqual({ x: 256, y: 9 });
    expect(snapToPieces({ x: 0, y: 0 }, { x: 20, y: 0 }, 128)).toEqual({ x: 128, y: 0 });
    // A diagonal: rounded to whole units, still a whole number of pieces (within a unit).
    const d = snapToPieces({ x: 64, y: 64 }, { x: 400, y: 380 }, 128);
    expect(Math.abs(Math.hypot(d.x - 64, d.y - 64) - 512)).toBeLessThan(1);
    const st = fenceLayout({ ...fence([[64, 64, 0], [d.x, d.y, 0]]), mode: 'model', model: 'chainlink' })[0];
    expect(st.open).toBe(0);
    expect(modelPieces(FENCE_MODELS.chainlink, st.runs[0]).map((q) => q.piece.step)).toEqual([256, 256]);
  });
  it('fenceSnap: brush fences on the grid, model fences on whole pieces, both on the ground', () => {
    const ground = () => 24;
    expect(fenceSnap({ x: 301, y: 9, z: 0 }, 16, ground)).toEqual({ x: 304, y: 16, z: 24 });
    expect(fenceSnap({ x: 301, y: 9, z: 0 }, 16, ground, { x: 0, y: 0, z: 0 }, 128)).toEqual({ x: 256, y: 8, z: 24 });
  });
});

describe('model fence doorways', () => {
  const s = (doors: FenceSpec['links'][number]['doors']) => fence([[0, 0, 0], [1024, 0, 0]], [{ from: 0, to: 1, doors }], { mode: 'model', model: 'chainlink' });
  it('open whole pieces, starting a whole number of pieces along', () => {
    const gaps = (doors: FenceSpec['links'][number]['doors']) => fenceLayout(s(doors))[0].gaps.map((g) => [g.s0, g.s1]);
    expect(gaps([{ at: 500, width: 96 }])).toEqual([[384, 512]]);
    expect(gaps([{ at: 500, width: 160 }])).toEqual([[384, 640]]);
    expect(gaps([{ at: 30, width: 96 }])).toEqual([[0, 128]]);
    expect(gaps([{ at: 1000, width: 96 }])).toEqual([[896, 1024]]);
  });
  it('the pieces beside an opening end at it, never in it', () => {
    for (const at of [100, 333, 500, 777, 990]) {
      const spec = s([{ at, width: 96 }]);
      const gap = fenceLayout(spec)[0].gaps[0];
      for (const p of modelPlacements(spec)) {
        const lo = p.s - p.piece.step / 2, hi = p.s + p.piece.step / 2;
        expect(hi <= gap.s0 + 0.01 || lo >= gap.s1 - 0.01).toBe(true);
      }
      expect(overlapProblems(spec)).toEqual([]);
    }
  });
  it('the doorway list stores what is built', () => {
    const p = fencePath(s([{ at: 500, width: 96 }]));
    expect(snapDoor(p, 0, { at: 500, width: 96, gate: true }, { mode: 'model', model: 'chainlink' })).toEqual({ at: 448, width: 128, gate: true });
    expect(snapDoor(p, 0, { at: 500, width: 96 }, { mode: 'brush' })).toEqual({ at: 500, width: 96 });
    expect(doorSpan(p, 0, 0, { mode: 'model', model: 'chainlink' })).toEqual({ door: 0, link: 0, s0: 384, s1: 512, gate: false });
  });
});

// --- Walls and the other brush styles --------------------------------------------------------------------------

/** A brush's plan outline (counter-clockwise) and its height range. */
function plan(node: KVNode): { poly: P2[]; zmin: number; zmax: number } {
  const verts = buildBrushFaces(solid(node)).flatMap((f) => f.verts);
  const pts = verts.map((v) => ({ x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100 }));
  const sorted = [...new Map(pts.map((p) => [`${p.x},${p.y}`, p])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P2[] = [], upper: P2[] = [];
  for (const p of sorted) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop(); lower.push(p); }
  for (const p of [...sorted].reverse()) { while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop(); upper.push(p); }
  return { poly: [...lower.slice(0, -1), ...upper.slice(0, -1)], zmin: Math.min(...verts.map((v) => v.z)), zmax: Math.max(...verts.map((v) => v.z)) };
}
/** Pairs of brushes that overlap in volume (plan overlap over 0.5 square units, heights overlapping). */
function overlapping(nodes: KVNode[]): [number, number][] {
  const plans = nodes.map(plan);
  const out: [number, number][] = [];
  for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) {
    const a = plans[i], b = plans[j];
    if (Math.min(a.zmax, b.zmax) - Math.max(a.zmin, b.zmin) < 0.5) continue;
    const both = clip(a.poly, b.poly);
    if (both.length >= 3 && Math.abs(area(both)) > 0.5) out.push([i, j]);
  }
  return out;
}
const wallSpec = (style: FenceSpec['style'], points: [number, number, number][], links?: FenceSpec['links'], o: Partial<FenceSpec> = {}) =>
  fence(points, links, { mode: 'brush', style, height: FENCE_STYLES[style].height, spacing: FENCE_STYLES[style].spacing, ...o });

describe('walls', () => {
  const doc = () => VmfDocument.empty();
  it('a short wall: valid solid brushes, mitred at the corner, no gaps or overlaps, no clip', () => {
    for (const style of ['wallConcrete', 'wallBrick', 'wallTall'] as const) {
      const b = buildFence(doc(), wallSpec(style, [[0, 0, 0], [512, 0, 0], [512, 384, 0]]));
      // Two wall segments and two copings.
      expect(b.detail).toHaveLength(4);
      expect(b.detail.every(valid)).toBe(true);
      expect(b.clip).toEqual([]);
      expect(overlapping(b.detail)).toEqual([]);
      const [w1, , w2] = b.detail.map(plan);
      // The mitre: both walls reach the outer corner (520, -8) and share the inner one (504, 8): no gap.
      for (const corner of [{ x: 520, y: -8 }, { x: 504, y: 8 }]) {
        for (const w of [w1, w2]) expect(w.poly.some((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < 0.01)).toBe(true);
      }
      const walls = b.detail.filter((n) => mats([n]).has(FENCE_STYLES[style].material));
      expect(walls).toHaveLength(2);
      expect(Math.max(...walls.map((n) => plan(n).zmax))).toBe(FENCE_STYLES[style].height);
    }
  });
  it('the coping is optional, and the wall material can be changed', () => {
    const s = wallSpec('wallBrick', [[0, 0, 0], [512, 0, 0]]);
    expect(mats(buildFence(doc(), s).detail)).toEqual(new Set(['BRICK/BRICKWALL001A', 'CONCRETE/CONCRETEFLOOR027A']));
    expect(mats(buildFence(doc(), { ...s, cap: false }).detail)).toEqual(new Set(['BRICK/BRICKWALL001A']));
    expect(mats(buildFence(doc(), { ...s, material: 'STONE/STONEWALL017A' }).detail).has('STONE/STONEWALL017A')).toBe(true);
    expect(decodeFence(encodeFence({ ...s, cap: false }))!.cap).toBe(false);
  });
  it('a doorway cuts a clean opening, with pillars beside a gate', () => {
    const s = wallSpec('wallConcrete', [[0, 0, 0], [512, 0, 0]], [{ from: 0, to: 1, doors: [{ at: 256, width: 96 }] }]);
    const b = buildFence(doc(), s);
    expect(b.detail.every(valid)).toBe(true);
    // Nothing between x 208 and 304.
    for (const n of b.detail) { const box = solidBounds(solid(n)); expect(box.max.x <= 208.01 || box.min.x >= 303.99).toBe(true); }
    const gate = buildFence(doc(), { ...s, links: [{ from: 0, to: 1, doors: [{ at: 256, width: 96, gate: true }] }] });
    expect(gate.detail.every(valid)).toBe(true);
    for (const n of gate.detail) { const box = solidBounds(solid(n)); expect(box.max.x <= 208.01 + 2 || box.min.x >= 303.99 - 2).toBe(true); }
    // Pillars stand taller than the wall, and nothing overlaps.
    expect(gate.detail.filter((n) => solidBounds(solid(n)).max.z > 48 + 4).length).toBe(4);
    expect(overlapping(gate.detail)).toEqual([]);
  });
  it('a T junction: the branch stops at the main wall\'s face', () => {
    const s = wallSpec('wallConcrete', [[0, 0, 0], [512, 0, 0], [1024, 0, 0], [512, 512, 0]], [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 1, to: 3 }], { cap: false });
    const b = buildFence(doc(), s);
    expect(b.detail.every(valid)).toBe(true);
    expect(overlapping(b.detail)).toEqual([]);
    const branch = plan(b.detail[2]);
    expect(Math.min(...branch.poly.map((p) => p.y))).toBeCloseTo(8, 3);
  });
  it('a wall on sloping ground follows it in segments that meet', () => {
    const ground = (x: number) => (x < 256 ? 0 : 32);
    const b = buildFence(doc(), wallSpec('wallConcrete', [[0, 0, 0], [768, 0, 32]], undefined, { cap: false, spacing: 256 }), ground);
    expect(b.detail.length).toBeGreaterThan(1);
    expect(b.detail.every(valid)).toBe(true);
    expect(overlapping(b.detail)).toEqual([]);
  });
});

describe('the other new brush styles', () => {
  const doc = () => VmfDocument.empty();
  it('low wall with a railing, pickets and a guardrail build valid brushes round a corner with a doorway', () => {
    for (const style of ['wallRailing', 'pickets', 'guardrail'] as const) {
      const b = buildFence(doc(), wallSpec(style, [[0, 0, 0], [512, 0, 0], [512, 384, 0]], [{ from: 0, to: 1, doors: [{ at: 256, width: 96, gate: true }] }, { from: 1, to: 2 }]));
      expect(b.detail.length).toBeGreaterThan(6);
      expect([...b.detail, ...b.clip].every(valid)).toBe(true);
      // Nothing in the opening below head height (gate posts stand at its sides).
      for (const n of b.detail) {
        const box = solidBounds(solid(n));
        if (box.max.y > 16) continue;
        expect(box.max.x <= 208 + 6 || box.min.x >= 304 - 6).toBe(true);
      }
    }
  });
  it("the railing stands on the wall's coping; walls have no clip, the others keep it", () => {
    const rail = buildFence(doc(), wallSpec('wallRailing', [[0, 0, 0], [512, 0, 0]]));
    expect(rail.clip).toEqual([]);
    const pipes = rail.detail.filter((n) => mats([n]).has('METAL/METALPIPE001A')).map((n) => solidBounds(solid(n)));
    expect(Math.min(...pipes.map((b) => b.min.z))).toBeGreaterThanOrEqual(32 + 4 - 2);
    expect(Math.max(...pipes.map((b) => b.max.z))).toBeCloseTo(32 + 4 + 44 + 1.5, 0);
    expect(buildFence(doc(), wallSpec('pickets', [[0, 0, 0], [512, 0, 0]])).clip.length).toBeGreaterThan(0);
    expect(buildFence(doc(), wallSpec('guardrail', [[0, 0, 0], [512, 0, 0]])).clip.length).toBeGreaterThan(0);
  });
  it('pickets stand between the posts, clear of them', () => {
    const b = buildFence(doc(), wallSpec('pickets', [[0, 0, 0], [256, 0, 0]], undefined, { clip: false }));
    const pickets = b.detail.filter((n) => { const box = solidBounds(solid(n)); return box.max.x - box.min.x < 5 && box.max.y - box.min.y < 3; });
    expect(pickets.length).toBeGreaterThan(15);
    const posts = b.detail.filter((n) => solidBounds(solid(n)).max.x - solidBounds(solid(n)).min.x >= 5.9 && solidBounds(solid(n)).max.y - solidBounds(solid(n)).min.y >= 5.9);
    for (const p of pickets) for (const q of posts) expect(overlapping([p, q])).toEqual([]);
  });
});
