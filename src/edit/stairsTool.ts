import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Plane, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { MapSolid, VmfDocument, type MapEntity } from '../vmf/map.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickSurface, snap } from './tools.ts';
import { buildBrushFaces } from '../geom/brush.ts';
import {
  DEFAULT_STAIRS, autoSteps, buildStairs, newStairsUid, squareTo, stairsSummary,
  type StairsFlight, type StairsNode, type StairsOptions, type StairsResult, type StairsSpec,
} from '../gen/stairs.ts';
import { applyStairs, deleteStairs, regenerateStairs } from '../gen/stairsAction.ts';
import { stairsMembers, stairsOf } from '../gen/stairsStore.ts';
import { PathPins, type PathTarget } from './pathPins.ts';
import { addPoint, lastPoint, normalizePath, parentOf, pathLabels, removePoint, type PointPath } from './pathPoints.ts';
import { stairsCheck, stairsOutline, stairsPath, stairsShown, stairsSnap } from './stairsPath.ts';

/**
 * Places stairs: click A (the foot), click B (the top end), set B's height (move the mouse up or down, scroll, or
 * type a number; click or Enter confirms). The stairs are built then, and every further click adds a point and a
 * flight from the last one, each with its own height; Shift+click starts the next flight from the landing just
 * left (A, B, C1, Shift+C2 is a T), or from a pin when clicked on. Every point has a pin (`pathPins.ts`): drag it to
 * move the point (placing carries on from the last one), click a + to insert one, Alt+click a pin to remove it.
 * Backspace takes the last point back, Esc steps back, Enter or a double click finishes. All of it is one undo step
 * (the Generate flow).
 */
export type StairsPhase = 'a' | 'b' | 'height';

export class StairsTool implements Tool {
  name: ToolName = 'stairs';
  private editor: Editor;
  /** Settings of the next stairs (and of the ones being tuned). */
  options: StairsOptions = { ...DEFAULT_STAIRS };
  phase: StairsPhase = 'a';
  nodes: StairsNode[] = [];
  flights: StairsFlight[] = [];
  /** The point the next flight leaves from. */
  from = 0;
  /** B (or C…) clicked, its height being set. */
  pending: { x: number; y: number } | null = null;
  /** Height of the pending point over the one its flight leaves. */
  height = 0;
  /** Steps typed for the pending flight (else automatic). */
  steps: number | undefined;
  /** The stairs built so far, while they are still being placed. */
  editing: MapEntity | null = null;
  /** Called with the stairs when they are first built, and after each point added or taken back. */
  onBuilt?: (stairs: MapEntity, summary: string) => void;
  onChanged?: (stairs: MapEntity | null, summary: string) => void;
  /** Ends the Generate session (a double click). */
  onFinish?: () => void;
  private hover: Vector3 | null = null;
  private typed = '';
  private uid = newStairsUid();
  private lastClick = { t: 0, x: 0, y: 0 };
  /** When the pending point was clicked (a double click finishes instead of adding it). */
  private pendingT = 0;
  private lines: LineSegments;
  private marks: LineSegments;
  /** The points' pins: dragged, inserted and removed while placing. */
  readonly pins: PathPins;
  private label: HTMLDivElement;

  constructor(editor: Editor) {
    this.editor = editor;
    const mat = (color: number) => new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    this.lines = new LineSegments(new BufferGeometry(), mat(0xffc04a));
    this.marks = new LineSegments(new BufferGeometry(), mat(0xffffff));
    const g = new Group();
    for (const l of [this.lines, this.marks]) { l.renderOrder = 12; l.frustumCulled = false; g.add(l); }
    editor.scene.add(g);
    this.pins = new PathPins(editor, () => editor.tools?.current === this, () => this.phase === 'b');
    this.label = document.createElement('div');
    this.label.className = 'gen-ghost stairs-label';
    this.label.hidden = true;
    editor.container.append(this.label);
    editor.on('frame', () => this.placeOverlays());
    // Scrolling sets the height (ahead of the camera's zoom).
    editor.renderer.domElement.addEventListener('wheel', (e) => {
      if (editor.tools.current !== this || this.phase !== 'height') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.setHeight(this.height + (e.deltaY < 0 ? 1 : -1) * Math.max(8, editor.grid));
    }, { capture: true, passive: false });
  }

  /** The spec as placed so far, with the pending point when `withPending`. */
  spec(withPending = false): StairsSpec {
    const nodes = this.nodes.map((n) => ({ ...n }));
    const flights = this.flights.map((f) => ({ ...f }));
    if (withPending && this.pending && this.nodes[this.from]) {
      nodes.push({ x: this.pending.x, y: this.pending.y, z: this.nodes[this.from].z + this.height });
      flights.push({ from: this.from, to: nodes.length - 1, ...(this.steps ? { steps: this.steps } : {}) });
    }
    return { uid: this.uid, nodes, flights, options: { ...this.options } };
  }

  /** Steps the pending flight gets. */
  get pendingSteps(): number {
    return Math.max(autoSteps(this.height), this.steps ?? 0);
  }

  /** Carries on placing points on stairs already built (Add flights, or Shift+click on a pin): from `from`, else the last point. */
  continueStairs(detail: MapEntity, from = -1): void {
    const s = stairsOf(detail);
    if (!s) return;
    this.reset();
    this.uid = s.uid;
    const path = normalizePath(stairsPath(s));
    this.nodes = path.points.map((n) => ({ ...n }));
    this.flights = path.links.map((f) => ({ ...f }));
    this.options = { ...s.options };
    this.from = from >= 0 && from < this.nodes.length ? from : this.nodes.length - 1;
    this.editing = detail;
    this.phase = 'b';
    this.redraw();
  }

  /** Forgets the stairs being placed (they stay built): the next click starts new ones. */
  reset(): void {
    this.phase = 'a';
    this.nodes = [];
    this.flights = [];
    this.from = 0;
    this.pending = null;
    this.editing = null;
    this.typed = '';
    this.steps = undefined;
    this.uid = newStairsUid();
    this.redraw();
  }

  activate(): void {}
  deactivate(): void {
    this.reset();
    this.hover = null;
    this.redraw();
    // Still the current tool while it is switched off.
    this.editor.status = '';
    this.label.hidden = true;
  }

  /** The grid point on the surface under the cursor. */
  private pointAt(ndc: Vector2): Vector3 | null {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return null;
    const g = this.editor.grid;
    return new Vector3(snap(hit.point.x, g), snap(hit.point.y, g), Math.round(hit.point.z));
  }

  /** Where the next point goes for a cursor point: squared to the grid's axes with the blocky plan. */
  private target(p: { x: number; y: number }): { x: number; y: number } {
    const f = this.nodes[this.from];
    return f && this.options.plan === 'blocky' ? squareTo(f, p) : { x: p.x, y: p.y };
  }

  down(): void {}

  move(_e: PointerEvent, ndc: Vector2): void {
    this.hoverAt(ndc);
  }

  hoverAt(ndc: Vector2): void {
    if (this.phase === 'height' && this.pending) {
      // Up and down on a vertical plane through the point, facing the camera.
      const cam = this.editor.activeCamera;
      const dir = new Vector3();
      cam.getWorldDirection(dir);
      dir.z = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();
      const at = new Vector3(this.pending.x, this.pending.y, 0);
      const p = this.editor.raycaster(ndc).ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(dir, at), new Vector3());
      if (p && !this.typed) this.setHeight(p.z - this.nodes[this.from].z);
      return;
    }
    this.hover = this.pointAt(ndc);
    this.redraw();
  }

  /** Sets the pending point's height (snapped to 8). */
  setHeight(h: number): void {
    this.height = Math.round(h / 8) * 8;
    this.redraw();
    this.editor.emit('stairs');
  }

  /** Sets the pending flight's steps (undefined: automatic). */
  setSteps(n: number | undefined): void {
    this.steps = n && n > 0 ? Math.round(n) : undefined;
    this.redraw();
    this.editor.emit('stairs');
  }

  up(e: PointerEvent, ndc: Vector2): void {
    const now = performance.now();
    const double = now - this.lastClick.t < 350 && Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) < 6;
    this.lastClick = { t: now, x: e.clientX, y: e.clientY };
    if (this.phase === 'height') {
      if (double && now - this.pendingT < 400 && this.flights.length) { this.pending = null; this.phase = 'b'; this.onFinish?.(); return; }
      this.confirm();
      return;
    }
    const p = this.pointAt(ndc);
    if (!p) return;
    if (this.phase === 'a') {
      this.nodes = [{ x: p.x, y: p.y, z: p.z }];
      this.from = 0;
      this.phase = 'b';
      this.redraw();
      this.editor.emit('stairs');
      return;
    }
    if (e.shiftKey) {
      // On a point of these stairs: the next flight leaves from there. Elsewhere: from the landing just left.
      const near = this.nodes.findIndex((n) => Math.hypot(n.x - p.x, n.y - p.y) <= this.options.width / 2 && Math.abs(n.z - p.z) <= 24);
      if (near >= 0) { this.from = near; this.redraw(); this.editor.emit('stairs'); return; }
      const before = parentOf(this.path, this.from);
      if (before >= 0) this.from = before;
    }
    const t = this.target(p);
    const f = this.nodes[this.from];
    if (Math.hypot(t.x - f.x, t.y - f.y) < 16) return;
    this.pending = t;
    // B starts at the height of the surface it was clicked on (B on a platform needs no change).
    this.height = Math.round((p.z - f.z) / 8) * 8;
    this.typed = '';
    this.steps = undefined;
    this.phase = 'height';
    this.pendingT = now;
    this.redraw();
    this.editor.emit('stairs');
  }

  /** The points placed so far as a path (the pins' model). */
  get path(): PointPath<StairsFlight> {
    return { points: this.nodes, links: this.flights };
  }

  /** Confirms the pending point's height: the stairs are built (or rebuilt) with it. */
  confirm(): void {
    if (this.phase !== 'height' || !this.pending) return;
    const at = { x: this.pending.x, y: this.pending.y, z: this.nodes[this.from].z + this.height };
    const r = addPoint(this.path, this.from, at, this.steps ? { steps: this.steps } : {});
    this.nodes = r.path.points;
    this.flights = r.path.links;
    this.from = r.added;
    this.pending = null;
    this.typed = '';
    this.steps = undefined;
    this.phase = 'b';
    this.build();
  }

  /** Builds the stairs placed so far (the first time), or rebuilds them in place. */
  private build(): void {
    const s = this.spec();
    if (!s.flights.length) return;
    if (this.editing && this.editor.doc.entities.includes(this.editing)) {
      const r = regenerateStairs(this.editor, this.editing, { nodes: s.nodes, flights: s.flights, options: s.options }, 'Edit stairs');
      if (r) { this.editing = r.detail; this.onChanged?.(r.detail, stairsSummary(r.result)); }
    } else {
      const r = applyStairs(this.editor, s, 'Generate stairs');
      this.editing = r.detail;
      this.editor.selection.clear();
      this.onBuilt?.(r.detail, stairsSummary(r.result));
    }
    this.redraw();
    this.editor.emit('stairs');
  }

  /** Rebuilds the stairs being placed with new options (the Tune step). */
  rebuild(): void {
    if (this.editing) this.build();
  }

  /** Takes the last point back. */
  private removeLast(): void {
    if (!this.flights.length) { this.reset(); return; }
    const path = this.path;
    const i = lastPoint(path, this.from);
    const before = parentOf(path, i);
    const r = removePoint(path, i)!;
    this.nodes = r.path.points;
    this.flights = r.path.links;
    this.from = Math.max(0, r.moved[before] ?? 0);
    this.applyPath();
  }

  /** Builds the points as they are now; with nothing left but A the stairs go (as part of the same generate). */
  private applyPath(): void {
    if (this.flights.length) { this.build(); return; }
    if (this.editing && this.editor.doc.entities.includes(this.editing)) deleteStairs(this.editor, this.editing);
    this.editing = null;
    this.onChanged?.(null, '');
    this.redraw();
    this.editor.emit('stairs');
  }

  /** The stairs being placed, for the pins: changes rebuild them as part of the generate. */
  private readonly pathTarget: PathTarget = {
    key: '', name: 'Stairs', min: 1, ownHeight: true,
    path: () => normalizePath(this.path),
    shown: (path) => stairsShown(this.spec(), path),
    snap: (path, i, hit, keep) => stairsSnap(this.spec(), path, i, hit, keep, this.editor.grid),
    check: (path, i, before) => stairsCheck(this.spec(), path, i, before),
    preview: (path) => stairsOutline(this.spec(), path),
    edit: () => {
      const start = { nodes: this.nodes.map((n) => ({ ...n })), flights: this.flights.map((f) => ({ ...f })), from: this.from };
      let changed = false;
      return {
        set: (path, moved) => {
          changed = true;
          if (moved) this.from = moved[this.from] >= 0 ? moved[this.from] : path.points.length - 1;
          this.nodes = path.points.map((n) => ({ ...n }));
          this.flights = path.links.map((f) => ({ ...f }));
          this.applyPath();
        },
        done: () => {},
        cancel: () => { if (changed) { Object.assign(this, start); this.applyPath(); } },
      };
    },
    own: (solid) => !!this.editing && (solid.entity === this.editing || stairsMembers(this.editor.doc, this.uid).world.includes(solid)),
    branch: (i) => { this.from = i; this.redraw(); this.editor.emit('stairs'); },
  };

  key(e: KeyboardEvent): boolean {
    const k = e.key;
    if (this.phase === 'b' && this.pins.key(e)) return true;
    if (this.phase === 'height') {
      if (k === 'Enter') this.confirm();
      else if (k === 'Escape') { this.pending = null; this.typed = ''; this.phase = 'b'; this.redraw(); this.editor.emit('stairs'); }
      else if (/^[0-9]$/.test(k) || (k === '-' && !this.typed)) { this.typed += k; this.setHeight(Number(this.typed) || 0); }
      else if (k === 'Backspace') { this.typed = this.typed.slice(0, -1); this.setHeight(Number(this.typed) || 0); }
      else return false;
      return true;
    }
    if (this.phase === 'b') {
      if (k === 'Backspace' || k === 'Delete') { this.removeLast(); return true; }
      if (k === 'Escape') {
        // Nothing built yet: back to A. Built: done placing; the Generate flow steps back from Tune.
        if (!this.flights.length) { this.reset(); this.editor.emit('stairs'); return true; }
        this.reset();
        return false;
      }
    }
    return false;
  }

  // --- Preview ----------------------------------------------------------------------------------------

  private redraw(): void {
    const L: number[] = [];
    const M: number[] = [];
    const showPending = this.phase === 'height' && this.pending;
    // The pending flight as wireframe (built in a scratch document); the hovered one as its footprint.
    let preview: StairsResult | null = null;
    if (showPending) {
      const s = this.spec(true);
      preview = buildStairs(VmfDocument.empty(), { ...s, flights: s.flights.slice(-1) });
      for (const n of preview.detail) for (const f of buildBrushFaces(new MapSolid(n, null))) {
        for (let i = 0; i < f.verts.length; i++) { const a = f.verts[i], b = f.verts[(i + 1) % f.verts.length]; L.push(a.x, a.y, a.z + 0.5, b.x, b.y, b.z + 0.5); }
      }
    } else if (this.phase === 'b' && this.hover) {
      const f = this.nodes[this.from];
      const t = this.target(this.hover);
      const len = Math.hypot(t.x - f.x, t.y - f.y);
      if (len > 1) {
        const u = new Vector2(t.x - f.x, t.y - f.y).divideScalar(len), n = new Vector2(-u.y, u.x).multiplyScalar(this.options.width / 2);
        const c = [[f.x + n.x, f.y + n.y], [t.x + n.x, t.y + n.y], [t.x - n.x, t.y - n.y], [f.x - n.x, f.y - n.y]];
        const z = f.z + 2;
        for (let i = 0; i < 4; i++) L.push(c[i][0], c[i][1], z, c[(i + 1) % 4][0], c[(i + 1) % 4][1], z);
        L.push(f.x, f.y, z, t.x, t.y, z);
      }
    }
    const cross = (x: number, y: number, z: number) => M.push(x - 12, y, z + 2, x + 12, y, z + 2, x, y - 12, z + 2, x, y + 12, z + 2, x, y, z, x, y, z + 48);
    if (this.hover && this.phase !== 'height') cross(this.hover.x, this.hover.y, this.hover.z);
    if (showPending) {
      const f = this.nodes[this.from];
      // The height arrow, from the point's ground up to where it will be.
      M.push(this.pending!.x, this.pending!.y, f.z, this.pending!.x, this.pending!.y, f.z + this.height);
    }
    for (const [obj, arr] of [[this.lines, L], [this.marks, M]] as const) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
      obj.geometry.dispose();
      obj.geometry = g;
    }
    // Pins for the points, a dashed one for the next (or pending) point, and the height read-out by the pending one.
    this.pathTarget.key = `placing:${this.uid}`;
    const next = showPending ? { x: this.pending!.x, y: this.pending!.y, z: this.nodes[this.from].z + this.height }
      : this.phase === 'b' && this.hover && this.nodes[this.from] ? { ...this.target(this.hover), z: this.hover.z } : null;
    const added = next && this.nodes.length ? addPoint(this.path, this.from, next) : null;
    this.pins.ghost = added ? { at: stairsShown(this.spec(), added.path)[added.added], name: pathLabels(added.path)[added.added] } : null;
    this.pins.show(this.nodes.length ? this.pathTarget : null);
    if (showPending && preview) {
      const fi = preview.flights[0];
      this.label.replaceChildren(
        Object.assign(document.createElement('b'), { textContent: `Height ${this.height}` }),
        Object.assign(document.createElement('span'), { textContent: fi && fi.steps ? `${fi.steps} steps × ${Math.round(fi.rise * 10) / 10} rise · ${Math.round(fi.tread * 10) / 10} tread · ${Math.round(fi.length)} long${fi.steep ? ' · too steep' : ''}` : 'Flat walkway' }));
      this.label.hidden = false;
    } else this.label.hidden = true;
    this.placeOverlays();
    this.editor.status = this.phase === 'a' ? 'Stairs · click A, the foot of the stairs'
      : this.phase === 'b' ? `Stairs · click ${this.nodes.length === 1 ? 'B, the top end' : 'the next point'} · Shift+click: branch · ${this.flights.length ? 'Enter or double-click: done · Backspace: take back a point' : 'Esc: back to A'}`
        : `Stairs · height ${this.height} · move up or down, scroll or type · click to confirm`;
    if (this.editor.tools.current !== this) this.editor.status = '';
  }

  /** Keeps the label over the pending point as the camera moves (the pins place themselves). */
  private placeOverlays(): void {
    const ed = this.editor;
    const on = ed.tools.current === this;
    if (!on) { this.label.hidden = true; return; }
    const cr = ed.container.getBoundingClientRect(), rr = ed.viewRect();
    const place = (el: HTMLElement, v: Vector3) => {
      const p = v.project(ed.activeCamera);
      el.style.left = `${rr.left - cr.left + ((p.x + 1) / 2) * rr.width}px`;
      el.style.top = `${rr.top - cr.top + ((1 - p.y) / 2) * rr.height}px`;
      el.style.visibility = p.z > 1 ? 'hidden' : '';
    };
    if (!this.label.hidden && this.pending) place(this.label, new Vector3(this.pending.x, this.pending.y, this.nodes[this.from].z + this.height / 2));
  }
}
