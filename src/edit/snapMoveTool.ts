import { Box3, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity, MapSolid } from '../vmf/map.ts';
import { isTyping } from '../render/cameraControls.ts';
import { entityModel } from '../render/entityRenderer.ts';
import { isGeneratorHandle } from '../gen/handle.ts';
import { h } from '../ui/dom.ts';
import { topology } from './brushEdit.ts';
import { partVerts, toScreen } from './parts.ts';
import type { SelectTool } from './tools.ts';
import {
  ALL_KINDS, boxNearCursor, boxShape, constrain, dragPlaneNormal, findTargets, fmtVec, handlesOf, nearestHandle, REACH,
  overlayParts, resolveSnap, syncCamera, type Handle, type HandleKind, type SnapKind, type SnapKinds, type SnapShape, type SnapView, type Target,
} from './snapMove.ts';
import './snapMove.css';

/** What a snap move in progress does, for the Selection panel, the cursor chip and the status bar. */
export interface SnapMoveInfo {
  holding: HandleKind;
  from: Vector3;
  onto: SnapKind;
  at: Vector3;
  delta: Vector3;
  /** The selection's lowest corner once dropped. */
  endsAt: Vector3;
  /** Name of what it lands on ('' for the grid). */
  target: string;
}

export const KIND_LABEL: Record<HandleKind | SnapKind, string> = { vertex: 'Vertex', edge: 'Edge', face: 'Face', origin: 'Origin', grid: 'Grid' };
const CHIPS: [keyof SnapKinds, string][] = [['vertex', '● Vertices'], ['edge', '◆ Edges'], ['face', '■ Faces'], ['grid', '# Grid']];
const KINDS_KEY = 'she.snapMoveKinds';

/** Something the selection can land on: built into corners, edges and faces only when the cursor comes near. */
interface Candidate { owner: object; bounds: Box3; label: string; shape: () => SnapShape }

const AMBER = '#f0a040', AMBER_FILL = 'rgba(233,149,42,0.25)', GREEN = '#8fcf98', BLUE = 'rgba(143,184,216,0.75)', DARK = '#0b0c0d';

function solidShape(s: MapSolid, bounds: Box3): SnapShape {
  const t = topology(s);
  return { owner: s, verts: t.verts, edges: t.edges, faces: t.faces.map((f) => ({ normal: f.normal, verts: f.verts })), bounds };
}

function entityLabel(e: MapEntity): string {
  const name = e.get('targetname');
  if (name) return name;
  const model = entityModel(e);
  return model ? model.split('/').pop()!.replace(/\.mdl$/i, '') : e.classname;
}

/**
 * Snap move with the Select tool. Hold V: the selection shows its handles and the gizmo hides. Press on one and
 * drag: corners, edges and faces of everything else near the cursor light up and the best one locks (see
 * snapMove.ts); release to drop it there as one undo step. Shift: one axis. Ctrl: keep height. Esc or letting go
 * of V first puts it back. In face, edge and vertex modes only the selected parts move.
 */
export class SnapMoveTool {
  /** V is held. */
  held = false;
  kinds: SnapKinds = { ...ALL_KINDS };
  info: SnapMoveInfo | null = null;
  private editor: Editor;
  private select: SelectTool;
  private handles: Handle[] = [];
  private hoverHandle: Handle | null = null;
  private grab: {
    handle: Handle; startEdges: [Vector3, Vector3][]; startMin: Vector3; candidates: Candidate[];
    shapes: Map<object, SnapShape>; delta: Vector3;
  } | null = null;
  private found: { best: Target | null; candidates: Target[] } = { best: null, candidates: [] };
  /** Cursor in canvas pixels. */
  private cursor = new Vector2();
  private client = new Vector2();
  private shift = false;
  private ctrl = false;
  private queued = false;
  /** The camera as last drawn (see syncCamera): when it moves, the target is looked up again. */
  private camKey = '';
  private canvas: HTMLCanvasElement;
  private card: HTMLElement;
  private chip: HTMLElement;

  constructor(editor: Editor, select: SelectTool) {
    this.editor = editor;
    this.select = select;
    try {
      const saved = JSON.parse(localStorage.getItem(KINDS_KEY) ?? 'null');
      if (saved) for (const k of Object.keys(ALL_KINDS) as (keyof SnapKinds)[]) if (typeof saved[k] === 'boolean') this.kinds[k] = saved[k];
    } catch { /* storage blocked: defaults */ }
    this.canvas = h('canvas.snap-canvas');
    this.card = this.buildCard();
    this.chip = h('div.snap-chip');
    editor.container.append(this.canvas, this.card, this.chip);
    this.applyOverlay();

    window.addEventListener('keydown', (e) => this.keyDown(e), true);
    window.addEventListener('keyup', (e) => this.keyUp(e), true);
    // Firefox and Chrome miss the keyup when the window loses focus: treat it as letting go of V.
    window.addEventListener('blur', () => this.release());
    window.addEventListener('pointerdown', (e) => this.pointerDown(e), true);
    window.addEventListener('pointermove', (e) => {
      this.client.set(e.clientX, e.clientY);
      if (!this.held) return;
      this.shift = e.shiftKey;
      this.ctrl = e.ctrlKey;
      this.queued = true;
    }, true);
    window.addEventListener('pointerup', (e) => {
      if (this.grab && e.button === 0) this.drop();
    }, true);
    editor.on('frame', () => this.frame());
    const rebuild = () => { if (this.held && !this.grab) this.collectHandles(); };
    editor.on('selection', rebuild);
    // Something else changed the map mid-drag (undo, a panel): put the drag back rather than fight it.
    editor.on('change', () => (this.grab ? this.cancel() : rebuild()));
    editor.on('document', () => this.release());
  }

  /**
   * Shows or hides the canvas, card and chip for the current state, inline: the stylesheet's
   * `#viewport canvas { display: block }` outranks a [hidden] rule, which left the last drawing on screen.
   */
  private applyOverlay(): void {
    const v = overlayParts(this.held, !!this.grab);
    const show = (el: HTMLElement, on: boolean) => { el.hidden = !on; el.style.display = on ? '' : 'none'; };
    show(this.canvas, v.canvas);
    show(this.card, v.card);
    show(this.chip, v.chip);
    if (!v.canvas) this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private buildCard(): HTMLElement {
    const chips = CHIPS.map(([k, label]) => {
      const b = h('button.snap-kind', { type: 'button', title: `Snap to ${label.slice(2).toLowerCase()}` }, label);
      const sync = () => b.classList.toggle('on', this.kinds[k]);
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => {
        this.kinds[k] = !this.kinds[k];
        sync();
        try { localStorage.setItem(KINDS_KEY, JSON.stringify(this.kinds)); } catch { /* not kept */ }
        this.queued = true;
      });
      sync();
      return b;
    });
    return h('div.overlay.tl.snap-card', {},
      h('div.snap-card-head', {}, h('span.caps', {}, 'Snap move'), h('kbd', {}, 'V'), h('span.muted', {}, 'held')),
      h('p.hint', {}, 'Grab a corner, edge or face of the selection and drop it on another one. Release V or Esc to cancel.'),
      h('div.snap-card-label.caps', {}, 'Snap to'),
      h('div.snap-kinds', {}, ...chips),
      h('div.snap-keys', {}, h('span', {}, h('kbd', {}, 'Shift'), ' one axis'), h('span', {}, h('kbd', {}, 'Ctrl'), ' keep height')));
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.code === 'KeyV' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e)) {
      if (this.editor.tools.current !== this.select) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat && !this.held) this.press();
      return;
    }
    if (!this.held) return;
    if (e.key === 'Shift' || e.key === 'Control') {
      this.shift = e.shiftKey;
      this.ctrl = e.ctrlKey;
      this.queued = true;
    } else if (this.grab && (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY')))) {
      // Undo mid-drag would restore the map underneath the drag: it cancels the drag instead.
      e.preventDefault();
      e.stopImmediatePropagation();
      this.cancel();
    }
  }

  private keyUp(e: KeyboardEvent): void {
    if (e.code === 'KeyV') return this.release();
    if (this.held && (e.key === 'Shift' || e.key === 'Control')) {
      this.shift = e.shiftKey;
      this.ctrl = e.ctrlKey;
      this.queued = true;
    }
  }

  /** V down: show the handles, hide the gizmo. */
  private press(): void {
    if (this.select.extruder.active || this.select.gizmo.dragging) return;
    this.held = true;
    this.select.cancelMarquee();
    this.select.syncGizmo();
    this.collectHandles();
    this.camKey = '';
    this.applyOverlay();
    this.queued = true;
    this.editor.emit('snapmove');
  }

  /** V up (or the window lost focus): a drag in progress is put back. */
  private release(): void {
    if (!this.held) return;
    if (this.grab) this.cancel();
    this.held = false;
    this.hoverHandle = null;
    this.applyOverlay();
    this.editor.status = '';
    this.select.syncGizmo();
    this.editor.emit('snapmove');
  }

  /** Handles of the whole selection, or of the selected faces, edges and vertices in those modes. */
  private collectHandles(): void {
    const sel = this.editor.selection;
    const out: Handle[] = [];
    if (sel.mode === 'object') {
      for (const s of sel.allSolids()) out.push(...handlesOf(solidShape(s, new Box3())));
      for (const e of sel.pointEntities()) out.push(...handlesOf(boxShape(e, this.editor.entities.entityBounds(e), e.origin ?? undefined)));
    } else {
      const seen: Vector3[] = [];
      const corner = (v: Vector3) => {
        if (seen.some((w) => w.distanceToSquared(v) < 1e-3)) return;
        seen.push(v);
        out.push({ kind: 'vertex', point: v.clone() });
      };
      for (const p of sel.parts) {
        const vs = partVerts(p);
        vs.forEach(corner);
        if (p.kind === 'edge' && vs.length === 2) out.push({ kind: 'edge', point: vs[0].clone().add(vs[1]).multiplyScalar(0.5), a: vs[0].clone(), b: vs[1].clone() });
        if (p.kind === 'face') {
          const f = topology(p.solid).faces.find((x) => x.side === p.side);
          if (!f) continue;
          f.verts.forEach((a, i) => {
            const b = f.verts[(i + 1) % f.verts.length];
            out.push({ kind: 'edge', point: a.clone().add(b).multiplyScalar(0.5), a: a.clone(), b: b.clone() });
          });
          out.push({ kind: 'face', point: f.verts.reduce((c, v) => c.add(v), new Vector3()).divideScalar(f.verts.length), normal: f.normal.clone() });
        }
      }
    }
    this.handles = out;
  }

  /** Edges of what moves, as they are now (drawn as the start outline and the landing ghost). */
  private movingEdges(): [Vector3, Vector3][] {
    const sel = this.editor.selection;
    const out: [Vector3, Vector3][] = [];
    if (sel.mode === 'object') {
      for (const s of sel.allSolids()) for (const [a, b] of topology(s).edges) out.push([a.clone(), b.clone()]);
      for (const e of sel.pointEntities()) out.push(...boxShape(e, this.editor.entities.entityBounds(e)).edges.map(([a, b]): [Vector3, Vector3] => [a.clone(), b.clone()]));
    } else {
      for (const p of sel.parts) {
        const vs = partVerts(p);
        if (vs.length < 2) continue;
        const n = p.kind === 'face' ? vs.length : 1;
        for (let i = 0; i < n; i++) out.push([vs[i].clone(), vs[(i + 1) % vs.length].clone()]);
      }
    }
    return out;
  }

  /** Everything the selection can land on: visible brushes and entities that are not part of what moves. */
  private collectCandidates(): Candidate[] {
    const ed = this.editor, sel = ed.selection;
    const moving = new Set<object>(sel.mode === 'object' ? [...sel.allSolids(), ...sel.entities] : [...sel.editing, ...sel.parts.map((p) => p.solid)]);
    const out: Candidate[] = [];
    for (const [s, bounds] of ed.world.visibleSolids()) {
      if (moving.has(s) || (s.entity && (moving.has(s.entity) || isGeneratorHandle(s.entity)))) continue;
      const name = s.entity?.get('targetname');
      out.push({ owner: s, bounds, label: name || `brush #${s.id}`, shape: () => solidShape(s, bounds) });
    }
    for (const e of ed.doc.entities) {
      if (e.solids.length || !e.origin || moving.has(e) || ed.hidden.has(e) || isGeneratorHandle(e)) continue;
      if (!(entityModel(e) ? ed.entities.showProps : ed.entities.showMarkers)) continue;
      const bounds = ed.entities.entityBounds(e);
      out.push({ owner: e, bounds, label: entityLabel(e), shape: () => boxShape(e, bounds, e.origin ?? undefined) });
    }
    return out;
  }

  private view(): SnapView {
    const ed = this.editor;
    const r = ed.renderer.domElement.getBoundingClientRect();
    const size = new Vector2(r.width, r.height), cam = ed.activeCamera;
    syncCamera(cam);
    this.cursor.set(this.client.x - r.left, this.client.y - r.top);
    return { project: (p) => toScreen(cam, size, p), ray: ed.raycaster(ed.ndcFromEvent({ clientX: this.client.x, clientY: this.client.y })).ray };
  }

  private pointerDown(e: PointerEvent): void {
    // Alt+left drag orbits the camera, as without V.
    if (!this.held || e.button !== 0 || e.altKey || e.target !== this.editor.renderer.domElement) return;
    // V held: the press grabs a handle; it never selects, box-selects or reaches the gizmo or camera.
    e.preventDefault();
    e.stopImmediatePropagation();
    this.client.set(e.clientX, e.clientY);
    const handle = nearestHandle(this.handles, this.view(), this.cursor);
    if (!handle || !this.select.snapBegin()) return;
    const sel = this.editor.selection;
    this.grab = {
      handle, startEdges: this.movingEdges(), startMin: sel.bounds().min.clone(), candidates: this.collectCandidates(),
      shapes: new Map(), delta: new Vector3(),
    };
    this.shift = e.shiftKey;
    this.ctrl = e.ctrlKey;
    this.step();
  }

  /** Finds the target under the cursor and moves the selection onto it. */
  private step(): void {
    const g = this.grab!, ed = this.editor, view = this.view();
    const near: SnapShape[] = [];
    for (const c of g.candidates) {
      if (!boxNearCursor(c.bounds, view, this.cursor, REACH)) continue;
      let s = g.shapes.get(c.owner);
      if (!s) g.shapes.set(c.owner, (s = c.shape()));
      near.push(s);
    }
    this.found = findTargets(near, view, this.cursor, { kinds: this.kinds, grabbed: g.handle });
    const best = this.found.best;
    const plane = dragPlaneNormal(ed.activeCamera.getWorldDirection(new Vector3()), this.ctrl);
    const r = resolveSnap(g.handle, best, view.ray, ed.grid, plane, this.kinds.grid);
    if (r) g.delta = constrain(r.delta, { oneAxis: this.shift, keepHeight: this.ctrl });
    this.select.snapStep(g.delta);
    const onto: SnapKind = r?.kind ?? 'grid';
    const label = best ? g.candidates.find((c) => c.owner === best.shape.owner)?.label ?? '' : '';
    this.info = {
      holding: g.handle.kind, from: g.handle.point.clone(), onto, at: g.handle.point.clone().add(g.delta),
      delta: g.delta.clone(), endsAt: g.startMin.clone().add(g.delta), target: onto === 'grid' ? '' : label,
    };
    const what = `${KIND_LABEL[g.handle.kind].toLowerCase()} onto ${onto === 'grid' ? `the ${ed.grid} grid` : `${KIND_LABEL[onto].toLowerCase()} of ${label}`}`;
    ed.status = `Snap move: ${what}${this.shift ? ' · one axis' : ''}${this.ctrl ? ' · keep height' : ''} · release to drop · Esc cancels`;
    this.chip.replaceChildren(
      h('span.caps.from', {}, KIND_LABEL[g.handle.kind]), h('span.arrow', {}, '→'), h('span.caps.to', {}, KIND_LABEL[onto]),
      h('span.mono', {}, `Δ ${fmtVec(g.delta)}`), ...(label && onto !== 'grid' ? [h('span.name', {}, label)] : []));
    this.applyOverlay();
    this.editor.emit('snapmove');
  }

  /** Mouse up: drop it there, one undo step. */
  private drop(): void {
    this.grab = null;
    this.info = null;
    this.found = { best: null, candidates: [] };
    this.applyOverlay();
    this.select.snapEnd();
    this.editor.status = this.held ? this.idleStatus() : '';
    if (this.held) this.collectHandles();
    this.editor.emit('snapmove');
  }

  /** Esc, or V let go first: put it back. */
  private cancel(): void {
    this.grab = null;
    this.info = null;
    this.found = { best: null, candidates: [] };
    this.applyOverlay();
    this.select.snapCancel();
    this.editor.status = this.held ? this.idleStatus() : '';
    if (this.held) this.collectHandles();
    this.editor.emit('snapmove');
  }

  private idleStatus(): string {
    return this.handles.length ? 'Snap move: press on a corner, edge or face of the selection and drag it onto another' : 'Snap move: select something to move first';
  }

  private frame(): void {
    if (!this.held) return;
    if (this.editor.tools.current !== this.select) return this.release();
    // The camera moved (fly, orbit, pan, zoom): the cursor now points somewhere else.
    const key = syncCamera(this.editor.activeCamera);
    if (key !== this.camKey) {
      this.camKey = key;
      this.queued = true;
    }
    if (this.queued) {
      this.queued = false;
      if (this.grab) this.step();
      else {
        this.hoverHandle = nearestHandle(this.handles, this.view(), this.cursor);
        this.editor.status = this.idleStatus();
      }
    }
    this.draw();
  }

  private draw(): void {
    const ed = this.editor, cv = this.canvas;
    const r = ed.renderer.domElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
    }
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, r.width, r.height);
    const size = new Vector2(r.width, r.height), cam = ed.activeCamera;
    const P = (p: Vector3) => toScreen(cam, size, p);
    const line = (a: Vector3, b: Vector3) => {
      const sa = P(a), sb = P(b);
      if (!sa || !sb) return;
      c.moveTo(sa.x, sa.y);
      c.lineTo(sb.x, sb.y);
    };
    const dot = (p: Vector3, rad: number, fill: string, stroke?: string, width = 1.5) => {
      const s = P(p);
      if (!s) return;
      c.beginPath();
      c.arc(s.x, s.y, rad, 0, Math.PI * 2);
      c.fillStyle = fill;
      c.fill();
      if (stroke) { c.lineWidth = width; c.strokeStyle = stroke; c.stroke(); }
    };
    const g = this.grab;
    if (!g) {
      // The handles you can grab.
      let n = 0;
      for (const hd of this.handles) {
        if (++n > 4000) break;
        const s = P(hd.point);
        if (!s) continue;
        const hot = hd === this.hoverHandle;
        c.beginPath();
        if (hd.kind === 'vertex' || hd.kind === 'origin') c.arc(s.x, s.y, hot ? 6 : 4.5, 0, Math.PI * 2);
        else if (hd.kind === 'edge') { const k = hot ? 6 : 4.5; c.moveTo(s.x, s.y - k); c.lineTo(s.x + k, s.y); c.lineTo(s.x, s.y + k); c.lineTo(s.x - k, s.y); c.closePath(); }
        else { const k = hot ? 6 : 5; c.rect(s.x - k, s.y - k, k * 2, k * 2); }
        c.fillStyle = hot ? AMBER : hd.kind === 'face' ? AMBER_FILL : DARK;
        c.fill();
        c.lineWidth = 1.5;
        c.strokeStyle = hd.kind === 'origin' ? '#ece9e2' : AMBER;
        c.stroke();
      }
      return;
    }
    const d = g.delta;
    // Where it started (faint amber) and where it lands (dashed green ghost).
    c.lineWidth = 1;
    c.setLineDash([3, 3]);
    c.strokeStyle = 'rgba(233,149,42,0.45)';
    c.beginPath();
    for (const [a, b] of g.startEdges) line(a, b);
    c.stroke();
    c.lineWidth = 1.5;
    c.setLineDash([6, 4]);
    c.strokeStyle = GREEN;
    c.beginPath();
    for (const [a, b] of g.startEdges) line(a.clone().add(d), b.clone().add(d));
    c.stroke();
    c.setLineDash([]);
    // Targets in reach light up; the best one is locked green.
    const best = this.found.best;
    for (const t of this.found.candidates.slice(0, 60)) {
      if (t === best) continue;
      if (t.kind === 'vertex') dot(t.point, 3.5, BLUE);
      else if (t.kind === 'edge') {
        c.beginPath(); line(t.a!, t.b!);
        c.lineWidth = 1.5; c.strokeStyle = BLUE; c.stroke();
      }
    }
    if (best?.kind === 'edge') {
      c.beginPath(); line(best.a!, best.b!);
      c.lineWidth = 3; c.lineCap = 'round'; c.strokeStyle = GREEN; c.stroke(); c.lineCap = 'butt';
    } else if (best?.kind === 'face') {
      c.beginPath();
      best.verts!.forEach((v, i) => { const s = P(v); if (!s) return; if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); });
      c.closePath();
      c.fillStyle = 'rgba(143,207,152,0.12)'; c.fill();
      c.lineWidth = 2; c.strokeStyle = GREEN; c.stroke();
    }
    const land = g.handle.point.clone().add(d);
    c.setLineDash([3, 5]);
    c.lineWidth = 1.5;
    c.strokeStyle = '#ece9e2';
    c.beginPath(); line(g.handle.point, land); c.stroke();
    c.setLineDash([]);
    dot(g.handle.point, 8, '#e9952a', DARK, 2);
    dot(g.handle.point, 10, 'rgba(0,0,0,0)', AMBER, 2);
    if (this.info?.onto === 'grid') dot(land, 6, 'rgba(0,0,0,0)', '#ece9e2', 1.5);
    else {
      dot(land, 13, 'rgba(143,207,152,0.12)', GREEN, 2);
      dot(land, 4, GREEN);
    }
    const s = P(land);
    if (s) Object.assign(this.chip.style, { left: `${Math.min(s.x + 22, r.width - 260)}px`, top: `${Math.min(s.y + 14, r.height - 40)}px` });
  }
}
