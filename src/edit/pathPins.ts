import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Plane, Raycaster, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapSolid } from '../vmf/map.ts';
import { h, toast } from '../ui/dom.ts';
import {
  childrenOf, insertPoint, isBranchTip, linkMiddle, movePoint, parentOf, pathLabels, removePoint, type PathPoint, type PointPath,
} from './pathPoints.ts';

/**
 * Pins for a path's points (A, B, C…) and a + handle in the middle of every stretch, over the viewport in the 3D and
 * the Top view. Drag a pin to move its point (the object rebuilds live, letting go keeps it as one undo step), click
 * a + to insert a point, Alt+click a pin to remove it, Shift+click a pin to place more points from it, Tab to pick
 * the next pin, Delete to remove the picked one, Esc to cancel a drag.
 *
 * The pins edit a `PathTarget`: a generator's object as a path (stairs now; streets and powerlines can follow). The
 * Stairs tool shows them while placing, the Select tool on selected stairs.
 */

/** Fine: green numbers. Adjusted: the generator bent a rule (amber). Refused: red, letting go snaps back. Joins: a blue ring. */
export type PathCheckLevel = 'fine' | 'adjusted' | 'refused' | 'joins';

export interface PathCheck {
  level: PathCheckLevel;
  /** What happened to the point ("dropped on a surface: height 192 → 256"), or why it can't go there. */
  note: string;
  /** Live numbers of the stretches it touches ("B → C2 · 8 steps × 16 rise …"). */
  numbers: string[];
  /** What Shift does instead ("Shift keeps 192"). */
  hint?: string;
}

/** One change of a path: every `set` rebuilds (live while dragging); `done` keeps it as one undo step, `cancel` puts back how it was. */
export interface PathEdit {
  /** `moved` maps the points of the path before this set (or before the edit) to the new ones, when they changed. */
  set(path: PointPath, moved?: number[]): void;
  done(): void;
  cancel(): void;
}

/** A generator's object as a path of points: what a generator implements so the pins can edit it. */
export interface PathTarget {
  /** The same key is the same object (the picked pin stays picked). */
  key: string;
  /** For the status line and messages ("Stairs"). */
  name: string;
  /** Fewest points it can have: Delete and Alt+click stop there. */
  min: number;
  /**
   * Points keep their own height (stairs): Shift while dragging keeps it, an inserted point gets the height halfway.
   * Without (streets, powerlines) points follow the ground: `keep` is always false and an inserted point sits on
   * the ground under it.
   */
  ownHeight: boolean;
  /** Its points now. */
  path(): PointPath;
  /** Where its pins are drawn: where the generator puts the points (blocky stairs square them to the grid). */
  shown(path: PointPath): PathPoint[];
  /**
   * Where point i goes for the surface point under the cursor (its own brushes looked through); `keep` (Shift, or no
   * surface under the cursor; only with `ownHeight`) keeps its height. `groundAt` finds the ground elsewhere.
   */
  snap(path: PointPath, i: number, hit: PathPoint, keep: boolean): PathPoint;
  /**
   * How a changed path would build: the note by a dragged pin (`i`: the point moved). 'joins' rings the pin blue
   * (a street landing on another one's centre line).
   */
  check(path: PointPath, i: number, before: PointPath): PathCheck;
  /** Starts a change: a drag, an insert, a removal, a typed number. */
  edit(label: string): PathEdit;
  /** The object's own brushes: a dragged pin looks through them for the surface under it. */
  own(solid: MapSolid): boolean;
  /** Shift+click on a pin: place more points from it. */
  branch(i: number): void;
}

/**
 * The edit of an object already placed: every set rebuilds it with `apply` (which records undo steps), and all of
 * them since the edit began are squashed into one; cancel undoes them.
 */
export function historyEdit(editor: Editor, label: string, apply: (path: PointPath) => void): PathEdit {
  const mark = editor.history.depth;
  return {
    set: (path) => { apply(path); editor.history.squash(mark, label); },
    done: () => editor.history.squash(mark, label),
    cancel: () => {
      if (editor.history.depth <= mark) return;
      while (editor.history.depth > mark) editor.history.undo();
      editor.changed();
    },
  };
}

/** Height of the highest surface at a plan point (looking down, through `skip`), or null over nothing. */
export function groundAt(editor: Editor, x: number, y: number, skip?: (solid: MapSolid) => boolean): number | null {
  const ray = new Raycaster(new Vector3(x, y, 1e5), new Vector3(0, 0, -1));
  const hit = editor.world.raycast(ray, { skip });
  return hit ? Math.round(hit.point.z) : null;
}

/** A pin pressed: a click, or a drag once the pointer moves. */
interface Press { pin: number; link: number; x: number; y: number; alt: boolean; shift: boolean }
interface Drag {
  i: number;
  edit: PathEdit;
  /** The path when the drag began (after the insert of a + drag), where the pin was, and the path at the cursor. */
  start: PointPath;
  was: PathPoint;
  path: PointPath;
  check: PathCheck | null;
  key: string;
}

const PIN_LIFT = 8;
const DRAG_START = 5;

export class PathPins {
  target: PathTarget | null = null;
  /** The picked pin (-1: none): white, and lit in the Points list. */
  selected = -1;
  /** The next point while placing: a dashed pin. */
  ghost: { at: PathPoint; name: string } | null = null;
  private editor: Editor;
  private visible: () => boolean;
  private enabled: () => boolean;
  private layer: HTMLDivElement;
  private pins: HTMLDivElement;
  private adds: HTMLDivElement;
  private extra: HTMLDivElement;
  private tip: HTMLDivElement;
  /** The stretches of a refused point, in red. */
  private lines: LineSegments;
  private press: Press | null = null;
  private drag: Drag | null = null;

  /** `visible`: when the pins show; `enabled`: when they take the pointer (off while stairs set a height). */
  constructor(editor: Editor, visible: () => boolean, enabled: () => boolean = () => true) {
    this.editor = editor;
    this.visible = visible;
    this.enabled = enabled;
    this.pins = h('div');
    this.adds = h('div');
    this.extra = h('div');
    this.tip = h('div.path-tip', { hidden: true });
    this.layer = h('div.path-pins', {}, this.adds, this.pins, this.extra, this.tip);
    this.layer.hidden = true;
    editor.container.append(this.layer);
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xe8796a, depthTest: false, transparent: true }));
    this.lines.renderOrder = 13;
    this.lines.frustumCulled = false;
    editor.scene.add(this.lines);
    this.layer.addEventListener('pointerdown', (e) => this.down(e));
    editor.on('frame', () => this.place());
  }

  get dragging(): boolean {
    return !!this.drag;
  }

  /** Shows the pins of an object (null: none). Another object drops the picked pin and any drag. */
  show(target: PathTarget | null): void {
    if (target?.key !== this.target?.key) {
      if (this.drag) this.cancelDrag();
      this.selected = -1;
    }
    this.target = target;
    if (this.target && this.selected >= this.target.path().points.length) this.selected = -1;
    this.draw();
  }

  /** Picks a pin (-1: none). */
  select(i: number): void {
    this.selected = i;
    this.draw();
    this.editor.emit('pathpins');
  }

  /** Moves a point to typed numbers (the Points list): checked like a drag, one undo step. */
  setPoint(i: number, at: PathPoint): void {
    const t = this.target;
    if (!t) return;
    const start = t.path();
    const next = movePoint(start, i, at);
    const check = t.check(next, i, start);
    const name = pathLabels(start)[i];
    if (check.level === 'refused') { toast(this.editor.container, `${name} not moved: ${check.note}`, 3000); this.editor.emit('pathpins'); return; }
    const edit = t.edit(`Move point ${name}`);
    edit.set(next);
    edit.done();
  }

  /** Removes a point; its neighbours join up. One undo step. */
  remove(i: number): void {
    const t = this.target;
    if (!t) return;
    const path = t.path();
    const r = removePoint(path, i, t.min);
    if (!r) { toast(this.editor.container, `${t.name} need at least ${t.min} points`); return; }
    const edit = t.edit(`Remove point ${pathLabels(path)[i]}`);
    edit.set(r.path, r.moved);
    edit.done();
    this.selected = -1;
    this.draw();
    this.editor.emit('pathpins');
  }

  /** Inserts a point in the middle of a stretch. One undo step. */
  insert(link: number): void {
    const t = this.target;
    if (!t) return;
    const path = t.path();
    const r = insertPoint(path, link, this.middle(path, link));
    const edit = t.edit(`Insert point ${pathLabels(r.path)[r.added]}`);
    edit.set(r.path, r.moved);
    edit.done();
    this.select(r.added);
  }

  /** Esc (cancels a drag, then drops the picked pin), Tab (next pin), Delete (removes the picked point). */
  key(e: KeyboardEvent): boolean {
    const t = this.target;
    if (!t || !this.visible() || e.altKey) return false;
    if (e.key === 'Escape') {
      if (this.drag) { this.cancelDrag(); return true; }
      if (this.selected >= 0) { this.select(-1); return true; }
      return false;
    }
    if (this.drag) return false;
    const n = t.path().points.length;
    if (e.key === 'Tab' && n) {
      this.select(this.selected < 0 ? (e.shiftKey ? n - 1 : 0) : (this.selected + (e.shiftKey ? n - 1 : 1)) % n);
      return true;
    }
    if (e.key === 'Delete' && this.selected >= 0) { this.remove(this.selected); return true; }
    return false;
  }

  // --- Pointer --------------------------------------------------------------------------------------------

  private down(e: PointerEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pin], [data-link]');
    if (!el || e.button !== 0 || !this.target || !this.enabled()) return;
    e.preventDefault();
    e.stopPropagation();
    this.press = { pin: Number(el.dataset.pin ?? -1), link: Number(el.dataset.link ?? -1), x: e.clientX, y: e.clientY, alt: e.altKey, shift: e.shiftKey };
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.press;
    if (!p || !this.target) return;
    if (!this.drag) {
      if (p.alt || Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START) return;
      this.beginDrag(p);
    }
    this.dragTo(e);
  };

  private onUp = (): void => {
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    const p = this.press, t = this.target;
    this.press = null;
    if (this.drag) return this.endDrag();
    if (!p || !t) return;
    if (p.link >= 0) return this.insert(p.link);
    if (p.alt) return this.remove(p.pin);
    this.select(p.pin);
    if (p.shift) t.branch(p.pin);
  };

  private middle(path: PointPath, link: number): PathPoint {
    const t = this.target!;
    const m = linkMiddle(t.shown(path), path.links[link]);
    const x = Math.round(m.x), y = Math.round(m.y);
    if (!t.ownHeight) return { x, y, z: groundAt(this.editor, x, y, (s) => t.own(s)) ?? Math.round(m.z) };
    return { x, y, z: Math.round(m.z / 8) * 8 };
  }

  /** A drag of a pin, or of a + (which inserts its point first, in the same undo step). */
  private beginDrag(p: Press): void {
    const t = this.target!;
    let path = t.path();
    let i = p.pin;
    const names = pathLabels(path);
    const edit = t.edit(p.link >= 0 ? 'Insert point' : `Move point ${names[i]}`);
    if (p.link >= 0) {
      const r = insertPoint(path, p.link, this.middle(path, p.link));
      edit.set(r.path, r.moved);
      path = r.path;
      i = r.added;
    }
    this.selected = i;
    this.drag = { i, edit, start: path, was: t.shown(path)[i], path, check: null, key: '' };
  }

  private dragTo(e: PointerEvent): void {
    const d = this.drag!, t = this.target!, ed = this.editor;
    const ray = ed.raycaster(ed.ndcFromEvent(e));
    const hit = ed.world.raycast(ray, { skip: (s) => t.own(s) });
    const at = hit?.point ?? ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), -d.was.z), new Vector3());
    if (!at) return;
    const p = t.snap(d.start, d.i, { x: at.x, y: at.y, z: Math.round(at.z) }, t.ownHeight && (e.shiftKey || !hit));
    const key = `${p.x},${p.y},${p.z}`;
    if (key === d.key) return;
    d.key = key;
    d.path = movePoint(d.start, d.i, p);
    d.check = t.check(d.path, d.i, d.start);
    if (d.check.level !== 'refused') d.edit.set(d.path);
    const name = pathLabels(d.path)[d.i];
    ed.status = `Dragging ${name} of ${t.name} · let go to ${d.check.level === 'refused' ? 'put it back' : 'rebuild'}${t.ownHeight ? ' · Shift keeps its height' : ''} · Esc cancels`;
    this.draw();
  }

  private endDrag(): void {
    const d = this.drag!;
    this.drag = null;
    if (d.check?.level === 'refused') {
      d.edit.cancel();
      toast(this.editor.container, `Put back: ${d.check.note}`, 3000);
    } else d.edit.done();
    this.editor.status = '';
    this.draw();
    this.editor.emit('pathpins');
  }

  private cancelDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    this.press = null;
    d.edit.cancel();
    this.editor.status = '';
    this.draw();
  }

  // --- Drawing --------------------------------------------------------------------------------------------

  /** Keeps a list of elements at `n`, made by `make`. */
  private sized(box: HTMLElement, n: number, make: () => HTMLElement): HTMLElement[] {
    while (box.children.length > n) box.lastElementChild!.remove();
    while (box.children.length < n) box.append(make());
    return [...box.children] as HTMLElement[];
  }

  /** Redraws the pins (they are kept, not replaced, so a pressed pin stays under the pointer). */
  draw(): void {
    const t = this.target;
    const path = t ? this.drag?.path ?? t.path() : { points: [], links: [] };
    const shown = t ? t.shown(path) : [];
    const names = pathLabels(path);
    const d = this.drag;
    const refused = d?.check?.level === 'refused';
    this.sized(this.pins, path.points.length, () => h('div')).forEach((el, i) => {
      const cls = ['path-pin'];
      if (i === this.selected) cls.push('sel');
      if (isBranchTip(path, i)) cls.push('branch');
      if (d && d.i === i && refused) cls.push('bad');
      if (d && d.i === i && d.check?.level === 'joins') cls.push('join');
      el.className = cls.join(' ');
      el.textContent = names[i];
      el.dataset.pin = String(i);
      el.title = `${names[i]}: drag to move · Alt+click removes · Shift+click places more from here`;
      at3(el, shown[i]);
    });
    this.sized(this.adds, d ? 0 : path.links.length, () => h('div.path-add', {}, '+')).forEach((el, k) => {
      el.dataset.link = String(k);
      el.title = `Insert a point between ${names[path.links[k].from]} and ${names[path.links[k].to]}`;
      at3(el, linkMiddle(shown, path.links[k]));
    });
    // Where the dragged pin was, and the next point while placing.
    const extras: [string, string, PathPoint][] = [];
    if (d) extras.push(['path-pin old', names[d.i], d.was]);
    if (this.ghost && !d) extras.push(['path-pin next', this.ghost.name, this.ghost.at]);
    this.sized(this.extra, extras.length, () => h('div')).forEach((el, k) => {
      el.className = extras[k][0];
      el.textContent = extras[k][1];
      at3(el, extras[k][2]);
    });
    this.drawTip(d, names, shown);
    // The refused point's stretches in red.
    const L: number[] = [];
    if (d && refused) {
      const p = shown[d.i];
      for (const j of [parentOf(path, d.i), ...childrenOf(path, d.i)]) if (j >= 0) L.push(p.x, p.y, p.z + 2, shown[j].x, shown[j].y, shown[j].z + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(L), 3));
    this.lines.geometry.dispose();
    this.lines.geometry = g;
    this.place();
  }

  private drawTip(d: Drag | null, names: string[], shown: PathPoint[]): void {
    const c = d?.check;
    this.tip.hidden = !d || !c;
    if (!d || !c) return;
    this.tip.className = `path-tip ${c.level}`;
    this.tip.replaceChildren(
      h('div', {}, h('b', {}, names[d.i]), ` ${c.note}`),
      ...c.numbers.map((n) => h('div.n', {}, n)),
      h('div.k', {}, h('kbd', {}, 'Esc'), ' puts it back', c.hint ? ' · ' : '', c.hint ? h('kbd', {}, 'Shift') : '', c.hint ? ` ${c.hint}` : ''));
    at3(this.tip, shown[d.i]);
  }

  /** Keeps the pins over their points as the camera moves. */
  private place(): void {
    const ed = this.editor;
    const on = !!this.target && this.visible();
    this.layer.hidden = !on;
    this.lines.visible = on;
    if (!on) return;
    this.layer.classList.toggle('off', !this.enabled());
    const cr = ed.container.getBoundingClientRect(), rr = ed.renderer.domElement.getBoundingClientRect();
    const v = new Vector3();
    const put = (el: HTMLElement) => {
      if (el.dataset.x === undefined) return;
      v.set(Number(el.dataset.x), Number(el.dataset.y), Number(el.dataset.z) + PIN_LIFT).project(ed.activeCamera);
      el.style.left = `${rr.left - cr.left + ((v.x + 1) / 2) * rr.width}px`;
      el.style.top = `${rr.top - cr.top + ((1 - v.y) / 2) * rr.height}px`;
      el.style.visibility = v.z > 1 ? 'hidden' : '';
    };
    for (const box of [this.pins, this.adds, this.extra]) for (const el of box.children as HTMLCollectionOf<HTMLElement>) put(el);
    if (!this.tip.hidden) put(this.tip);
  }
}

/** Ties an element to a world point (placed each frame). */
function at3(el: HTMLElement, p: PathPoint): void {
  el.dataset.x = String(p.x);
  el.dataset.y = String(p.y);
  el.dataset.z = String(p.z);
}
