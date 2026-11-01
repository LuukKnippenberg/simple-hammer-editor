import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument, type MapSolid } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { boxSolid, solidBounds } from '../src/edit/brushes.ts';
import { convexHull, hullVolume } from '../src/geom/hull.ts';
import { extrudeNode, moveFaces, moveVertices, sideThrough, sweep, topology } from '../src/edit/brushEdit.ts';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

function box(min = v(0, 0, 0), max = v(128, 128, 128)) {
  const doc = VmfDocument.empty();
  const solid = doc.addSolid(boxSolid(doc, min, max, 'BRICK/BRICK01'));
  return { doc, solid };
}

/** Index of the side facing `n`. */
const sideFacing = (s: MapSolid, n: Vector3) => topology(s).faces.find((f) => f.normal.dot(n) > 0.999)!.side;
const volume = (s: MapSolid) => hullVolume(buildBrushFaces(s).map((f) => ({ normal: f.plane.normal, verts: f.verts })));

describe('convex hull', () => {
  it('merges coplanar triangles: a cube has six quads', () => {
    const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => v(i & 1 ? 64 : 0, i & 2 ? 64 : 0, i & 4 ? 64 : 0));
    const hull = convexHull([...pts, v(32, 32, 32), v(32, 0, 0)])!;
    expect(hull).toHaveLength(6);
    for (const f of hull) expect(f.verts).toHaveLength(4);
    expect(hullVolume(hull)).toBeCloseTo(64 ** 3);
  });

  it('gives no hull for flat point sets', () => {
    expect(convexHull([v(0, 0, 0), v(64, 0, 0), v(64, 64, 0), v(0, 64, 0)])).toBeNull();
  });
});

describe('topology', () => {
  it('lists the faces, 8 corners and 12 edges of a box', () => {
    const { solid } = box();
    const t = topology(solid);
    expect(t.faces).toHaveLength(6);
    expect(t.verts).toHaveLength(8);
    expect(t.edges).toHaveLength(12);
  });
});

describe('moving faces', () => {
  it('translates the plane of the top face', () => {
    const { solid } = box();
    const top = sideFacing(solid, v(0, 0, 1));
    expect(moveFaces(solid, [[top, v(0, 0, 64)]])).toBe(true);
    const b = solidBounds(solid);
    expect(b.max.z).toBe(192);
    expect(b.min.z).toBe(0);
    expect(b.max.x).toBe(128);
  });

  it('refuses to push a face through the opposite one', () => {
    const { solid } = box();
    const top = sideFacing(solid, v(0, 0, 1));
    expect(moveFaces(solid, [[top, v(0, 0, -128)]])).toBe(false);
    expect(solidBounds(solid).max.z).toBe(128);
  });
});

describe('moving vertices (hull rebuild)', () => {
  it('drops a top edge into a wedge, keeping the materials', () => {
    const { doc, solid } = box();
    solid.sides[sideFacing(solid, v(0, 0, 1))].material = 'ROOF/ROOF01';
    solid.commit();
    const edge = [v(128, 0, 128), v(128, 128, 128)];
    expect(moveVertices(doc, solid, edge, (p) => p.add(v(0, 0, -128)))).toBe(true);
    const faces = buildBrushFaces(solid);
    // The two bottom corners merge with the moved ones: a wedge with 5 faces and 6 corners.
    expect(faces).toHaveLength(5);
    expect(topology(solid).verts).toHaveLength(6);
    expect(volume(solid)).toBeCloseTo(128 ** 3 / 2);
    // The sloped face inherits the old top's material (closest normal).
    const slope = faces.find((f) => f.plane.normal.x > 0.1 && f.plane.normal.z > 0.1)!;
    expect(slope.side.material).toBe('ROOF/ROOF01');
    // Plane points are on the corners, ordered so the normals point out.
    for (const f of faces) for (const p of f.side.plane) expect(f.verts.some((q) => q.distanceTo(p) < 0.01)).toBe(true);
  });

  it('splits a face that would not stay planar', () => {
    const { doc, solid } = box();
    // Lift one top corner: the top quad becomes two triangles.
    expect(moveVertices(doc, solid, [v(128, 128, 128)], (p) => p.add(v(0, 0, 64)))).toBe(true);
    const faces = buildBrushFaces(solid);
    expect(faces.length).toBeGreaterThan(6);
    expect(topology(solid).verts).toHaveLength(8);
    expect(solidBounds(solid).max.z).toBe(192);
  });

  it('refuses a move that flattens the brush', () => {
    const { doc, solid } = box();
    const before = solid.node.clone();
    const top = topology(solid).verts.filter((p) => p.z === 128);
    expect(moveVertices(doc, solid, top, (p) => p.setZ(0))).toBe(false);
    expect(solid.node.clone().items.length).toBe(before.items.length);
    expect(solidBounds(solid).max.z).toBe(128);
  });

  it('finds the side through moved corners', () => {
    const { doc, solid } = box();
    moveVertices(doc, solid, [v(0, 0, 128), v(128, 0, 128)], (p) => p.add(v(0, 32, 0)));
    const i = sideThrough(solid, [v(0, 32, 128), v(128, 32, 128), v(0, 128, 128), v(128, 128, 128)]);
    expect(buildBrushFaces(solid).find((f) => solid.sides.indexOf(f.side) === i)!.plane.normal.z).toBeCloseTo(1);
  });
});

describe('extruding a face', () => {
  it('sweeps the top face into a new box with its material, cap on top', () => {
    const { doc, solid } = box();
    const top = sideFacing(solid, v(0, 0, 1));
    solid.sides[top].material = 'CONCRETE/CONCRETEFLOOR001A';
    solid.commit();
    const r = extrudeNode(doc, solid, top, 64)!;
    const made = doc.addSolid(r.node);
    const b = solidBounds(made);
    expect([b.min.z, b.max.z, b.min.x, b.max.x]).toEqual([128, 192, 0, 128]);
    expect(buildBrushFaces(made)).toHaveLength(6);
    expect(made.sides.every((s) => s.material === 'CONCRETE/CONCRETEFLOOR001A')).toBe(true);
    const cap = buildBrushFaces(made).find((f) => made.sides.indexOf(f.side) === r.cap)!;
    expect(cap.plane.normal.z).toBeCloseTo(1);
    expect(cap.plane.dist).toBeCloseTo(192);
    // Chained: extruding the cap again stacks another box.
    const again = doc.addSolid(extrudeNode(doc, made, r.cap, 32)!.node);
    expect(solidBounds(again).max.z).toBe(224);
  });

  it('extrudes a sloped face along its normal', () => {
    const { doc, solid } = box();
    moveVertices(doc, solid, [v(128, 0, 128), v(128, 128, 128)], (p) => p.add(v(0, 0, -128)));
    const slope = topology(solid).faces.find((f) => f.normal.x > 0.1 && f.normal.z > 0.1)!;
    const r = extrudeNode(doc, solid, slope.side, 32)!;
    const made = doc.addSolid(r.node);
    const faces = buildBrushFaces(made);
    expect(faces).toHaveLength(6);
    // Swept by whole units: the cap stays parallel to the slope, every corner on integers.
    const off = sweep(slope.normal, 32);
    expect(off.toArray()).toEqual([23, 0, 23]);
    expect(volume(made)).toBeCloseTo(128 * 128 * Math.SQRT2 * off.dot(slope.normal), 0);
    for (const f of faces) for (const p of f.verts) expect(p.toArray().every(Number.isInteger)).toBe(true);
    expect(faces.some((f) => f.plane.normal.dot(slope.normal) > 0.9999)).toBe(true);
  });

  it('makes nothing for a zero distance', () => {
    const { doc, solid } = box();
    expect(extrudeNode(doc, solid, 0, 0)).toBeNull();
  });
});

describe('parts of brushes', () => {
  it('converts a face to its corners and edges, and corners back to the face', async () => {
    const { convertParts, partsOf, partVerts, samePart } = await import('../src/edit/parts.ts');
    const { solid } = box();
    const top = partsOf(solid, 'face').find((p) => partVerts(p).every((q) => q.z === 128))!;
    expect(convertParts([top], 'vertex')).toHaveLength(4);
    expect(convertParts([top], 'edge')).toHaveLength(4);
    const back = convertParts(convertParts([top], 'vertex'), 'face');
    expect(back).toHaveLength(1);
    expect(samePart(back[0], top)).toBe(true);
  });

  it('drops a vertex that a move merged away', async () => {
    const { partVerts } = await import('../src/edit/parts.ts');
    const { doc, solid } = box();
    const corner = { solid, kind: 'vertex' as const, side: -1, verts: [v(128, 0, 128)] };
    expect(partVerts(corner)).toHaveLength(1);
    moveVertices(doc, solid, [v(128, 0, 128), v(128, 128, 128)], (p) => p.add(v(0, 0, -128)));
    expect(partVerts(corner)).toHaveLength(0);
  });
});
