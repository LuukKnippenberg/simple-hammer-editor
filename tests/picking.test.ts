import { describe, expect, it } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { boxSolid } from '../src/edit/brushes.ts';
import { WorldRenderer } from '../src/render/worldRenderer.ts';
import { MaterialLibrary } from '../src/render/materials.ts';

describe('brush picking', () => {
  it('maps BVH hits back to the right brush and side', () => {
    const doc = VmfDocument.empty();
    // Many brushes sharing one material, so the BVH reorders triangles within the batch.
    const solids = [];
    for (let i = 0; i < 40; i++) {
      const x = (i % 8) * 256, y = Math.floor(i / 8) * 256;
      solids.push(doc.addSolid(boxSolid(doc, new Vector3(x, y, 0), new Vector3(x + 128, y + 128, 64 + i), 'BRICK/BRICK01')));
    }
    const world = new WorldRenderer(new MaterialLibrary());
    world.sync(doc);
    for (const i of [0, 7, 21, 39]) {
      const x = (i % 8) * 256 + 64, y = Math.floor(i / 8) * 256 + 64;
      const hit = world.raycast(new Raycaster(new Vector3(x, y, 1000), new Vector3(0, 0, -1)));
      expect(hit?.solid).toBe(solids[i]);
      expect(hit?.point.z).toBeCloseTo(64 + i);
      // The top face is the first side boxSolid writes.
      expect(hit?.side).toBe(solids[i].sides[0]);
    }
  });
});
