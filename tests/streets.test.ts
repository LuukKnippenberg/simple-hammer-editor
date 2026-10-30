import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { generateBuildings } from '../src/gen/buildings.ts';
import { streetDressing, type BlockDressing } from '../src/gen/streets.ts';
import { Rng } from '../src/gen/rng.ts';
import { VmfDocument, MapEntity } from '../src/vmf/map.ts';
import { RopeRenderer } from '../src/render/ropeRenderer.ts';
import { entity } from '../src/gen/layout.ts';

/** Two rows of blocks with a 256-unit street between them and an alley-width gap between neighbours. */
function district(seed: number): BlockDressing[] {
  const doc = VmfDocument.empty();
  const boxes = [[0, 0, 1024, 1024], [1152, 0, 2176, 1024], [0, 1280, 1024, 2304], [1152, 1280, 2176, 2304]];
  return boxes.map(([x0, y0, x1, y1], i) => generateBuildings(doc, new Box3(new Vector3(x0, y0, 0), new Vector3(x1, y1, 0)), {
    seed: seed + i, minFloors: 4, maxFloors: 6, alleys: false, roofProps: false, architecture: 'tenement',
  }).dressing);
}

describe('street dressing', () => {
  it('strings cables across the street between facing walls, each rope linked to its far end', () => {
    let cables = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const blocks = district(seed);
      const ents = streetDressing(blocks, new Rng(seed));
      const ropes = ents.filter((e) => e.classname === 'move_rope');
      cables += ropes.length;
      const doc = VmfDocument.empty();
      const wrapped = ents.map((e) => new MapEntity(entity(doc, e.classname, e.origin, e.keys)));
      const spans = RopeRenderer.spans(wrapped);
      expect(spans).toHaveLength(ropes.length);
      for (const [a, b] of spans) {
        // Across a street: 128 to 900 units, level ends.
        const span = Math.hypot(b.x - a.x, b.y - a.y);
        expect(span).toBeGreaterThanOrEqual(128);
        expect(span).toBeLessThanOrEqual(900);
        expect(a.z).toBe(b.z);
      }
    }
    expect(cables).toBeGreaterThan(6);
  });

  it('puts lamps on the pavement but not in alleys, and trees in courtyards clear of the sheds', () => {
    const blocks = district(3);
    const ents = streetDressing(blocks, new Rng(3));
    const lamps = ents.filter((e) => e.keys.model?.includes('lamppost'));
    expect(lamps.length).toBeGreaterThan(4);
    // The 128-unit gap between neighbouring blocks (x 1024..1152) is an alley: no lamps in it.
    expect(lamps.some((l) => l.origin.x > 1024 && l.origin.x < 1152 && l.origin.y > 0 && l.origin.y < 1024)).toBe(false);
    const trees = ents.filter((e) => e.keys.model?.includes('tree'));
    for (const t of trees) {
      const p = { x: t.origin.x, y: t.origin.y };
      for (const b of blocks) for (const o of b.obstacles) expect(o.clone().expandByScalar(40).containsPoint(p as never)).toBe(false);
    }
  });
});
