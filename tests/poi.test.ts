import { describe, expect, it } from 'vitest';
import { MapSolid, VmfDocument } from '../src/vmf/map.ts';
import { History } from '../src/edit/history.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { writeKeyValues, type KVNode } from '../src/vmf/keyvalues.ts';
import type { Editor } from '../src/editor.ts';
import { POI_TYPES, buildPoi, defaultParams, newSpec, poiOf, registerPoi, sharedParams } from '../src/gen/poi/registry.ts';
import { applyPoi, deletePoi, poiMembers, regeneratePoi } from '../src/gen/poi/action.ts';
import { decodePoi, encodePoi } from '../src/gen/poi/spec.ts';
import { modelInfo } from '../src/gen/poi/models.ts';
import { modelFootprint, overlaps, rect, walkable } from '../src/gen/poi/kit.ts';
import type { PoiOutput, PoiSpec, PoiType, Rotation } from '../src/gen/poi/types.ts';
import '../src/gen/poi/catalogue.ts';

/** Just enough of an Editor for POI actions: a document, history, no world to ray-cast against. */
function stubEditor(): Editor {
  const doc = VmfDocument.empty();
  return {
    doc, history: new History(() => doc), changed() {}, emit() {},
    selection: { set() {}, clear() {} },
    world: { raycast: () => null },
  } as unknown as Editor;
}

const DUMMY: PoiType = {
  id: 'test_dummy', label: 'Dummy', icon: '?', hint: '', landscapes: ['city'],
  minSize: [256, 256], maxSize: [2048, 2048], defaultSize: [512, 512],
  params: [{ key: 'crates', label: 'Crates', type: 'number', default: 4 }, { key: 'wall', label: 'Wall', type: 'check', default: true }],
  gameplay: { capture: true, scrap: true },
  build(k) {
    k.pad(k.bounds, 'CONCRETE/CONCRETEFLOOR050A');
    k.crossRoute('x');
    if (k.flag('wall')) k.perimeter('wall', 16, { fow: true });
    k.scatter(['props_junk/wood_crate001a_static'], k.bounds, k.num('crates'));
    k.box(rect(0, 0, 32, 32), -64, 0, 'TOOLS/TOOLSNODRAW', { world: true });
    k.gameplay(k.centre);
  },
};
registerPoi(DUMMY);

const valid = (n: KVNode) => {
  const s = new MapSolid(n, null);
  return s.sides.length >= 4 && buildBrushFaces(s).length === s.sides.length;
};

const sig = (o: PoiOutput) => JSON.stringify({
  d: o.detail.map((n) => writeKeyValues([n], '\n')), w: o.world.map((n) => writeKeyValues([n], '\n')),
  e: o.entities.map((e) => [e.classname, e.origin?.toArray(), e.keys, e.solids?.map((n) => writeKeyValues([n], '\n'))]),
});

const specFor = (t: PoiType, seed: number, rotation: Rotation = 0): PoiSpec => {
  const [w, d] = rotation % 180 ? [t.defaultSize[1], t.defaultSize[0]] : t.defaultSize;
  return newSpec(t, { x0: 1024, y0: -512, x1: 1024 + w, y1: -512 + d }, 64, { seed, rotation });
};

describe('POI framework', () => {
  it('stores its spec on the func_detail and reads it back with typed parameters', () => {
    const spec = newSpec(DUMMY, { x0: 0, y0: 0, x1: 700, y1: 300 }, 32, { seed: 42, rotation: 90, params: { crates: 7, wall: false } });
    const back = decodePoi(encodePoi(spec), DUMMY, sharedParams(DUMMY));
    expect(back).toEqual({ ...spec, params: { ...spec.params } });
    expect(back!.params.crates).toBe(7);
    expect(back!.params.wall).toBe(false);
    // Snapped to 64 and clamped to the type's sizes (turned: local width runs along world y).
    expect(spec.rect.x1 - spec.rect.x0).toBe(704);
    expect(spec.rect.y1 - spec.rect.y0).toBe(320);
  });

  it('rebuilds in place: the same parts again, nothing left over, undo brings the old ones back', () => {
    const ed = stubEditor();
    const spec = newSpec(DUMMY, { x0: 0, y0: 0, x1: 1024, y1: 768 }, 0, { seed: 5, params: { capture: true, scrap: 2 } });
    const detail = applyPoi(ed, spec, 'gen');
    const count = () => {
      const m = poiMembers(ed, spec.uid);
      return { ents: ed.doc.entities.length, world: ed.doc.worldEntity.solids.length, members: m.entities.length, detail: m.detail?.solids.length ?? 0 };
    };
    const first = count();
    expect(first.members).toBeGreaterThan(5);
    expect(first.world).toBe(1);
    expect(ed.doc.entities.filter((e) => e.classname === 'control_point')).toHaveLength(1);
    expect(ed.doc.entities.filter((e) => e.classname === 'fow_blocker').length).toBeGreaterThan(0);
    regeneratePoi(ed, detail);
    expect(count()).toEqual(first);
    regeneratePoi(ed, detail, { seed: 99 });
    expect(count().world).toBe(1);
    expect(count().ents).toBe(ed.doc.entities.length);
    expect(poiOf(detail)!.spec.seed).toBe(99);
    // Fewer crates, no wall: the extra parts go.
    regeneratePoi(ed, detail, { params: { wall: false, crates: 0 } });
    expect(ed.doc.entities.filter((e) => e.classname === 'fow_blocker')).toHaveLength(0);
    expect(ed.doc.entities.filter((e) => e.get('model')?.includes('wood_crate'))).toHaveLength(0);
    ed.history.undo();
    expect(ed.doc.entities.filter((e) => e.classname === 'fow_blocker').length).toBeGreaterThan(0);
    expect(poiOf(detail)!.spec.params.wall).toBe(true);
    deletePoi(ed, detail);
    expect(ed.doc.entities).toHaveLength(0);
    expect(ed.doc.worldEntity.solids).toHaveLength(0);
    ed.history.undo();
    expect(ed.doc.entities.length).toBeGreaterThan(5);
  });

  for (const t of POI_TYPES) {
    it(`${t.label}: valid brushes, measured props off the routes, same output for the same seed`, () => {
      for (const [seed, rot] of [[1, 0], [2, 90], [3, 180], [4, 270]] as [number, Rotation][]) {
        const spec = specFor(t, seed, rot);
        spec.params = { ...defaultParams(t), capture: true, scrap: 2 };
        const out = buildPoi(VmfDocument.empty(), spec);
        for (const n of [...out.detail, ...out.world]) expect(valid(n)).toBe(true);
        expect(out.routes.length).toBeGreaterThan(0);
        for (const r of out.routes) expect(Math.min(r.x1 - r.x0, r.y1 - r.y0)).toBeGreaterThanOrEqual(128);
        const routes = out.routes.map((r) => rect(r.x0 + 4, r.y0 + 4, r.x1 - 4, r.y1 - 4));
        for (const e of out.entities) {
          if (!e.classname.startsWith('prop_') || !e.origin) continue;
          const model = e.keys.model.replace(/^models\//, '').replace(/\.mdl$/, '');
          expect(modelInfo(model), `${model} is in the model table`).not.toBeNull();
          const fp = modelFootprint(model, e.origin.x, e.origin.y, Number(e.keys.angles.split(' ')[1]));
          if (walkable(model)) continue;
          for (const r of routes) expect(overlaps(fp, r), `${model} at ${e.origin.toArray()} on route`).toBe(false);
        }
        expect(sig(buildPoi(VmfDocument.empty(), spec))).toBe(sig(out));
      }
    });
  }
});
