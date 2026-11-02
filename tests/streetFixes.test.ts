import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument, MapSolid } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { buildRoads, defaultRoad, roadGround, roadOf, type RoadSpec } from '../src/gen/roads.ts';
import { emptySketch, generateFromSketch, sketchPoiPlacements, Surface } from '../src/gen/sketch.ts';
import { railwayWidth, shapeRoads } from '../src/gen/sketchShapes.ts';
import { buildPoi, newSpec, poiType } from '../src/gen/poi/registry.ts';
import { applyRooms } from '../src/gen/rooms/action.ts';
import { STATION_TRACKS, stationSpec } from '../src/examples/gardenDistrict.ts';
import '../src/gen/poi/catalogue.ts';
import { stubEditor } from './stubEditor.ts';

const road = (ax: number, ay: number, bx: number, by: number, materials?: RoadSpec['materials']): RoadSpec =>
  ({ ...defaultRoad('asphalt', [new Vector3(ax, ay, 0), new Vector3(bx, by, 0)]), width: 256, pavement: 96, radius: 0, materials });

/** The top faces of a road's brushes with their texture axes. */
function tops(nodes: ReturnType<typeof buildRoads>[number]) {
  return nodes.flatMap((n) => buildBrushFaces(new MapSolid(n, null)).filter((f) => f.plane.normal.z > 0.9).map((f) => {
    const parse = (s: string) => { const m = s.match(/\[([^\]]+)\]\s*([-\d.e]+)/)!; const [x, y, z, shift] = m[1].trim().split(/\s+/).map(Number); return { axis: new Vector3(x, y, z), shift, scale: Number(m[2]) }; };
    return { material: f.side.material, u: parse(f.side.node.get('uaxis')!), v: parse(f.side.node.get('vaxis')!), y: Math.min(...f.verts.map((p) => p.y)), Y: Math.max(...f.verts.map((p) => p.y)) };
  }));
}
/** Texture coordinate of a world point on an axis, in texels, wrapped into one tile. */
const texel = (a: { axis: Vector3; shift: number; scale: number }, p: Vector3, w: number) => ((((p.dot(a.axis) / a.scale + a.shift) % w) + w) % w);

describe('street fixes', () => {
  it('lines the pavement slabs and the gutter setts up with the street', () => {
    for (const [ax, ay, bx, by] of [[0, 0, 1024, 0], [0, 0, 0, 1024], [0, 0, 724, 724]]) {
      const [nodes] = buildRoads(VmfDocument.empty(), [road(ax, ay, bx, by, { pavement: 'slabs', gutter: 'setts' })]);
      const dir = new Vector3(bx - ax, by - ay, 0).normalize(), left = new Vector3(-dir.y, dir.x, 0);
      const faces = tops(nodes);
      const pavements = faces.filter((f) => f.material === 'CONCRETE/CONCRETEFLOOR028C');
      const gutters = faces.filter((f) => f.material === 'STONE/STONEFLOOR006B');
      expect(pavements.length).toBeGreaterThanOrEqual(2);
      expect(gutters.length).toBeGreaterThanOrEqual(2);
      for (const face of [...pavements, ...gutters]) {
        // The texture runs along the street, across it from the kerb.
        expect(Math.abs(face.v.axis.dot(dir))).toBeCloseTo(1);
        expect(Math.abs(face.u.axis.dot(left))).toBeCloseTo(1);
        const side = Math.sign(face.u.axis.dot(left));
        const pav = face.material === 'CONCRETE/CONCRETEFLOOR028C';
        // Pavement: the tile starts at the kerb's outer edge (128 + 8 out) and one tile spans the 96 of pavement.
        // Gutter: it starts at the kerb (128 out) and the strip of setts (30% of 256 texels) spans its 32.
        const kerbSide = pav ? side * 136 : -side * 128;
        const at = left.clone().multiplyScalar(kerbSide);
        const period = pav ? 512 : 256;
        const offset = texel(face.u, at, period);
        expect(Math.min(offset, period - offset)).toBeLessThan(0.5);
        expect(face.u.scale).toBeCloseTo(pav ? 96 / 512 : 32 / (0.3 * 256));
      }
    }
  });

  it('knows a rounded corner is carriageway, so no bollard stands in the street', () => {
    const roads = [road(-1024, 0, 1024, 0, { corner: 96 }), road(0, -1024, 0, 1024)];
    const cornerGround = roadGround(roads);
    // Just round the corner, on the line where the straight pavement would be: the corner's carriageway.
    expect(cornerGround(150, 142)?.kind).toBe('surface');
    expect(cornerGround(400, 150)?.kind).toBe('pavement');
    // A Sofia street grid with round corners: every bollard is on pavement.
    const sketch = emptySketch(24, 24, 'city');
    for (let y = 0; y < 24; y++) for (let x = 10; x < 14; x++) sketch.surface[y * 24 + x] = Surface.Road;
    for (let x = 0; x < 24; x++) for (let y = 10; y < 14; y++) sketch.surface[y * 24 + x] = Surface.Road;
    sketch.streets = 'sofia';
    sketch.streetMaterials = { pavement: 'slabs', corner: 96 };
    const doc = generateFromSketch(sketch).doc;
    const ground = roadGround(doc.entities.map(roadOf).filter((r): r is RoadSpec => !!r));
    const bollards = doc.entities.filter((e) => e.get('model')?.includes('trainstation_post001'));
    expect(bollards.length).toBeGreaterThan(10);
    for (const b of bollards) expect(ground(b.origin!.x, b.origin!.y)?.kind).toBe('pavement');
  });

  it('runs a car park of its own up to the pavement on its street sides', () => {
    const sketch = emptySketch(20, 20, 'city');
    for (let y = 0; y < 20; y++) for (let x = 12; x < 16; x++) sketch.surface[y * 20 + x] = Surface.Road;
    sketch.pois = [{ type: 'parking', x: 2, y: 2, w: 10, h: 8, seed: 1, params: { ground: 'own' } }];
    const [lot] = sketchPoiPlacements(sketch);
    expect(lot.params?.streets).toBe('e');
    const spec = newSpec(poiType('parking')!, { x0: 0, y0: 0, x1: 1280, y1: 1024 }, 0, { seed: 1, params: lot.params });
    const out = buildPoi(VmfDocument.empty(), spec);
    const pads = out.detail.flatMap((n) => buildBrushFaces(new MapSolid(n, null))).filter((f) => f.side.material === 'CONCRETE/CONCRETEFLOOR033A' && f.plane.normal.z > 0.9);
    expect(Math.max(...pads.flatMap((f) => f.verts.map((p) => p.x)))).toBe(1286);
    expect(Math.min(...pads.flatMap((f) => f.verts.map((p) => p.x)))).toBe(0);
    // A kerb along the west side, none along the street on the east.
    const runs = out.detail.map((n) => buildBrushFaces(new MapSolid(n, null)).flatMap((f) => f.verts))
      .map((v) => ({ x0: Math.min(...v.map((p) => p.x)), x1: Math.max(...v.map((p) => p.x)), y0: Math.min(...v.map((p) => p.y)), y1: Math.max(...v.map((p) => p.y)) }))
      .filter((b) => b.x1 - b.x0 <= 14 && b.y1 - b.y0 > 300);
    expect(runs.some((b) => b.x0 < 32)).toBe(true);
    expect(runs.some((b) => b.x1 > 1240)).toBe(false);
  });

  it('builds a railway: a ballast bed with rails that run on out of the map', () => {
    const [r] = shapeRoads([{ kind: 'railway', points: [[2, 8], [16, 8]], tracks: 2 }], 128, () => 0);
    expect(r.materials?.carriageway).toBe('ballast');
    expect(r.width).toBe(railwayWidth(2));
    expect(r.tracks).toBe(2);
    const sketch = emptySketch(16, 16, 'city');
    sketch.surroundings = { style: 'city' };
    sketch.shapes = [{ kind: 'railway', points: [[2, 8], [16, 8]], tracks: 2 }];
    const doc = generateFromSketch(sketch).doc;
    const rails = doc.entities.filter((e) => e.get('model') === 'models/pg_props/pg_obj/pg_rail_512.mdl');
    // Two tracks, 208 apart, either side of the line (the map is centred: its y 8 is world 0).
    expect(new Set(rails.map((e) => e.origin!.y))).toEqual(new Set([-104, 104]));
    // From just before the start (cell 2, world -768) out past the east edge (1024) into the city beyond.
    const xs = rails.map((e) => e.origin!.x);
    expect(Math.min(...xs) - 256).toBeLessThanOrEqual(-768 - 40);
    expect(Math.max(...xs)).toBeGreaterThan(1024 + 1024);
  });

  it("leads the station's tracks out through the hall's east wall, in line with the rail line", () => {
    const editor = stubEditor();
    const spec = stationSpec(0);
    const applied = applyRooms(editor, spec, 'Add');
    expect(applied.result.layout.issues).toEqual([]);
    const rails = editor.doc.entities.filter((e) => e.get('model') === 'models/pg_props/pg_obj/pg_rail_512.mdl');
    expect(new Set(rails.map((e) => e.origin!.y))).toEqual(new Set(STATION_TRACKS));
    // The rails reach the east wall's inner face (cell 13 of the building, less half a wall).
    const east = spec.origin.x + 13 * 128 - 16;
    for (const y of STATION_TRACKS) expect(Math.max(...rails.filter((e) => e.origin!.y === y).map((e) => e.origin!.x + 256))).toBe(east);
    // Buffers only at the west end.
    const bumpers = editor.doc.entities.filter((e) => e.get('model')?.includes('pg_train_bumper'));
    expect(bumpers).toHaveLength(2);
    for (const b of bumpers) expect(b.origin!.x).toBeLessThan(spec.origin.x + 256);
  });
});
