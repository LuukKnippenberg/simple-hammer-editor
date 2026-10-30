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

  it('orients wall decals upright and floor decals along world X', () => {
    const wall = decalBasis(new Vector3(0, -1, 0));
    expect(Math.abs(wall.t.z)).toBeCloseTo(1);
    expect(wall.s.z).toBeCloseTo(0);
    const floor = decalBasis(new Vector3(0, 0, 1));
    expect(floor.s.x).toBeCloseTo(1);
    expect(Math.abs(floor.t.y)).toBeCloseTo(1);
  });
});
