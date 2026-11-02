import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { VmfDocument, type MapEntity } from '../src/vmf/map.ts';
import { remapSolid, solidBounds, translateSolid } from '../src/edit/brushes.ts';
import type { Editor } from '../src/editor.ts';
import { newSpec, poiOf, poiType } from '../src/gen/poi/registry.ts';
import { applyPoi, deletePoi, duplicatePoi, handleDragged, poiMembers, regeneratePoi, selectedPois, turnPoi } from '../src/gen/poi/action.ts';
import { HANDLE_CLASS, HANDLE_HEIGHT, handleOf, stripHandles } from '../src/gen/poi/handle.ts';
import { addPoiToDoc } from '../src/gen/poi/mapgen.ts';
import '../src/gen/poi/catalogue.ts';
import { stubEditor } from './stubEditor.ts';

/** What is selected (entities). */
const picked = (editor: Editor) => [...editor.selection.entities];

const square = poiType('square')!;
const box = (handleEntity: MapEntity) => solidBounds(handleEntity.solids[0]);

describe('POI handles', () => {
  it('every POI gets one handle over its rectangle, kept through rebuilds and removed with the POI', () => {
    const editor = stubEditor();
    const spec = newSpec(square, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, 32, { seed: 3 });
    const detail = applyPoi(editor, spec, 'gen');
    const handle = handleOf(editor.doc, spec.uid)!;
    expect(editor.doc.entities.filter((e) => e.classname === HANDLE_CLASS)).toHaveLength(1);
    expect(box(handle).min.toArray()).toEqual([0, 0, 32]);
    expect(box(handle).max.toArray()).toEqual([1024, 1024, 32 + HANDLE_HEIGHT]);
    // The handle is not one of the parts a rebuild replaces.
    expect(poiMembers(editor, spec.uid).entities).not.toContain(handle);
    regeneratePoi(editor, detail, { rect: { x0: 256, y0: 0, x1: 1280, y1: 1024 } });
    expect(handleOf(editor.doc, spec.uid)).toBe(handle);
    expect(box(handle).min.x).toBe(256);
    expect(picked(editor)).toEqual([handle]);
    deletePoi(editor, detail);
    expect(editor.doc.entities).toHaveLength(0);
    editor.history.undo();
    expect(handleOf(editor.doc, spec.uid)).not.toBeNull();
  });

  it('moving the handle moves the POI, and one undo puts both back', () => {
    const editor = stubEditor();
    const spec = newSpec(square, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, 0, { seed: 3 });
    const detail = applyPoi(editor, spec, 'gen');
    const handle = handleOf(editor.doc, spec.uid)!;
    const props = () => editor.doc.entities.filter((e) => e.classname === 'prop_static' && poiMembers(editor, spec.uid).entities.includes(e)).map((e) => e.origin!.x).sort((a, b) => a - b);
    const before = props();
    // What the Select tool does: the drag is recorded, then the rebuild joins it in one step.
    const end = editor.history.begin('Move', handle.solids, [handle]);
    translateSolid(handle.solids[0], new Vector3(512, 256, 0));
    editor.history.group('Move POI', () => { end(); handleDragged(editor, handle, 'translate'); });
    expect(poiOf(detail)!.spec.rect).toEqual({ x0: 512, y0: 256, x1: 1536, y1: 1280 });
    expect(props().map((x) => x - 512)).toEqual(before);
    expect(box(handle).min.toArray()).toEqual([512, 256, 0]);
    editor.history.undo();
    expect(poiOf(detail)!.spec.rect).toEqual({ x0: 0, y0: 0, x1: 1024, y1: 1024 });
    expect(box(handle).min.toArray()).toEqual([0, 0, 0]);
    expect(props()).toEqual(before);
  });

  it('resizing the handle resizes the POI within its type\'s sizes', () => {
    const editor = stubEditor();
    const spec = newSpec(square, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, 0, { seed: 3 });
    const detail = applyPoi(editor, spec, 'gen');
    const handle = handleOf(editor.doc, spec.uid)!;
    remapSolid(handle.solids[0], box(handle), new Box3(new Vector3(-256, 0, 0), new Vector3(1536, 1024, 200)));
    handleDragged(editor, handle, 'scale');
    expect(poiOf(detail)!.spec.rect).toEqual({ x0: -256, y0: 0, x1: 1536, y1: 1024 });
    expect(poiOf(detail)!.spec.z).toBe(0);
    expect(box(handle).max.z).toBe(HANDLE_HEIGHT);
    // Far bigger than a square may be: clamped to the largest.
    remapSolid(handle.solids[0], box(handle), new Box3(new Vector3(-20000, 0, 0), new Vector3(20000, 1024, 64)));
    handleDragged(editor, handle, 'scale');
    const rect = poiOf(detail)!.spec.rect;
    expect(rect.x1 - rect.x0).toBe(square.maxSize[0]);
  });

  it('turns a quarter turn around its centre and duplicates next to itself', () => {
    const editor = stubEditor();
    const spec = newSpec(square, { x0: 0, y0: 0, x1: 1536, y1: 1024 }, 0, { seed: 3 });
    const detail = applyPoi(editor, spec, 'gen');
    turnPoi(editor, detail, 1);
    const turned = poiOf(detail)!.spec;
    expect(turned.rotation).toBe(90);
    expect([turned.rect.x1 - turned.rect.x0, turned.rect.y1 - turned.rect.y0]).toEqual([1024, 1536]);
    expect([(turned.rect.x0 + turned.rect.x1) / 2, (turned.rect.y0 + turned.rect.y1) / 2]).toEqual([768, 512]);
    const copy = duplicatePoi(editor, detail)!;
    const copied = poiOf(copy)!.spec;
    expect(copied.uid).not.toBe(turned.uid);
    expect(copied.rect.x0).toBe(turned.rect.x1 + 128);
    expect([copied.seed, copied.rotation]).toEqual([turned.seed, turned.rotation]);
    expect(editor.doc.entities.filter((e) => e.classname === HANDLE_CLASS)).toHaveLength(2);
    expect(picked(editor)).toEqual([handleOf(editor.doc, copied.uid)]);
  });

  it('acts for the whole POI only when the selection is nothing but handles', () => {
    const editor = stubEditor();
    const spec = newSpec(square, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, 0, { seed: 3 });
    const detail = applyPoi(editor, spec, 'gen');
    const handle = handleOf(editor.doc, spec.uid)!;
    editor.selection.set([], [handle]);
    expect(selectedPois(editor)).toEqual([detail]);
    editor.selection.set([], [handle, poiMembers(editor, spec.uid).entities[0]]);
    expect(selectedPois(editor)).toEqual([]);
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
