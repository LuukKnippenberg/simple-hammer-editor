import { BufferAttribute, BufferGeometry, Group, Mesh, MeshDepthMaterial, type Material, Vector3, Box3, Raycaster, type Intersection } from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import type { MapSolid, MapSide, VmfDocument } from '../vmf/map.ts';
import { buildBrushFaces, texelUV } from '../geom/brush.ts';
import { buildDisplacement } from '../geom/displacement.ts';
import type { MaterialLibrary, MaterialKind } from './materials.ts';

/** Invisible in game and not solid, but casts lightmap shadows (batch keys are normalized material names). */
const BLOCKLIGHT = 'tools/toolsblocklight';

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

/** Triangles of one brush that share a material. */
interface Chunk {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  alpha: Float32Array;
  /** Side index (into solid.sides) per triangle. */
  sides: Uint16Array;
}

interface SolidGeom {
  version: number;
  chunks: Map<string, Chunk>;
  bounds: Box3;
}

interface Batch {
  mesh: Mesh;
  kind: MaterialKind;
  triSolid: MapSolid[];
  triSide: Uint16Array;
}

export interface BrushHit {
  solid: MapSolid;
  side: MapSide;
  point: Vector3;
  normal: Vector3;
  distance: number;
}

class ChunkBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  alpha: number[] = [];
  sides: number[] = [];
  build(): Chunk {
    return {
      pos: new Float32Array(this.pos),
      nrm: new Float32Array(this.nrm),
      uv: new Float32Array(this.uv),
      alpha: new Float32Array(this.alpha),
      sides: new Uint16Array(this.sides),
    };
  }
}

/** Builds triangle chunks for one brush, grouped by material. */
export function buildSolidChunks(solid: MapSolid): SolidGeom {
  const faces = buildBrushFaces(solid);
  const builders = new Map<string, ChunkBuilder>();
  const bounds = new Box3();
  const isDisp = solid.isDisplacement;
  const get = (m: string) => {
    const k = m.toLowerCase();
    let b = builders.get(k);
    if (!b) builders.set(k, (b = new ChunkBuilder()));
    return b;
  };

  for (const face of faces) {
    for (const v of face.verts) bounds.expandByPoint(v);
    const sideIndex = solid.sides.indexOf(face.side);
    const disp = face.side.dispinfo;
    // A brush with a displacement only renders its displacement faces.
    if (isDisp && !disp) continue;
    const b = get(face.side.material);
    if (disp) {
      const grid = buildDisplacement(face, disp);
      if (!grid) continue;
      // Smooth normals over the grid.
      const vn = grid.positions.map(() => new Vector3());
      const e1 = new Vector3(), e2 = new Vector3(), fn = new Vector3();
      const ix = grid.indices;
      for (let k = 0; k < ix.length; k += 3) {
        const a = grid.positions[ix[k]], bb = grid.positions[ix[k + 1]], c = grid.positions[ix[k + 2]];
        fn.crossVectors(e1.subVectors(bb, a), e2.subVectors(c, a));
        vn[ix[k]].add(fn); vn[ix[k + 1]].add(fn); vn[ix[k + 2]].add(fn);
      }
      for (const n of vn) n.normalize();
      for (let k = 0; k < ix.length; k++) {
        const i = ix[k];
        const p = grid.positions[i];
        bounds.expandByPoint(p);
        b.pos.push(p.x, p.y, p.z);
        b.nrm.push(vn[i].x, vn[i].y, vn[i].z);
        const [u, v] = texelUV(face.side, grid.base[i]);
        b.uv.push(u, v);
        b.alpha.push(grid.alpha[i]);
        if (k % 3 === 0) b.sides.push(sideIndex);
      }
    } else {
      const n = face.plane.normal;
      const vs = face.verts;
      const uvs = vs.map((v) => texelUV(face.side, v));
      for (let k = 1; k < vs.length - 1; k++) {
        for (const i of [0, k, k + 1]) {
          const p = vs[i];
          b.pos.push(p.x, p.y, p.z);
          b.nrm.push(n.x, n.y, n.z);
          b.uv.push(uvs[i][0], uvs[i][1]);
          b.alpha.push(0);
        }
        b.sides.push(sideIndex);
      }
    }
  }
  const chunks = new Map<string, Chunk>();
  for (const [k, b] of builders) if (b.sides.length) chunks.set(k, b.build());
  return { version: solid.version, chunks, bounds };
}

/**
 * Renders all brushes as one mesh per material. Brushes are rebuilt only when their
 * `version` changes, and only the material batches they touch are re-merged.
 */
export class WorldRenderer {
  readonly group = new Group();
  private geoms = new Map<MapSolid, SolidGeom>();
  private batches = new Map<string, Batch>();
  private materials: MaterialLibrary;
  /** Objects hidden in the editor; shared with the editor. */
  hidden: Set<object> = new Set();
  visibleKinds: Record<MaterialKind, boolean> = { opaque: true, blend: true, translucent: true, tool: false, sky: false, handle: true };
  stats = { brushes: 0, faces: 0, triangles: 0, batches: 0, buildMs: 0 };
  private shadows = false;

  setShadows(on: boolean): void {
    this.shadows = on;
    for (const b of this.batches.values()) this.shadowFlags(b.mesh, b.kind);
  }

  private shadowFlags(mesh: Mesh, kind: MaterialKind): void {
    const solid = kind === 'opaque' || kind === 'blend';
    // Light blockers draw nothing unless tool brushes are shown, but cast shadows as they do in vrad.
    const blocker = mesh.name === BLOCKLIGHT;
    mesh.castShadow = this.shadows && (solid || blocker);
    mesh.receiveShadow = this.shadows && kind !== 'tool' && kind !== 'sky' && kind !== 'handle';
    if (blocker) {
      mesh.visible = this.visibleKinds.tool || this.shadows;
      (mesh.material as Material).opacity = this.visibleKinds.tool ? 0.3 : 0;
      // Shadows of transparent meshes fade with their opacity; an opaque depth material casts them in full.
      mesh.customDepthMaterial ??= new MeshDepthMaterial();
    }
  }

  constructor(materials: MaterialLibrary) {
    this.materials = materials;
    this.group.name = 'world';
  }

  /** Brings the batches in line with the document. Cheap when nothing changed. */
  sync(doc: VmfDocument): void {
    const t0 = performance.now();
    const solids = doc.allSolids().filter((s) => !this.hidden.has(s) && !(s.entity && this.hidden.has(s.entity)));
    const alive = new Set(solids);
    const dirty = new Set<string>();
    for (const [s, g] of this.geoms) {
      if (!alive.has(s)) {
        for (const k of g.chunks.keys()) dirty.add(k);
        this.geoms.delete(s);
      }
    }
    for (const s of solids) {
      const old = this.geoms.get(s);
      if (old && old.version === s.version) continue;
      if (old) for (const k of old.chunks.keys()) dirty.add(k);
      const g = buildSolidChunks(s);
      for (const k of g.chunks.keys()) dirty.add(k);
      this.geoms.set(s, g);
    }
    if (!dirty.size) return;
    for (const k of dirty) this.rebuildBatch(k);
    this.stats.brushes = solids.length;
    this.stats.faces = solids.reduce((n, s) => n + s.sides.length, 0);
    this.stats.triangles = [...this.batches.values()].reduce((n, b) => n + b.triSide.length, 0);
    this.stats.batches = this.batches.size;
    this.stats.buildMs = Math.round(performance.now() - t0);
    this.applyVisibility();
  }

  private rebuildBatch(key: string): void {
    const old = this.batches.get(key);
    if (old) {
      this.group.remove(old.mesh);
      old.mesh.geometry.disposeBoundsTree();
      old.mesh.geometry.dispose();
      this.batches.delete(key);
    }
    let tris = 0;
    const parts: [MapSolid, Chunk][] = [];
    for (const [s, g] of this.geoms) {
      const c = g.chunks.get(key);
      if (c) { parts.push([s, c]); tris += c.sides.length; }
    }
    if (!tris) return;
    const pos = new Float32Array(tris * 9), nrm = new Float32Array(tris * 9);
    const uv = new Float32Array(tris * 6), alpha = new Float32Array(tris * 3);
    const triSolid: MapSolid[] = new Array(tris);
    const triSide = new Uint16Array(tris);
    let t = 0;
    for (const [s, c] of parts) {
      pos.set(c.pos, t * 9); nrm.set(c.nrm, t * 9); uv.set(c.uv, t * 6); alpha.set(c.alpha, t * 3);
      triSide.set(c.sides, t);
      for (let i = 0; i < c.sides.length; i++) triSolid[t + i] = s;
      t += c.sides.length;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setAttribute('alpha', new BufferAttribute(alpha, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    // The BVH is built lazily on the first raycast, so drags that rebuild batches every frame stay cheap.
    const info = this.materials.get(key);
    const mesh = new Mesh(geo, info.material);
    mesh.name = key;
    mesh.matrixAutoUpdate = false;
    if (info.kind === 'tool' || info.kind === 'sky' || info.kind === 'translucent' || info.kind === 'handle') mesh.renderOrder = 1;
    this.shadowFlags(mesh, info.kind);
    this.group.add(mesh);
    this.batches.set(key, { mesh, kind: info.kind, triSolid, triSide });
  }

  /** Re-reads material kinds (they can change once a VMT is loaded) and applies visibility toggles. */
  applyVisibility(): void {
    for (const [k, b] of this.batches) {
      const info = this.materials.get(k);
      b.kind = info.kind;
      if (b.mesh.material !== info.material) b.mesh.material = info.material;
      b.mesh.visible = this.visibleKinds[b.kind];
      this.shadowFlags(b.mesh, b.kind);
    }
  }

  bounds(): Box3 {
    const box = new Box3();
    for (const g of this.geoms.values()) if (!g.bounds.isEmpty()) box.union(g.bounds);
    return box;
  }

  /** Brushes that currently draw something (not hidden, not only invisible tool faces), with their bounds. */
  visibleSolids(): [MapSolid, Box3][] {
    const out: [MapSolid, Box3][] = [];
    for (const [s, g] of this.geoms) {
      for (const k of g.chunks.keys()) {
        if (this.visibleKinds[this.materials.get(k).kind]) { out.push([s, g.bounds]); break; }
      }
    }
    return out;
  }

  solidBounds(s: MapSolid): Box3 | null {
    return this.geoms.get(s)?.bounds ?? null;
  }

  /** Nearest brush hit. POI handles only count with `handles` (the Select tool); other tools reach what's inside. */
  raycast(ray: Raycaster, opts: { handles?: boolean } = {}): BrushHit | null {
    const meshes = [...this.batches.values()].filter((b) => b.mesh.visible && (opts.handles || b.kind !== 'handle')
      && (b.mesh.name !== BLOCKLIGHT || this.visibleKinds.tool)).map((b) => b.mesh);
    for (const m of meshes) if (!m.geometry.boundsTree) m.geometry.computeBoundsTree();
    ray.firstHitOnly = true;
    const hits: Intersection[] = ray.intersectObjects(meshes, false);
    let best: Intersection | null = null;
    for (const h of hits) if (!best || h.distance < best.distance) best = h;
    if (!best || !best.face) return null;
    const batch = this.batches.get(best.object.name)!;
    // The BVH reorders its index buffer, so faceIndex is not our triangle number. The batches are
    // non-indexed (three vertices per triangle), so the vertex index still identifies the triangle.
    const tri = Math.floor(best.face.a / 3);
    const solid = batch.triSolid[tri];
    return {
      solid,
      side: solid.sides[batch.triSide[tri]],
      point: best.point,
      normal: best.face ? best.face.normal.clone() : new Vector3(0, 0, 1),
      distance: best.distance,
    };
  }
}
