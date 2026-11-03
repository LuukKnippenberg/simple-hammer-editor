import { Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { MapSolid } from '../vmf/map.ts';
import { extrudeNode, moveFaces, sweep, topology } from './brushEdit.ts';
import { toScreen, type Part } from './parts.ts';
import { toast } from '../ui/dom.ts';

interface Source { solid: MapSolid; side: number; normal: Vector3; centre: Vector3 }

/** Screen pixels per 64 units are measured along the first face's normal; looking straight at it, mouse up pulls. */
const PROBE = 64;

/**
 * Extrudes the selected faces (face mode): pulls a new brush out of each along its normal, or with `extend`
 * (Alt flips it while dragging) moves the faces so the brushes themselves grow. Started with X: the distance
 * follows the mouse on the grid with a live preview, a click or Enter confirms, Esc or a right click cancels.
 */
export class Extruder {
  /** Extend the brushes instead of making new ones. */
  extend = false;
  /** Distance for an exact extrude from the tool options. */
  distance = 64;
  active = false;
  private editor: Editor;
  private faces: Source[] = [];
  private snaps: [MapSolid, KVNode][] = [];
  private made: MapSolid[] = [];
  private moved = false;
  private from = new Vector2();
  private dist = 0;
  private alt = false;
  private ok = true;
  private lastKey = '';
  private label: HTMLDivElement;

  constructor(editor: Editor) {
    this.editor = editor;
    this.label = document.createElement('div');
    Object.assign(this.label.style, {
      position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: '5', padding: '2px 7px', borderRadius: '3px',
      background: 'rgba(20, 24, 30, 0.85)', color: '#ffd29a', font: '12px system-ui, sans-serif', whiteSpace: 'nowrap',
    });
    editor.container.append(this.label);
  }

  get extending(): boolean {
    return this.extend !== this.alt;
  }

  /** The selected faces with their normals. */
  private sources(): Source[] {
    const sel = this.editor.selection;
    if (sel.mode !== 'face') return [];
    return sel.parts.flatMap((p) => {
      const f = topology(p.solid).faces.find((x) => x.side === p.side);
      if (!f) return [];
      const centre = f.verts.reduce((c, v) => c.add(v), new Vector3()).divideScalar(f.verts.length);
      return [{ solid: p.solid, side: p.side, normal: f.normal.clone(), centre }];
    });
  }

  private take(): boolean {
    this.faces = this.sources();
    if (!this.faces.length) {
      toast(this.editor.container, 'Select one or more faces first (Face mode, Shift+2)', 2000);
      return false;
    }
    this.snaps = [...new Set(this.faces.map((f) => f.solid))].map((s) => [s, s.node.clone()]);
    return true;
  }

  /** Starts a drag with the cursor at `at` (client pixels). */
  start(at: Vector2): boolean {
    if (this.active || !this.take()) return false;
    this.active = true;
    this.from.copy(at);
    this.dist = 0;
    this.alt = false;
    this.ok = true;
    this.lastKey = '';
    this.made = [];
    this.pointer(at, false);
    return true;
  }

  /** The cursor moved (or Alt changed): distance along the first face's normal on screen, snapped to the grid. */
  pointer(at: Vector2, alt: boolean): void {
    if (!this.active) return;
    const ed = this.editor;
    const r = ed.viewRect();
    const size = new Vector2(r.width, r.height);
    const f = this.faces[0];
    const a = toScreen(ed.activeCamera, size, f.centre), b = toScreen(ed.activeCamera, size, f.centre.clone().addScaledVector(f.normal, PROBE));
    let dir = a && b ? b.sub(a) : new Vector2(0, -40);
    if (dir.length() < 8) dir = new Vector2(0, -40);
    const t = (at.clone().sub(this.from).dot(dir) / dir.lengthSq()) * PROBE;
    const dist = Math.round(t / ed.grid) * ed.grid;
    this.alt = alt;
    const c = ed.container.getBoundingClientRect();
    Object.assign(this.label.style, { display: 'block', left: `${at.x - c.left + 16}px`, top: `${at.y - c.top + 14}px` });
    const key = `${dist}|${this.extending}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.preview(dist);
  }

  /** Puts the document back as it was before the preview. */
  private clear(): void {
    const doc = this.editor.doc;
    for (const s of this.made) doc.removeSolid(s);
    this.made = [];
    if (this.moved) for (const [s, node] of this.snaps) { s.node.items = node.clone().items; s.reload(); }
    this.moved = false;
  }

  /** Applies `dist` to the document (preview or for real); returns the caps of new brushes. */
  private apply(dist: number, extending: boolean): Part[] {
    const doc = this.editor.doc;
    const caps: Part[] = [];
    this.ok = true;
    if (!dist) return caps;
    if (extending) {
      this.moved = true;
      for (const [s] of this.snaps) {
        const mine = this.faces.filter((f) => f.solid === s).map((f): [number, Vector3] => [f.side, sweep(f.normal, dist)]);
        this.ok = moveFaces(s, mine) && this.ok;
      }
      return caps;
    }
    for (const f of this.faces) {
      const r = extrudeNode(doc, f.solid, f.side, dist);
      if (!r) continue;
      const solid = doc.addSolid(r.node, f.solid.entity);
      this.made.push(solid);
      caps.push({ solid, kind: 'face', side: r.cap, verts: [] });
    }
    return caps;
  }

  private preview(dist: number): void {
    this.clear();
    this.dist = dist;
    this.apply(dist, this.extending);
    const what = this.extending ? 'Extend' : 'Extrude';
    this.label.textContent = `${what} ${dist}${this.ok ? '' : ' · would collapse the brush'}`;
    this.editor.status = `${what} ${dist} · Alt: ${this.extending ? 'new brush' : 'extend the brush'} · click or Enter confirms · Esc cancels`;
    this.editor.changed(true);
  }

  private finish(): void {
    this.active = false;
    this.label.style.display = 'none';
    this.editor.status = '';
  }

  confirm(): void {
    if (!this.active) return;
    const dist = this.dist, extending = this.extending;
    this.clear();
    this.finish();
    this.commit(dist, extending);
  }

  cancel(): void {
    if (!this.active) return;
    this.clear();
    this.finish();
    this.editor.changed(true);
  }

  /** Extrudes the selected faces by an exact distance (tool options). */
  run(dist: number, extending = this.extend): void {
    if (this.active || !this.take()) return;
    this.commit(dist, extending);
  }

  /** The real change, one undo step: new brushes become the selection with their caps picked, to keep going. */
  private commit(dist: number, extending: boolean): void {
    const ed = this.editor;
    if (!dist) {
      ed.changed();
      return;
    }
    if (extending) {
      const end = ed.history.begin('Extend faces', this.snaps.map(([s]) => s));
      this.apply(dist, true);
      this.moved = false;
      if (!this.ok) {
        for (const [s, node] of this.snaps) { s.node.items = node.clone().items; s.reload(); }
        toast(ed.container, 'Not extended: the brush would collapse or lose a face', 2200);
      } else {
        end();
      }
      ed.changed();
      return;
    }
    const caps = this.apply(dist, false);
    const made = this.made;
    this.made = [];
    if (!made.length) return;
    ed.history.added(made.length > 1 ? 'Extrude faces' : 'Extrude face', made);
    ed.selection.setParts(caps, made);
    ed.changed();
  }
}
