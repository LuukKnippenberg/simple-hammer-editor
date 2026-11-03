import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { decalBasis } from '../src/render/decalRenderer.ts';
import { decalKind, flipOverlay, overlayFlipped, overlayKeys, overlayRotation, overlaySize, placeableDecals, setOverlayRotation, setOverlaySize, type Keys } from '../src/edit/overlays.ts';

const keys = (init: Record<string, string>): Keys & { all: Record<string, string> } => {
  const all = { ...init };
  return { all, get: (k) => all[k], set: (k, v) => { all[k] = v; } };
};

describe('overlay geometry', () => {
  it('builds overlay keys the way the Decal tool places them', () => {
    const k = overlayKeys(new Vector3(10, 20, 0), new Vector3(0, 0, 1), 256, 128, 0, [4, 9]);
    expect(k.sides).toBe('4 9');
    expect([k.uv0, k.uv1, k.uv2, k.uv3]).toEqual(['-128 -64 0', '-128 64 0', '128 64 0', '128 -64 0']);
    // On a floor the texture's top points north (+Y), as an infodecal's does: V (towards the bottom) is −Y.
    expect([k.BasisU, k.BasisV, k.BasisNormal]).toEqual(['1 0 0', '0 -1 0', '0 0 1']);
    expect([k.StartU, k.EndU]).toEqual(['0', '1']);
    expect(overlayKeys(new Vector3(), new Vector3(0, 0, 1), 64, 64, 0, [1], { u: true }).StartU).toBe('1');
  });

  it('reads and rewrites size and rotation', () => {
    const e = keys(overlayKeys(new Vector3(), new Vector3(1, 0, 0), 256, 128, 30, [1]));
    expect(overlaySize(e)).toEqual({ w: 256, h: 128 });
    expect(overlayRotation(e)).toBeCloseTo(30, 3);
    setOverlaySize(e, 100, 50);
    expect(overlaySize(e)).toEqual({ w: 100, h: 50 });
    setOverlayRotation(e, 300);
    expect(overlayRotation(e)).toBeCloseTo(300, 3);
    // U and V stay perpendicular unit vectors in the surface.
    const u = e.all.BasisU.split(' ').map(Number), v = e.all.BasisV.split(' ').map(Number);
    expect(u[0]).toBeCloseTo(0);
    expect(u[1] * v[1] + u[2] * v[2]).toBeCloseTo(0);
  });

  // Seen from in front (looking along −N), with the texture's top (StartV, at −V) up and its left (StartU, at −U) left.
  const vec = (s: string) => new Vector3(...s.split(' ').map(Number));
  const surfaces: [string, Vector3, Vector3, Vector3][] = [
    // name, normal, expected U (the texture's width, left to right), expected V (its height, top to bottom)
    ['+X wall', new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, -1)],
    ['−X wall', new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)],
    ['+Y wall', new Vector3(0, 1, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, -1)],
    ['−Y wall', new Vector3(0, -1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, -1)],
    ['floor', new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, -1, 0)],
    ['ceiling', new Vector3(0, 0, -1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)],
  ];
  for (const [name, n, u, v] of surfaces) {
    it(`places an overlay on a ${name} the way an infodecal sits there`, () => {
      const k = overlayKeys(new Vector3(), n, 256, 128, 0, [1]);
      const U = vec(k.BasisU), V = vec(k.BasisV);
      expect(U.distanceTo(u)).toBeCloseTo(0);
      expect(V.distanceTo(v)).toBeCloseTo(0);
      // V = U × N, so vbsp sets its flip flag (V against the engine's N × U).
      expect(V.dot(new Vector3().crossVectors(n, U))).toBeCloseTo(-1);
      // Not mirrored: seen from in front, U is the viewer's right.
      const right = new Vector3().crossVectors(n.clone().negate(), Math.abs(n.z) > 0.7 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1));
      if (Math.abs(n.z) < 0.7) expect(U.dot(right)).toBeCloseTo(1);
      // Same axes as the infodecal preview uses.
      const { s, t } = decalBasis(n);
      expect([s.distanceTo(U), t.distanceTo(V)].map((x) => Math.round(x * 1e6))).toEqual([0, 0]);
      // A positive turn is counter-clockwise seen from in front: 90° points the texture's width along its old top.
      const e = keys(k);
      setOverlayRotation(e, 90);
      expect(vec(e.all.BasisU).distanceTo(v.clone().negate())).toBeCloseTo(0);
      expect(overlayRotation(e)).toBeCloseTo(90, 3);
    });
  }

  it('flips by swapping start and end', () => {
    const e = keys({ StartU: '0', EndU: '1', StartV: '0', EndV: '1' });
    flipOverlay(e, 'V');
    expect([e.all.StartV, e.all.EndV, overlayFlipped(e, 'V'), overlayFlipped(e, 'U')]).toEqual(['1', '0', true, false]);
    flipOverlay(e, 'V');
    expect(overlayFlipped(e, 'V')).toBe(false);
  });
});

describe('decal lists', () => {
  it('sorts decals into kinds by name', () => {
    expect(decalKind('decals/decal_posters001a')).toBe('posters');
    expect(decalKind('decals/decalgraffiti001a')).toBe('graffiti');
    expect(decalKind('decals/combinepropaganda01a')).toBe('combine');
    expect(decalKind('decals/scorch1')).toBe('scorch');
    expect(decalKind('overlays/utility_drain01')).toBe('road');
    expect(decalKind('decals/decalstain001a')).toBe('dirt');
    expect(decalKind('decals/decalrug001a')).toBe('other');
  });

  it('leaves out blood, impacts, model variants and engine decals', () => {
    expect(placeableDecals([
      'materials/decals/decal_posters001a.vmt', 'materials/decals/bloodstain_002.vmt', 'materials/decals/yblood1.vmt',
      'materials/decals/scorch1model.vmt', 'materials/decals/simpleshadow.vmt', 'materials/overlays/dirt01a.vmt', 'materials/decals/concrete/shot1.vmt',
    ])).toEqual(['decals/decal_posters001a', 'overlays/dirt01a']);
  });
});
