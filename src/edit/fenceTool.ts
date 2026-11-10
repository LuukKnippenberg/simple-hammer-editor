import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Vector2 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickSurface } from './tools.ts';
import { DEFAULT_FENCE, fenceOutline, fencePatch, newFenceUid, type FenceSpec } from '../gen/fences.ts';
import { applyFence, fenceGround, regenerateFence, selectFence } from '../gen/fenceAction.ts';
import { fenceOf } from '../gen/fenceStore.ts';
import { PathPins, type PathTarget } from './pathPins.ts';
import { addPoint, lastPoint, parentOf, pathLabels, removePoint, type PathPoint, type PointPath } from './pathPoints.ts';
import { carryDoors, doorKeeping, fenceCheck, fencePath, fenceSnap, withPath } from './fencePath.ts';
import { FenceDoors } from './fenceDoors.ts';
import { mountFencePlan } from './fencePlan.ts';

/** A fence's settings without its points (what the next fence gets). */
export type FenceSettings = Omit<FenceSpec, 'uid' | 'points' | 'links'>;

/**
 * Click points along the fence, A, B, C… (on the ground under the cursor, on the grid); Enter or a double click
 * builds it. Every point has a pin (`pathPins.ts`): drag it to move the point, click a + to insert one, Alt+click
 * a pin to remove it, Shift+click a pin to branch from it (a T in the fence). Backspace takes the last point back,
 * Esc starts over. Doorways are added per stretch in the panel's Doorways list and dragged along their stretch by
 * their chip in the viewport (`fenceDoors.ts`). The preview shows the posts or models and the openings.
 */
export class FenceTool implements Tool {
  name: ToolName = 'fence';
  private editor: Editor;
  /** The points placed so far (nothing is built until Enter). */
  path: PointPath = { points: [], links: [] };
  /** The point the next click carries on from. */
  from = 0;
  /** A placed fence being carried on (a Shift+click on its pin): Enter rebuilds it instead of adding one. */
  editing: MapEntity | null = null;
  private hover: PathPoint | null = null;
  private lines: LineSegments;
  private lastClick = { t: 0, x: 0, y: 0 };
  /** Counts fences, so a new one drops the picked pin. */
  private routes = 0;
  /** The points' pins: dragged, inserted and removed while placing. */
  readonly pins: PathPins;
  /** Doorway chips for the fence being placed (or tuned), and for a placed fence under the Select tool. */
  readonly doors: FenceDoors;
  readonly placedDoors: FenceDoors;
  settings: FenceSettings = { ...DEFAULT_FENCE };
  /** Called with the func_detail of each fence it builds (the Generate flow's Tune step). */
  onBuilt?: (detail: MapEntity) => void;
  /** The pins shown while no points are being placed: the fence just built, in the Generate flow's Tune step. */
  tuned?: () => PathTarget | null;

  constructor(editor: Editor) {
    this.editor = editor;
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xd8b070, depthTest: false, transparent: true }));
    this.lines.renderOrder = 12;
    this.lines.frustumCulled = false;
    editor.scene.add(this.lines);
    this.pins = new PathPins(editor, () => editor.tools?.current === this);
    this.doors = new FenceDoors(editor, () => (editor.tools?.current === this ? this.pins.target : null));
    this.placedDoors = new FenceDoors(editor, () => {
      const select = editor.tools?.select;
      const t = select && editor.tools.current === select ? select.pins.target : null;
      return t?.key.startsWith('fence:') ? t : null;
    });
    for (const event of ['generate', 'change']) editor.on(event, () => { if (editor.tools?.current === this && !this.path.points.length) this.redraw(); });
    // Placed fences in the top view.
    mountFencePlan(editor);
  }

  activate(): void {}
  deactivate(): void {
    this.reset();
    this.hover = null;
    this.redraw();
    this.editor.status = '';
  }

  /** Forgets the points being placed: the next click starts a new fence. */
  reset(): void {
    this.path = { points: [], links: [] };
    this.from = 0;
    this.editing = null;
    this.routes++;
    this.redraw();
  }

  /** Carries on placing points on a placed fence (a Shift+click on its pin): from point `from`, else its last point. */
  continueFence(detail: MapEntity, from = -1): void {
    const spec = fenceOf(detail);
    if (!spec) return;
    this.reset();
    const { uid: _uid, points: _points, links: _links, ...settings } = spec;
    this.settings = settings;
    this.path = fencePath(spec);
    this.from = from >= 0 && from < this.path.points.length ? from : this.path.points.length - 1;
    this.editing = detail;
    this.redraw();
  }

  /** The settings and points of the fence being placed. */
  spec(path = this.path): FenceSpec {
    return withPath({ uid: '', points: [], links: [], ...this.settings }, path);
  }

  /** Changes the next fence's settings (and the one being placed); a new style brings its height and spacing. */
  set(patch: Partial<FenceSettings>): void {
    this.settings = { ...this.settings, ...fencePatch(this.settings, patch) };
    if (this.settings.material === undefined) delete this.settings.material;
    this.redraw();
  }

  private pointAt(ndc: Vector2): PathPoint | null {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return null;
    return fenceSnap({ x: hit.point.x, y: hit.point.y, z: hit.point.z }, this.editor.grid, fenceGround(this.editor));
  }

  hoverAt(ndc: Vector2): void {
    this.hover = this.pointAt(ndc);
    this.redraw();
  }
  down(): void {}
  move(_e: PointerEvent, ndc: Vector2): void {
    this.hoverAt(ndc);
  }

  up(e: PointerEvent, ndc: Vector2): void {
    const now = performance.now();
    const double = now - this.lastClick.t < 350 && Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) < 6;
    this.lastClick = { t: now, x: e.clientX, y: e.clientY };
    if (double) { this.finish(); return; }
    const p = this.pointAt(ndc);
    if (!p) return;
    if (!this.path.points.length) {
      this.path = { points: [p], links: [] };
      this.from = 0;
      this.redraw();
      return;
    }
    // Shift+click away from the pins: the next stretch leaves from the point before the last one (a T there).
    if (e.shiftKey) {
      const before = parentOf(this.path, this.from);
      if (before >= 0) this.from = before;
    }
    const f = this.path.points[this.from];
    if (Math.hypot(p.x - f.x, p.y - f.y) < 16) return;
    const r = addPoint(this.path, this.from, p);
    this.path = r.path;
    this.from = r.added;
    this.redraw();
  }

  key(e: KeyboardEvent): boolean {
    if (this.pins.key(e)) return true;
    if (!this.path.points.length) return false;
    if (e.key === 'Enter') this.finish();
    else if (e.key === 'Escape') this.reset();
    else if (e.key === 'Backspace' || e.key === 'Delete') this.removeLast();
    else return false;
    return true;
  }

  /** Takes the last point back. */
  private removeLast(): void {
    if (this.path.points.length < 2) { this.reset(); return; }
    const i = lastPoint(this.path, this.from);
    const before = parentOf(this.path, i);
    const r = removePoint(this.path, i);
    if (!r) return;
    this.path = carryDoors(this.path, r.path, r.moved);
    this.from = Math.max(0, r.moved[before] ?? r.path.points.length - 1);
    this.redraw();
  }

  /** Builds the fence placed so far (or rebuilds the placed one being carried on). */
  finish(): void {
    const path = this.path, editing = this.editing;
    this.reset();
    if (path.points.length < 2) return;
    let detail: MapEntity | null = null;
    if (editing && this.editor.doc.entities.includes(editing) && fenceOf(editing)) {
      const s = this.spec(path);
      detail = regenerateFence(this.editor, editing, { ...this.settings, points: s.points, links: s.links }, 'Edit fence')?.detail ?? null;
    } else {
      detail = applyFence(this.editor, { ...this.spec(path), uid: newFenceUid() }, 'Draw fence').detail;
      selectFence(this.editor, detail);
    }
    if (detail) this.onBuilt?.(detail);
  }

  /** The fence being placed, for the pins: changes only redraw the preview (it is built on Enter). */
  private readonly pathTarget: PathTarget = {
    key: '', name: 'Fence', min: 1, ownHeight: false,
    path: () => this.path,
    shown: (path) => path.points,
    snap: (_path, _i, hit) => fenceSnap(hit, this.editor.grid, fenceGround(this.editor)),
    check: (path, i) => fenceCheck(this.spec(), path, i),
    edit: () => {
      const start = { path: this.path, from: this.from };
      return doorKeeping({
        set: (path, moved) => {
          if (moved) this.from = moved[this.from] >= 0 ? moved[this.from] : path.points.length - 1;
          this.path = path;
          this.redraw();
        },
        done: () => {},
        cancel: () => { Object.assign(this, start); this.redraw(); },
      }, () => this.path);
    },
    own: () => false,
    branch: (i) => { this.from = i; this.redraw(); },
  };

  redraw(): void {
    const path = this.path;
    const next = this.hover && path.points.length ? addPoint(path, this.from, this.hover) : null;
    const shown = next?.path ?? path;
    const arr: number[] = [];
    if (shown.points.length >= 2) arr.push(...fenceOutline(this.spec(shown), fenceGround(this.editor)));
    for (const p of [...path.points, ...(this.hover ? [this.hover] : [])]) arr.push(p.x - 12, p.y, p.z + 4, p.x + 12, p.y, p.z + 4, p.x, p.y - 12, p.z + 4, p.x, p.y + 12, p.z + 4);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    this.lines.geometry.dispose();
    this.lines.geometry = g;
    this.pathTarget.key = `placing-fence:${this.routes}`;
    this.pins.ghost = next ? { at: next.path.points[next.added], name: pathLabels(next.path)[next.added] } : null;
    this.pins.show(path.points.length ? this.pathTarget : this.tuned?.() ?? null);
    this.doors.draw();
    const length = path.links.reduce((n, l) => n + Math.hypot(path.points[l.to].x - path.points[l.from].x, path.points[l.to].y - path.points[l.from].y), 0);
    this.editor.status = !path.points.length ? 'Fence · click A, where the fence starts'
      : `Fence · ${Math.round(length)} units · click the next point · Shift+click a pin: branch · ${path.points.length > 1 ? 'Enter or double-click: build · ' : ''}Backspace: take back a point · Esc: start over`;
    if (this.editor.tools?.current !== this) this.editor.status = '';
    this.editor.emit('fence');
  }
}
