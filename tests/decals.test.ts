import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { clipRect, decalBasis } from '../src/render/decalRenderer.ts';

const area = (p: [number, number][]) => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;

describe('decals and overlays', () => {
  it('clips an overlay rectangle to a face in either winding', () => {
    const face: [number, number][] = [[-50, -50], [50, -50], [50, 50], [-50, 50]];
    expect(area(clipRect(face, -100, -20, 100, 20))).toBeCloseTo(100 * 40);
    expect(area(clipRect([...face].reverse(), -100, -20, 100, 20))).toBeCloseTo(100 * 40);
    expect(clipRect(face, 60, 60, 80, 80)).toHaveLength(0);
  });

  it('orients wall decals upright (t down, s to the right seen from in front) and floor decals along world X', () => {
    for (const n of [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0)]) {
      const { s, t } = decalBasis(n);
      // Texture v grows along t, so the texture's top row is at −t: up.
      expect(t.z).toBeCloseTo(-1);
      expect(s.dot(new Vector3().crossVectors(n.clone().negate(), new Vector3(0, 0, 1)))).toBeCloseTo(1);
    }
    const floor = decalBasis(new Vector3(0, 0, 1));
    expect([floor.s.x, floor.t.y]).toEqual([1, -1]);
    const ceiling = decalBasis(new Vector3(0, 0, -1));
    expect([ceiling.s.x, ceiling.t.y]).toEqual([1, 1]);
  });
});
