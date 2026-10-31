import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { MapSolid } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { buildRoads, cornerFillets, decodeRoad, defaultRoad, encodeRoad, type RoadSpec } from '../src/gen/roads.ts';
import { CARRIAGEWAYS, GUTTERS, KERBS, PAVEMENTS, STREET_PRESETS } from '../src/gen/streetMaterials.ts';
import { emptySketch, generateFromSketch, Surface } from '../src/gen/sketch.ts';
import { boxPairs, intersection, scanBrushes, type ScanBrush } from './overlaps.ts';

const road = (ax: number, ay: number, bx: number, by: number, materials?: RoadSpec['materials']): RoadSpec =>
  ({ ...defaultRoad('asphalt', [new Vector3(ax, ay, 0), new Vector3(bx, by, 0)]), width: 256, pavement: 96, radius: 0, materials });
/** Two convex brushes that only touch share a face: one's face plane, flipped, is the other's. */
const sharesOnlyAFace = (a: ScanBrush, b: ScanBrush) => a.faces.some((f) => b.faces.some((g) => f.plane.normal.dot(g.plane.normal) < -0.9999 && Math.abs(f.plane.dist + g.plane.dist) < 0.5));
const tops = (nodes: ReturnType<typeof buildRoads>[number]) => nodes.flatMap((n) => buildBrushFaces(new MapSolid(n, null)).filter((f) => f.plane.normal.z > 0.9).map((f) => f.side.material));

describe('street materials', () => {
  it('has a real material for every choice', () => {
    for (const list of [CARRIAGEWAYS, PAVEMENTS, KERBS]) for (const m of list) expect(m.material).toMatch(/^[A-Z_]+\/[A-Z0-9_]+$/);
    expect(GUTTERS[0].material).toBe('');
    for (const p of STREET_PRESETS) for (const id of [p.materials.carriageway, p.materials.pavement].filter(Boolean)) {
      expect([...CARRIAGEWAYS, ...PAVEMENTS].some((m) => m.id === id)).toBe(true);
    }
  });

  it("keeps a road's materials when it is stored and read back", () => {
    const r = road(0, 0, 1024, 0, { carriageway: 'setts', pavement: 'slabs', kerb: 'stone', gutter: 'cobbles', gutterWidth: 40, corner: 96 });
    expect(decodeRoad(encodeRoad(r))!.materials).toEqual(r.materials);
    // A road stored before materials existed still reads.
    expect(decodeRoad(encodeRoad(road(0, 0, 512, 0)))!.materials).toBeUndefined();
  });

  it('builds the carriageway, gutter, kerb and pavement in their materials', () => {
    const [nodes] = buildRoads(VmfDocument.empty(), [road(0, 0, 1024, 0, { carriageway: 'setts', pavement: 'slabs', kerb: 'stone', gutter: 'cobbles' })]);
    const t = tops(nodes);
    expect(t).toContain('STONE/STONEFLOOR006B');
    expect(t).toContain('STONE/STONEFLOOR006A');
    expect(t).toContain('CONCRETE/CONCRETEFLOOR028C');
    expect(t).toContain('STONE/STONEWALL017A');
    // Without choices the style's look stays.
    expect(tops(buildRoads(VmfDocument.empty(), [road(0, 0, 1024, 0)])[0])).toContain('CONCRETE/CONCRETEFLOOR028A');
  });

  it('rounds the kerbs at a crossing, without overlaps', () => {
    const roads = [road(-1024, 0, 1024, 0, { corner: 96 }), road(0, -1024, 0, 1024)];
    const fillets = cornerFillets(roads);
    expect(fillets).toHaveLength(4);
    const all = buildRoads(VmfDocument.empty(), roads).flat();
    // Brushes only touch (their bounding boxes overlap round the arcs, their volumes don't).
    const real = boxPairs(scanBrushes(all), 1).filter(([a, b]) => intersection(a, b, 1) && !sharesOnlyAFace(a, b));
    expect(real.length).toBe(0);
    // A T-junction (the side street ends at the main road's centre) has two corners.
    expect(cornerFillets([road(-1024, 0, 1024, 0, { corner: 96 }), road(0, 0, 0, 1024)])).toHaveLength(2);
    // The sketch's pieces: two pieces of the side street end a cell into the crossing, one from each side.
    expect(cornerFillets([road(-1024, 0, 1024, 0, { corner: 96 }), road(0, -1024, 0, -16), road(0, 1024, 0, 16)])).toHaveLength(4);
    // Square corners when no road asks for round ones.
    expect(cornerFillets([road(-1024, 0, 1024, 0), road(0, -1024, 0, 1024)])).toHaveLength(0);
  });

  it("gives the sketch's streets the chosen look", () => {
    const s = emptySketch(20, 16, 'city');
    for (let y = 0; y < 16; y++) for (let x = 8; x < 12; x++) s.surface[y * 20 + x] = Surface.Road;
    for (let x = 0; x < 20; x++) for (let y = 6; y < 10; y++) s.surface[y * 20 + x] = Surface.Road;
    s.streetMaterials = STREET_PRESETS.find((p) => p.id === 'old_town')!.materials;
    const r = generateFromSketch(s);
    const mats = new Set(r.doc.allSolids().flatMap((q) => q.sides.map((side) => side.material)));
    expect(mats.has('STONE/STONEFLOOR006B')).toBe(true);
    expect(mats.has('CONCRETE/CONCRETEFLOOR028C')).toBe(true);
  });
});
