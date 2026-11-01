import {
  Box3, BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Vector3,
} from 'three';
import type { MapEntity, MapSolid, VmfDocument } from '../vmf/map.ts';
import { buildBrushFaces } from '../geom/brush.ts';
import type { EntityRenderer } from '../render/entityRenderer.ts';
import { convertParts, partVerts, samePart, type Part, type SelectMode } from './parts.ts';

/** The selected brushes and entities, drawn as an orange outline over everything. */
export class Selection {
  readonly solids = new Set<MapSolid>();
  readonly entities = new Set<MapEntity>();
  /** Object mode selects brushes and entities; the other modes select parts of brushes. */
  mode: SelectMode = 'object';
  /** Selected faces, edges or vertices (sub-object modes). */
  parts: Part[] = [];
  /** Brushes being edited in a sub-object mode: their candidate edges and corners are shown. */
  readonly editing = new Set<MapSolid>();
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
    return !this.solids.size && !this.entities.size && !this.parts.length && !this.editing.size;
  }

  /**
   * Switches the selection mode. Selected brushes become the brushes being edited; going back to objects
   * selects the edited brushes; between part modes the selection converts (a face's corners, and so on).
   */
  setMode(mode: SelectMode): void {
    if (mode === this.mode) return;
    const from = this.mode;
    this.mode = mode;
    if (mode === 'object') {
      const brushes = [...this.editing, ...this.parts.map((p) => p.solid)];
      this.parts = [];
      this.editing.clear();
      return this.set(brushes);
    }
    if (from === 'object') {
      const brushes = this.allSolids().filter((s) => !s.isDisplacement);
      this.solids.clear();
      this.entities.clear();
      for (const s of brushes) this.editing.add(s);
    } else {
      for (const p of this.parts) this.editing.add(p.solid);
      this.parts = convertParts(this.parts, mode);
    }
    this.refresh();
  }

  /** Selects parts (sub-object modes); their brushes join the edited ones unless `editing` replaces them. */
  setParts(parts: Part[], editing?: MapSolid[]): void {
    this.parts = parts;
    if (editing) this.editing.clear();
    for (const s of editing ?? []) this.editing.add(s);
    for (const p of parts) this.editing.add(p.solid);
    this.refresh();
  }

  togglePart(part: Part): void {
    const i = this.parts.findIndex((p) => samePart(p, part));
    this.setParts(i >= 0 ? this.parts.filter((_, j) => j !== i) : [...this.parts, part]);
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
    this.parts = [];
    this.editing.clear();
    this.set([]);
  }

  /** Drops objects that are no longer in the document (after undo or delete). */
  prune(doc: VmfDocument): void {
    const solids = new Set(doc.allSolids());
    const ents = new Set(doc.entities);
    let changed = false;
    for (const s of this.solids) if (!solids.has(s)) { this.solids.delete(s); changed = true; }
    for (const e of this.entities) if (!ents.has(e)) { this.entities.delete(e); changed = true; }
    for (const s of this.editing) if (!solids.has(s)) { this.editing.delete(s); changed = true; }
    // Parts whose brush is gone, or that the brush no longer has (a corner merged away, an undone move).
    const parts = this.parts.filter((p) => solids.has(p.solid) && partVerts(p).length);
    if (parts.length !== this.parts.length) { this.parts = parts; changed = true; }
    if (changed) this.refresh();
    else this.refreshIfChanged();
  }

  bounds(): Box3 {
    const box = new Box3();
    if (this.mode !== 'object') {
      for (const p of this.parts) for (const v of partVerts(p)) box.expandByPoint(v);
      if (box.isEmpty()) for (const s of this.editing) for (const f of buildBrushFaces(s)) for (const v of f.verts) box.expandByPoint(v);
      return box;
    }
    for (const s of this.allSolids()) for (const f of buildBrushFaces(s)) for (const v of f.verts) box.expandByPoint(v);
    for (const e of this.pointEntities()) box.union(this.entityRenderer.entityBounds(e));
    return box;
  }

  /** Rebuilds the outline when a selected object changed (cheap check). */
  refreshIfChanged(): void {
    for (const s of this.allSolids()) if (this.versions.get(s) !== s.version) return this.refresh();
    for (const e of this.entities) if (this.versions.get(e) !== e.version) return this.refresh();
    for (const s of this.editing) if (this.versions.get(s) !== s.version) return this.refresh();
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
    for (const s of this.editing) this.versions.set(s, s.version);
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
