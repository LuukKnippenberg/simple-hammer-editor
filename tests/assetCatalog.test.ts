import { afterEach, describe, expect, it, vi } from 'vitest';
import { VmfDocument } from '../src/vmf/map.ts';
import type { Editor } from '../src/editor.ts';
import {
  assetGroups, assetUses, decalAssets, favouriteAssets, loadAssets, materialAssets, modelAssets, recentAssets,
  searchAssets, soundAssets, usedInMap,
} from '../src/assets/assetCatalog.ts';

const side = (id: number, material: string) => `side { "id" "${id}" "plane" "(0 0 0) (1 0 0) (0 1 0)" "material" "${material}" }`;
const map = `world
{
	"id" "1"
	"classname" "worldspawn"
	solid { "id" "2" ${side(1, 'BRICK/BRICKWALL001A')} ${side(2, 'BRICK/BRICKWALL001A')} ${side(3, 'TOOLS/TOOLSNODRAW')} }
	solid { "id" "3" ${side(4, 'concrete/concretefloor001a')} }
}
entity { "id" "10" "classname" "prop_static" "model" "" "origin" "0 0 0" }
entity { "id" "11" "classname" "prop_dynamic" "model" "models/props_c17/oildrum001.mdl" "origin" "0 0 0" }
entity { "id" "12" "classname" "prop_static" "model" "models/props_junk/wood_crate001a.mdl" "origin" "0 0 0" }
entity { "id" "13" "classname" "infodecal" "texture" "Decals/LambdaSpray_1a" "origin" "0 0 0" }
entity { "id" "14" "classname" "info_overlay" "material" "overlays/no_entry" "origin" "0 0 0" }
entity { "id" "15" "classname" "ambient_generic" "message" "#ambient/levels/canals/drip1.wav" "origin" "0 0 0" }
entity { "id" "16" "classname" "ambient_generic" "message" "Canals.Drip" "origin" "0 0 0" }
entity { "id" "17" "classname" "func_brush" solid { "id" "4" ${side(5, 'BRICK/BRICKWALL001A')} } }
`;
const editorFor = (text: string) => {
  const doc = VmfDocument.parse(text);
  // Hammer may write backslashes and capitals; set after parsing, as the KV parser reads \ as an escape.
  doc.entities.find((e) => e.get('id') === '10')?.set('model', 'Models\\Props_c17\\OilDrum001.mdl');
  return { doc } as unknown as Editor;
};

describe('asset catalog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes model items with folder groups and prop_static, physics and skins badges', () => {
    const items = modelAssets([
      { path: 'models/props_c17/oildrum001.mdl', static: true, physics: false, skins: 6, size: [29, 29, 46], materials: 6 },
      { path: 'models/props_junk/wood_crate001a.mdl', static: false, physics: true, skins: 1, size: [40, 40, 40], materials: 1 },
      { path: 'models/error.mdl', static: false, physics: false, skins: 1, size: [8, 8, 8], materials: 1 },
    ]);
    expect(items[0]).toEqual({ kind: 'model', id: 'models/props_c17/oildrum001.mdl', name: 'oildrum001', group: 'props_c17', badges: ['static', 'skins'] });
    expect(items[1].badges).toEqual(['physics']);
    expect(items[2]).toMatchObject({ name: 'error', group: '', badges: [] });
  });

  it('keeps brush materials only, with tool and blend badges', () => {
    const items = materialAssets(['materials/brick/brickwall001a.vmt', 'materials/models/props_c17/oil.vmt', 'materials/decals/x.vmt',
      'materials/tools/toolsnodraw.vmt', 'materials/nature/blendgrassdirt001a.vmt', 'materials/vgui/logo.vmt', 'materials/loose.vmt']);
    expect(items.map((i) => i.id)).toEqual(['brick/brickwall001a', 'tools/toolsnodraw', 'nature/blendgrassdirt001a', 'loose']);
    expect(items.map((i) => i.group)).toEqual(['brick', 'tools', 'nature', '']);
    expect(items.map((i) => i.badges)).toEqual([[], ['tool'], ['blend'], []]);
  });

  it('groups decals by kind and marks overlays; sounds by folder with a loop badge', () => {
    expect(decalAssets(['decals/lambdaspray_1a', 'overlays/no_entry', 'decals/zzz'])).toEqual([
      { kind: 'decal', id: 'decals/lambdaspray_1a', name: 'lambdaspray_1a', group: 'graffiti', badges: [] },
      { kind: 'decal', id: 'overlays/no_entry', name: 'no_entry', group: 'other', badges: ['overlay'] },
      { kind: 'decal', id: 'decals/zzz', name: 'zzz', group: 'other', badges: [] },
    ]);
    expect(soundAssets(['ambient/levels/canals/waterleak_loop1.wav', 'ui/buttonclick.wav'])).toEqual([
      { kind: 'sound', id: 'ambient/levels/canals/waterleak_loop1.wav', name: 'waterleak_loop1.wav', group: 'ambient', badges: ['loop'] },
      { kind: 'sound', id: 'ui/buttonclick.wav', name: 'buttonclick.wav', group: 'ui', badges: [] },
    ]);
  });

  it('searches the path: every word must match, case does not matter', () => {
    const items = soundAssets(['ambient/fire/fire_loop.wav', 'ambient/water/drip1.wav', 'weapons/fire1.wav']);
    expect(searchAssets(items, 'FIRE').map((i) => i.name)).toEqual(['fire_loop.wav', 'fire1.wav']);
    expect(searchAssets(items, ' ambient  fire ').map((i) => i.name)).toEqual(['fire_loop.wav']);
    expect(searchAssets(items, 'fire drip')).toEqual([]);
    expect(searchAssets(items, '  ')).toBe(items);
  });

  it('lists groups largest first, ties in list order, without the empty group', () => {
    const items = soundAssets(['b/1.wav', 'a/1.wav', 'c/1.wav', 'a/2.wav', 'top.wav', 'top2.wav', 'top3.wav']);
    expect(assetGroups(items)).toEqual([{ group: 'a', count: 2 }, { group: 'b', count: 1 }, { group: 'c', count: 1 }]);
  });

  it('counts uses in the map per kind and sees later changes', () => {
    const editor = editorFor(map);
    expect([...usedInMap(editor, 'model')]).toEqual([['models/props_c17/oildrum001.mdl', 2], ['models/props_junk/wood_crate001a.mdl', 1]]);
    expect([...usedInMap(editor, 'material')]).toEqual([['brick/brickwall001a', 3], ['tools/toolsnodraw', 1], ['concrete/concretefloor001a', 1]]);
    expect([...usedInMap(editor, 'decal')]).toEqual([['decals/lambdaspray_1a', 1], ['overlays/no_entry', 1]]);
    // A soundscript name is no file, so it is not counted.
    expect([...usedInMap(editor, 'sound')]).toEqual([['ambient/levels/canals/drip1.wav', 1]]);

    editor.doc.entities.find((e) => e.get('id') === '12')!.set('model', 'models/props_c17/oildrum001.mdl');
    expect([...usedInMap(editor, 'model')]).toEqual([['models/props_c17/oildrum001.mdl', 3]]);
    // A new map counts afresh.
    expect(usedInMap(editorFor('world { "id" "1" "classname" "worldspawn" }'), 'model').size).toBe(0);
  });

  it('finds the brushes or entities that use an asset', () => {
    const editor = editorFor(map);
    expect(assetUses(editor, 'model', 'models/props_c17/oildrum001.mdl').entities.map((e) => e.get('id'))).toEqual(['10', '11']);
    expect(assetUses(editor, 'decal', 'overlays/no_entry').entities.map((e) => e.get('id'))).toEqual(['14']);
    expect(assetUses(editor, 'sound', 'ambient/levels/canals/drip1.wav').entities.map((e) => e.get('id'))).toEqual(['15']);
    const bricks = assetUses(editor, 'material', 'brick/brickwall001a');
    expect([bricks.solids.map((s) => s.id), bricks.entities]).toEqual([[2, 4], []]);
  });

  it('keeps recent and favourite lists apart for every kind', () => {
    const kinds = ['model', 'material', 'decal', 'sound'] as const;
    const lists = kinds.flatMap((k) => [recentAssets(k), favouriteAssets(k)]);
    expect(new Set(lists).size).toBe(8);
    expect(recentAssets('model')).toBe(recentAssets('model'));
    favouriteAssets('sound').toggle('ambient/fire/fire_loop.wav');
    expect(favouriteAssets('sound').has('Ambient/Fire/Fire_Loop.wav')).toBe(true);
    expect(favouriteAssets('material').has('ambient/fire/fire_loop.wav')).toBe(false);
    for (let i = 0; i < 30; i++) recentAssets('material').push(`brick/b${i}`);
    expect(recentAssets('material').items).toHaveLength(24);
    expect(recentAssets('material').items[0]).toBe('brick/b29');
  });

  it('loads a kind once and keeps the list', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(['materials/brick/brickwall001a.vmt', 'materials/models/x.vmt'])));
    vi.stubGlobal('fetch', fetch);
    const a = await loadAssets('material');
    const b = await loadAssets('material');
    expect(a).toBe(b);
    expect(a.map((i) => i.id)).toEqual(['brick/brickwall001a']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0])).toContain('/api/list?folder=materials&ext=.vmt');
  });
});
