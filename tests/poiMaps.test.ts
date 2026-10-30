import { describe, expect, it } from 'vitest';
import { generateMap, randomLayout } from '../src/gen/layout.ts';
import { emptySketch, generateFromSketch } from '../src/gen/sketch.ts';
import { placePois } from '../src/gen/poi/sketchPois.ts';
import { poiOf } from '../src/gen/poi/registry.ts';
import { POI_ID_KEY } from '../src/gen/poi/spec.ts';
import { readDisp, vertexPos } from '../src/edit/terrain.ts';
import { buildSolidChunks } from '../src/render/worldRenderer.ts';
import { VmfDocument } from '../src/vmf/map.ts';

describe('POIs in generated maps', () => {
  it('the sketch builds its POIs on levelled ground, editable afterwards', () => {
    const s = emptySketch(32, 32, 'rural');
    // A hill on the east half; the park straddles flat ground only.
    for (let y = 0; y < 32; y++) for (let x = 20; x < 32; x++) s.levels[y * 32 + x] = 1;
    s.pois = [{ type: 'park', x: 2, y: 2, w: 12, h: 12, seed: 5 }, { type: 'rebelcamp', x: 21, y: 18, w: 10, h: 9, seed: 6 }];
    const r = generateFromSketch(s);
    expect(placePois(r.doc, s, r)).toBe(2);
    const doc = VmfDocument.parse(r.doc.serialize());
    const details = doc.entities.filter((e) => poiOf(e));
    expect(details.map((e) => poiOf(e)!.spec.type).sort()).toEqual(['park', 'rebelcamp']);
    // The camp stands on level 1 (128 up).
    const camp = poiOf(details.find((e) => poiOf(e)!.spec.type === 'rebelcamp')!)!.spec;
    expect(camp.z).toBe(128);
    // Its entities are tied to it.
    expect(doc.entities.filter((e) => e.get(POI_ID_KEY) === camp.uid).length).toBeGreaterThan(5);
    // Terrain inside the park is flat at its level.
    const park = poiOf(details.find((e) => poiOf(e)!.spec.type === 'park')!)!.spec;
    const zs: number[] = [];
    for (const solid of doc.allSolids().filter((x) => x.isDisplacement)) {
      const d = readDisp(solid)!;
      for (let i = 0; i < d.size * d.size; i++) {
        const p = vertexPos(d, i);
        if (p.x > park.rect.x0 + 16 && p.x < park.rect.x1 - 16 && p.y > park.rect.y0 + 16 && p.y < park.rect.y1 - 16) zs.push(p.z);
      }
    }
    expect(zs.length).toBeGreaterThan(50);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1);
  });

  it('Generate map places mirrored POIs away from the bases, one pair with capture points', () => {
    for (const theme of ['rural', 'city'] as const) {
      const doc = generateMap(randomLayout(32, 32, theme, 3), { theme, seed: 3, highGround: 192, pois: 2 });
      const pois = doc.entities.map((e) => poiOf(e)).filter((p) => p);
      expect(pois.length).toBeGreaterThanOrEqual(2);
      expect(pois.length % 2).toBe(0);
      // Mirrored through the map centre.
      const [a, b] = pois;
      expect(a!.spec.rect.x0 + b!.spec.rect.x1).toBeCloseTo(0, 0);
      expect(a!.spec.rect.y0 + b!.spec.rect.y1).toBeCloseTo(0, 0);
      expect(a!.spec.type).toBe(b!.spec.type);
      // Away from the bases.
      for (const start of doc.entities.filter((e) => e.classname === 'info_start_wars')) {
        for (const p of pois) {
          const r = p!.spec.rect, o = start.origin!;
          const d = Math.max(r.x0 - o.x, o.x - r.x1, r.y0 - o.y, o.y - r.y1);
          expect(d).toBeGreaterThan(512);
        }
      }
      expect(pois.filter((p) => p!.spec.params.capture === true).length).toBe(2);
      for (const s of doc.allSolids()) expect(buildSolidChunks(s).chunks.size).toBeGreaterThan(0);
    }
  });
});
