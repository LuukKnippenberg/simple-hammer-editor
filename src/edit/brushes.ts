import { Box3, Vector2, Vector3 } from 'three';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import { fmt, vecStr, type MapSolid, type TexAxis, type VmfDocument } from '../vmf/map.ts';
import { buildBrushFaces } from '../geom/brush.ts';

export interface FaceSpec {
  /** Three points, clockwise seen from outside (Hammer's convention). */
  points: [Vector3, Vector3, Vector3];
  material: string;
  /** Texture axes; world-aligned when omitted. */
  u?: TexAxis;
  v?: TexAxis;
}

/** Hammer's world-aligned texture axes for a face normal. */
export function worldAlignedAxes(normal: Vector3, scale = 0.25): { u: TexAxis; v: TexAxis } {
  const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
  if (az >= ax && az >= ay) return { u: { axis: new Vector3(1, 0, 0), shift: 0, scale }, v: { axis: new Vector3(0, -1, 0), shift: 0, scale } };
  if (ax >= ay) return { u: { axis: new Vector3(0, 1, 0), shift: 0, scale }, v: { axis: new Vector3(0, 0, -1), shift: 0, scale } };
  return { u: { axis: new Vector3(1, 0, 0), shift: 0, scale }, v: { axis: new Vector3(0, 0, -1), shift: 0, scale } };
}

const axisStr = (t: TexAxis) => `[${fmt(t.axis.x)} ${fmt(t.axis.y)} ${fmt(t.axis.z)} ${fmt(t.shift)}] ${fmt(t.scale)}`;

/** Builds a `solid` node in Hammer's layout from face specs. */
export function solidNode(doc: VmfDocument, faces: FaceSpec[], color = '0 180 220', textureScale = 0.25): KVNode {
  const solid = new KVNode('solid');
  solid.items.push(new KVPair('id', String(doc.nextId())));
  for (const f of faces) {
    const [a, b, c] = f.points;
    const n = new Vector3().subVectors(c, a).cross(new Vector3().subVectors(b, a)).normalize();
    const aligned = worldAlignedAxes(n, textureScale);
    const u = f.u ?? aligned.u, v = f.v ?? aligned.v;
    const side = new KVNode('side');
    side.items.push(
      new KVPair('id', String(doc.nextId())),
      new KVPair('plane', `(${vecStr(a)}) (${vecStr(b)}) (${vecStr(c)})`),
      new KVPair('material', f.material.toUpperCase()),
      new KVPair('uaxis', axisStr(u)),
      new KVPair('vaxis', axisStr(v)),
      new KVPair('rotation', '0'),
      new KVPair('lightmapscale', '16'),
      new KVPair('smoothing_groups', '0'),
    );
    solid.items.push(side);
  }
  const editor = new KVNode('editor');
  editor.items.push(new KVPair('color', color), new KVPair('visgroupshown', '1'), new KVPair('visgroupautoshown', '1'));
  solid.items.push(editor);
  return solid;
}

export interface PrismMaterials {
  top: string;
  bottom: string;
  /** One material for all sides, or one per footprint edge. */
  sides: string | string[];
}

/**
 * A vertical prism: convex footprint (counter-clockwise seen from above) extruded from zMin to zMax.
 */
export function prismFaces(footprint: Vector2[], zMin: number, zMax: number, mat: PrismMaterials): FaceSpec[] {
  const p = (q: Vector2, z: number) => new Vector3(q.x, q.y, z);
  const n = footprint.length;
  const faces: FaceSpec[] = [
    { points: [p(footprint[0], zMax), p(footprint[2], zMax), p(footprint[1], zMax)], material: mat.top },
    { points: [p(footprint[0], zMin), p(footprint[1], zMin), p(footprint[2], zMin)], material: mat.bottom },
  ];
  for (let i = 0; i < n; i++) {
    const a = footprint[i], b = footprint[(i + 1) % n];
    const m = Array.isArray(mat.sides) ? mat.sides[i] ?? mat.sides[0] : mat.sides;
    faces.push({ points: [p(a, zMax), p(b, zMax), p(a, zMin)], material: m });
  }
  return faces;
}

export function boxFaces(min: Vector3, max: Vector3, material: string | PrismMaterials): FaceSpec[] {
  const mats = typeof material === 'string' ? { top: material, bottom: material, sides: material } : material;
  const fp = [new Vector2(min.x, min.y), new Vector2(max.x, min.y), new Vector2(max.x, max.y), new Vector2(min.x, max.y)];
  return prismFaces(fp, min.z, max.z, mats);
}

export function boxSolid(doc: VmfDocument, min: Vector3, max: Vector3, material: string | PrismMaterials): KVNode {
  return solidNode(doc, boxFaces(min, max, material));
}

export function solidBounds(solid: MapSolid): Box3 {
  const box = new Box3();
  for (const f of buildBrushFaces(solid)) for (const v of f.verts) box.expandByPoint(v);
  return box;
}

/** Moves a brush. With texture lock, texture offsets follow so the texture stays glued to the faces. */
export function translateSolid(solid: MapSolid, d: Vector3, textureLock = true): void {
  for (const side of solid.sides) {
    for (const p of side.plane) p.add(d);
    if (textureLock) {
      side.uaxis.shift -= d.dot(side.uaxis.axis) / (side.uaxis.scale || 1);
      side.vaxis.shift -= d.dot(side.vaxis.axis) / (side.vaxis.scale || 1);
    }
  }
  solid.commit();
}

/** Per-axis remap of a brush from one box to another (resize). Planes stay planes, so the brush stays convex. */
export function remapSolid(solid: MapSolid, from: Box3, to: Box3): void {
  const fs = from.getSize(new Vector3()), ts = to.getSize(new Vector3());
  const k = new Vector3(fs.x ? ts.x / fs.x : 1, fs.y ? ts.y / fs.y : 1, fs.z ? ts.z / fs.z : 1);
  for (const side of solid.sides) {
    for (const p of side.plane) p.sub(from.min).multiply(k).add(to.min);
  }
  solid.commit();
}
