import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces, texelUV } from '../src/geom/brush.ts';
import { boxSolid, rotateSolid, solidBounds } from '../src/edit/brushes.ts';
import { angleAbout, rotateEntity, snapAngle } from '../src/edit/rotate.ts';
import { entity } from '../src/gen/layout.ts';

const Z = new Vector3(0, 0, 1), X = new Vector3(1, 0, 0);
const about = (axis: Vector3, deg: number) => new Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180);

function box(min: Vector3, max: Vector3) {
  const doc = VmfDocument.empty();
  return doc.addSolid(boxSolid(doc, min, max, 'BRICK/BRICK01'));
}

describe('rotating brushes', () => {
  it('turns a box 90° about its centre into the same box on its side', () => {
    const solid = box(new Vector3(0, 0, 0), new Vector3(256, 64, 128));
    const centre = solidBounds(solid).getCenter(new Vector3());
    rotateSolid(solid, centre, about(Z, 90));
    const b = solidBounds(solid);
    expect(b.min.x).toBeCloseTo(96);
    expect(b.max.x).toBeCloseTo(160);
    expect(b.min.y).toBeCloseTo(-96);
    expect(b.max.y).toBeCloseTo(160);
    expect(b.min.z).toBeCloseTo(0);
    expect(b.max.z).toBeCloseTo(128);
    expect(buildBrushFaces(solid)).toHaveLength(6);
  });

  it('keeps the texture glued to the faces (texture lock)', () => {
    const solid = box(new Vector3(0, 0, 0), new Vector3(128, 128, 128));
    const before = buildBrushFaces(solid).map((f) => f.verts.map((v) => texelUV(f.side, v)));
    const centre = new Vector3(64, 64, 64);
    const q = about(Z, 30);
    rotateSolid(solid, centre, q);
    // Each original vertex, turned with the brush, keeps its texel.
    const after = buildBrushFaces(solid);
    expect(after).toHaveLength(6);
    const doc0 = box(new Vector3(0, 0, 0), new Vector3(128, 128, 128));
    buildBrushFaces(doc0).forEach((f, i) => {
      f.verts.forEach((v, j) => {
        const turned = v.clone().sub(centre).applyQuaternion(q).add(centre);
        const [u, w] = texelUV(solid.sides[i], turned);
        expect(u).toBeCloseTo(before[i][j][0], 4);
        expect(w).toBeCloseTo(before[i][j][1], 4);
      });
    });
    // The axes turned with the faces.
    expect(solid.sides[2].uaxis.axis.length()).toBeCloseTo(1);
  });

  it('turns about a horizontal axis too', () => {
    const solid = box(new Vector3(-64, -16, 0), new Vector3(64, 16, 32));
    rotateSolid(solid, new Vector3(0, 0, 16), about(X, 90));
    const b = solidBounds(solid);
    expect(b.max.y - b.min.y).toBeCloseTo(32);
    expect(b.max.z - b.min.z).toBeCloseTo(32);
    expect(b.max.x - b.min.x).toBeCloseTo(128);
  });
});

describe('rotating entities', () => {
  it('moves the origin round the pivot and adds to the yaw', () => {
    const doc = VmfDocument.empty();
    const e = doc.addEntity(entity(doc, 'prop_static', new Vector3(100, 0, 8), { angles: '0 350 0' }));
    rotateEntity(e, new Vector3(0, 0, 0), Z, 90);
    expect(e.origin!.x).toBeCloseTo(0);
    expect(e.origin!.y).toBeCloseTo(100);
    expect(e.origin!.z).toBeCloseTo(8);
    expect(e.get('angles')).toBe('0 80 0');
    rotateEntity(e, new Vector3(0, 0, 0), Z, -90);
    expect(e.get('angles')).toBe('0 350 0');
  });

  it('turns pitch and roll for the horizontal axes', () => {
    const doc = VmfDocument.empty();
    const e = doc.addEntity(entity(doc, 'prop_static', new Vector3(0, 0, 0), { angles: '0 0 0' }));
    // About Y a forward-facing prop tips its nose down: positive pitch in Source.
    rotateEntity(e, new Vector3(), new Vector3(0, 1, 0), 30);
    expect(e.angles.x).toBeCloseTo(30);
    expect(e.angles.y).toBeCloseTo(0);
    const f = doc.addEntity(entity(doc, 'prop_static', new Vector3(0, 0, 0), { angles: '0 0 0' }));
    rotateEntity(f, new Vector3(), X, 45);
    expect(f.angles.z).toBeCloseTo(45);
  });
});

describe('rotation snapping', () => {
  it('snaps to steps and leaves a zero step free', () => {
    expect(snapAngle(7, 15)).toBe(0);
    expect(snapAngle(8, 15)).toBe(15);
    expect(snapAngle(-50, 15)).toBe(-45);
    expect(snapAngle(44, 45)).toBe(45);
    expect(snapAngle(12.3, 0)).toBe(12.3);
  });

  it('reads the angle a gizmo rotation turns about its axis', () => {
    expect(angleAbout(about(Z, 37), Z)).toBeCloseTo(37);
    expect(angleAbout(about(Z, -120), Z)).toBeCloseTo(-120);
    expect(angleAbout(about(X, 200), X)).toBeCloseTo(-160);
  });
});
