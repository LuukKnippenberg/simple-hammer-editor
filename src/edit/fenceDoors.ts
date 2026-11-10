import { Plane, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { h } from '../ui/dom.ts';
import type { PathTarget } from './pathPins.ts';
import type { PathPoint } from './pathPoints.ts';
import type { FenceLink } from '../gen/fences.ts';
import { doorPoint, withDoors } from './fencePath.ts';

/**
 * Doorway chips over a fence in the viewport (the fence's pins' target): one at the middle of every doorway. Drag a
 * chip to slide its doorway along its stretch (it is rebuilt where it is let go, one undo step), Alt+click it to
 * remove the doorway, click it to pick it (lit in the Doorways list). Doorways are added in that list.
 */
export class FenceDoors {
  /** The picked doorway: its stretch and its place in the stretch's list. */
  picked: { link: number; door: number } | null = null;
  private editor: Editor;
  private target: () => PathTarget | null;
  private layer: HTMLDivElement;
  private drag: { link: number; door: number; at: number; x: number; y: number; moved: boolean; alt: boolean } | null = null;

  constructor(editor: Editor, target: () => PathTarget | null) {
    this.editor = editor;
    this.target = target;
    this.layer = h('div.fence-doors');
    this.layer.hidden = true;
    editor.container.append(this.layer);
    this.layer.addEventListener('pointerdown', (e) => this.down(e));
    editor.on('frame', () => this.place());
    for (const event of ['selection', 'change', 'document', 'toolchange', 'pathpins']) editor.on(event, () => this.draw());
  }

  /** Redraws the chips for the target's doorways now. */
  draw(): void {
    const t = this.target();
    const path = t?.path();
    const chips: { link: number; door: number; at: PathPoint; gate: boolean }[] = [];
    if (path) {
      (path.links as FenceLink[]).forEach((l, link) => (l.doors ?? []).forEach((d, door) => {
        const at = this.drag?.link === link && this.drag.door === door ? this.along(path, link, this.drag.at) : doorPoint(path, link, door);
        if (at) chips.push({ link, door, at, gate: !!d.gate });
      }));
    }
    while (this.layer.children.length > chips.length) this.layer.lastElementChild!.remove();
    while (this.layer.children.length < chips.length) this.layer.append(h('div'));
    chips.forEach((c, k) => {
      const el = this.layer.children[k] as HTMLElement;
      const on = this.picked?.link === c.link && this.picked.door === c.door;
      el.className = `fence-door${c.gate ? ' gate' : ''}${on ? ' sel' : ''}`;
      el.textContent = c.gate ? '⇆ gate' : '⇆';
      el.title = 'Doorway: drag along the fence to move it · Alt+click removes it · its width and gate are in the Doorways list';
      Object.assign(el.dataset, { link: String(c.link), door: String(c.door), x: String(c.at.x), y: String(c.at.y), z: String(c.at.z) });
    });
    this.place();
  }

  /** The point `s` along a stretch of a path. */
  private along(path: { points: PathPoint[]; links: { from: number; to: number }[] }, link: number, s: number): PathPoint {
    const l = path.links[link], a = path.points[l.from], b = path.points[l.to];
    const t = s / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }

  private down(e: PointerEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.fence-door');
    const t = this.target();
    if (!el || !t || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const link = Number(el.dataset.link), door = Number(el.dataset.door);
    const d = (t.path().links[link] as FenceLink | undefined)?.doors?.[door];
    if (!d) return;
    this.drag = { link, door, at: d.at, x: e.clientX, y: e.clientY, moved: false, alt: e.altKey };
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
  }

  private onMove = (e: PointerEvent): void => {
    const d = this.drag, t = this.target();
    if (!d || !t || d.alt) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
    d.moved = true;
    const path = t.path();
    const l = path.links[d.link], a = path.points[l.from], b = path.points[l.to];
    const ed = this.editor;
    const ray = ed.raycaster(ed.ndcFromEvent(e));
    const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), -(a.z + b.z) / 2), new Vector3());
    if (!hit) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const width = (l as FenceLink).doors![d.door].width;
    const s = ((hit.x - a.x) * (b.x - a.x) + (hit.y - a.y) * (b.y - a.y)) / len;
    const grid = Math.min(ed.grid, 16);
    d.at = Math.round(Math.max(Math.min(width, len) / 2, Math.min(len - Math.min(width, len) / 2, s)) / grid) * grid;
    ed.status = `Doorway · ${Math.round(d.at)} units along its stretch · let go to rebuild`;
    this.draw();
  };

  private onUp = (): void => {
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    const d = this.drag, t = this.target();
    this.drag = null;
    this.editor.status = '';
    if (!d || !t) return;
    const path = t.path();
    const doors = [...((path.links[d.link] as FenceLink).doors ?? [])];
    if (d.alt) {
      doors.splice(d.door, 1);
      this.picked = null;
      setDoors(t, d.link, doors, 'Remove doorway');
    } else if (d.moved) {
      doors[d.door] = { ...doors[d.door], at: d.at };
      this.picked = { link: d.link, door: d.door };
      setDoors(t, d.link, doors, 'Move doorway');
    } else {
      this.picked = this.picked?.link === d.link && this.picked.door === d.door ? null : { link: d.link, door: d.door };
      this.editor.emit('fence');
    }
    this.draw();
  };

  /** Keeps the chips over their doorways as the camera moves. */
  private place(): void {
    const ed = this.editor;
    const on = !!this.target() && this.layer.children.length > 0;
    this.layer.hidden = !on;
    if (!on) return;
    const cr = ed.container.getBoundingClientRect(), rr = ed.viewRect();
    const v = new Vector3();
    for (const el of this.layer.children as HTMLCollectionOf<HTMLElement>) {
      v.set(Number(el.dataset.x), Number(el.dataset.y), Number(el.dataset.z) + 40).project(ed.activeCamera);
      el.style.left = `${rr.left - cr.left + ((v.x + 1) / 2) * rr.width}px`;
      el.style.top = `${rr.top - cr.top + ((1 - v.y) / 2) * rr.height}px`;
      el.style.visibility = v.z > 1 ? 'hidden' : '';
    }
  }
}

/** Replaces one stretch's doorways through a fence's pins' target: one undo step (or a redraw while placing). */
export function setDoors(target: PathTarget, link: number, doors: FenceLink['doors'] & object, label: string): void {
  const edit = target.edit(label);
  edit.set(withDoors(target.path(), link, doors));
  edit.done();
}
