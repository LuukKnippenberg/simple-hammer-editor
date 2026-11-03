import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { parseKeyValues } from '../src/vmf/keyvalues.ts';
import { terrainPatch } from '../src/gen/layout.ts';
import { dab, noiseFill, readDisp, setGroundMaterial, vertexPos, type Disp } from '../src/edit/terrain.ts';
import { BLEND_EDGES, blendFromParams, blendVmt, paintLayer, readBlendRows, slotShares, type BlendDef } from '../src/edit/multiblend.ts';
import { AssetFS } from '../server/assets.ts';
import { loadConfig } from '../server/config.ts';
import { parseDetailTypes } from '../server/plugin.ts';
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
    // An unused slot has no softness map: it is never painted.
    expect(root.get('$spectexture2')).toBeUndefined();
    expect(root.get('$spectexture4')).toBe('nature/forest_grass_10a_spec');
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

  it('writes exactly the keys the shader reads, as the blender spec shows (canal_mud)', () => {
    const def: BlendDef = { name: 'canal_mud', detailtype: 'grass01b', layers: [
      { texture: 'nature/forest_grass_01', scale: 1, rotation: 0 },
      { texture: 'nature/mud01', scale: 1.5, rotation: 30, edge: 'soft' },
      { texture: 'nature/gravelfloor006a', scale: 0.75, rotation: 0, edge: 'crisp' },
    ] };
    expect(blendVmt(def)).toBe([
      '"MultiBlend"', '{', '\t"%keywords" "wars"',
      '\t"$basetexture" "nature/mud01"', '\t"$spectexture" "nature/forest_grass_10a_spec"', '\t"$scale" "1.50"', '\t"$rotation" "30.0"',
      '\t"$basetexture2" "nature/gravelfloor006a"', '\t"$scale2" "0.75"', '\t"$rotation2" "0.0"',
      '\t"$basetexture3" "nature/forest_grass_01"', '\t"$scale3" "1.00"', '\t"$rotation3" "0.0"',
      '\t"$basetexture4" "nature/forest_grass_01"', '\t"$spectexture4" "nature/forest_grass_10a_spec"', '\t"$scale4" "1.00"', '\t"$rotation4" "0.0"',
      '\t"%tooltexture" "nature/forest_grass_01"', '\t"$fow" "_rt_fog_of_war"', '\t"%detailtype" "grass01b"', '}', '',
    ].join('\n'));
  });

  it('picks each layer\'s softness map from its edge and reads every edge back', () => {
    const maps = { crisp: undefined, medium: 'nature/forest_grass_10b_spec', soft: 'nature/forest_grass_10a_spec' };
    for (const edge of BLEND_EDGES) {
      for (const other of BLEND_EDGES) {
        const def: BlendDef = { name: 'e', layers: [
          { texture: 'nature/dirt', scale: 1, rotation: 0 },
          { texture: 'nature/mud', scale: 0.25, rotation: -15, edge },
          { texture: 'nature/grass', scale: 4, rotation: 90, edge: other },
          { texture: 'nature/gravel', scale: 2, rotation: 0, edge },
        ] };
        const root = parseKeyValues(blendVmt(def))[0];
        expect(root.get('$spectexture'), edge).toBe(maps[edge]);
        expect(root.get('$spectexture2'), other).toBe(maps[other]);
        expect(root.get('$spectexture3'), edge).toBe(maps[edge]);
        // The base keeps the Soft map: there it only adds shine.
        expect(root.get('$spectexture4')).toBe(maps.soft);
        const keys = root.props.map(([k]) => k.toLowerCase());
        expect(keys.filter((k) => /^\$(bumpmap|color|detail|blendmodulatetexture)/.test(k))).toEqual([]);
        const back = blendFromParams('e', new Map(root.props.map(([k, v]) => [k.toLowerCase(), v] as [string, string])));
        expect(back).toEqual(def);
      }
    }
  });

  it('reads blends written before edges existed as Soft, with their unused slots dropped', () => {
    const old = '"MultiBlend"\n{\n"$basetexture" "nature/a"\n"$spectexture" "nature/forest_grass_10a_spec"\n"$scale" "1.25"\n"$rotation" "40.0"\n' +
      '"$basetexture2" "nature/b"\n"$spectexture2" "nature/forest_grass_10a_spec"\n"$scale2" "1.00"\n"$rotation2" "0.0"\n' +
      '"$basetexture3" "nature/b"\n"$spectexture3" "nature/forest_grass_10a_spec"\n"$scale3" "1.00"\n"$rotation3" "0.0"\n' +
      '"$basetexture4" "nature/b"\n"$spectexture4" "nature/forest_grass_10a_spec"\n"$scale4" "1.00"\n"$rotation4" "0.0"\n}';
    const root = parseKeyValues(old)[0];
    const back = blendFromParams('old', new Map(root.props.map(([k, v]) => [k.toLowerCase(), v] as [string, string])));
    expect(back.layers).toEqual([{ texture: 'nature/b', scale: 1, rotation: 0 }, { texture: 'nature/a', scale: 1.25, rotation: 40, edge: 'soft' }]);
  });
});

const cfg = loadConfig(process.cwd());
const game = new AssetFS(cfg);
const shipped = game.list('materials/blends', '.vmt');

describe.skipIf(!shipped.length)('the game\'s MultiBlend materials', () => {
  it('parses all 23 shipped materials/blends/*.vmt', () => {
    expect(shipped.length).toBe(23);
    for (const f of shipped) {
      const root = parseKeyValues(game.read(f)!.toString('latin1'))[0];
      expect(root.name.toLowerCase(), f).toBe('multiblend');
      const def = blendFromParams(f, new Map(root.props.map(([k, v]) => [k.toLowerCase(), v] as [string, string])));
      expect(def.layers.length, f).toBeGreaterThanOrEqual(1);
      for (const [i, l] of def.layers.entries()) {
        expect(l.texture, f).toMatch(/^[\w/-]+$/);
        expect(l.scale, f).toBeGreaterThan(0);
        expect(Number.isFinite(l.rotation), f).toBe(true);
        expect(l.edge === undefined, f).toBe(i === 0);
      }
      // Saving a copy writes a VMT that reads back the same.
      const again = parseKeyValues(blendVmt({ ...def, name: 'copy' }))[0];
      expect(blendFromParams(f, new Map(again.props.map(([k, v]) => [k.toLowerCase(), v] as [string, string]))).layers, f).toEqual(def.layers);
    }
  });

  it('lists the 23 sprite types of the game\'s detail.vbsp', () => {
    const types = parseDetailTypes(game.read('detail.vbsp')!.toString('latin1'));
    expect(types.length).toBeGreaterThanOrEqual(23);
    expect(types).toContain('grass01b');
    expect(types).toContain('rocks1');
  });
});
