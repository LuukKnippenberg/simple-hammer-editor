import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { KVNode } from '../src/vmf/keyvalues.ts';
import { MapSolid, parseVec, VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces, texelUV } from '../src/geom/brush.ts';
import { rotateSolid, solidBounds, translateSolid } from '../src/edit/brushes.ts';
import { buildPoi, newSpec, poiOf, poiType, sharedParams } from '../src/gen/poi/registry.ts';
import { decodePoi, encodePoi } from '../src/gen/poi/spec.ts';
import { applyPoi, handleDragged, poiMembers, regeneratePoi, turnPoi, turnPoiBy } from '../src/gen/poi/action.ts';
import { handleOf } from '../src/gen/poi/handle.ts';
import type { PoiSpec } from '../src/gen/poi/types.ts';
import { blockOf, blockMembers, decodeBlock, encodeBlock, generateBlock, groupStreet, type BlockSpec } from '../src/gen/buildingStore.ts';
import { applyBlock, blockHandleDragged, blockTurnedBy, turnBlockBy } from '../src/gen/buildingAction.ts';
import { BUILDING_HANDLE, findHandle } from '../src/gen/handle.ts';
import { insideTurned, normAngle, outsideTurned, splitAngle, turnedBounds, turnEntity, turnPoint } from '../src/gen/turn.ts';
import '../src/gen/poi/catalogue.ts';
import { stubEditor } from './stubEditor.ts';

const square = poiType('square')!;
const RECT = { x0: 0, y0: 0, x1: 1536, y1: 1024 };

/** Every brush's corners and the texture coordinates at them. */
function corners(nodes: KVNode[]): { verts: Vector3[]; uv: [number, number][] }[][] {
  return nodes.map((n) => buildBrushFaces(new MapSolid(n, null)).map((f) => ({ verts: f.verts, uv: f.verts.map((v) => texelUV(f.side, v)) })));
}

/** Checks that `turned` is `straight` turned `deg` about (cx, cy): same faces, corners turned, texture fixed to them. */
function expectRigid(straight: KVNode[], turned: KVNode[], cx: number, cy: number, deg: number): void {
  expect(turned.length).toBe(straight.length);
  const a = corners(straight), b = corners(turned);
  const t = { x: cx, y: cy, deg };
  a.forEach((faces, i) => {
    // Every side still makes a face: the brush is as valid as before.
    expect(b[i].length).toBe(faces.length);
    faces.forEach((f, j) => {
      const g = b[i][j];
      expect(g.verts.length).toBe(f.verts.length);
      f.verts.forEach((v, k) => {
        const [x, y] = turnPoint(t, v.x, v.y);
        // The turned face may start at another corner: find this one (corners are snapped to 1/100).
        const m = g.verts.findIndex((w) => Math.abs(w.x - x) + Math.abs(w.y - y) + Math.abs(w.z - v.z) < 0.05);
        expect(m, `corner ${v.toArray()} of brush ${i}`).toBeGreaterThanOrEqual(0);
        // Texture lock: the texture stays where it was on the brush (no smear, no slide).
        expect(Math.abs(g.uv[m][0] - f.uv[k][0]) + Math.abs(g.uv[m][1] - f.uv[k][1])).toBeLessThan(0.2);
      });
    });
  });
}

describe('angles', () => {
  it('split into the nearest quarter turn and the rest', () => {
    expect(splitAngle(0)).toEqual({ quarter: 0, fine: 0 });
    expect(splitAngle(30)).toEqual({ quarter: 0, fine: 30 });
    expect(splitAngle(60)).toEqual({ quarter: 90, fine: -30 });
    expect(splitAngle(45)).toEqual({ quarter: 90, fine: -45 });
    expect(splitAngle(-15)).toEqual({ quarter: 0, fine: -15 });
    expect(splitAngle(270)).toEqual({ quarter: 270, fine: 0 });
    expect(splitAngle(350.5)).toEqual({ quarter: 0, fine: -9.5 });
    expect(normAngle(-30)).toBe(330);
    expect(normAngle(720.04)).toBe(0);
  });

  it('turned rectangles: inside, distance outside, bounds', () => {
    const t = { x: 0, y: 0, deg: 45 };
    const r = { x0: -100, y0: -100, x1: 100, y1: 100 };
    expect(insideTurned(r, t, 0, 140)).toBe(true);
    expect(insideTurned(r, t, 100, 100)).toBe(false);
    expect(outsideTurned(r, t, 0, 100 * Math.SQRT2 + 10)).toBeCloseTo(10 / Math.SQRT2, 3);
    const b = turnedBounds(r, t);
    expect(b.x1).toBeCloseTo(100 * Math.SQRT2, 6);
  });

  it('entities turn their origin, yaw, full angles and overlay basis', () => {
    const t = { x: 100, y: 0, deg: 30 };
    const prop = turnEntity({ classname: 'prop_static', origin: new Vector3(200, 0, 8), keys: { angles: '0 350 0' } }, t);
    expect(prop.origin!.toArray()).toEqual([187, 50, 8]);
    expect(prop.keys.angles).toBe('0 20 0');
    const wreck = turnEntity({ classname: 'prop_static', origin: new Vector3(100, 0, 0), keys: { angles: '0 0 90' } }, t);
    expect(wreck.keys.angles).toBe('0 30 90');
    const ov = turnEntity({ classname: 'info_overlay', origin: new Vector3(100, 0, 0), keys: { BasisU: '1 0 0', BasisV: '0 1 0', BasisNormal: '0 0 1', BasisOrigin: '100 0 0' } }, t);
    expect(parseVec(ov.keys.BasisU).toArray().map((v) => Math.round(v * 1000) / 1000)).toEqual([0.866, 0.5, 0]);
    expect(ov.keys.BasisNormal).toBe('0 0 1');
  });
});

describe('POIs at any angle', () => {
  it('encode and decode any angle; old quarter turns still decode', () => {
    const spec = newSpec(square, RECT, 16, { seed: 5, rotation: 37.5 });
    const text = encodePoi(spec);
    expect(text.split('|')[4]).toBe('37.5');
    expect(decodePoi(text, square, sharedParams(square))!.rotation).toBe(37.5);
    expect(decodePoi('square|abc|5|0 0 1024 1024|90|0|city|', square)!.rotation).toBe(90);
    expect(decodePoi('square|abc|5|0 0 1024 1024|-30|0|city|', square)!.rotation).toBe(330);
    expect(decodePoi('square|abc|5|0 0 1024 1024|x|0|city|', square)).toBeNull();
  });

  for (const deg of [30, 45, -20]) {
    it(`a square at ${deg}° is the square at its quarter turn, turned rigidly`, () => {
      const base: PoiSpec = { ...newSpec(square, RECT, 16, { seed: 9, params: { level: false } }), uid: 'fixed' };
      const { quarter, fine } = splitAngle(deg);
      const straight = buildPoi(VmfDocument.empty(), { ...base, rotation: quarter });
      const turned = buildPoi(VmfDocument.empty(), { ...base, rotation: normAngle(deg) });
      expectRigid([...straight.world, ...straight.detail], [...turned.world, ...turned.detail], 768, 512, fine);
      // Props: the same models, turned round the centre, with the yaw turned as much.
      const props = (o: typeof straight) => o.entities.filter((e) => e.classname.startsWith('prop_'));
      expect(props(turned).length).toBe(props(straight).length);
      props(straight).forEach((p, i) => {
        const q = props(turned)[i];
        expect(q.keys.model).toBe(p.keys.model);
        const [x, y] = turnPoint({ x: 768, y: 512, deg: fine }, p.origin!.x, p.origin!.y);
        expect(Math.abs(q.origin!.x - x)).toBeLessThanOrEqual(1);
        expect(Math.abs(q.origin!.y - y)).toBeLessThanOrEqual(1);
        const yaw = (s: string) => Number(s.split(' ')[1]);
        expect(normAngle(yaw(q.keys.angles) - yaw(p.keys.angles) - fine)).toBeCloseTo(0, 1);
      });
    });
  }

  it('levels the terrain under the turned rectangle and samples the ground where things will stand', () => {
    const spec = { ...newSpec(square, RECT, 16, { seed: 2, rotation: 30 }), uid: 'g' };
    const seen: [number, number][] = [];
    const out = buildPoi(VmfDocument.empty(), spec, (x, y) => { seen.push([x, y]); return 16; });
    expect(out.terrain?.turn).toEqual({ x: 768, y: 512, deg: 30 });
    // Every sample lies inside the turned rectangle (give or take the edge).
    for (const [x, y] of seen) expect(outsideTurned(spec.rect, out.terrain!.turn!, x, y)).toBeLessThan(64);
    expect(seen.some(([x, y]) => !insideTurned(spec.rect, null, x, y))).toBe(true);
  });

  it('the handle is turned with the POI; moving, resizing and turning it rebuild exactly what the POI made', () => {
    const editor = stubEditor();
    const detail = applyPoi(editor, { ...newSpec(square, RECT, 0, { seed: 4, rotation: 30 }), uid: 'h1' }, 'gen');
    const handle = handleOf(editor.doc, 'h1')!;
    const faces = buildBrushFaces(handle.solids[0]);
    const top = faces.find((f) => f.plane.normal.z > 0.9)!;
    for (const v of top.verts) expect(outsideTurned(RECT, { x: 768, y: 512, deg: 30 }, v.x, v.y)).toBeLessThan(0.5);
    const box = solidBounds(handle.solids[0]);
    const bb = turnedBounds(RECT, { x: 768, y: 512, deg: 30 });
    expect(box.min.x).toBeCloseTo(bb.x0, 1);
    expect(box.max.y).toBeCloseTo(bb.y1, 1);
    const count = editor.doc.entities.length;

    // Move: the box round the turned handle moves; the POI keeps its angle and size.
    let end = editor.history.begin('Move', handle.solids, [handle]);
    translateSolid(handle.solids[0], new Vector3(256, 128, 0));
    editor.history.group('Move POI', () => { end(); handleDragged(editor, handle, 'translate'); });
    expect(poiOf(detail)!.spec.rect).toEqual({ x0: 256, y0: 128, x1: 1792, y1: 1152 });
    expect(poiOf(detail)!.spec.rotation).toBe(30);
    expect(editor.doc.entities.length).toBe(count);

    // The rotate gizmo: the handle turns while dragging, the POI is rebuilt at its new angle.
    end = editor.history.begin('Rotate', handle.solids, [handle]);
    rotateSolid(handle.solids[0], new Vector3(1024, 640, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 12));
    editor.history.group('Turn POI', () => { end(); turnPoiBy(editor, detail, 15); });
    expect(poiOf(detail)!.spec.rotation).toBe(45);
    // 45° rounds to the 90° quarter turn: the stored rectangle swaps sides round the same centre.
    expect(poiOf(detail)!.spec.rect).toEqual({ x0: 512, y0: -128, x1: 1536, y1: 1408 });
    expect(editor.doc.entities.length).toBe(count);

    // The quarter-turn keys still turn by 90°.
    turnPoi(editor, detail, 1);
    expect(poiOf(detail)!.spec.rotation).toBe(135);
    turnPoi(editor, detail, -1);
    turnPoi(editor, detail, -1);
    expect(poiOf(detail)!.spec.rotation).toBe(315);

    // Resize along the world axes: the POI grows along its own sides.
    const before = poiOf(detail)!.spec;
    const hb = solidBounds(handle.solids[0]);
    end = editor.history.begin('Resize', handle.solids, [handle]);
    const k = new Vector3(1.25, 1.25, 1);
    for (const side of handle.solids[0].sides) for (const p of side.plane) p.sub(hb.min).multiply(k).add(hb.min);
    handle.solids[0].commit();
    editor.history.group('Resize POI', () => { end(); handleDragged(editor, handle, 'scale'); });
    const after = poiOf(detail)!.spec;
    expect(after.rotation).toBe(315);
    expect(after.rect.x1 - after.rect.x0).toBeGreaterThan(before.rect.x1 - before.rect.x0);
    // Bigger, so more props: still nothing but the POI's own parts, its func_detail and its handle.
    expect(editor.doc.entities.length).toBe(poiMembers(editor, 'h1').entities.length + 2);

    // Undo goes all the way back to the first build.
    for (let i = 0; i < 6; i++) editor.history.undo();
    expect(poiOf(detail)!.spec.rotation).toBe(30);
    expect(poiOf(detail)!.spec.rect).toEqual(RECT);
  });

  it('typing an angle keeps the POI\'s centre and own size', () => {
    const editor = stubEditor();
    const detail = applyPoi(editor, { ...newSpec(square, RECT, 0, { seed: 4 }), uid: 'h2' }, 'gen');
    regeneratePoi(editor, detail, { rotation: 100 });
    expect(poiOf(detail)!.spec.rect).toEqual({ x0: 256, y0: -256, x1: 1280, y1: 1280 });
    regeneratePoi(editor, detail, { rotation: 20 });
    expect(poiOf(detail)!.spec.rect).toEqual(RECT);
    expect(poiMembers(editor, 'h2').entities.every((e) => e.get('she_poi_id') === 'h2')).toBe(true);
  });
});

describe('blocks of buildings at any angle', () => {
  const block = (angle = 0): BlockSpec => ({
    uid: 'b1', group: 'g1', street: 'flat', groupSeed: 5, rect: { x0: 0, y0: 0, x1: 1536, y1: 1152 }, z: 0, angle,
    options: { seed: 3, minFloors: 2, maxFloors: 4, alleys: false, roofProps: true, architecture: 'mixed', detail: 1 },
  });

  it('store the angle only when there is one', () => {
    expect(encodeBlock(block()).split('|')).toHaveLength(7);
    const text = encodeBlock(block(30));
    expect(text.split('|')[7]).toBe('30');
    expect(decodeBlock(text)!.angle).toBe(30);
    expect(decodeBlock(encodeBlock(block()))!.angle).toBeUndefined();
  });

  it('a block at 30° is the straight block turned rigidly, entities included', () => {
    const straight = generateBlock(VmfDocument.empty(), block());
    const turned = generateBlock(VmfDocument.empty(), block(30));
    expectRigid([...straight.solids, ...straight.detail], [...turned.solids, ...turned.detail], 768, 576, 30);
    expect(turned.entities.length).toBe(straight.entities.length);
    straight.entities.forEach((e, i) => {
      const [x, y] = turnPoint({ x: 768, y: 576, deg: 30 }, e.origin.x, e.origin.y);
      expect(Math.abs(turned.entities[i].origin.x - x)).toBeLessThanOrEqual(1);
      expect(Math.abs(turned.entities[i].origin.y - y)).toBeLessThanOrEqual(1);
    });
    // The street pass input stays in the block's own frame.
    expect(turned.dressing).toEqual(straight.dressing);
  });

  it('turning: a quarter turn swaps the footprint, the rest is the angle', () => {
    expect(blockTurnedBy(block(), 30)).toEqual({ rect: block().rect, angle: 30 });
    expect(blockTurnedBy(block(), 120)).toEqual({ rect: { x0: 192, y0: -192, x1: 1344, y1: 1344 }, angle: 30 });
    expect(blockTurnedBy(block(30), -60)).toEqual({ rect: block().rect, angle: 330 });
    expect(blockTurnedBy(block(30), -30).angle).toBe(0);
  });

  it('street dressing of a turned block stands round it, turned with it', () => {
    const b = block(30);
    const lamps = groupStreet([b]).filter((e) => /lamppost/.test(e.keys.model ?? ''));
    const straight = groupStreet([block()]).filter((e) => /lamppost/.test(e.keys.model ?? ''));
    expect(lamps.length).toBeGreaterThan(0);
    const t = { x: 768, y: 576, deg: 30 };
    for (const l of lamps) expect(outsideTurned(b.rect, t, l.origin.x, l.origin.y)).toBeLessThan(400);
    // Not the straight block's lamps left where they were.
    expect(lamps.map((l) => l.origin.toArray().join())).not.toEqual(straight.map((l) => l.origin.toArray().join()));
  });

  it('the handle turns with the block; moving it and the angle field rebuild exactly the block', () => {
    const editor = stubEditor();
    const { detail } = applyBlock(editor, block(30), 'gen');
    const handle = findHandle(editor.doc, BUILDING_HANDLE, 'b1')!;
    const box = solidBounds(handle.solids[0]);
    expect(box.max.x - box.min.x).toBeCloseTo(turnedBounds(block().rect, { x: 768, y: 576, deg: 30 }, 16).x1 - turnedBounds(block().rect, { x: 768, y: 576, deg: 30 }, 16).x0, 1);
    const count = () => editor.doc.entities.length + editor.doc.worldEntity.solids.length;
    const n = count();
    const end = editor.history.begin('Move', handle.solids, [handle]);
    translateSolid(handle.solids[0], new Vector3(512, 0, 0));
    editor.history.group('Move buildings', () => { end(); blockHandleDragged(editor, handle, 'translate'); });
    expect(blockOf(detail)!.rect).toEqual({ x0: 512, y0: 0, x1: 2048, y1: 1152 });
    expect(blockOf(detail)!.angle).toBe(30);
    expect(count()).toBe(n);
    // 45° is the 90° quarter turn less 45°: the footprint swaps sides round its centre.
    turnBlockBy(editor, detail, 15);
    expect(blockOf(detail)!.angle).toBe(315);
    expect(blockOf(detail)!.rect).toEqual({ x0: 704, y0: -192, x1: 1856, y1: 1344 });
    expect(blockMembers(editor.doc, 'b1').world.length).toBeGreaterThan(0);
    expect(count()).toBe(n);
  });
});
