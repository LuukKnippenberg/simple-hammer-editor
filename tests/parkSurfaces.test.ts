import { describe, expect, it } from 'vitest';
import { VmfDocument } from '../src/vmf/map.ts';
import { buildPoi, defaultParams, newSpec, POI_TYPES } from '../src/gen/poi/registry.ts';
import type { Rotation } from '../src/gen/poi/types.ts';
import '../src/gen/poi/catalogue.ts';
import { boxPairs, coplanarOverlaps, scanBrushes } from './overlaps.ts';

const PARK = POI_TYPES.find((t) => t.id === 'park')!;

/** Drawn faces of the park's brushes lying on the same plane over each other (they z-fight). */
function fights(seed: number, rotation: Rotation, params: Record<string, string | number | boolean>) {
  const [w, d] = rotation % 180 ? [PARK.defaultSize[1], PARK.defaultSize[0]] : PARK.defaultSize;
  const spec = newSpec(PARK, { x0: 1024, y0: -512, x1: 1024 + w, y1: -512 + d }, 64, { seed, rotation });
  spec.params = { ...defaultParams(PARK), ...params };
  const out = buildPoi(VmfDocument.empty(), spec);
  const brushes = scanBrushes([...out.detail, ...out.world]);
  return boxPairs(brushes).flatMap(([a, b]) => coplanarOverlaps(a, b).map((c) => `${c.materials.join(' / ')} at ${c.at.toArray().map(Math.round)} (${Math.round(c.area)} sq)`));
}

describe('park surfaces', () => {
  for (const ground of ['own', 'paving']) {
    for (const feature of ['pond', 'fountain', 'bandstand', 'none']) {
      it(`${feature} on ${ground} ground: no two drawn faces overlap on the same plane`, () => {
        for (const [seed, rot] of [[1, 0], [7, 90], [23, 180], [58, 270]] as [number, Rotation][]) {
          expect(fights(seed, rot, { ground, feature }), `seed ${seed}`).toEqual([]);
        }
      });
    }
  }
});
