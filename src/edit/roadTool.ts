import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Vector2 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickSurface } from './tools.ts';
import { ROAD_STYLES, defaultRoad, offsetLine, roadLine, roadOf, type RoadSpec, type RoadStyle } from '../gen/roads.ts';
import { rebuildRoads, roadEntities } from '../gen/roadAction.ts';
import { PathPins, type PathTarget } from './pathPins.ts';
import { addPoint, lastPoint, parentOf, pathLabels, removePoint, type PathPoint, type PointPath } from './pathPoints.ts';
import { roadBase, roadCheck, roadPath, roadSnap, roadSpecs, type RoadBase } from './roadPath.ts';

/**
 * Click to add road points A, B, C… (they snap to the grid, and onto existing roads to join them); the preview
 * shows the rounded centre line and the road's outer edges. Every point has a pin (`pathPins.ts`): drag it to move
 * the point, click a + to insert one, Alt+click a pin to remove it, Shift+click a pin to branch from it (the branch
 * is built as a second road joined there: a T junction). Enter or a double click builds the roads, Backspace
 * removes the last point, Escape cancels.
 */
export class RoadTool implements Tool {
  name: ToolName = 'road';
  private editor: Editor;
  /** The points placed so far: a tree, each branch becomes a road of its own. */
  path: PointPath = { points: [], links: [] };
  /** The point the next click adds from. */
  from = 0;
  /** A placed road being placed on from (Enter rebuilds it), else null: Enter adds new roads. */
  editing: MapEntity | null = null;
  /** The road placed on from or branched off: its other settings (materials, kerbs) carry over. */
  private inherit: Partial<RoadBase> = {};
  /** The path when placing on from a placed road began (Enter with nothing changed builds nothing). */
  private startedAs = '';
  private hover: PathPoint | null = null;
  private preview: LineSegments;
  private markers: LineSegments;
  private lastClick = { t: 0, x: 0, y: 0 };
  /** Counts the roads placed, so each gets its own pins' key. */
  private placed = 0;
  style: RoadStyle = 'asphalt';
  width = ROAD_STYLES.asphalt.width;
  pavement = ROAD_STYLES.asphalt.pavement;
  radius = 256;
  /** Called with each road it builds (the Generate flow's Tune step). */
  onBuilt?: (road: MapEntity) => void;
  /** The points' pins: dragged, inserted, removed and branched from while placing. */
  readonly pins: PathPins;

  constructor(editor: Editor) {
    this.editor = editor;
    const mat = (color: number) => new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    this.preview = new LineSegments(new BufferGeometry(), mat(0xffc04a));
    this.markers = new LineSegments(new BufferGeometry(), mat(0xffffff));
    const g = new Group();
    for (const l of [this.preview, this.markers]) { l.renderOrder = 12; l.frustumCulled = false; g.add(l); }
    editor.scene.add(g);
    this.pins = new PathPins(editor, () => editor.tools?.current === this);
  }

  setStyle(style: RoadStyle): void {
    this.style = style;
    this.width = ROAD_STYLES[style].width;
    this.pavement = ROAD_STYLES[style].pavement;
    this.redraw();
    this.editor.emit('roadstyle');
  }

  /** The settings every road placed now gets. */
  get base(): RoadBase {
    return { ...roadBase(defaultRoad(this.style)), ...this.inherit, style: this.style, width: this.width, pavement: this.pavement, radius: this.radius };
  }

  /** The roads the points make: the first road, then one per branch. */
  get specs(): RoadSpec[] {
    return roadSpecs(this.path, this.base);
  }

  /** Places on from a placed road's point (Shift+click on its end pin): Enter rebuilds it with the new points. */
  continueRoad(entity: MapEntity, from: number): void {
    const road = roadOf(entity);
    if (!road) return;
    this.reset();
    this.takeSettings(roadBase(road));
    this.path = roadPath(road);
    this.from = Math.max(0, Math.min(from, this.path.points.length - 1));
    this.editing = entity;
    this.startedAs = JSON.stringify(this.path);
    this.redraw();
  }

  /** Starts a road at a point (Shift+click on a placed road's corner pin: a second road from there), with `base`'s settings. */
  startRoad(at: PathPoint, base: RoadBase): void {
    this.reset();
    this.takeSettings(base);
    this.path = { points: [{ x: at.x, y: at.y, z: at.z }], links: [] };
    this.redraw();
  }

  private takeSettings(base: RoadBase): void {
    const { style, width, pavement, radius, ...rest } = base;
    Object.assign(this, { style, width, pavement, radius });
    this.inherit = rest;
    this.editor.emit('roadstyle');
  }

  /** Forgets the points being placed (what was built stays). */
  reset(): void {
    this.path = { points: [], links: [] };
    this.from = 0;
    this.editing = null;
    this.inherit = {};
    this.startedAs = '';
    this.placed++;
    this.redraw();
  }

  activate(): void {}
  deactivate(): void {
    this.reset();
    this.hover = null;
    this.redraw();
    this.editor.status = '';
  }

  /** The point under the cursor: on another road's centre line if close, else on the grid. */
  private pointAt(ndc: Vector2): PathPoint | null {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return null;
    return roadSnap(this.editor, { x: hit.point.x, y: hit.point.y, z: Math.round(hit.point.z) }, this.width, (e) => e === this.editing);
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
    const f = this.path.points[this.from];
    if (!f) this.path = { points: [p], links: [] };
    else if (Math.hypot(p.x - f.x, p.y - f.y) > 8) {
      const r = addPoint(this.path, this.from, p);
      this.path = r.path;
      this.from = r.added;
    }
    this.redraw();
  }

  key(e: KeyboardEvent): boolean {
    if (!this.path.points.length) return false;
    if (this.pins.key(e)) return true;
    if (e.key === 'Enter') this.finish();
    else if (e.key === 'Escape') this.reset();
    else if (e.key === 'Backspace' || e.key === 'Delete') this.removeLast();
    else return false;
    return true;
  }

  /** Takes the last point back. */
  private removeLast(): void {
    if (this.path.points.length <= 1) { this.reset(); return; }
    const i = lastPoint(this.path, this.from);
    const before = parentOf(this.path, i);
    const r = removePoint(this.path, i)!;
    this.path = r.path;
    this.from = Math.max(0, r.moved[before] ?? 0);
    this.redraw();
  }

  /** Builds the roads placed (or rebuilds the road placed on from, adding its branches as roads of their own). */
  finish(): void {
    const specs = this.specs;
    const editing = this.editing && this.editor.doc.entities.includes(this.editing) ? this.editing : null;
    const unchanged = !!editing && JSON.stringify(this.path) === this.startedAs;
    this.reset();
    if (!specs.length || unchanged) return;
    const label = `Draw ${ROAD_STYLES[specs[0].style].label.toLowerCase()}`;
    let e: MapEntity | null;
    if (editing) {
      rebuildRoads(this.editor, label, { replace: [editing, specs[0]], add: specs.slice(1) });
      e = editing;
    } else e = rebuildRoads(this.editor, label, { add: specs });
    if (e) {
      this.editor.selection.set([], [e]);
      this.onBuilt?.(e);
    }
  }

  /** The other roads (the one placed on from is not one). */
  private others(): RoadSpec[] {
    return roadEntities(this.editor.doc).filter((r) => r.entity !== this.editing).map((r) => r.road);
  }

  /** The points being placed, for the pins: changes redraw the preview (nothing is built until Enter). */
  private readonly pathTarget: PathTarget = {
    key: '', name: 'Road', min: 1, ownHeight: false,
    path: () => this.path,
    shown: (path) => path.points,
    snap: (_path, _i, hit) => roadSnap(this.editor, hit, this.width, (e) => e === this.editing),
    check: (path, i) => roadCheck(this.base, path, i, this.others()),
    edit: () => {
      const start = { path: this.path, from: this.from };
      return {
        set: (path, moved) => {
          if (moved) this.from = moved[this.from] >= 0 ? moved[this.from] : path.points.length - 1;
          this.path = path;
          this.redraw();
        },
        done: () => {},
        cancel: () => { this.path = start.path; this.from = start.from; this.redraw(); },
      };
    },
    own: (solid) => !!this.editing && solid.entity === this.editing,
    branch: (i) => { this.from = i; this.redraw(); },
  };

  private redraw(): void {
    const points = this.path.points;
    // The roads as they would be with the hovered point added.
    const next = this.hover && points[this.from] ? addPoint(this.path, this.from, this.hover) : null;
    const roads = roadSpecs(next?.path ?? this.path, this.base);
    const lines: number[] = [];
    const strip = (line: { x: number; y: number }[], z: (i: number) => number) => {
      for (let i = 0; i + 1 < line.length; i++) lines.push(line[i].x, line[i].y, z(i), line[i + 1].x, line[i + 1].y, z(i + 1));
    };
    let length = 0;
    for (const road of roads) {
      const c = roadLine(road);
      const lift = (i: number) => c[i].z + 4;
      strip(c, lift);
      const edge = road.width / 2 + ((road.kerbs ?? ROAD_STYLES[road.style].kerb) ? 8 : 0) + road.pavement;
      for (const d of [-edge, edge, -road.width / 2, road.width / 2]) strip(offsetLine(c, d), lift);
      length += c.reduce((s, p, i) => s + (i ? p.distanceTo(c[i - 1]) : 0), 0);
    }
    const marks: number[] = [];
    if (this.hover && !points.length) {
      const p = this.hover;
      marks.push(p.x - 12, p.y, p.z + 4, p.x + 12, p.y, p.z + 4, p.x, p.y - 12, p.z + 4, p.x, p.y + 12, p.z + 4, p.x, p.y, p.z, p.x, p.y, p.z + 48);
    }
    for (const [obj, arr] of [[this.preview, lines], [this.markers, marks]] as const) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
      obj.geometry.dispose();
      obj.geometry = g;
    }
    // Pins for the points and a dashed one for the next.
    const names = pathLabels(this.path);
    this.pathTarget.key = `placing:road:${this.placed}`;
    this.pins.ghost = next ? { at: next.path.points[next.added], name: pathLabels(next.path)[next.added] } : null;
    this.pins.show(points.length ? this.pathTarget : null);
    const last = names[lastPoint(this.path, this.from)];
    const branches = roads.length > 1 ? ` (${roads.length} roads)` : '';
    this.editor.status = !points.length || this.editor.tools?.current !== this ? ''
      : `Road: ${points.length} point${points.length > 1 ? 's' : ''}${branches}, ${Math.round(length)} units · click to add ${this.pins.ghost?.name ?? 'the next point'} · Shift+click a pin: branch · `
        + `${points.length > 1 ? `Enter or double-click: done · Backspace: remove ${last}` : 'Backspace: remove A'} · Esc: cancel`;
  }
}
