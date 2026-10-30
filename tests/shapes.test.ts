import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { shapeSolids } from '../src/edit/shapes.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { solidBounds } from '../src/edit/brushes.ts';

const m = { top: 'BRICK/BRICK01', bottom: 'TOOLS/TOOLSNODRAW', sides: 'BRICK/BRICK01' };

describe('primitive shapes', () => {
  it.each(['box', 'cylinder', 'cone', 'dome'] as const)('%s builds closed convex brushes inside the footprint', (kind) => {
    const doc = VmfDocument.empty();
    const nodes = shapeSolids(doc, kind, new Vector3(-128, -96, 0), new Vector3(128, 96, 256), m, 12);
    expect(nodes.length).toBeGreaterThan(0);
    let top = -Infinity;
    for (const n of nodes) {
      const s = doc.addSolid(n);
      const faces = buildBrushFaces(s);
      // Every side produced a face: no plane is redundant or inverted.
      expect(faces.length).toBe(s.sides.length);
      const b = solidBounds(s);
      expect(b.min.x).toBeGreaterThanOrEqual(-129);
      expect(b.max.y).toBeLessThanOrEqual(97);
      top = Math.max(top, b.max.z);
    }
    expect(top).toBeGreaterThan(200);
  });
});
