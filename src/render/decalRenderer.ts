import { BufferAttribute, BufferGeometry, Group, Mesh, MeshLambertMaterial, Raycaster, Vector3 } from 'three';
import type { MapEntity, VmfDocument } from '../vmf/map.ts';
import { parseVec } from '../vmf/map.ts';
import { loadVmt, normalizeMaterialPath } from '../assets/vmt.ts';
import { loadTexture } from '../assets/textures.ts';
import type { WorldRenderer } from './worldRenderer.ts';
import { buildBrushFaces } from '../geom/brush.ts';

export interface DecalInfo {
  material: MeshLambertMaterial;
  /** World size of an infodecal: texture size × $decalscale. */
  width: number;
  height: number;
  ready: Promise<void>;
  loaded: boolean;
}

/**
 * Surface axes Source uses for an infodecal on a surface with normal n (R_DecalComputeBasis without an s-axis):
 * s runs along the texture's width, t down its height (texture v grows along t). On walls t points down and s to
 * the right seen from in front; on floors and ceilings s follows world X and t = s × n.
 */
export function decalBasis(n: Vector3): { s: Vector3; t: Vector3 } {
  if (Math.abs(n.z) < 0.7) {
    const s = new Vector3().crossVectors(n, new Vector3(0, 0, -1)).normalize();
    return { s, t: new Vector3().crossVectors(s, n).normalize() };
  }
  const s = new Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize();
  const t = new Vector3().crossVectors(n, s).normalize().negate();
  return { s, t };
}

/**
 * Draws infodecal and info_overlay entities as textured quads on the surfaces they decorate, batched by
 * material. infodecals find their surface by casting short rays from the origin, like the engine does.
 */
export class DecalRenderer {
  readonly group = new Group();
  private infos = new Map<string, DecalInfo>();
  private world: WorldRenderer;
  private versions = new Map<MapEntity, number>();
  private doc: VmfDocument | null = null;
  visible = true;
  stats = { decals: 0, overlays: 0 };

  constructor(world: WorldRenderer) {
    this.world = world;
    this.group.name = 'decals';
    this.group.renderOrder = 3;
  }

  info(name: string): DecalInfo {
    const key = normalizeMaterialPath(name);
    let info = this.infos.get(key);
    if (!info) {
      const material = new MeshLambertMaterial({
        color: 0xffffff, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, opacity: 0,
      });
      const i: DecalInfo = { material, width: 64, height: 64, ready: Promise.resolve(), loaded: false };
      i.ready = (async () => {
        const vmt = await loadVmt(key);
        const base = vmt?.params.get('$basetexture');
        const tex = base ? await loadTexture(base) : null;
        if (!tex) return;
        const scale = parseFloat(vmt!.params.get('$decalscale') ?? '1') || 1;
        i.width = tex.width * scale;
        i.height = tex.height * scale;
        material.map = tex.texture;
        material.opacity = 1;
        if (vmt!.params.get('$alphatest') === '1') material.alphaTest = 0.4;
        material.needsUpdate = true;
      })().finally(() => { i.loaded = true; });
      this.infos.set(key, i);
      info = i;
    }
    return info;
  }

  /** Finds the surface below an infodecal origin: nearest hit of short rays along the six axes. */
  private surfaceAt(o: Vector3): { point: Vector3; normal: Vector3 } | null {
    let best: { point: Vector3; normal: Vector3; d: number } | null = null;
    for (const dir of [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) {
      const d = new Vector3(...dir);
      const ray = new Raycaster(o.clone().addScaledVector(d, -4), d, 0, 36);
      const hit = this.world.raycast(ray);
      if (hit && (!best || hit.distance < best.d)) {
        const n = hit.normal.dot(d) > 0 ? hit.normal.clone().negate() : hit.normal.clone();
        best = { point: hit.point, normal: n, d: hit.distance };
      }
    }
    return best;
  }

  sync(doc: VmfDocument): void {
    this.doc = doc;
    const ents = doc.entities.filter((e) => e.classname === 'infodecal' || e.classname === 'info_overlay');
    // Rebuild when a decal entity was added, removed or changed (cheap: there are rarely more than a few hundred).
    const changed = ents.length !== this.versions.size || ents.some((e) => this.versions.get(e) !== e.version);
    if (!changed) return;
    this.versions = new Map(ents.map((e) => [e, e.version]));
    const byMat = new Map<string, { pos: number[]; nrm: number[]; uv: number[] }>();
    const quad = (mat: string, corners: Vector3[], uvs: number[][], n: Vector3) => {
      let b = byMat.get(mat);
      if (!b) byMat.set(mat, (b = { pos: [], nrm: [], uv: [] }));
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const c = corners[i];
        b.pos.push(c.x, c.y, c.z);
        b.nrm.push(n.x, n.y, n.z);
        b.uv.push(uvs[i][0], uvs[i][1]);
      }
    };
    const tris = (mat: string, pts: Vector3[], uvs: number[][], n: Vector3) => {
      let b = byMat.get(mat);
      if (!b) byMat.set(mat, (b = { pos: [], nrm: [], uv: [] }));
      pts.forEach((c, i) => {
        b!.pos.push(c.x, c.y, c.z);
        b!.nrm.push(n.x, n.y, n.z);
        b!.uv.push(uvs[i][0], uvs[i][1]);
      });
    };
    const faceById = new Map<number, Vector3[]>();
    const wanted = new Set<number>();
    for (const e of ents) if (e.classname === 'info_overlay') for (const id of (e.get('sides') ?? '').trim().split(/\s+/)) wanted.add(Number(id));
    if (wanted.size) {
      for (const solid of doc.allSolids()) {
        if (!solid.sides.some((x) => wanted.has(x.id))) continue;
        for (const f of buildBrushFaces(solid)) if (wanted.has(f.side.id)) faceById.set(f.side.id, f.verts);
      }
    }
    let decals = 0, overlays = 0;
    const pending: Promise<void>[] = [];
    let unsized = false;
    for (const e of ents) {
      if (e.classname === 'infodecal') {
        const tex = e.get('texture');
        const o = e.origin;
        if (!tex || !o) continue;
        const surf = this.surfaceAt(o);
        if (!surf) continue;
        const info = this.info(tex);
        if (!info.loaded) { unsized = true; pending.push(info.ready); }
        const { s, t } = decalBasis(surf.normal);
        const c = surf.point.clone().addScaledVector(surf.normal, 0.5);
        const hs = s.clone().multiplyScalar(info.width / 2), ht = t.clone().multiplyScalar(info.height / 2);
        const corners = [
          c.clone().sub(hs).sub(ht), c.clone().add(hs).sub(ht), c.clone().add(hs).add(ht), c.clone().sub(hs).add(ht),
        ];
        // Keep CCW seen from the surface side.
        const ccw = new Vector3().subVectors(corners[1], corners[0]).cross(new Vector3().subVectors(corners[2], corners[0])).dot(surf.normal) > 0;
        const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
        if (ccw) quad(normalizeMaterialPath(tex), corners, uvs, surf.normal);
        else quad(normalizeMaterialPath(tex), [corners[0], corners[3], corners[2], corners[1]], [uvs[0], uvs[3], uvs[2], uvs[1]], surf.normal);
        decals++;
      } else {
        const mat = e.get('material');
        if (!mat) continue;
        const origin = parseVec(e.get('BasisOrigin') ?? e.get('origin'));
        const U = parseVec(e.get('BasisU')), V = parseVec(e.get('BasisV')), N = parseVec(e.get('BasisNormal')).normalize();
        const su = parseFloat(e.get('StartU') ?? '0'), eu = parseFloat(e.get('EndU') ?? '1');
        const sv = parseFloat(e.get('StartV') ?? '0'), ev = parseFloat(e.get('EndV') ?? '1');
        const rect = [0, 1, 2, 3].map((i) => parseVec(e.get(`uv${i}`)));
        const x0 = Math.min(...rect.map((r) => r.x)), x1 = Math.max(...rect.map((r) => r.x));
        const y0 = Math.min(...rect.map((r) => r.y)), y1 = Math.max(...rect.map((r) => r.y));
        // uv0 (x0,y0) → (StartU,StartV), uv1 (x0,y1) → (StartU,EndV), uv2 (x1,y1) → (EndU,EndV).
        const texAt = (x: number, y: number) => [su + ((x - x0) / (x1 - x0 || 1)) * (eu - su), sv + ((y - y0) / (y1 - y0 || 1)) * (ev - sv)];
        const toWorld = (x: number, y: number) => origin.clone().addScaledVector(U, x).addScaledVector(V, y).addScaledVector(N, 0.6);
        const info = this.info(mat);
        if (!info.loaded) pending.push(info.ready);
        // In game the overlay is clipped to the faces listed in `sides`; do the same so it never hangs in the air.
        const faces = (e.get('sides') ?? '').trim().split(/\s+/).map(Number).map((id) => faceById.get(id)).filter((f): f is Vector3[] => !!f);
        const pieces = faces.length ? faces.map((verts) => clipRect(verts.map((v) => {
          const d = v.clone().sub(origin);
          return [d.dot(U), d.dot(V)] as [number, number];
        }), x0, y0, x1, y1)) : [[[x0, y0], [x0, y1], [x1, y1], [x1, y0]] as [number, number][]];
        for (const poly of pieces) {
          if (poly.length < 3) continue;
          const pts = poly.map(([x, y]) => toWorld(x, y));
          const tex = poly.map(([x, y]) => texAt(x, y));
          const ccw = new Vector3().subVectors(pts[1], pts[0]).cross(new Vector3().subVectors(pts[2], pts[0])).dot(N) > 0;
          for (let k = 1; k < pts.length - 1; k++) {
            const tri = ccw ? [0, k, k + 1] : [0, k + 1, k];
            tris(normalizeMaterialPath(mat), tri.map((i) => pts[i]), tri.map((i) => tex[i]), N);
          }
        }
        overlays++;
      }
    }
    for (const m of this.group.children as Mesh[]) m.geometry.dispose();
    this.group.clear();
    for (const [mat, b] of byMat) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nrm), 3));
      g.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2));
      g.computeBoundingSphere();
      const mesh = new Mesh(g, this.info(mat).material);
      mesh.renderOrder = 3;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.stats = { decals, overlays };
    // infodecal sizes come from the texture: rebuild once the missing ones have loaded.
    if (unsized) {
      void Promise.all(pending).then(() => {
        if (this.doc !== doc) return;
        this.versions.clear();
        this.sync(doc);
      });
    }
    this.group.visible = this.visible;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
  }
}

type P2 = [number, number];

/** Clips the rectangle [x0,x1]×[y0,y1] to a convex polygon (Sutherland–Hodgman, both in overlay space). */
export function clipRect(face: P2[], x0: number, y0: number, x1: number, y1: number): P2[] {
  let poly: P2[] = [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
  // Face winding in overlay space can be either way; use its signed area to know which side is inside.
  let area = 0;
  for (let i = 0; i < face.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sign = area >= 0 ? 1 : -1;
  for (let i = 0; i < face.length && poly.length; i++) {
    const a = face[i], b = face[(i + 1) % face.length];
    const inside = (p: P2) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= -1e-6;
    const out: P2[] = [];
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      const pin = inside(p), qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) {
        const dp = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        const dq = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
        const t = dp / (dp - dq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    poly = out;
  }
  return poly;
}
