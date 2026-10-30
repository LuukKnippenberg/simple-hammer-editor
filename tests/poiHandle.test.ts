import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { VmfDocument, type MapEntity, type MapSolid } from '../src/vmf/map.ts';
import { History } from '../src/edit/history.ts';
import { remapSolid, solidBounds, translateSolid } from '../src/edit/brushes.ts';
import type { Editor } from '../src/editor.ts';
import { newSpec, poiOf, poiType } from '../src/gen/poi/registry.ts';
import { applyPoi, deletePoi, duplicatePoi, handleDragged, poiMembers, regeneratePoi, selectedPois, turnPoi } from '../src/gen/poi/action.ts';
import { HANDLE_CLASS, HANDLE_HEIGHT, handleOf, stripHandles } from '../src/gen/poi/handle.ts';
import { addPoiToDoc } from '../src/gen/poi/mapgen.ts';
import '../src/gen/poi/catalogue.ts';

/** Enough of an Editor for POI actions, with a selection that remembers what was selected. */
function stubEditor(): Editor & { picked: () => MapEntity[] } {
  const doc = VmfDocument.empty();
  const selection = {
    solids: new Set<MapSolid>(), entities: new Set<MapEntity>(),
    set(s: MapSolid[], e: MapEntity[]) { this.solids = new Set(s); this.entities = new Set(e); },
    clear() { this.solids.clear(); this.entities.clear(); },
  };
  return {
    doc, history: new History(() => doc), changed() {}, emit() {}, selection,
    world: { raycast: () => null, visibleKinds: { handle: true } },
    picked: () => [...selection.entities],
  } as unknown as Editor & { picked: () => MapEntity[] };
}

const square = poiType('square')!;
const box = (h: MapEntity) => solidBounds(h.solids[0]);

describe('POI handles', () => {
  it('every POI gets one handle over its rectangle, kept through rebuilds and removed with the POI', () => {
    const ed = stubEditor();
    const spec = newSpec(square, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, 32, { seed: 3 });
    const detail = applyPoi(ed, spec, 'gen');
    const handle = handleOf(ed.doc, spec.uid)!;
    expect(ed.doc.entities.filter((e) => e.classname === HANDLE_CLASS)).toHaveLength(1);
    expect(box(handle).min.toArray()).toEqual([0, 0, 32]);
    expect(box(handle).max.toArray()).toEqual([1024, 1024, 32 + HANDLE_HEIGHT]);
    // The handle is not one of the parts a rebuild replaces.
    expect(poiMembers(ed, spec.uid).entities).not.toContain(handle);
    regeneratePoi(ed, detail, { rect: { x0: 256, y0: 0, x1: 1280, y1: 1024 } });
    expect(handleOf(ed.doc, spec.uid)).toBe(handle);
    expect(box(handle).min.x).toBe(256);
    expect(ed.picked()).toEqual([handle]);
    deletePoi(ed, detail);
    expect(ed.doc.entities).toHaveLength(0);
    ed.history.undo();
    expect(handleOf(ed.doc, spec.uid)).not.toBeNull();
  });

  it('moving the handle moves the POI, and one undo puts both back', () => {
    const ed = stubEditor();
    const spec = newSpec(square, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, 0, { seed: 3 });
    const detail = applyPoi(ed, spec, 'gen');
    const handle = handleOf(ed.doc, spec.uid)!;
    const props = () => ed.doc.entities.filter((e) => e.classname === 'prop_static' && poiMembers(ed, spec.uid).entities.includes(e)).map((e) => e.origin!.x).sort((a, b) => a - b);
    const before = props();
    // What the Select tool does: the drag is recorded, then the rebuild joins it in one step.
    const end = ed.history.begin('Move', handle.solids, [handle]);
    translateSolid(handle.solids[0], new Vector3(512, 256, 0));
    ed.history.group('Move POI', () => { end(); handleDragged(ed, handle, 'translate'); });
    expect(poiOf(detail)!.spec.rect).toEqual({ x0: 512, y0: 256, x1: 1536, y1: 1280 });
    expect(props().map((x) => x - 512)).toEqual(before);
    expect(box(handle).min.toArray()).toEqual([512, 256, 0]);
    ed.history.undo();
    expect(poiOf(detail)!.spec.rect).toEqual({ x0: 0, y0: 0, x1: 1024, y1: 1024 });
    expect(box(handle).min.toArray()).toEqual([0, 0, 0]);
    expect(props()).toEqual(before);
  });

  it('resizing the handle resizes the POI within its type\'s sizes', () => {
    const ed = stubEditor();
    const spec = newSpec(square, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, 0, { seed: 3 });
    const detail = applyPoi(ed, spec, 'gen');
    const handle = handleOf(ed.doc, spec.uid)!;
    remapSolid(handle.solids[0], box(handle), new Box3(new Vector3(-256, 0, 0), new Vector3(1536, 1024, 200)));
    handleDragged(ed, handle, 'scale');
    expect(poiOf(detail)!.spec.rect).toEqual({ x0: -256, y0: 0, x1: 1536, y1: 1024 });
    expect(poiOf(detail)!.spec.z).toBe(0);
    expect(box(handle).max.z).toBe(HANDLE_HEIGHT);
    // Far bigger than a square may be: clamped to the largest.
    remapSolid(handle.solids[0], box(handle), new Box3(new Vector3(-20000, 0, 0), new Vector3(20000, 1024, 64)));
    handleDragged(ed, handle, 'scale');
    const r = poiOf(detail)!.spec.rect;
    expect(r.x1 - r.x0).toBe(square.maxSize[0]);
  });

  it('turns a quarter turn around its centre and duplicates next to itself', () => {
    const ed = stubEditor();
    const spec = newSpec(square, { x0: 0, y0: 0, x1: 1536, y1: 1024 }, 0, { seed: 3 });
    const detail = applyPoi(ed, spec, 'gen');
    turnPoi(ed, detail, 1);
    const t = poiOf(detail)!.spec;
    expect(t.rotation).toBe(90);
    expect([t.rect.x1 - t.rect.x0, t.rect.y1 - t.rect.y0]).toEqual([1024, 1536]);
    expect([(t.rect.x0 + t.rect.x1) / 2, (t.rect.y0 + t.rect.y1) / 2]).toEqual([768, 512]);
    const copy = duplicatePoi(ed, detail)!;
    const c = poiOf(copy)!.spec;
    expect(c.uid).not.toBe(t.uid);
    expect(c.rect.x0).toBe(t.rect.x1 + 128);
    expect([c.seed, c.rotation]).toEqual([t.seed, t.rotation]);
    expect(ed.doc.entities.filter((e) => e.classname === HANDLE_CLASS)).toHaveLength(2);
    expect(ed.picked()).toEqual([handleOf(ed.doc, c.uid)]);
  });

  it('acts for the whole POI only when the selection is nothing but handles', () => {
    const ed = stubEditor();
    const spec = newSpec(square, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, 0, { seed: 3 });
    const detail = applyPoi(ed, spec, 'gen');
    const handle = handleOf(ed.doc, spec.uid)!;
    ed.selection.set([], [handle]);
    expect(selectedPois(ed)).toEqual([detail]);
    ed.selection.set([], [handle, poiMembers(ed, spec.uid).entities[0]]);
    expect(selectedPois(ed)).toEqual([]);
  });

  it('never reaches a compiled map; generated maps get handles too', () => {
    const doc = VmfDocument.empty();
    const spec = newSpec(square, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, 0, { seed: 3 });
    addPoiToDoc(doc, spec, () => 0);
    const parsed = VmfDocument.parse(doc.serialize());
    expect(handleOf(parsed, spec.uid)).not.toBeNull();
    const others = parsed.entities.length - 1;
    expect(stripHandles(parsed)).toBe(1);
    expect(parsed.entities).toHaveLength(others);
    expect(parsed.serialize()).not.toContain(HANDLE_CLASS);
  });
});
