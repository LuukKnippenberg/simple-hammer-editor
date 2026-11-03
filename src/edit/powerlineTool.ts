import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Raycaster, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickSurface } from './tools.ts';
import { entityNode } from './actions.ts';
import { WALL_MOUNT, nextPowerlineName, powerlineEntities, powerlineOf, powerlinePlan, wallMount, wirePoint, type PoleType, type PowerlineSpec } from '../gen/powerlines.ts';
import { PathPins, groundAt, type PathTarget } from './pathPins.ts';
import { addPoint, lastPoint, parentOf, pathLabels, removePoint, type PathPoint, type PointPath } from './pathPoints.ts';
import { powerlineCheck, powerlineOutline, powerlinePath, powerlineSnap, powerlineWorld, routeOf } from './powerlinePath.ts';

/**
 * House feeds: from each pole, a sagging wire across to the nearest wall within `reach` on either side of
 * the line (found by casting rays from the first wire point), ending on the outer insulator of a wall
 * bracket that sticks out from the wall it hit. A tee pole's second crossarm has none.
 */
function feedEntities(editor: Editor, spec: PowerlineSpec, name: string, reach = 480): { classname: string; origin: Vector3; keys: Record<string, string> }[] {
  const out: { classname: string; origin: Vector3; keys: Record<string, string> }[] = [];
  powerlinePlan(spec, ground(editor)).poles.forEach((p, i) => {
    if (p.arm) return;
    const from = wirePoint(spec.pole, p.at, p.yaw, 0);
    const r = (p.yaw * Math.PI) / 180;
    for (const side of [1, -1]) {
      const dir = new Vector3(-Math.sin(r) * side, Math.cos(r) * side, -0.12).normalize();
      const ray = new Raycaster(from.clone(), dir, 24, reach);
      const hit = editor.world.raycast(ray);
      // Only walls (steep faces), not roofs or the ground.
      if (!hit || Math.abs(hit.normal.z) > 0.3) continue;
      const mount = wallMount(hit.point, hit.normal);
      const at = mount.wire.round();
      const tn = `${name}_f${i}${side > 0 ? 'a' : 'b'}`;
      const common = { RopeMaterial: 'cable/cable.vmt', Width: '1', TextureScale: '1', Subdiv: '2', Type: '0', Collide: '0', Breakable: '0', Barbed: '0', Dangling: '0' };
      out.push({ classname: 'move_rope', origin: from.clone().round(), keys: { ...common, targetname: `${tn}_0`, NextKey: `${tn}_1`, Slack: String(Math.round(from.distanceTo(at) * 0.08)), PositionInterpolator: '2', MoveSpeed: '64' } });
      out.push({ classname: 'keyframe_rope', origin: at, keys: { ...common, targetname: `${tn}_1`, Slack: '0' } });
      out.push({ classname: 'prop_static', origin: mount.origin, keys: { model: WALL_MOUNT.model, angles: `0 ${mount.yaw} 0`, solid: '0', targetname: `${tn}_mount` } });
      break;
    }
  });
  return out;
}

/** The ground under a plan point, for the poles between a line's points. */
const ground = (editor: Editor) => (x: number, y: number) => groundAt(editor, x, y);

/** Adds a powerline's entities (one undo step) and selects its first pole. */
export function addPowerline(editor: Editor, spec: PowerlineSpec, label = 'Draw powerline'): MapEntity[] {
  const doc = editor.doc;
  const name = nextPowerlineName(doc.entities);
  const defs = [...powerlineEntities(spec, name, ground(editor)), ...(spec.feeds ? feedEntities(editor, spec, name) : [])];
  const created = defs.map((e) => doc.addEntity(entityNode(editor, e.classname, e.origin, e.keys)));
  editor.history.added(label, [], created);
  editor.changed();
  return created;
}

/**
 * Rebuilds the powerline that `e` belongs to with new settings or a new route (one undo step) and selects its
 * first pole. That pole stays the same entity (rebuilt in place), so a selection of it lives through undo and redo.
 */
export function editPowerline(editor: Editor, e: MapEntity, patch: Partial<PowerlineSpec>): void {
  const line = powerlineOf(editor.doc.entities, e);
  if (!line) return;
  const keep = line.first;
  editor.history.group('Edit powerline', () => {
    editor.history.remove('Remove powerline', [], line.members.filter((m) => m !== keep));
    const doc = editor.doc;
    const spec = { ...line.spec, ...patch };
    const [first, ...defs] = [...powerlineEntities(spec, line.name, ground(editor)), ...(spec.feeds ? feedEntities(editor, spec, line.name) : [])];
    const end = editor.history.begin('Rebuild first pole', [], [keep]);
    const node = entityNode(editor, first.classname, first.origin, first.keys);
    node.set('id', String(keep.id));
    keep.node.items = node.items;
    keep.reload();
    end();
    const created = defs.map((x) => doc.addEntity(entityNode(editor, x.classname, x.origin, x.keys)));
    editor.history.added('Add powerline', [], created);
    editor.selection.set([], [keep]);
  });
  editor.changed();
}

/**
 * Click points along the route, A, B, C… (each on the ground under the cursor, on the grid, or on a street's
 * pavement when near one); Enter or a double click places the poles and strings the wires. Every point has a
 * pin (`pathPins.ts`): drag it to move the point, click a + to insert one, Alt+click a pin to remove it,
 * Shift+click a pin to branch from it (that point becomes a tee pole). Shift+click elsewhere branches from the
 * point before the last one. Backspace takes the last point back, Esc starts over. The preview shows where
 * poles will stand.
 */
export class PowerlineTool implements Tool {
  name: ToolName = 'powerline';
  private editor: Editor;
  /** The route placed so far (nothing is built until Enter). */
  path: PointPath = { points: [], links: [] };
  /** The point the next click carries on from. */
  from = 0;
  /** A placed powerline being carried on (a Shift+click on its pin): Enter rebuilds it instead of adding one. */
  editing: MapEntity | null = null;
  private hover: PathPoint | null = null;
  private lines: LineSegments;
  private lastClick = { t: 0, x: 0, y: 0 };
  /** Counts routes, so a new one drops the picked pin. */
  private routes = 0;
  /** The points' pins: dragged, inserted and removed while placing. */
  readonly pins: PathPins;
  pole: PoleType = 'wooden';
  spacing = 640;
  slack = 0.04;
  feeds = true;
  /** Called with the first pole of each powerline it builds (the Generate flow's Tune step). */
  onBuilt?: (pole: MapEntity) => void;
  /** The pins shown while no points are being placed: the powerline just built, in the Generate flow's Tune step. */
  tuned?: () => PathTarget | null;

  constructor(editor: Editor) {
    this.editor = editor;
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x9fe0ff, depthTest: false, transparent: true }));
    this.lines.renderOrder = 12;
    this.lines.frustumCulled = false;
    editor.scene.add(this.lines);
    this.pins = new PathPins(editor, () => editor.tools?.current === this);
    // The Tune step's powerline comes and goes with the Generate flow (and undo).
    for (const event of ['generate', 'change']) editor.on(event, () => { if (editor.tools?.current === this && !this.path.points.length) this.redraw(); });
  }

  activate(): void {}
  deactivate(): void {
    this.reset();
    this.hover = null;
    this.redraw();
    // Still the current tool while it is switched off.
    this.editor.status = '';
  }

  /** Forgets the route being placed: the next click starts a new one. */
  reset(): void {
    this.path = { points: [], links: [] };
    this.from = 0;
    this.editing = null;
    this.routes++;
    this.redraw();
  }

  /** Carries on placing points on a placed powerline (a Shift+click on its pin): from point `from`, else its last point. */
  continueLine(pole: MapEntity, from = -1): void {
    const line = powerlineOf(this.editor.doc.entities, pole);
    if (!line) return;
    this.reset();
    Object.assign(this, { pole: line.spec.pole, spacing: line.spec.spacing, slack: line.spec.slack, feeds: !!line.spec.feeds });
    this.path = powerlinePath(line.spec);
    this.from = from >= 0 && from < this.path.points.length ? from : this.path.points.length - 1;
    this.editing = pole;
    this.redraw();
  }

  /** The settings and route of the line being placed. */
  spec(path = this.path): PowerlineSpec {
    return { ...routeOf(path), pole: this.pole, spacing: this.spacing, slack: this.slack, feeds: this.feeds };
  }

  private pointAt(ndc: Vector2): PathPoint | null {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return null;
    return powerlineSnap(powerlineWorld(this.editor), { x: hit.point.x, y: hit.point.y, z: hit.point.z }, this.editor.grid);
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
    // Shift+click away from the pins: the next span leaves from the point before the last one (a tee there).
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
    this.path = r.path;
    this.from = Math.max(0, r.moved[before] ?? r.path.points.length - 1);
    this.redraw();
  }

  /** Builds the route placed so far (or rebuilds the placed line being carried on). */
  finish(): void {
    const path = this.path, editing = this.editing;
    this.reset();
    if (path.points.length < 2) return;
    const spec = this.spec(path);
    let first: MapEntity | undefined;
    if (editing && this.editor.doc.entities.includes(editing)) {
      editPowerline(this.editor, editing, spec);
      first = [...this.editor.selection.entities][0];
    } else {
      first = addPowerline(this.editor, spec)[0];
      this.editor.selection.set([], first ? [first] : []);
    }
    if (first) this.onBuilt?.(first);
  }

  /** The route being placed, for the pins: changes only redraw the preview (it is built on Enter). */
  private readonly pathTarget: PathTarget = {
    key: '', name: 'Powerline', min: 1, ownHeight: false,
    path: () => this.path,
    shown: (path) => path.points,
    snap: (_path, _i, hit) => powerlineSnap(powerlineWorld(this.editor), hit, this.editor.grid),
    check: (path, i, before) => powerlineCheck(this.spec(), path, i, before, powerlineWorld(this.editor)),
    edit: () => {
      const start = { path: this.path, from: this.from };
      return {
        set: (path, moved) => {
          if (moved) this.from = moved[this.from] >= 0 ? moved[this.from] : path.points.length - 1;
          this.path = path;
          this.redraw();
        },
        done: () => {},
        cancel: () => { Object.assign(this, start); this.redraw(); },
      };
    },
    own: () => false,
    branch: (i) => { this.from = i; this.redraw(); },
  };

  private redraw(): void {
    const path = this.path;
    const next = this.hover && path.points.length ? addPoint(path, this.from, this.hover) : null;
    const shown = next?.path ?? path;
    const arr: number[] = [];
    const plan = shown.points.length >= 2 ? powerlinePlan(this.spec(shown), ground(this.editor)) : null;
    if (plan) arr.push(...powerlineOutline(this.pole, plan));
    for (const p of [...path.points, ...(this.hover ? [this.hover] : [])]) arr.push(p.x - 12, p.y, p.z + 4, p.x + 12, p.y, p.z + 4, p.x, p.y - 12, p.z + 4, p.x, p.y + 12, p.z + 4);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    this.lines.geometry.dispose();
    this.lines.geometry = g;
    // Pins for the points, and a dashed one for the next.
    this.pathTarget.key = `placing-powerline:${this.routes}`;
    this.pins.ghost = next ? { at: next.path.points[next.added], name: pathLabels(next.path)[next.added] } : null;
    // Nothing being placed: the powerline just built keeps its pins in the Tune step.
    this.pins.show(path.points.length ? this.pathTarget : this.tuned?.() ?? null);
    const poles = plan ? plan.poles.filter((p) => !p.arm).length : 0;
    this.editor.status = !path.points.length ? 'Powerline · click A, where the line starts'
      : `Powerline · ${poles} poles · click the next point · Shift+click a pin: branch (tee pole) · ${path.points.length > 1 ? 'Enter or double-click: build · ' : ''}Backspace: take back a point · Esc: start over`;
    if (this.editor.tools?.current !== this) this.editor.status = '';
  }
}
