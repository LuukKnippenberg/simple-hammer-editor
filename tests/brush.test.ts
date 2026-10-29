import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { buildSolidChunks } from '../src/render/worldRenderer.ts';

const cube = `world
{
	"id" "1"
	"classname" "worldspawn"
	solid
	{
		"id" "2"
		side { "id" "1" "plane" "(-64 64 64) (64 64 64) (64 -64 64)" "material" "BRICK/BRICK01" "uaxis" "[1 0 0 0] 0.25" "vaxis" "[0 -1 0 0] 0.25" }
		side { "id" "2" "plane" "(-64 -64 -64) (64 -64 -64) (64 64 -64)" "material" "BRICK/BRICK01" "uaxis" "[1 0 0 0] 0.25" "vaxis" "[0 -1 0 0] 0.25" }
		side { "id" "3" "plane" "(-64 64 64) (-64 -64 64) (-64 -64 -64)" "material" "BRICK/BRICK01" "uaxis" "[0 1 0 0] 0.25" "vaxis" "[0 0 -1 0] 0.25" }
		side { "id" "4" "plane" "(64 64 -64) (64 -64 -64) (64 -64 64)" "material" "BRICK/BRICK01" "uaxis" "[0 1 0 0] 0.25" "vaxis" "[0 0 -1 0] 0.25" }
		side { "id" "5" "plane" "(64 64 64) (-64 64 64) (-64 64 -64)" "material" "BRICK/BRICK01" "uaxis" "[1 0 0 0] 0.25" "vaxis" "[0 0 -1 0] 0.25" }
		side { "id" "6" "plane" "(64 -64 -64) (-64 -64 -64) (-64 -64 64)" "material" "BRICK/BRICK01" "uaxis" "[1 0 0 0] 0.25" "vaxis" "[0 0 -1 0] 0.25" }
	}
}
`;

describe('brush geometry', () => {
  it('builds six outward-facing quads for a Hammer cube', () => {
    const doc = VmfDocument.parse(cube);
    const solid = doc.allSolids()[0];
    const faces = buildBrushFaces(solid);
    expect(faces).toHaveLength(6);
    for (const f of faces) {
      expect(f.verts).toHaveLength(4);
      // Every vertex sits on the cube, and the normal points away from the centre.
      for (const v of f.verts) expect(Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z))).toBeCloseTo(64);
      const centroid = f.verts.reduce((a, v) => a.add(v), f.verts[0].clone().multiplyScalar(0)).divideScalar(4);
      expect(centroid.dot(f.plane.normal)).toBeGreaterThan(0);
    }
    expect(faces.find((f) => f.side.id === 1)!.plane.normal.z).toBeCloseTo(1);
  });

  it('builds every brush of the sample map', () => {
    const doc = VmfDocument.parse(readFileSync('maps/hlw_City16.vmf', 'utf8'));
    const solids = doc.allSolids();
    expect(solids.length).toBe(3184);
    let empty = 0;
    for (const s of solids) if (!buildSolidChunks(s).chunks.size) empty++;
    // Brushes made only of clipped-away or degenerate faces should be rare.
    expect(empty).toBeLessThan(5);
  });
});
