import type { VmfDocument } from '../../vmf/map.ts';
import { sketchPoiPlacements, type Sketch, type SketchResult } from '../sketch.ts';
import { addPoiToDoc, placementSpec } from './mapgen.ts';

/**
 * Builds a sketch's POIs into its generated document (after generateFromSketch, like placeMarkers): each
 * stands at the levelled height of its rectangle and keeps its spec, so it can be edited in the editor.
 * Returns how many were built.
 */
export function placePois(doc: VmfDocument, s: Sketch, r: SketchResult): number {
  const placements = sketchPoiPlacements(s);
  if (!placements.length) return 0;
  let n = 0;
  placements.forEach((p, i) => {
    const spec = placementSpec(p, r.poiLevels[i] ?? 0, r.shift);
    if (!spec) return;
    addPoiToDoc(doc, spec, (x, y) => r.heightAt(x, y));
    n++;
  });
  return n;
}
