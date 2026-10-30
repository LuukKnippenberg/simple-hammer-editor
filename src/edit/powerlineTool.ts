import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Raycaster, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickSurface, snap } from './tools.ts';
import { entityNode } from './actions.ts';
import { POLE_TYPES, WALL_MOUNT, nextPowerlineName, polePlacements, powerlineEntities, powerlineOf, wallMount, wirePoint, type PoleType, type PowerlineSpec } from '../gen/powerlines.ts';

/**
 * House feeds: from each pole, a sagging wire across to the nearest wall within `reach` on either side of
 * the line (found by casting rays from the first wire point), ending on the outer insulator of a wall
 * bracket that sticks out from the wall it hit.
 */
function feedEntities(editor: Editor, spec: PowerlineSpec, name: string, reach = 480): { classname: string; origin: Vector3; keys: Record<string, string> }[] {
  const out: { classname: string; origin: Vector3; keys: Record<string, string> }[] = [];
  polePlacements(spec).forEach((p, i) => {
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

/** Adds a powerline's entities (one undo step) and selects its first pole. */
export function addPowerline(editor: Editor, spec: PowerlineSpec, label = 'Draw powerline'): MapEntity[] {
  const doc = editor.doc;
  const name = nextPowerlineName(doc.entities);
  const defs = [...powerlineEntities(spec, name), ...(spec.feeds ? feedEntities(editor, spec, name) : [])];
  const created = defs.map((e) => doc.addEntity(entityNode(editor, e.classname, e.origin, e.keys)));
  editor.history.added(label, [], created);
  editor.changed();
  return created;
}

/** Rebuilds the powerline that `e` belongs to with new settings (one undo step). */
export function editPowerline(editor: Editor, e: MapEntity, patch: Partial<PowerlineSpec>): void {
  const line = powerlineOf(editor.doc.entities, e);
  if (!line) return;
  editor.history.group('Edit powerline', () => {
    editor.history.remove('Remove powerline', [], line.members);
    const doc = editor.doc;
    const spec = { ...line.spec, ...patch };
    const defs = [...powerlineEntities(spec, line.name), ...(spec.feeds ? feedEntities(editor, spec, line.name) : [])];
    const created = defs.map((x) => doc.addEntity(entityNode(editor, x.classname, x.origin, x.keys)));
    editor.history.added('Add powerline', [], created);
    editor.selection.set([], created.slice(0, 1));
  });
  editor.changed();
}

/**
 * Click points along the route (the ground height is taken from what's under the cursor); Enter or a
 * double click places the poles and strings the wires. The preview shows where poles will stand.
 */
export class PowerlineTool implements Tool {
  name: ToolName = 'powerline';
  private editor: Editor;
  private points: Vector3[] = [];
  private hover: Vector3 | null = null;
  private lines: LineSegments;
  private lastClick = { t: 0, x: 0, y: 0 };
  pole: PoleType = 'wooden';
  spacing = 640;
  slack = 0.04;
  feeds = true;

  constructor(editor: Editor) {
    this.editor = editor;
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x9fe0ff, depthTest: false, transparent: true }));
    this.lines.renderOrder = 12;
    this.lines.frustumCulled = false;
    editor.scene.add(this.lines);
  }

  activate(): void {}
  deactivate(): void {
    this.points = [];
    this.hover = null;
    this.redraw();
  }

  private pointAt(ndc: Vector2): Vector3 | null {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return null;
    const g = this.editor.grid;
    return new Vector3(snap(hit.point.x, g), snap(hit.point.y, g), Math.round(hit.point.z));
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
    if (p && (!this.points.length || this.points[this.points.length - 1].distanceTo(p) > 16)) this.points.push(p);
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
    const pts = this.points;
    this.points = [];
    this.redraw();
    if (pts.length < 2) return;
    const created = addPowerline(this.editor, { points: pts, pole: this.pole, spacing: this.spacing, slack: this.slack, feeds: this.feeds });
    this.editor.selection.set([], created.slice(0, 1));
  }

  private redraw(): void {
    const pts = [...this.points, ...(this.hover && this.points.length ? [this.hover] : [])];
    const arr: number[] = [];
    if (pts.length >= 2) {
      const spec: PowerlineSpec = { points: pts, pole: this.pole, spacing: this.spacing, slack: this.slack };
      const poles = polePlacements(spec);
      for (const p of poles) arr.push(p.at.x, p.at.y, p.at.z, p.at.x, p.at.y, p.at.z + POLE_TYPES[this.pole].wires[0][2]);
      for (let w = 0; w < POLE_TYPES[this.pole].wires.length; w++) {
        for (let i = 0; i + 1 < poles.length; i++) {
          const a = wirePoint(this.pole, poles[i].at, poles[i].yaw, w), b = wirePoint(this.pole, poles[i + 1].at, poles[i + 1].yaw, w);
          arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    for (const p of [...this.points, ...(this.hover ? [this.hover] : [])]) arr.push(p.x - 12, p.y, p.z + 4, p.x + 12, p.y, p.z + 4, p.x, p.y - 12, p.z + 4, p.x, p.y + 12, p.z + 4);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    this.lines.geometry.dispose();
    this.lines.geometry = g;
    const poles = pts.length >= 2 ? polePlacements({ points: pts, pole: this.pole, spacing: this.spacing, slack: this.slack }).length : 0;
    this.editor.status = this.points.length ? `Powerline: ${poles} poles · Enter or double-click to build · Backspace undo point · Esc cancel` : '';
  }
}
