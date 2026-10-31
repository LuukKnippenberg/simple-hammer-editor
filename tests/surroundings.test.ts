import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { defaultRoad, type RoadSpec } from '../src/gen/roads.ts';
import { bandWidth, buildSurroundings, extendEdgeRoads, PLAIN_APRON, sideOf, surroundRise, type SurroundSpec } from '../src/gen/surroundings.ts';
import { emptySketch, Feature, generateFromSketch, Surface } from '../src/gen/sketch.ts';
import { scanBrushes } from './overlaps.ts';

const W = 4096, H = 3072;
const road = (ax: number, ay: number, bx: number, by: number): RoadSpec => ({ ...defaultRoad('asphalt', [new Vector3(ax, ay, 0), new Vector3(bx, by, 0)]), width: 256, pavement: 96 });

describe('surroundings', () => {
  it('knows which side a point beyond the edge is on, and how wide the band is', () => {
    expect(sideOf(100, 100, W, H)).toBe(null);
    expect(sideOf(100, -50, W, H)).toBe('s');
    expect(sideOf(W + 300, 100, W, H)).toBe('e');
    // Corners go to the side the point is further out from.
    expect(sideOf(-100, H + 400, W, H)).toBe('n');
    expect(bandWidth(undefined)).toBe(PLAIN_APRON);
    expect(bandWidth({ style: 'none' })).toBe(PLAIN_APRON);
    expect(bandWidth({ style: 'none', sides: { e: 'hills' } })).toBe(2048);
  });

  it('runs streets on out of city and wall sides only', () => {
    const roads = [road(1024, 0, 1024, H), road(0, 1536, W, 1536)];
    const spec: SurroundSpec = { style: 'city', sides: { e: 'hills', n: 'wall' } };
    expect(extendEdgeRoads(roads, spec, W, H, () => 0)).toBe(3);
    expect(roads[0].points[0].y).toBe(-(2048 - 64));
    // Up to the wall on the north side.
    expect(roads[0].points[1].y).toBeGreaterThan(H);
    expect(roads[0].points[1].y).toBeLessThan(H + 352);
    // Not into the hills on the east side.
    expect(roads[1].points[1].x).toBe(W);
    expect(roads[1].points[0].x).toBe(-(2048 - 64));
  });

  it('builds the city outside the playable area and leaves the streets open', () => {
    const roads = [road(1024, 0, 1024, H)];
    const spec: SurroundSpec = { style: 'city' };
    extendEdgeRoads(roads, spec, W, H, () => 0);
    const out = buildSurroundings({ doc: VmfDocument.empty(), spec, w: W, h: H, seed: 3, ground: () => 0, roads });
    expect(out.brushes.length).toBeGreaterThan(100);
    for (const b of scanBrushes(out.brushes)) {
      const inside = b.box.max.x > 0 && b.box.min.x < W && b.box.max.y > 0 && b.box.min.y < H;
      expect(inside).toBe(false);
      // Nothing on the street that runs out south and north.
      const onStreet = b.box.max.x > 1024 - 128 && b.box.min.x < 1024 + 128;
      expect(onStreet).toBe(false);
    }
    // The skyline rises: some buildings of 7 floors and more.
    expect(out.top).toBeGreaterThan(7 * 128);
  });

  it('raises hills away from the edge and puts walls just outside it', () => {
    const rise = surroundRise({ style: 'hills' }, W, H, 5);
    expect(rise(1000, 1000)).toBe(0);
    expect(rise(1000, -100)).toBe(0);
    expect(rise(1000, -1900)).toBeGreaterThan(800);
    const hills = buildSurroundings({ doc: VmfDocument.empty(), spec: { style: 'hills' }, w: W, h: H, seed: 3, ground: () => 0, roads: [] });
    expect(hills.props.length).toBeGreaterThan(100);
    expect(hills.props.every((p) => sideOf(p.origin.x, p.origin.y, W, H))).toBe(true);
    const wall = buildSurroundings({ doc: VmfDocument.empty(), spec: { style: 'wall' }, w: W, h: H, seed: 3, ground: () => 0, roads: [] });
    const clusters = wall.props.filter((p) => /combineinnerwall/.test(p.model));
    // Round all four sides: (4096 + 704) / 1000 twice and (3072 + 704) / 1000 twice, give or take the ends.
    expect(clusters.length).toBeGreaterThanOrEqual(16);
  });

  it('builds a sketch map with city surroundings: band, NPC clip, a func_brush of buildings', () => {
    const s = emptySketch(24, 16, 'city');
    for (let y = 0; y < 16; y++) for (let x = 10; x < 14; x++) s.surface[y * 24 + x] = Surface.Road;
    for (let y = 2; y < 14; y++) for (let x = 1; x < 9; x++) s.features[y * 24 + x] = Feature.Building;
    s.surroundings = { style: 'city', sides: { e: 'hills' } };
    const r = generateFromSketch(s);
    const around = r.doc.entities.find((e) => e.get('targetname') === 'surroundings');
    expect(around?.solids.length).toBeGreaterThan(30);
    expect(r.doc.worldEntity.solids.some((q) => q.sides.some((side) => side.material === 'TOOLS/TOOLSNPCCLIP'))).toBe(true);
  });
});
