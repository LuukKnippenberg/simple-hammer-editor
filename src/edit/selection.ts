import {
  Box3, BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Vector3,
} from 'three';
import type { MapEntity, MapSolid, VmfDocument } from '../vmf/map.ts';
import { buildBrushFaces } from '../geom/brush.ts';
import type { EntityRenderer } from '../render/entityRenderer.ts';

/** The selected brushes and entities, drawn as an orange outline over everything. */
export class Selection {
  readonly solids = new Set<MapSolid>();
  readonly entities = new Set<MapEntity>();
  readonly group = new Group();
  private lines: LineSegments;
  private fill: Mesh;
  private entityRenderer: EntityRenderer;
  private versions = new Map<object, number>();
  onChange: () => void = () => {};

  constructor(entityRenderer: EntityRenderer) {
    this.entityRenderer = entityRenderer;
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xffa020, depthTest: false, transparent: true, opacity: 0.95 }));
    this.lines.renderOrder = 10;
    this.fill = new Mesh(new BufferGeometry(), new MeshBasicMaterial({
      color: 0xff8a10, transparent: true, opacity: 0.18, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.fill.renderOrder = 9;
    this.lines.frustumCulled = this.fill.frustumCulled = false;
    this.group.add(this.fill, this.lines);
  }

  get isEmpty(): boolean {
    return !this.solids.size && !this.entities.size;
  }

  /** Brushes plus the brushes of selected brush entities. */
  allSolids(): MapSolid[] {
    const out = new Set(this.solids);
    for (const e of this.entities) for (const s of e.solids) out.add(s);
    return [...out];
  }

  /** Selected point entities (brush entities move with their brushes). */
  pointEntities(): MapEntity[] {
    return [...this.entities].filter((e) => !e.solids.length);
  }

  set(solids: MapSolid[], entities: MapEntity[] = []): void {
    this.solids.clear();
    this.entities.clear();
    for (const s of solids) this.solids.add(s);
    for (const e of entities) this.entities.add(e);
    this.refresh();
  }

  toggle(item: { solid?: MapSolid; entity?: MapEntity }): void {
    if (item.solid) this.solids.has(item.solid) ? this.solids.delete(item.solid) : this.solids.add(item.solid);
    if (item.entity) this.entities.has(item.entity) ? this.entities.delete(item.entity) : this.entities.add(item.entity);
    this.refresh();
  }

  clear(): void {
    if (this.isEmpty) return;
    this.set([]);
  }

  /** Drops objects that are no longer in the document (after undo or delete). */
  prune(doc: VmfDocument): void {
    const solids = new Set(doc.allSolids());
    const ents = new Set(doc.entities);
    let changed = false;
    for (const s of this.solids) if (!solids.has(s)) { this.solids.delete(s); changed = true; }
    for (const e of this.entities) if (!ents.has(e)) { this.entities.delete(e); changed = true; }
    if (changed) this.refresh();
    else this.refreshIfChanged();
  }

  bounds(): Box3 {
    const box = new Box3();
    for (const s of this.allSolids()) for (const f of buildBrushFaces(s)) for (const v of f.verts) box.expandByPoint(v);
    for (const e of this.pointEntities()) box.union(this.entityRenderer.entityBounds(e));
    return box;
  }

  /** Rebuilds the outline when a selected object changed (cheap check). */
  refreshIfChanged(): void {
    for (const s of this.allSolids()) if (this.versions.get(s) !== s.version) return this.refresh();
    for (const e of this.entities) if (this.versions.get(e) !== e.version) return this.refresh();
  }

  refresh(): void {
    const line: number[] = [];
    const tri: number[] = [];
    this.versions.clear();
    for (const s of this.allSolids()) {
      this.versions.set(s, s.version);
      for (const f of buildBrushFaces(s)) {
        const v = f.verts;
        for (let i = 0; i < v.length; i++) {
          const a = v[i], b = v[(i + 1) % v.length];
          line.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
        for (let i = 1; i < v.length - 1; i++) for (const p of [v[0], v[i], v[i + 1]]) tri.push(p.x, p.y, p.z);
      }
    }
    for (const e of this.pointEntities()) {
      this.versions.set(e, e.version);
      const b = this.entityRenderer.entityBounds(e);
      const c = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
      for (const [i, j] of [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
        line.push(c[i].x, c[i].y, c[i].z, c[j].x, c[j].y, c[j].z);
      }
    }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(new Float32Array(line), 3));
    const fg = new BufferGeometry();
    fg.setAttribute('position', new BufferAttribute(new Float32Array(tri), 3));
    this.lines.geometry.dispose();
    this.fill.geometry.dispose();
    this.lines.geometry = lg;
    this.fill.geometry = fg;
    this.onChange();
  }
}
