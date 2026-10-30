import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Plane, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickSurface, snap } from './tools.ts';
import type { ParamValue } from '../lw/kits.ts';
import { POI_TYPES, defaultParams, fitRect, poiType } from '../gen/poi/registry.ts';
import { generatePoi } from '../gen/poi/action.ts';
import type { Landscape, PoiType, Rect, Rotation } from '../gen/poi/types.ts';
import '../gen/poi/catalogue.ts';

/**
 * Drag a rectangle on the ground to fill it with the point of interest chosen in the POI tab; a click
 * without dragging places one at the type's default size. The rectangle snaps to 64 and is clamped to the
 * type's sizes; the preview shows what it will cover and which way the POI faces.
 */
export class PoiTool implements Tool {
  name: ToolName = 'poi';
  private editor: Editor;
  private start: Vector3 | null = null;
  private current = new Vector3();
  private preview: LineSegments;
  typeId = POI_TYPES[0]?.id ?? '';
  rotation: Rotation = 0;
  seed = Math.floor(Math.random() * 100000);
  landscape: Landscape | null = null;
  params: Record<string, Record<string, ParamValue>> = {};

  constructor(editor: Editor) {
    this.editor = editor;
    this.preview = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x6ee7a0, depthTest: false, transparent: true, opacity: 0.95 }));
    this.preview.renderOrder = 12;
    this.preview.frustumCulled = false;
    this.preview.visible = false;
    editor.scene.add(this.preview);
  }

  get type(): PoiType | null {
    return poiType(this.typeId) ?? POI_TYPES[0] ?? null;
  }

  paramsFor(t: PoiType): Record<string, ParamValue> {
    this.params[t.id] ??= defaultParams(t);
    return this.params[t.id];
  }

  activate(): void {}
  deactivate(): void {
    this.start = null;
    this.preview.visible = false;
    this.editor.status = '';
  }

  private rect(): Rect | null {
    const t = this.type;
    if (!t || !this.start) return null;
    const dragged = Math.abs(this.current.x - this.start.x) >= 64 || Math.abs(this.current.y - this.start.y) >= 64;
    const turned = this.rotation === 90 || this.rotation === 270;
    const [w, d] = turned ? [t.defaultSize[1], t.defaultSize[0]] : t.defaultSize;
    const r = dragged ? { x0: this.start.x, y0: this.start.y, x1: this.current.x, y1: this.current.y }
      : { x0: this.start.x - w / 2, y0: this.start.y - d / 2, x1: this.start.x + w / 2, y1: this.start.y + d / 2 };
    return fitRect(t, r, this.rotation);
  }

  down(_e: PointerEvent, ndc: Vector2): void {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return;
    this.start = new Vector3(snap(hit.point.x, 64), snap(hit.point.y, 64), Math.round(hit.point.z));
    this.current.copy(this.start);
    this.redraw();
  }

  move(_e: PointerEvent, ndc: Vector2): void {
    if (!this.start) return;
    const ray = this.editor.raycaster(ndc);
    const p = ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), -this.start.z), new Vector3());
    if (!p) return;
    this.current.set(snap(p.x, 64), snap(p.y, 64), this.start.z);
    this.redraw();
  }

  up(): void {
    const t = this.type, r = this.rect(), start = this.start;
    this.start = null;
    this.preview.visible = false;
    this.editor.status = '';
    if (!t || !r || !start) return;
    generatePoi(this.editor, t, r, start.z, { rotation: this.rotation, seed: this.seed, landscape: this.landscape ?? t.landscapes[0], params: this.paramsFor(t) });
    // The next one gets a new layout.
    this.seed = Math.floor(Math.random() * 100000);
    this.editor.emit('poi');
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.start) {
      this.start = null;
      this.preview.visible = false;
      return true;
    }
    return false;
  }

  private redraw(): void {
    const r = this.rect();
    if (!r || !this.start) { this.preview.visible = false; return; }
    const z = this.start.z + 4;
    const L: number[] = [];
    const seg = (a: number[], b: number[]) => L.push(a[0], a[1], z, b[0], b[1], z);
    const c = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
    for (let i = 0; i < 4; i++) seg(c[i], c[(i + 1) % 4]);
    // An arrow along the POI's local +y (its "front" faces local -y).
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const a = ((this.rotation + 90) * Math.PI) / 180, len = Math.min(r.x1 - r.x0, r.y1 - r.y0) / 3;
    const tip = [cx + Math.cos(a) * len, cy + Math.sin(a) * len];
    seg([cx, cy], tip);
    for (const s of [-0.5, 0.5]) seg(tip, [tip[0] - Math.cos(a + s) * 48, tip[1] - Math.sin(a + s) * 48]);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(L), 3));
    this.preview.geometry.dispose();
    this.preview.geometry = g;
    this.preview.visible = true;
    this.editor.status = `${this.type?.label}: ${r.x1 - r.x0} × ${r.y1 - r.y0}`;
  }
}
