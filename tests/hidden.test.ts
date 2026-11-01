import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { boxSolid } from '../src/edit/brushes.ts';
import { rotateSolid } from '../src/edit/brushes.ts';
import { MapSolid, VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { hideCoveredFaces, NODRAW, overlaySides } from '../src/geom/hidden.ts';
import { terrainPatch } from '../src/gen/layout.ts';
import { KVNode, KVPair } from '../src/vmf/keyvalues.ts';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const doc = VmfDocument.empty();
const box = (min: Vector3, max: Vector3, material = 'BRICK/BRICKWALL001A') => boxSolid(doc, min, max, material);
/** The outward normals of a brush's nodraw faces, as short strings ("+x", "-z"...). */
const nodraw = (n: KVNode) => buildBrushFaces(new MapSolid(n, null))
  .filter((f) => f.side.material === NODRAW)
  .map((f) => {
    const v = f.plane.normal;
    const [axis, c] = Math.abs(v.x) > 0.9 ? ['x', v.x] : Math.abs(v.y) > 0.9 ? ['y', v.y] : Math.abs(v.z) > 0.9 ? ['z', v.z] : ['?', 0];
    return `${c > 0 ? '+' : '-'}${axis}`;
  })
  .sort();
const turn = (n: KVNode, degrees: number) => {
  const s = new MapSolid(n, null);
  rotateSolid(s, V(0, 0, 0), new Quaternion().setFromAxisAngle(V(0, 0, 1), (degrees * Math.PI) / 180));
  return n;
};

describe('hideCoveredFaces', () => {
  it('nodraws the faces two brushes press together, nothing else', () => {
    const a = box(V(0, 0, 0), V(64, 64, 64)), b = box(V(64, 0, 0), V(128, 64, 64));
    expect(hideCoveredFaces([a, b])).toBe(2);
    expect(nodraw(a)).toEqual(['+x']);
    expect(nodraw(b)).toEqual(['-x']);
  });

  it('keeps a face only partly covered', () => {
    const big = box(V(0, 0, 0), V(64, 256, 256)), small = box(V(64, 64, 64), V(96, 128, 128));
    hideCoveredFaces([big, small]);
    expect(nodraw(small)).toEqual(['-x']);
    expect(nodraw(big)).toEqual([]);
    // Overhanging the wall's edge by a little is not covered either.
    const ledge = box(V(64, 240, 0), V(96, 272, 32));
    hideCoveredFaces([big, ledge]);
    expect(nodraw(ledge)).toEqual([]);
  });

  it('keeps faces with a gap between them', () => {
    const a = box(V(0, 0, 0), V(64, 64, 64)), b = box(V(65, 0, 0), V(128, 64, 64));
    expect(hideCoveredFaces([a, b])).toBe(0);
  });

  it('counts a face covered by several brushes together', () => {
    const wall = box(V(0, 0, 0), V(16, 128, 64));
    const left = box(V(16, 0, 0), V(64, 64, 64)), right = box(V(16, 64, 0), V(64, 128, 64));
    hideCoveredFaces([wall, left, right]);
    expect(nodraw(wall)).toEqual(['+x']);
    // Leave a 16-unit gap between the two: the wall shows through it.
    const wall2 = box(V(0, 0, 0), V(16, 128, 64));
    const l2 = box(V(16, 0, 0), V(64, 56, 64)), r2 = box(V(16, 72, 0), V(64, 128, 64));
    hideCoveredFaces([wall2, l2, r2]);
    expect(nodraw(wall2)).toEqual([]);
  });

  it('works on rotated brushes', () => {
    for (const deg of [30, 45, 117]) {
      const a = turn(box(V(0, 0, 0), V(64, 64, 64)), deg), b = turn(box(V(64, 16, 0), V(96, 48, 32)), deg);
      hideCoveredFaces([a, b]);
      // Unrotated, b's -x face lies on a's +x face (covered); a's face is bigger than b's (partly covered).
      expect(buildBrushFaces(new MapSolid(b, null)).filter((f) => f.side.material === NODRAW)).toHaveLength(1);
      expect(nodraw(a)).toEqual([]);
    }
    // Two turned road segments meeting end to end.
    const s1 = turn(box(V(0, -64, 0), V(256, 64, 8)), 20), s2 = turn(box(V(256, -64, 0), V(512, 64, 8)), 20);
    expect(hideCoveredFaces([s1, s2])).toBe(2);
  });

  it('keeps flush tops of overlapping brushes (both look the same way)', () => {
    const a = box(V(0, 0, 0), V(64, 64, 64)), b = box(V(32, 0, 0), V(96, 64, 64));
    hideCoveredFaces([a, b]);
    expect(nodraw(a)).toEqual(['+x']);
    expect(nodraw(b)).toEqual(['-x']);
  });

  it('nodraws a face buried inside another brush', () => {
    const wall = box(V(0, 0, 0), V(32, 256, 256)), beam = box(V(16, 96, 96), V(256, 128, 128));
    hideCoveredFaces([wall, beam]);
    expect(nodraw(beam)).toEqual(['-x']);
  });

  it('hides nothing behind glass, water, tool or all-nodraw brushes, but nodraws their own covered faces', () => {
    for (const m of ['GLASS/GLASSWINDOW029A', 'NATURE/WATER_COAST01', 'METAL/METALRAIL001A', 'METAL/METALBAR001C_WHITE', 'TOOLS/TOOLSBLOCKLIGHT', 'TOOLS/TOOLSPLAYERCLIP', NODRAW]) {
      const wall = box(V(0, 0, 0), V(64, 64, 64)), pane = box(V(64, 0, 0), V(72, 64, 64), m);
      hideCoveredFaces([wall, pane]);
      expect(nodraw(wall)).toEqual([]);
      if (!m.startsWith('TOOLS/')) expect(nodraw(pane)).toEqual(['-x']);
    }
  });

  it('nodraws bottoms on or under the ground, not above it', () => {
    const low = box(V(0, 0, -8), V(64, 64, 32)), lifted = box(V(128, 0, 16), V(192, 64, 32));
    hideCoveredFaces([low, lifted], { groundAt: () => 0 });
    expect(nodraw(low)).toEqual(['-z']);
    expect(nodraw(lifted)).toEqual([]);
  });

  it('leaves displacements, tool textures and kept sides alone', () => {
    const disp = terrainPatch(doc, 0, 0, 512, 'NATURE/BLENDGRASSDIRT01', () => 0, () => 0, 2, -16);
    const onTop = box(V(0, 0, 0), V(64, 64, 32));
    const before = new MapSolid(disp, null).sides.map((s) => s.material);
    hideCoveredFaces([disp, onTop]);
    expect(new MapSolid(disp, null).sides.map((s) => s.material)).toEqual(before);
    expect(nodraw(onTop)).toEqual([]);
    const clip = box(V(0, 0, 0), V(64, 64, 64), 'TOOLS/TOOLSCLIP'), solid = box(V(64, 0, 0), V(128, 64, 64));
    hideCoveredFaces([clip, solid]);
    expect(new MapSolid(clip, null).sides.every((s) => s.material === 'TOOLS/TOOLSCLIP')).toBe(true);
    const a = box(V(0, 0, 0), V(64, 64, 64)), b = box(V(64, 0, 0), V(128, 64, 64));
    const face = buildBrushFaces(new MapSolid(a, null)).find((f) => f.plane.normal.x > 0.9)!;
    hideCoveredFaces([a, b], { keep: [face.side.id] });
    expect(nodraw(a)).toEqual([]);
    expect(nodraw(b)).toEqual(['-x']);
  });

  it('lets cover brushes hide faces without changing them', () => {
    const wall = box(V(0, 0, 0), V(64, 64, 64)), relief = box(V(64, 16, 16), V(72, 48, 48));
    hideCoveredFaces([relief], { cover: [wall] });
    expect(nodraw(relief)).toEqual(['-x']);
    expect(nodraw(wall)).toEqual([]);
  });

  it('reads the sides overlays lie on', () => {
    const e = new KVNode('entity');
    e.items.push(new KVPair('classname', 'info_overlay'), new KVPair('sides', '12 34'));
    expect(overlaySides([e])).toEqual([12, 34]);
  });
});
