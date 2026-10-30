import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { ARCHITECTURES, FACADE_STYLES, generateBuildings, type ArchitectureName } from '../src/gen/buildings.ts';
import { MapSolid, VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import type { KVNode } from '../src/vmf/keyvalues.ts';

const block = new Box3(new Vector3(0, 0, 0), new Vector3(1280, 1152, 0));
const gen = (architecture: ArchitectureName, seed = 9) => {
  const doc = VmfDocument.empty();
  const a = ARCHITECTURES[architecture];
  return generateBuildings(doc, block, { seed, minFloors: a.floors[0], maxFloors: a.floors[1], alleys: false, roofProps: true, architecture, detail: 2 });
};
const mats = (nodes: KVNode[]) => new Set(nodes.flatMap((n) => new MapSolid(n, null).sides.map((s) => s.material)));

describe('architectures', () => {
  it('every architecture builds valid brushes', () => {
    for (const name of Object.keys(ARCHITECTURES) as ArchitectureName[]) {
      const r = gen(name);
      expect(r.buildings).toBeGreaterThan(0);
      for (const n of [...r.solids, ...r.detail]) {
        const s = new MapSolid(n, null);
        expect(buildBrushFaces(s).length).toBe(s.sides.length);
      }
    }
  });

  it('soviet blocks are flat-roofed concrete without towers or oriels', () => {
    const r = gen('soviet');
    const all = mats([...r.solids, ...r.detail]);
    for (const roof of ['TILE/TILEROOF004A', 'METAL/METALROOF003A', 'WOOD/WOODSHINGLES002A']) expect(all.has(roof)).toBe(false);
    const allowed = new Set(['soviet', 'stone', 'pale'].flatMap((k) => {
      const s = FACADE_STYLES[k as keyof typeof FACADE_STYLES];
      return [...s.windows, ...s.ground].map((t) => t.material);
    }));
    const windowMats = [...mats(r.solids)].filter((m) => m.startsWith('BUILDING_TEMPLATE/') || m.startsWith('COURTYARD'));
    for (const m of windowMats) expect(allowed.has(m) || m.endsWith('002E') || m.endsWith('002F')).toBe(true);
  });

  it('the same seed gives the same buildings; weathering adds stains', () => {
    const a = gen('tenement', 4), b = gen('tenement', 4);
    const text = (r: ReturnType<typeof gen>) => [...r.solids, ...r.detail].map((n) => new MapSolid(n, null).sides.map((s) => s.node.get('plane')).join()).join('|');
    expect(text(a)).toBe(text(b));
    const stains = (r: ReturnType<typeof gen>) => r.entities.filter((e) => /stain/.test(e.keys.texture ?? '')).length;
    expect(stains(a)).toBeGreaterThan(0);
    const clean = generateBuildings(VmfDocument.empty(), block, { seed: 4, minFloors: 3, maxFloors: 6, alleys: false, roofProps: true, architecture: 'tenement', weathering: 0 });
    expect(stains(clean)).toBe(0);
  });
});
