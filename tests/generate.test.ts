import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { Cell, emptyLayout, generateMap, randomLayout } from '../src/gen/layout.ts';
import { generateBuildings } from '../src/gen/buildings.ts';
import { VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { buildDisplacement } from '../src/geom/displacement.ts';
import { buildSolidChunks } from '../src/render/worldRenderer.ts';

describe('map generator', () => {
  it('produces a complete map whose brushes all build', () => {
    for (const theme of ['rural', 'city'] as const) {
      const doc = generateMap(randomLayout(24, 24, theme, 7), { theme, seed: 7, highGround: 192 });
      const solids = doc.allSolids();
      expect(solids.length).toBeGreaterThan(150);
      for (const s of solids) expect(buildSolidChunks(s).chunks.size).toBeGreaterThan(0);
      const cls = (c: string) => doc.entities.filter((e) => e.classname === c).length;
      expect(cls('info_start_wars')).toBe(2);
      expect(cls('control_point')).toBeGreaterThanOrEqual(1);
      expect(cls('trigger_capture_area')).toBe(cls('control_point'));
      expect(cls('light_environment')).toBe(1);
      expect(cls('func_map_boundary')).toBe(1);
      // Round-trips like any other VMF.
      expect(VmfDocument.parse(doc.serialize()).serialize()).toBe(doc.serialize());
    }
  });

  it('writes displacement rows in the order the renderer reads them', () => {
    const L = emptyLayout(4, 4);
    for (let x = 2; x < 4; x++) for (let y = 0; y < 4; y++) L.cells[y * 4 + x] = Cell.High; // east half is high
    const doc = generateMap(L, { theme: 'city', seed: 1, highGround: 256 });
    // Heights depend on x only, so a transposed or mirrored grid would put high vertices in the west.
    let westMax = -Infinity, eastMin = Infinity, vertices = 0;
    for (const s of doc.worldEntity.solids) {
      for (const f of buildBrushFaces(s)) {
        if (!f.side.dispinfo) continue;
        for (const p of buildDisplacement(f, f.side.dispinfo)!.positions) {
          vertices++;
          if (p.x < -400) westMax = Math.max(westMax, p.z);
          if (p.x > 400) eastMin = Math.min(eastMin, p.z);
        }
      }
    }
    // 4×4 cells (1024 units) plus a 1024-unit apron on every side: 6×6 patches of 9×9 vertices.
    expect(vertices).toBe(36 * 81);
    expect(westMax).toBeLessThan(20);
    expect(eastMin).toBeGreaterThan(230);
  });

  it('fills a block with buildings on the facade grid', () => {
    const doc = VmfDocument.empty();
    const r = generateBuildings(doc, new Box3(new Vector3(0, 0, 0), new Vector3(1024, 640, 0)), { seed: 3, minFloors: 2, maxFloors: 4, alleys: true, roofProps: true });
    expect(r.buildings).toBeGreaterThan(1);
    for (const node of r.solids) doc.addSolid(node);
    for (const s of doc.allSolids()) expect(buildSolidChunks(s).chunks.size).toBeGreaterThan(0);
  });
});
