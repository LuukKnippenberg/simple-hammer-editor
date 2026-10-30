import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { terrainPatch } from '../src/gen/layout.ts';
import { dab, readDisp, setGroundMaterial, vertexPos, type Disp } from '../src/edit/terrain.ts';

/** Two 512 patches side by side at z = 64, sharing the edge x = 512. */
function patches(): Disp[] {
  const doc = VmfDocument.empty();
  for (const x of [0, 512]) doc.addSolid(terrainPatch(doc, x, 0, 512, 'NATURE/BLENDGRASSDIRT01A', () => 64, () => 0, 3, 64));
  return doc.worldEntity.solids.map((s) => readDisp(s)!);
}
const at = (ds: Disp[], x: number, y: number) => ds.flatMap((d) => Array.from({ length: d.size * d.size }, (_, i) => vertexPos(d, i)))
  .filter((p) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1);

describe('terrain painting', () => {
  it('reads flat patches at their height', () => {
    const ds = patches();
    expect(ds.every((d) => d.size === 9)).toBe(true);
    expect(at(ds, 256, 256)[0].z).toBeCloseTo(64, 3);
  });

  it('raises shared edge vertices of both patches alike, so no crack opens', () => {
    const ds = patches();
    for (let k = 0; k < 4; k++) dab(ds, new Vector3(512, 256, 64), { mode: 'raise', radius: 200, strength: 1 });
    const edge = at(ds, 512, 256);
    expect(edge).toHaveLength(2);
    expect(edge[0].z).toBeGreaterThan(100);
    expect(edge[0].z).toBeCloseTo(edge[1].z, 5);
    // Outside the radius nothing moved.
    expect(at(ds, 0, 0)[0].z).toBeCloseTo(64, 3);
  });

  it('smooths a spike and flattens to a level', () => {
    const ds = patches();
    dab(ds, new Vector3(256, 256, 64), { mode: 'raise', radius: 70, strength: 1 });
    const spike = at(ds, 256, 256)[0].z;
    for (let k = 0; k < 6; k++) dab(ds, new Vector3(256, 256, 64), { mode: 'smooth', radius: 200, strength: 1 });
    expect(at(ds, 256, 256)[0].z).toBeLessThan(spike - 2);
    for (let k = 0; k < 10; k++) dab(ds, new Vector3(256, 256, 64), { mode: 'flatten', radius: 300, strength: 1, level: 32 });
    expect(at(ds, 256, 256)[0].z).toBeCloseTo(32, 0);
  });

  it('paints alphas towards 255 and writes them to the dispinfo; switching sets keeps them', () => {
    const ds = patches();
    const changed = dab(ds, new Vector3(100, 100, 64), { mode: 'paint', radius: 128, strength: 1 });
    expect(changed).toHaveLength(1);
    const d = changed[0];
    const written = d.node.child('alphas')!.props.flatMap(([, v]) => v.split(' ').map(Number));
    expect(Math.max(...written)).toBeGreaterThan(200);
    expect(setGroundMaterial(d, 'NATURE/BLEND_GRASS01_MUD01')).toBe(true);
    const again = readDisp(d.solid)!;
    expect(Math.max(...again.alphas)).toBeGreaterThan(200);
    again.alphas.forEach((a, i) => expect(a).toBeCloseTo(d.alphas[i], 1));
  });
});
