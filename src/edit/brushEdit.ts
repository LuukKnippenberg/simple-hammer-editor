import { Vector3 } from 'three';
import { KVNode } from '../vmf/keyvalues.ts';
import { vecStr, type MapSide, type MapSolid, type VmfDocument } from '../vmf/map.ts';
import { buildBrushFaces, planeFromPoints } from '../geom/brush.ts';
import { convexHull, hullVolume, planePoints, uniquePoints } from '../geom/hull.ts';
import { solidNode, worldAlignedAxes, type FaceSpec } from './brushes.ts';

/** Faces, corners and edges of a brush, for sub-object editing. */
export interface Topology {
  faces: { side: number; normal: Vector3; verts: Vector3[] }[];
  verts: Vector3[];
  edges: [Vector3, Vector3][];
}

const cache = new WeakMap<MapSolid, { version: number; topo: Topology }>();
const near = (a: Vector3, b: Vector3) => a.distanceToSquared(b) < 1e-3;

/** The brush's faces (by side index), unique corners and unique edges. Cached per brush version. */
export function topology(solid: MapSolid): Topology {
  const c = cache.get(solid);
  if (c && c.version === solid.version) return c.topo;
  const faces = buildBrushFaces(solid).map((f) => ({ side: solid.sides.indexOf(f.side), normal: f.plane.normal, verts: f.verts }));
  const verts = uniquePoints(faces.flatMap((f) => f.verts));
  const edges: [Vector3, Vector3][] = [];
  for (const f of faces) {
    f.verts.forEach((a, i) => {
      const b = f.verts[(i + 1) % f.verts.length];
      if (!edges.some(([p, q]) => (near(p, a) && near(q, b)) || (near(p, b) && near(q, a)))) edges.push([a, b]);
    });
  }
  const topo = { faces, verts, edges };
  cache.set(solid, { version: solid.version, topo });
  return topo;
}

/** True when every side that has a polygon now had one before and the brush still has volume. */
function intact(solid: MapSolid, faced: number): boolean {
  const faces = buildBrushFaces(solid);
  return faces.length >= faced && faces.length >= 4 && hullVolume(faces.map((f) => ({ normal: f.plane.normal, verts: f.verts }))) > 1;
}

/**
 * Moves sides of a brush by translating their planes (`[side index, offset]`). Refused, leaving the brush as it
 * was, when a face would disappear or the brush would collapse. Textures stay where they are in the world.
 */
export function moveFaces(solid: MapSolid, moves: [number, Vector3][]): boolean {
  const faced = buildBrushFaces(solid).length;
  const before = moves.map(([i]) => solid.sides[i].plane.map((p) => p.clone()));
  for (const [i, d] of moves) for (const p of solid.sides[i].plane) p.add(d);
  solid.commit();
  if (intact(solid, faced)) return true;
  moves.forEach(([i], k) => (solid.sides[i].plane = before[k] as [Vector3, Vector3, Vector3]));
  solid.commit();
  return false;
}

/** The old side whose outward normal is closest to `normal`. */
function closestSide(solid: MapSolid, normal: Vector3): MapSide {
  let best = solid.sides[0], dot = -2;
  for (const s of solid.sides) {
    const p = planeFromPoints(s.plane[0], s.plane[1], s.plane[2]);
    const d = p ? p.normal.dot(normal) : -2;
    if (d > dot) { dot = d; best = s; }
  }
  return best;
}

/**
 * Rebuilds a brush as the convex hull of `points`: coplanar hull triangles become one face, faces that would
 * not be planar are split by the hull. Each new side copies the old side facing most nearly the same way
 * (material, texture axes, lightmap scale). False, brush untouched, when the points span no volume.
 */
export function rebuildFromPoints(doc: VmfDocument, solid: MapSolid, points: Vector3[]): boolean {
  const hull = convexHull(points);
  if (!hull) return false;
  const sides = hull.map((f) => {
    const node = closestSide(solid, f.normal).node.clone();
    node.items = node.items.filter((it) => !(it instanceof KVNode && it.name.toLowerCase() === 'dispinfo'));
    node.set('id', String(doc.nextId()));
    node.set('plane', planePoints(f.verts, f.normal).map((p) => `(${vecStr(p)})`).join(' '));
    return node;
  });
  const old = solid.node.items;
  const isSide = (it: (typeof old)[number]) => it instanceof KVNode && it.name.toLowerCase() === 'side';
  const at = old.findIndex(isSide);
  const rest = old.filter((it) => !isSide(it));
  solid.node.items = [...rest.slice(0, at < 0 ? rest.length : at), ...sides, ...rest.slice(at < 0 ? rest.length : at)];
  solid.reload();
  if (buildBrushFaces(solid).length === hull.length) return true;
  solid.node.items = old;
  solid.reload();
  return false;
}

/** Moves the brush corners at `selected` with `move` and rebuilds the brush round its corners. */
export function moveVertices(doc: VmfDocument, solid: MapSolid, selected: Vector3[], move: (v: Vector3) => Vector3): boolean {
  const pts = topology(solid).verts.map((v) => (selected.some((s) => near(s, v)) ? move(v.clone()) : v.clone()));
  return rebuildFromPoints(doc, solid, pts);
}

/** Index of the side that contains the most of `verts` (ties: normal closest to `normal`). */
export function sideThrough(solid: MapSolid, verts: Vector3[], normal?: Vector3): number {
  let best = -1, score = -Infinity;
  for (const f of topology(solid).faces) {
    const d = f.normal.dot(f.verts[0]);
    const on = verts.filter((v) => Math.abs(f.normal.dot(v) - d) < 0.05).length;
    const s = on * 10 + (normal ? f.normal.dot(normal) : 0);
    if (s > score) { score = s; best = f.side; }
  }
  return best;
}

/** `dist` along a face normal, rounded to whole units so sloped faces keep their plane points on integers. */
export function sweep(normal: Vector3, dist: number): Vector3 {
  const v = normal.clone().multiplyScalar(dist).round();
  return v.set(v.x || 0, v.y || 0, v.z || 0);
}

/**
 * A new brush pulled out of face `side` of `solid`: the face polygon swept `dist` along its normal (negative goes
 * into the brush; see sweep). Every face gets the face's material; the cap and base keep its texture axes, the walls are
 * world-aligned. Returns the node and the cap's side index, or null for a zero distance or a missing face.
 */
export function extrudeNode(doc: VmfDocument, solid: MapSolid, side: number, dist: number): { node: KVNode; cap: number } | null {
  const face = topology(solid).faces.find((f) => f.side === side);
  const off = face && sweep(face.normal, dist);
  if (!face || !off || off.lengthSq() < 0.5) return null;
  const hull = convexHull([...face.verts, ...face.verts.map((v) => v.clone().add(off))]);
  if (!hull) return null;
  const src = solid.sides[side];
  const out = face.normal.clone().multiplyScalar(Math.sign(dist));
  const specs: FaceSpec[] = hull.map((f) => {
    const flat = Math.abs(f.normal.dot(face.normal)) > 0.999;
    const aligned = worldAlignedAxes(f.normal, src.uaxis.scale || 0.25);
    return {
      points: planePoints(f.verts, f.normal), material: src.material,
      u: flat ? { ...src.uaxis, axis: src.uaxis.axis.clone() } : aligned.u,
      v: flat ? { ...src.vaxis, axis: src.vaxis.axis.clone() } : aligned.v,
    };
  });
  const cap = hull.findIndex((f) => f.normal.dot(out) > 0.999);
  return { node: solidNode(doc, specs), cap };
}
