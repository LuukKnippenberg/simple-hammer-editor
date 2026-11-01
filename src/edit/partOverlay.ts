import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Points, PointsMaterial, Vector3 } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { MapSolid } from '../vmf/map.ts';
import { topology } from './brushEdit.ts';
import { partVerts, type Part, type PartMode } from './parts.ts';

const SELECTED = 0xff8a10, HOVER = 0x8fd0ff, FAINT = 0xd8e6f5;

const geometry = (pos: number[]) => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
};

/** Selected faces, edges or vertices (filled, thick, big dots) and faint candidates of the brushes being edited. */
export class PartOverlay {
  readonly group = new Group();
  private faint = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: FAINT, transparent: true, opacity: 0.45, depthTest: false }));
  private dots = new Points(new BufferGeometry(), new PointsMaterial({ color: FAINT, size: 6, sizeAttenuation: false, transparent: true, opacity: 0.8, depthTest: false }));
  private sel = this.layer(SELECTED, 0.42, 4, 11);
  private hover = this.layer(HOVER, 0.22, 3, 9);

  constructor() {
    this.faint.renderOrder = this.dots.renderOrder = 12;
    this.group.add(this.faint, this.dots);
    for (const o of [this.faint, this.dots]) o.frustumCulled = false;
  }

  private layer(color: number, fillOpacity: number, width: number, dot: number) {
    const fill = new Mesh(new BufferGeometry(), new MeshBasicMaterial({
      color, transparent: true, opacity: fillOpacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    const lines = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({ color, linewidth: width, depthTest: false, transparent: true }));
    const points = new Points(new BufferGeometry(), new PointsMaterial({ color, size: dot, sizeAttenuation: false, depthTest: false }));
    fill.renderOrder = 10;
    lines.renderOrder = 13;
    points.renderOrder = 14;
    for (const o of [fill, lines, points]) o.frustumCulled = false;
    this.group.add(fill, lines, points);
    return { fill, lines, points };
  }

  private fillLayer(l: ReturnType<PartOverlay['layer']>, parts: Part[]): void {
    const tri: number[] = [], seg: number[] = [], pts: number[] = [];
    for (const p of parts) {
      const v = partVerts(p);
      if (p.kind === 'face') {
        for (let i = 1; i < v.length - 1; i++) for (const q of [v[0], v[i], v[i + 1]]) tri.push(q.x, q.y, q.z);
        v.forEach((a, i) => { const b = v[(i + 1) % v.length]; seg.push(a.x, a.y, a.z, b.x, b.y, b.z); });
      } else if (p.kind === 'edge' && v.length === 2) {
        seg.push(v[0].x, v[0].y, v[0].z, v[1].x, v[1].y, v[1].z);
      } else if (v.length) {
        pts.push(v[0].x, v[0].y, v[0].z);
      }
    }
    l.fill.geometry.dispose();
    l.fill.geometry = geometry(tri);
    l.points.geometry.dispose();
    l.points.geometry = geometry(pts);
    l.lines.geometry.dispose();
    const lg = new LineSegmentsGeometry();
    if (seg.length) lg.setPositions(seg);
    l.lines.geometry = lg;
    l.lines.visible = seg.length > 0;
  }

  /** Redraws the selection and the candidates (every edge, and in vertex mode every corner) of `brushes`. */
  update(mode: PartMode | 'object', parts: Part[], brushes: MapSolid[]): void {
    this.group.visible = mode !== 'object';
    if (mode === 'object') return;
    const seg: number[] = [], pts: number[] = [];
    for (const s of new Set(brushes)) {
      const t = topology(s);
      for (const [a, b] of t.edges) seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
      if (mode === 'vertex') for (const v of t.verts) pts.push(v.x, v.y, v.z);
    }
    this.faint.geometry.dispose();
    this.faint.geometry = geometry(seg);
    this.dots.geometry.dispose();
    this.dots.geometry = geometry(pts);
    this.fillLayer(this.sel, parts);
  }

  setHover(part: Part | null): void {
    this.fillLayer(this.hover, part ? [part] : []);
  }

  /** Centre of a set of corners (for labels and the gizmo). */
  static centre(vs: Vector3[]): Vector3 {
    const c = new Vector3();
    for (const v of vs) c.add(v);
    return c.divideScalar(vs.length || 1);
  }
}
