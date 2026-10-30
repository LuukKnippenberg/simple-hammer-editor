import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { VmfDocument, type MapEntity, type MapSolid } from '../src/vmf/map.ts';
import { History } from '../src/edit/history.ts';
import { boxSolid, remapSolid, solidBounds, translateSolid } from '../src/edit/brushes.ts';
import type { Editor } from '../src/editor.ts';
import {
  applyBlock, blockHandleDragged, buildingsFromSelection, deleteBlock, duplicateBlock, regenerateBlock, selectedBlocks,
} from '../src/gen/buildingAction.ts';
import {
  BLOCK_WORLD_KEY, GROUP_KEY, blockMembers, blockOf, blockOfSolid, blocksInGroup, decodeBlock, encodeBlock, groupDressing, type BlockSpec,
} from '../src/gen/buildingStore.ts';
import { BUILDING_HANDLE, HANDLE_HEIGHT, findHandle, handleBox, stripHandles } from '../src/gen/handle.ts';
import { generateFromSketch } from '../src/gen/sketch.ts';
import { generateMap, randomLayout } from '../src/gen/layout.ts';
import { buildDistrictSketch } from '../src/examples/district.ts';

/** Enough of an Editor for building actions, with a selection that remembers what was selected. */
function stubEditor(doc = VmfDocument.empty()): Editor {
  const selection = {
    solids: new Set<MapSolid>(), entities: new Set<MapEntity>(),
    set(s: MapSolid[], e: MapEntity[] = []) { this.solids = new Set(s); this.entities = new Set(e); },
    clear() { this.solids.clear(); this.entities.clear(); },
  };
  return {
    doc, history: new History(() => doc), changed() {}, emit() {}, selection,
    world: { raycast: () => null, visibleKinds: { handle: true } },
  } as unknown as Editor;
}

const OPTS = { seed: 11, minFloors: 3, maxFloors: 5, alleys: false, roofProps: true, architecture: 'tenement' as const };

/** Generates blocks of buildings on block brushes (one group), like the Building panel. Returns their func_details. */
function generate(ed: Editor, rects: [number, number, number, number][], opts = OPTS): MapEntity[] {
  const brushes = rects.map(([x0, y0, x1, y1]) => ed.doc.addSolid(boxSolid(ed.doc, new Vector3(x0, y0, 0), new Vector3(x1, y1, 64), 'DEV/DEV_MEASUREGENERIC01')));
  ed.selection.set(brushes, []);
  buildingsFromSelection(ed, opts);
  return selectedBlocks(ed);
}

const handle = (ed: Editor, d: MapEntity) => findHandle(ed.doc, BUILDING_HANDLE, blockOf(d)!.uid)!;
const cables = (ed: Editor) => ed.doc.entities.filter((e) => e.classname === 'move_rope');
/** Everything in the map, as a fingerprint that changes when any of it changes. */
const parts = (ed: Editor, d: MapEntity) => { const m = blockMembers(ed.doc, blockOf(d)!.uid); return { world: m.world, entities: m.entities }; };

describe('stored blocks of buildings', () => {
  it('keep their footprint and options through a save', () => {
    const spec: BlockSpec = {
      uid: 'abc123', group: 'grp001', street: 'ground', groupSeed: 77, rect: { x0: -512, y0: 0, x1: 640, y1: 896 }, z: 128,
      options: {
        seed: 4242, minFloors: 2, maxFloors: 7, alleys: true, roofProps: false, style: 'brick', architecture: 'tenement', weathering: 0.3,
        corners: 'round', courtyards: false, annexes: true, detail: 3, roofs: 'mansard', towers: false, interiors: 'some',
        interiorStyle: 'farmhouse', cutHeight: 104, furnish: 'sparse', interiorLights: true, wideDoors: false,
      },
    };
    expect(decodeBlock(encodeBlock(spec))).toEqual(spec);
    // Options this code doesn't know yet survive too.
    const extra = { ...spec, options: { ...spec.options, sealed: true, lightBudget: 12 } as BlockSpec['options'] };
    expect(decodeBlock(encodeBlock(extra))).toEqual(extra);

    const ed = stubEditor();
    const [d] = generate(ed, [[0, 0, 1024, 768]], { ...OPTS, weathering: 0.2, detail: 1, roofs: 'flat' } as typeof OPTS);
    const saved = VmfDocument.parse(ed.doc.serialize());
    const again = saved.entities.find((e) => blockOf(e))!;
    expect(blockOf(again)).toEqual(blockOf(d));
    expect(blockOf(again)!.options).toMatchObject({ seed: 11, minFloors: 3, maxFloors: 5, weathering: 0.2, detail: 1, roofs: 'flat', architecture: 'tenement' });
    expect(blockOf(again)!.rect).toEqual({ x0: 0, y0: 0, x1: 1024, y1: 768 });
  });

  it('a rebuild replaces exactly the block\'s own parts', () => {
    const ed = stubEditor();
    const mine = ed.doc.addSolid(boxSolid(ed.doc, new Vector3(5000, 0, 0), new Vector3(5128, 128, 128), 'DEV/DEV_MEASUREGENERIC01'));
    const [a, b] = generate(ed, [[0, 0, 1024, 768], [1280, 0, 2304, 768]]);
    const bBefore = parts(ed, b);
    const aBefore = parts(ed, a);
    expect(aBefore.world.length).toBeGreaterThan(3);
    expect(aBefore.entities.length).toBeGreaterThan(0);
    // The world brushes of a block are one range of ids.
    expect(a.get(BLOCK_WORLD_KEY)).toMatch(/^\d+-\d+$/);
    for (const s of aBefore.world) expect(blockOfSolid(ed.doc, s)).toBe(a);
    expect(blockOfSolid(ed.doc, mine)).toBeNull();

    const worldBefore = ed.doc.worldEntity.solids.length;
    regenerateBlock(ed, a, { options: { seed: 999 } });
    const aAfter = parts(ed, a);
    // None of the old parts are left, the other block and the hand-made brush are untouched.
    for (const s of aBefore.world) expect(ed.doc.worldEntity.solids).not.toContain(s);
    for (const e of aBefore.entities) expect(ed.doc.entities).not.toContain(e);
    expect(parts(ed, b)).toEqual(bBefore);
    expect(ed.doc.worldEntity.solids).toContain(mine);
    expect(ed.doc.worldEntity.solids.length).toBe(worldBefore - aBefore.world.length + aAfter.world.length);
    expect(blockOf(a)!.options.seed).toBe(999);
    // Still one block, one handle each.
    expect(ed.doc.entities.filter((e) => blockOf(e))).toHaveLength(2);
    expect(ed.doc.entities.filter((e) => e.classname === BUILDING_HANDLE.classname)).toHaveLength(2);
    // Undo puts the old parts back.
    ed.history.undo();
    expect(parts(ed, a).world).toHaveLength(aBefore.world.length);
    for (const s of aBefore.world) expect(parts(ed, a).world).toContain(s);
    expect(blockOf(a)!.options.seed).toBe(11);
  });

  it('moves and resizes with its handle, in one undo step with the drag', () => {
    const ed = stubEditor();
    const [d] = generate(ed, [[0, 0, 1024, 768]]);
    const h = handle(ed, d);
    expect(handleBox(h)!.min.toArray()).toEqual([0, 0, 0]);
    expect(handleBox(h)!.max.toArray()).toEqual([1024, 768, HANDLE_HEIGHT]);
    const xs = () => blockMembers(ed.doc, blockOf(d)!.uid).world.map((s) => solidBounds(s).min.x);
    const before = Math.min(...xs());
    // What the Select tool does: the drag is recorded, then the rebuild joins it in one step.
    const end = ed.history.begin('Move', h.solids, [h]);
    translateSolid(h.solids[0], new Vector3(512, 256, 0));
    ed.history.group('Move buildings', () => { end(); blockHandleDragged(ed, h, 'translate'); });
    expect(blockOf(d)!.rect).toEqual({ x0: 512, y0: 256, x1: 1536, y1: 1024 });
    expect(Math.min(...xs())).toBe(before + 512);
    expect(handleBox(h)!.min.toArray()).toEqual([512, 256, 0]);
    expect(ed.selection.entities.has(h)).toBe(true);
    ed.history.undo();
    expect(blockOf(d)!.rect).toEqual({ x0: 0, y0: 0, x1: 1024, y1: 768 });
    expect(handleBox(h)!.min.toArray()).toEqual([0, 0, 0]);
    expect(Math.min(...xs())).toBe(before);

    // Resize: wider, and the height of the drag doesn't matter.
    const b = solidBounds(h.solids[0]);
    remapSolid(h.solids[0], b, new Box3(b.min.clone(), b.max.clone().add(new Vector3(512, 0, 300))));
    blockHandleDragged(ed, h, 'scale');
    expect(blockOf(d)!.rect).toEqual({ x0: 0, y0: 0, x1: 1536, y1: 768 });
    expect(blockOf(d)!.z).toBe(0);
    expect(handleBox(h)!.max.z).toBe(HANDLE_HEIGHT);
    // Never smaller than one building.
    const c = solidBounds(h.solids[0]);
    remapSolid(h.solids[0], c, new Box3(c.min.clone(), new Vector3(c.min.x + 40, c.max.y, c.max.z)));
    blockHandleDragged(ed, h, 'scale');
    expect(blockOf(d)!.rect.x1 - blockOf(d)!.rect.x0).toBe(128);
  });

  it('the group\'s street dressing follows its blocks', () => {
    const ed = stubEditor();
    // Two blocks facing each other across a 384-wide street.
    const [a, b] = generate(ed, [[0, 0, 1024, 1024], [1408, 0, 2432, 1024]], { ...OPTS, seed: 5 });
    const group = blockOf(a)!.group;
    expect(blockOf(b)!.group).toBe(group);
    expect(blocksInGroup(ed.doc, group)).toEqual([a, b]);
    const dressing = groupDressing(ed.doc, group);
    expect(cables(ed).length).toBeGreaterThan(0);
    expect(cables(ed).every((c) => c.get(GROUP_KEY) === group)).toBe(true);
    expect(dressing.some((e) => e.classname === 'prop_static')).toBe(true);
    // Rope names carry the group, so another group never links to them.
    expect(cables(ed).every((c) => c.get('targetname')!.startsWith(`wire_${group}_`))).toBe(true);

    // Move b far away: no cable is left hanging from a wall that moved.
    const h = handle(ed, b);
    translateSolid(h.solids[0], new Vector3(6000, 0, 0));
    blockHandleDragged(ed, h, 'translate');
    expect(cables(ed)).toHaveLength(0);
    for (const e of dressing) expect(ed.doc.entities).not.toContain(e);
    ed.history.undo();
    expect(cables(ed).length).toBeGreaterThan(0);

    // Rebuilding a block rebuilds the group's dressing (cables meet its new walls).
    regenerateBlock(ed, a, { options: { seed: 31 } });
    const ends = ed.doc.entities.filter((e) => e.classname === 'move_rope' || e.classname === 'keyframe_rope');
    expect(ends.length).toBeGreaterThan(0);
    // Both ends of every cable are on the two walls facing each other across the street.
    for (const e of ends) expect(Math.min(Math.abs(e.origin!.x - 1024), Math.abs(e.origin!.x - 1408))).toBeLessThan(64);

    // Deleting a block rebuilds the dressing without it; one undo puts it all back.
    const count = groupDressing(ed.doc, group).length;
    deleteBlock(ed, b);
    expect(blocksInGroup(ed.doc, group)).toEqual([a]);
    expect(cables(ed)).toHaveLength(0);
    expect(groupDressing(ed.doc, group).length).toBeLessThan(count);
    ed.history.undo();
    expect(blocksInGroup(ed.doc, group)).toHaveLength(2);
    expect(groupDressing(ed.doc, group)).toHaveLength(count);
  });

  it('duplicates next to itself into the same group, and deletes with all its parts', () => {
    const ed = stubEditor();
    const [a] = generate(ed, [[0, 0, 1024, 768]]);
    const copy = duplicateBlock(ed, a)!;
    const s = blockOf(copy)!, o = blockOf(a)!;
    expect(s.uid).not.toBe(o.uid);
    expect(s.group).toBe(o.group);
    expect(s.rect.x0).toBe(o.rect.x1 + 256);
    expect(s.options).toEqual(o.options);
    expect(selectedBlocks(ed)).toEqual([copy]);
    // A street between the two now: cables and lamps.
    expect(groupDressing(ed.doc, o.group).length).toBeGreaterThan(0);

    const n = { world: ed.doc.worldEntity.solids.length, entities: ed.doc.entities.length };
    const m = blockMembers(ed.doc, s.uid);
    deleteBlock(ed, copy);
    expect(ed.doc.worldEntity.solids.length).toBe(n.world - m.world.length);
    expect(findHandle(ed.doc, BUILDING_HANDLE, s.uid)).toBeNull();
    expect(ed.doc.entities.some((e) => e.get('she_building_id') === s.uid)).toBe(false);
    ed.history.undo();
    expect(ed.doc.worldEntity.solids.length).toBe(n.world);
    expect(ed.doc.entities.length).toBe(n.entities);
  });

  it('acts for the whole block only when the selection is nothing but block handles', () => {
    const ed = stubEditor();
    const [a] = generate(ed, [[0, 0, 1024, 768]]);
    const h = handle(ed, a);
    ed.selection.set([], [h]);
    expect(selectedBlocks(ed)).toEqual([a]);
    ed.selection.set([], [h, blockMembers(ed.doc, blockOf(a)!.uid).entities[0]]);
    expect(selectedBlocks(ed)).toEqual([]);
  });

  it('never reaches a compiled map', () => {
    const ed = stubEditor();
    generate(ed, [[0, 0, 1024, 768], [1280, 0, 2304, 768]]);
    // A block too small to build on keeps its settings on an empty func_detail: also left out.
    applyBlock(ed, { uid: 'tiny01', group: 'tiny01', street: 'none', groupSeed: 1, rect: { x0: 4000, y0: 0, x1: 4064, y1: 64 }, z: 0, options: { ...OPTS, detail: 0 } }, 'tiny');
    const copy = VmfDocument.parse(ed.doc.serialize());
    expect(copy.entities.filter((e) => e.classname === BUILDING_HANDLE.classname)).toHaveLength(3);
    expect(stripHandles(copy)).toBe(3);
    const text = copy.serialize();
    expect(text).not.toContain(BUILDING_HANDLE.classname);
    expect(text).not.toContain('EDITOR/');
    expect(copy.entities.filter((e) => e.classname === 'func_detail' && !e.solids.length)).toHaveLength(0);
    // The blocks themselves stay.
    expect(copy.entities.filter((e) => blockOf(e)).length).toBeGreaterThanOrEqual(2);
  });

  it('Sketch and Generate map store their blocks too, one group per level', () => {
    for (const doc of [generateFromSketch(buildDistrictSketch()).doc, generateMap(randomLayout(16, 16, 'city', 7), { theme: 'city', seed: 7, highGround: 192 })]) {
      const blocks = doc.entities.filter((e) => blockOf(e));
      expect(blocks.length).toBeGreaterThan(3);
      for (const d of blocks) {
        const b = blockOf(d)!;
        // The stored footprint, the handle and the brushes are all where the map was centred to.
        expect(handleBox(findHandle(doc, BUILDING_HANDLE, b.uid)!)!.min.toArray().map((v) => v + 0)).toEqual([b.rect.x0, b.rect.y0, b.z]);
        const world = blockMembers(doc, b.uid).world;
        expect(d.get(BLOCK_WORLD_KEY) ?? '').toMatch(/^(\d+-\d+|\d+)?$/);
        for (const s of world) {
          const box = solidBounds(s);
          expect(box.min.x).toBeGreaterThanOrEqual(b.rect.x0 - 1);
          expect(box.max.x).toBeLessThanOrEqual(b.rect.x1 + 1);
        }
      }
      const groups = new Set(blocks.map((d) => blockOf(d)!.group));
      const dressing = doc.entities.filter((e) => e.get(GROUP_KEY));
      expect(dressing.length).toBeGreaterThan(0);
      expect(dressing.every((e) => groups.has(e.get(GROUP_KEY)!))).toBe(true);
    }
  });

  it('a sketched block rebuilds in the editor with its group', () => {
    const ed = stubEditor(generateFromSketch(buildDistrictSketch()).doc);
    const d = ed.doc.entities.find((e) => blockOf(e))!;
    const b = blockOf(d)!;
    const others = ed.doc.entities.filter((e) => e.get(GROUP_KEY) && e.get(GROUP_KEY) !== b.group);
    const before = parts(ed, d);
    regenerateBlock(ed, d, { options: { seed: 5 } });
    for (const s of before.world) expect(ed.doc.worldEntity.solids).not.toContain(s);
    expect(parts(ed, d).world.length).toBeGreaterThan(0);
    expect(groupDressing(ed.doc, b.group).length).toBeGreaterThan(0);
    // Other groups' dressing is left alone.
    for (const e of others) expect(ed.doc.entities).toContain(e);
  });
});
