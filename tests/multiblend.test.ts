import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { parseKeyValues } from '../src/vmf/keyvalues.ts';
import { terrainPatch } from '../src/gen/layout.ts';
import { dab, noiseFill, readDisp, setGroundMaterial, vertexPos, type Disp } from '../src/edit/terrain.ts';
import { blendFromParams, blendVmt, paintLayer, readBlendRows, slotShares } from '../src/edit/multiblend.ts';
import { buildDisplacement } from '../src/geom/displacement.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';

const MB = 'SHE/BLEND/TEST';

function patches(): Disp[] {
  const doc = VmfDocument.empty();
  for (const x of [0, 512]) doc.addSolid(terrainPatch(doc, x, 0, 512, MB, () => 0, () => 0, 3, 0));
  const ds = doc.worldEntity.solids.map((s) => readDisp(s)!);
  for (const d of ds) setGroundMaterial(d, MB, true);
  return ds;
}

describe('multiblend', () => {
  it('writes the VMF rows VBSP reads, with Hammer row lengths', () => {
    const [d] = patches();
    const n = d.size;
    const rowLen = (block: string) => d.node.child(block)!.get('row0')!.split(' ').length;
    expect(rowLen('multiblend')).toBe(n * 4);
    expect(rowLen('alphablend')).toBe(n * 4);
    for (let c = 0; c < 4; c++) expect(rowLen(`multiblend_color_${c}`)).toBe(n * 3);
  });

  it('paints a layer over the base and erases back to it, following the shader slot order', () => {
    const w = new Float32Array(4);
    expect(slotShares(w, 0)).toEqual([0, 0, 0, 1]);
    paintLayer(w, 0, 2, 1);
    expect(slotShares(w, 0)).toEqual([0, 1, 0, 0]);
    // Layer 1 sits above layer 2 in the shader, so painting it takes over.
    paintLayer(w, 0, 1, 1);
    expect(slotShares(w, 0)[0]).toBe(1);
    // Layer 3 has to push the earlier slots back down.
    paintLayer(w, 0, 3, 1);
    expect(slotShares(w, 0)).toEqual([0, 0, 1, 0]);
    paintLayer(w, 0, 0, 1);
    expect(slotShares(w, 0)).toEqual([0, 0, 0, 1]);
  });

  it('brush strokes write multiblend weights that the renderer reads back', () => {
    const ds = patches();
    for (let k = 0; k < 4; k++) dab(ds, new Vector3(256, 256, 0), { mode: 'paint', radius: 150, strength: 1, layer: 1 });
    const face = buildBrushFaces(ds[0].solid).find((f) => f.side.dispinfo)!;
    const grid = buildDisplacement(face, face.side.dispinfo!)!;
    const centre = grid.positions.findIndex((p) => Math.abs(p.x - 256) < 1 && Math.abs(p.y - 256) < 1);
    expect(grid.blend[centre * 4]).toBeGreaterThan(0.9);
    expect(grid.blend[0]).toBe(0);
  });

  it('noise fill matches on shared patch edges and covers roughly the asked share', () => {
    const ds = patches();
    noiseFill(ds, [{ layer: 1, coverage: 0.4, scale: 256, seed: 5 }]);
    const edge = (d: Disp) => Array.from({ length: d.size * d.size }, (_, i) => i).filter((i) => Math.abs(vertexPos(d, i).x - 512) < 1)
      .map((i) => [Math.round(vertexPos(d, i).y), d.blend[i * 4]] as const).sort((a, b) => a[0] - b[0]);
    expect(edge(ds[0])).toEqual(edge(ds[1]));
    const all = ds.flatMap((d) => Array.from(readBlendRows(d.node, d.size)).filter((_, k) => k % 4 === 0));
    const covered = all.filter((v) => v > 0.5).length / all.length;
    expect(covered).toBeGreaterThan(0.15);
    expect(covered).toBeLessThan(0.7);
  });

  it('switching back to a two-texture blend drops the multiblend rows', () => {
    const [d] = patches();
    setGroundMaterial(d, 'NATURE/BLENDGRASSDIRT01A', false);
    expect(d.node.child('multiblend')).toBeUndefined();
    expect(d.node.child('multiblend_color_0')).toBeUndefined();
  });

  it('generates a MultiBlend VMT with the base in slot 4 and reads it back', () => {
    const def = { name: 'yard', layers: [{ texture: 'nature/dirt', scale: 1, rotation: 0 }, { texture: 'nature/mud', scale: 2, rotation: 30 }] };
    const root = parseKeyValues(blendVmt(def))[0];
    expect(root.name).toBe('MultiBlend');
    expect(root.get('$basetexture4')).toBe('nature/dirt');
    expect(root.get('$basetexture')).toBe('nature/mud');
    // Unused slots repeat the base and are never painted.
    expect(root.get('$basetexture2')).toBe('nature/dirt');
    expect(root.get('$spectexture3')).toBeTruthy();
    const params = new Map(root.props.map(([k, v]) => [k.toLowerCase(), v] as [string, string]));
    const back = blendFromParams('she/blend/yard', params);
    expect(back.layers.map((l) => l.texture)).toEqual(['nature/dirt', 'nature/mud']);
    expect(back.layers[1].scale).toBe(2);
  });

  it('keeps a layer that reuses the base texture at another angle, in its slot', () => {
    const def = { name: 'g', layers: [
      { texture: 'nature/grass', scale: 1, rotation: 0 }, { texture: 'nature/grass', scale: 1.7, rotation: 47 }, { texture: 'nature/dirt', scale: 1, rotation: 0 },
    ] };
    const root = parseKeyValues(blendVmt(def))[0];
    const back = blendFromParams('g', new Map(root.props.map(([k, v]) => [k.toLowerCase(), v] as [string, string])));
    expect(back.layers.map((l) => [l.texture, l.rotation])).toEqual([['nature/grass', 0], ['nature/grass', 47], ['nature/dirt', 0]]);
  });
});
