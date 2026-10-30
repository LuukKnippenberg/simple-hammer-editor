import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickSurface, snap } from './tools.ts';
import { ROAD_STYLES, centreline, defaultRoad, offsetLine, snapToRoads, type RoadSpec, type RoadStyle } from '../gen/roads.ts';
import { rebuildRoads, roadEntities } from '../gen/roadAction.ts';

/**
 * Click to add road points (they snap to the grid, and onto existing roads to join them); the preview
 * shows the rounded centre line and the road's outer edges. Enter or a double click builds the road,
 * Backspace removes the last point, Escape cancels.
 */
export class RoadTool implements Tool {
  name: ToolName = 'road';
  private editor: Editor;
  private points: Vector3[] = [];
  private hover: Vector3 | null = null;
  private preview: LineSegments;
  private markers: LineSegments;
  private lastClick = { t: 0, x: 0, y: 0 };
  style: RoadStyle = 'asphalt';
  width = ROAD_STYLES.asphalt.width;
  pavement = ROAD_STYLES.asphalt.pavement;
  radius = 256;

  constructor(editor: Editor) {
    this.editor = editor;
    const mat = (color: number) => new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    this.preview = new LineSegments(new BufferGeometry(), mat(0xffc04a));
    this.markers = new LineSegments(new BufferGeometry(), mat(0xffffff));
    const g = new Group();
    for (const l of [this.preview, this.markers]) { l.renderOrder = 12; l.frustumCulled = false; g.add(l); }
    editor.scene.add(g);
  }

  setStyle(style: RoadStyle): void {
    this.style = style;
    this.width = ROAD_STYLES[style].width;
    this.pavement = ROAD_STYLES[style].pavement;
    this.redraw();
    this.editor.emit('roadstyle');
  }

  get spec(): RoadSpec {
    return { ...defaultRoad(this.style), width: this.width, pavement: this.pavement, radius: this.radius, points: this.points };
  }

  activate(): void {}
  deactivate(): void {
    this.points = [];
    this.hover = null;
    this.redraw();
  }

  /** The point under the cursor: on an existing road's centre line if close, else on the grid. */
  private pointAt(ndc: Vector2): Vector3 | null {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return null;
    const roads = roadEntities(this.editor.doc).map((r) => r.road);
    const joined = snapToRoads(roads, hit.point, Math.max(48, this.width / 2));
    if (joined) return joined;
    const g = this.editor.grid;
    return new Vector3(snap(hit.point.x, g), snap(hit.point.y, g), Math.round(hit.point.z));
  }

  down(): void {}
  move(_e: PointerEvent, ndc: Vector2): void {
    this.hoverAt(ndc);
  }

  hoverAt(ndc: Vector2): void {
    this.hover = this.pointAt(ndc);
    this.redraw();
  }

  up(e: PointerEvent, ndc: Vector2): void {
    const now = performance.now();
    const double = now - this.lastClick.t < 350 && Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) < 6;
    this.lastClick = { t: now, x: e.clientX, y: e.clientY };
    if (double) { this.finish(); return; }
    const p = this.pointAt(ndc);
    if (!p) return;
    const last = this.points[this.points.length - 1];
    if (!last || last.distanceTo(p) > 8) this.points.push(p);
    this.redraw();
  }

  key(e: KeyboardEvent): boolean {
    if (!this.points.length) return false;
    if (e.key === 'Enter') this.finish();
    else if (e.key === 'Escape') { this.points = []; this.redraw(); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { this.points.pop(); this.redraw(); }
    else return false;
    return true;
  }

  finish(): void {
    const spec = this.spec;
    this.points = [];
    this.redraw();
    if (spec.points.length < 2) return;
    const e = rebuildRoads(this.editor, `Draw ${ROAD_STYLES[spec.style].label.toLowerCase()}`, { add: spec });
    if (e) this.editor.selection.set([], [e]);
  }

  private redraw(): void {
    const pts = [...this.points, ...(this.hover && this.points.length ? [this.hover] : [])];
    const lines: number[] = [];
    const strip = (line: { x: number; y: number }[], z: (i: number) => number) => {
      for (let i = 0; i + 1 < line.length; i++) lines.push(line[i].x, line[i].y, z(i), line[i + 1].x, line[i + 1].y, z(i + 1));
    };
    if (pts.length >= 2) {
      const c = centreline(pts, this.radius);
      const lift = (i: number) => c[i].z + 4;
      strip(c, lift);
      const edge = this.width / 2 + (ROAD_STYLES[this.style].kerb ? 8 : 0) + this.pavement;
      for (const d of [-edge, edge, -this.width / 2, this.width / 2]) strip(offsetLine(c, d), lift);
    }
    const marks: number[] = [];
    for (const p of [...this.points, ...(this.hover ? [this.hover] : [])]) {
      marks.push(p.x - 12, p.y, p.z + 4, p.x + 12, p.y, p.z + 4, p.x, p.y - 12, p.z + 4, p.x, p.y + 12, p.z + 4, p.x, p.y, p.z, p.x, p.y, p.z + 48);
    }
    for (const [obj, arr] of [[this.preview, lines], [this.markers, marks]] as const) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
      obj.geometry.dispose();
      obj.geometry = g;
    }
    const len = pts.length >= 2 ? centreline(pts, this.radius).reduce((s, p, i, a) => s + (i ? p.distanceTo(a[i - 1]) : 0), 0) : 0;
    this.editor.status = this.points.length ? `Road: ${this.points.length} points, ${Math.round(len)} units · Enter or double-click to build · Backspace undo point · Esc cancel` : '';
  }
}
