import {
  Box3, Color, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector2, Vector3,
  WebGLRenderTarget, type Object3D,
} from 'three';
import type { Editor } from '../editor.ts';
import { getPref, setPref } from '../ui/prefs.ts';
import { isTyping } from './cameraControls.ts';
import {
  axisPoint, buildBrushLines, buildCameraMarker, buildEntityLines, buildGridLines, buildHandles, buildSelectionLines, clearGroup,
  drawnStep, handlePoints, type PaneAxes,
} from './wireframe.ts';

/** What a pane of the quad view shows: the rendered Camera view or one of the three 2D wireframe views. */
export type PaneKind = 'camera' | 'top' | 'front' | 'side';
export const PANE_KINDS: PaneKind[] = ['camera', 'top', 'front', 'side'];
/** The 2D panes' axes, as Hammer lays them out: Top X/Y, Front Y/Z, Side X/Z (QuadSpec A). */
export const PANE_AXES: Record<Exclude<PaneKind, 'camera'>, PaneAxes> = { top: { u: 0, v: 1, w: 2 }, front: { u: 1, v: 2, w: 0 }, side: { u: 0, v: 2, w: 1 } };
const NAMES: Record<PaneKind, [string, string]> = { camera: ['Camera', '3D · rendered'], top: ['Top', 'X / Y'], front: ['Front', 'Y / Z'], side: ['Side', 'X / Z'] };
const AXIS_LETTER = ['x', 'y', 'z'];
/** Tools that work in the Front and Side panes; the rest (generators, kits, ground, …) use Camera and Top (QuadSpec D). */
const SIDE_TOOLS = new Set(['select', 'block', 'entity', 'paint', 'decal']);
/** Gap between panes in CSS pixels (the dividers). */
const GAP = 4;
/** How far behind the plane a 2D camera sits, along the axis it looks down. */
const DEPTH = 100000;

/** Where a 2D pane looks: the centre in its (u, v) axes and the zoom in screen pixels per unit. */
export interface View2d { cu: number; cv: number; ppu: number }

interface Pane {
  kind: PaneKind;
  /** Each 2D kind keeps its own pan and zoom in this pane. */
  views: Partial<Record<PaneKind, View2d>>;
  readonly cam: OrthographicCamera;
  /** CSS pixels within the viewport. */
  rect: { x: number; y: number; w: number; h: number };
  rt: WebGLRenderTarget | null;
  /** What the render target shows (redrawn when this changes). */
  drawn: string;
  readonly grid: Group;
  readonly el: HTMLElement;
  readonly name: HTMLButtonElement;
  readonly axes: HTMLElement;
  readonly zoom: HTMLElement;
  readonly max: HTMLButtonElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

/** The axis a 2D pane's camera looks down, pointing from the plane towards the camera. */
function towardsCamera(ax: PaneAxes): Vector3 {
  return new Vector3().crossVectors(axisPoint(ax, 1, 0), axisPoint(ax, 0, 1));
}

/**
 * The optional quad view (View › Quad): Camera top left, Top, Front and Side as wireframes, like Hammer.
 * One renderer draws all four panes (scissor rectangles). The 2D panes draw into their own render targets only
 * when something changes, pans or zooms; each frame they are copied to the screen with the overlays (handles, the
 * camera marker, hover and tool previews) on top. Pointer input goes to the pane under the mouse (`input`).
 */
export class QuadView {
  on = false;
  readonly panes: Pane[];
  /** The pane taking pointer input: the one under the mouse, or the one a drag started in. */
  input = 0;
  /** The pane clicked last: amber border, named in the status bar. */
  focus = 1;
  /** The maximised pane (Shift+Z), or -1. */
  max = -1;
  /** Where the dividers are, as fractions of the viewport. */
  readonly split = new Vector2(0.5, 0.5);
  /** Main-scene helpers that also draw in the 2D panes (the hover outline, the block preview, the entity ghost). */
  readonly helpers: Object3D[] = [];
  /** The mouse over a 2D pane: which pane and where, in that pane's two axes. */
  cursor: { pane: number; u: number; v: number } | null = null;
  /** The selection's bounds, kept with the wireframe (empty when nothing is selected). */
  readonly selBox = new Box3();
  private editor: Editor;
  private chrome: HTMLElement;
  private wire = new Scene();
  private brushes = new Group();
  private ents = new Group();
  private sel = new Group();
  private overlay = new Scene();
  private marks = new Group();
  private blitScene = new Scene();
  private blitCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blitMat = new MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false });
  private keys = { brush: -1, ents: '', sel: '' };
  /** Goes up when the shared wireframe is rebuilt; part of each pane's redraw key. */
  private rev = 0;
  private selRev = 0;
  private pan: { pane: number; last: Vector2; id: number } | null = null;
  private held = false;
  private splits: HTMLElement[] = [];

  constructor(editor: Editor) {
    this.editor = editor;
    this.wire.add(this.brushes, this.ents, this.sel);
    this.overlay.add(this.marks);
    const blit = new Mesh(new PlaneGeometry(2, 2), this.blitMat);
    blit.position.z = -0.5;
    this.blitScene.add(blit);
    this.chrome = el('div', 'quad');
    this.chrome.hidden = true;
    editor.container.append(this.chrome);
    this.panes = [0, 1, 2, 3].map((i) => this.makePane(i, PANE_KINDS[i]));
    this.makeSplits();
    editor.on('selection', () => this.selRev++);
    editor.on('document', () => this.fitAll());
    this.listen();
    const saved = getPref('quad');
    if (saved?.views?.length === 4) saved.views.forEach((k, i) => { if (PANE_KINDS.includes(k)) this.panes[i].kind = k; });
    if (saved?.split) this.split.set(saved.split[0], saved.split[1]);
  }

  private makePane(i: number, kind: PaneKind): Pane {
    const root = el('div', 'quad-pane');
    const head = el('div', 'quad-head');
    const name = el('button', 'quad-name');
    name.title = 'Change what this pane shows: Camera, Top, Front, Side';
    const axes = el('span', 'quad-axes'), zoom = el('span', 'quad-zoom');
    const max = el('button', 'quad-max', '⤢');
    max.title = 'Maximise this pane (Shift+Z)';
    head.append(name, axes, el('span', 'quad-fill'), zoom, max);
    root.append(head);
    this.chrome.append(root);
    name.addEventListener('click', () => this.cycle(i));
    max.addEventListener('click', () => this.toggleMax(i));
    const cam = new OrthographicCamera(-1, 1, 1, -1, 1, DEPTH * 2);
    return { kind, views: {}, cam, rect: { x: 0, y: 0, w: 1, h: 1 }, rt: null, drawn: '', grid: new Group(), el: root, name, axes, zoom, max };
  }

  private makeSplits(): void {
    const v = el('div', 'quad-split v'), hz = el('div', 'quad-split h'), c = el('div', 'quad-split c');
    for (const s of [v, hz, c]) s.title = 'Drag to resize the panes · double-click makes them equal';
    this.splits = [v, hz, c];
    this.chrome.append(v, hz, c);
    const drag = (s: HTMLElement, x: boolean, y: boolean) => {
      s.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        s.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
          const r = this.editor.container.getBoundingClientRect();
          if (x) this.split.x = Math.min(0.85, Math.max(0.15, (m.clientX - r.left) / r.width));
          if (y) this.split.y = Math.min(0.85, Math.max(0.15, (m.clientY - r.top) / r.height));
          this.layout();
        };
        const up = () => {
          s.removeEventListener('pointermove', move);
          s.removeEventListener('pointerup', up);
          this.save();
        };
        s.addEventListener('pointermove', move);
        s.addEventListener('pointerup', up);
      });
      s.addEventListener('dblclick', () => {
        if (x) this.split.x = 0.5;
        if (y) this.split.y = 0.5;
        this.layout();
        this.save();
      });
    };
    drag(v, true, false);
    drag(hz, false, true);
    drag(c, true, true);
  }

  private save(): void {
    setPref('quad', { on: this.on, views: this.panes.map((p) => p.kind), split: [this.split.x, this.split.y] });
  }

  /** Turns the quad layout on or off (the editor's setLayout does the rest). */
  setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.chrome.hidden = !on;
    this.editor.container.classList.toggle('quad-on', on);
    this.max = -1;
    this.held = false;
    this.pan = null;
    this.editor.renderer.info.autoReset = !on;
    if (on) {
      this.layout();
      for (let i = 0; i < 4; i++) if (this.panes[i].kind !== 'camera' && !this.panes[i].views[this.panes[i].kind]) this.fit(i);
    } else {
      for (const p of this.panes) { p.rt?.dispose(); p.rt = null; p.drawn = ''; }
    }
    this.save();
  }

  /** The panes shown: all four, or the maximised one. */
  shown(): number[] {
    return this.max >= 0 ? [this.max] : [0, 1, 2, 3];
  }

  kindOf(i = this.input): PaneKind {
    return this.panes[i].kind;
  }

  /** The axes of a 2D pane (the input pane by default), or null for a Camera pane or with the quad view off. */
  axes(i = this.input): PaneAxes | null {
    const k = this.panes[i].kind;
    return this.on && k !== 'camera' ? PANE_AXES[k] : null;
  }

  /** The pan and zoom of a 2D pane. */
  view(i = this.input): View2d {
    const p = this.panes[i];
    return (p.views[p.kind] ??= { cu: 0, cv: 0, ppu: 0.25 });
  }

  /** Whether the current tool works in the input pane (Front and Side take only some tools). */
  allows(tool: string): boolean {
    const k = this.kindOf();
    return !this.on || k === 'camera' || k === 'top' || SIDE_TOOLS.has(tool);
  }

  /** Places the panes, dividers and headers in the viewport; also called when the viewport resizes. */
  layout(): void {
    if (!this.on) return;
    const W = this.editor.container.clientWidth, H = this.editor.container.clientHeight;
    const sx = Math.round(W * this.split.x), sy = Math.round(H * this.split.y), g = GAP / 2;
    const rects = [
      { x: 0, y: 0, w: sx - g, h: sy - g }, { x: sx + g, y: 0, w: W - sx - g, h: sy - g },
      { x: 0, y: sy + g, w: sx - g, h: H - sy - g }, { x: sx + g, y: sy + g, w: W - sx - g, h: H - sy - g },
    ];
    this.panes.forEach((p, i) => {
      p.rect = this.max === i ? { x: 0, y: 0, w: W, h: H } : rects[i];
      const shown = this.max < 0 || this.max === i;
      p.el.hidden = !shown;
      Object.assign(p.el.style, { left: `${p.rect.x}px`, top: `${p.rect.y}px`, width: `${p.rect.w}px`, height: `${p.rect.h}px` });
      p.el.classList.toggle('on', i === this.focus);
      p.name.textContent = `${NAMES[p.kind][0]} ▾`;
      p.axes.textContent = NAMES[p.kind][1];
      p.max.textContent = this.max >= 0 ? '▣' : '⤢';
      p.max.title = this.max >= 0 ? 'Back to four panes (Shift+Z)' : 'Maximise this pane (Shift+Z)';
      p.zoom.textContent = p.kind === 'camera' ? '' : `${Math.round(this.view(i).ppu * 1000) / 10}%`;
      p.el.dataset.kind = p.kind;
    });
    const [v, hz, c] = this.splits;
    for (const s of this.splits) s.hidden = this.max >= 0;
    Object.assign(v.style, { left: `${sx - g}px`, top: '0px', width: `${GAP}px`, height: `${H}px` });
    Object.assign(hz.style, { left: '0px', top: `${sy - g}px`, width: `${W}px`, height: `${GAP}px` });
    Object.assign(c.style, { left: `${sx - 6}px`, top: `${sy - 6}px`, width: '12px', height: '12px' });
    this.cameraAspect(this.input);
  }

  /** The perspective camera takes the shape of the Camera pane it is used in. */
  private cameraAspect(i: number): void {
    const p = this.panes[i];
    if (p.kind !== 'camera' || !p.rect.h) return;
    const a = p.rect.w / p.rect.h, cam = this.editor.camera;
    if (Math.abs(cam.aspect - a) > 1e-6) {
      cam.aspect = a;
      cam.updateProjectionMatrix();
    }
  }

  /** A pane's rectangle in page (client) coordinates. */
  clientRect(i = this.input): DOMRect {
    const r = this.editor.container.getBoundingClientRect(), p = this.panes[i].rect;
    return new DOMRect(r.left + p.x, r.top + p.y, p.w, p.h);
  }

  /** The shown pane under a page position, or -1. */
  paneAt(x: number, y: number): number {
    for (const i of this.shown()) {
      const r = this.clientRect(i);
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return i;
    }
    return -1;
  }

  /** The camera that draws pane `i`. */
  camera(i = this.input): Editor['camera'] | OrthographicCamera {
    if (this.panes[i].kind === 'camera') return this.editor.camera;
    this.applyCamera(i);
    return this.panes[i].cam;
  }

  /** Points a 2D pane's orthographic camera at its view. */
  private applyCamera(i: number): void {
    const p = this.panes[i], ax = this.axes(i);
    if (!ax) return;
    const v = this.view(i), hw = p.rect.w / 2 / v.ppu, hh = p.rect.h / 2 / v.ppu;
    const c = p.cam, centre = axisPoint(ax, v.cu, v.cv);
    c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh;
    c.position.copy(centre).addScaledVector(towardsCamera(ax), DEPTH);
    c.up.copy(axisPoint(ax, 0, 1));
    c.lookAt(centre);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }

  /** A page position as (u, v) in a 2D pane's axes. */
  toUV(i: number, x: number, y: number): [number, number] {
    const r = this.clientRect(i), v = this.view(i);
    return [v.cu + (x - r.left - r.width / 2) / v.ppu, v.cv - (y - r.top - r.height / 2) / v.ppu];
  }

  /** The world point under a page position in the input 2D pane (0 along the hidden axis). */
  worldAt(x: number, y: number): Vector3 {
    const ax = this.axes()!;
    const [u, v] = this.toUV(this.input, x, y);
    return axisPoint(ax, u, v);
  }

  /** Page coordinates of a world point in pane `i` (for scripts). */
  project(i: number, p: Vector3): [number, number] {
    const r = this.clientRect(i);
    const v = p.clone().project(this.camera(i));
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }

  /** Fits a 2D pane to the map. */
  fit(i: number, box = this.editor.world.bounds()): void {
    const ax = PANE_AXES[this.panes[i].kind as Exclude<PaneKind, 'camera'>];
    if (!ax) return;
    const p = this.panes[i], v = this.view(i);
    if (box.isEmpty()) { Object.assign(v, { cu: 0, cv: 0, ppu: 0.25 }); return; }
    const c = box.getCenter(new Vector3()), s = box.getSize(new Vector3());
    v.cu = c.getComponent(ax.u);
    v.cv = c.getComponent(ax.v);
    const w = p.rect.w > 8 ? p.rect.w : 600, h = p.rect.h > 8 ? p.rect.h : 400;
    v.ppu = Math.min(16, Math.max(1 / 64, Math.min(w / (s.getComponent(ax.u) * 1.1 + 128), h / (s.getComponent(ax.v) * 1.1 + 128))));
  }

  private fitAll(): void {
    this.panes.forEach((p, i) => {
      for (const k of ['top', 'front', 'side'] as const) {
        if (p.views[k] || p.kind === k) { const was = p.kind; p.kind = k; this.fit(i); p.kind = was; }
      }
    });
    this.layout();
  }

  /** Centres every 2D pane on a box at its own zoom (F). */
  centre(box: Box3): void {
    const c = box.getCenter(new Vector3());
    this.panes.forEach((_, i) => {
      const ax = this.axes(i);
      if (!ax) return;
      const v = this.view(i);
      v.cu = c.getComponent(ax.u);
      v.cv = c.getComponent(ax.v);
    });
  }

  /** Clicking a pane's name: the next of Camera, Top, Front, Side. */
  cycle(i: number): void {
    const p = this.panes[i];
    p.kind = PANE_KINDS[(PANE_KINDS.indexOf(p.kind) + 1) % PANE_KINDS.length];
    if (p.kind !== 'camera' && !p.views[p.kind]) this.fit(i);
    p.drawn = '';
    this.focus = this.input = i;
    this.layout();
    this.syncControls();
    this.save();
  }

  /** Maximises pane `i`, or goes back to four panes (Shift+Z). */
  toggleMax(i: number): void {
    if (!this.on) return;
    this.max = this.max >= 0 ? -1 : i;
    this.focus = this.input = i;
    this.layout();
    this.syncControls();
  }

  /** The fly camera only takes the mouse in a Camera pane. */
  private syncControls(): void {
    this.editor.controls.enabled = this.kindOf() === 'camera';
    this.cameraAspect(this.input);
  }

  /** Whether the 2D panes show resize handles: the Select tool on objects, with brushes selected. */
  private showsHandles(): boolean {
    const ed = this.editor;
    return ed.tools.current.name === 'select' && ed.selection.mode === 'object' && !this.selBox.isEmpty() && ed.selection.allSolids().length > 0;
  }

  /** The selection's rectangle in a 2D pane's axes. */
  private selRect(ax: PaneAxes): [number, number, number, number] {
    const b = this.selBox;
    return [b.min.getComponent(ax.u), b.min.getComponent(ax.v), b.max.getComponent(ax.u), b.max.getComponent(ax.v)];
  }

  /**
   * What a press at a page position grabs in the input 2D pane: a resize handle (0–7: TL, T, TR, R, BR, B, BL, L),
   * 8 inside the selection (move), or -1.
   */
  grabAt(x: number, y: number): number {
    const ax = this.axes();
    if (!ax) return -1;
    this.syncWire();
    if (this.selBox.isEmpty()) return -1;
    const [u, v] = this.toUV(this.input, x, y), ppu = this.view().ppu;
    const [u0, v0, u1, v1] = this.selRect(ax);
    if (this.showsHandles()) {
      const k = handlePoints(u0, v0, u1, v1).findIndex(([a, b]) => Math.abs(a - u) * ppu <= 6 && Math.abs(b - v) * ppu <= 6);
      if (k >= 0) return k;
    }
    const slack = 2 / ppu;
    return u >= u0 - slack && u <= u1 + slack && v >= v0 - slack && v <= v1 + slack ? 8 : -1;
  }

  /** The status bar's grid note for the focused 2D pane (or the first one shown). */
  gridNote(): string {
    const g = this.editor.grid;
    const i = this.axes(this.focus) ? this.focus : this.shown().find((k) => this.axes(k));
    if (!this.on || i === undefined) return '';
    const step = drawnStep(g, this.view(i).ppu);
    return step !== g ? `snaps to ${g}, lines every ${step} at this zoom` : `lines every ${g}`;
  }

  /** The focused pane and the cursor in its axes, for the status bar. */
  status(): { pane: string; cursor: string } {
    const k = this.panes[this.focus].kind;
    const c = this.cursor;
    let cursor = '';
    if (c) {
      const ax = this.axes(c.pane);
      if (ax) cursor = `${AXIS_LETTER[ax.u]} ${Math.round(c.u)} · ${AXIS_LETTER[ax.v]} ${Math.round(c.v)}`;
    }
    return { pane: `${NAMES[k][0]} (${NAMES[k][1]})`, cursor };
  }

  private listen(): void {
    const ed = this.editor, dom = ed.renderer.domElement;
    // Capture phase: the input pane is known before the tools, gizmo and camera see the event.
    window.addEventListener('pointerdown', (e) => {
      if (!this.on || e.target !== dom) return;
      const i = this.paneAt(e.clientX, e.clientY);
      if (i < 0) return;
      this.input = i;
      this.held = true;
      if (this.focus !== i) { this.focus = i; this.layout(); }
      this.syncControls();
      if (this.axes(i) && (e.button === 1 || e.button === 2)) {
        e.preventDefault();
        this.pan = { pane: i, last: new Vector2(e.clientX, e.clientY), id: e.pointerId };
        dom.setPointerCapture(e.pointerId);
      }
    }, true);
    window.addEventListener('pointermove', (e) => {
      if (!this.on) return;
      if (!this.held && !this.pan && e.buttons === 0 && e.target === dom) {
        const i = this.paneAt(e.clientX, e.clientY);
        if (i >= 0 && i !== this.input) { this.input = i; this.syncControls(); }
      }
      const i = this.paneAt(e.clientX, e.clientY);
      const over = this.held ? this.input : i;
      if (over >= 0 && this.axes(over) && (e.target === dom || this.held)) {
        const [u, v] = this.toUV(over, e.clientX, e.clientY);
        this.cursor = { pane: over, u, v };
      } else if (e.target === dom) this.cursor = null;
      if (this.pan) {
        const v = this.view(this.pan.pane);
        v.cu -= (e.clientX - this.pan.last.x) / v.ppu;
        v.cv += (e.clientY - this.pan.last.y) / v.ppu;
        this.pan.last.set(e.clientX, e.clientY);
      }
    }, true);
    window.addEventListener('pointerup', (e) => {
      if (this.pan && e.pointerId === this.pan.id && (e.button === 1 || e.button === 2)) this.pan = null;
      if (e.buttons === 0) this.held = false;
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.on) return;
      const i = this.paneAt(e.clientX, e.clientY);
      if (i < 0 || !this.axes(i)) return;
      e.preventDefault();
      const v = this.view(i);
      const before = this.toUV(i, e.clientX, e.clientY);
      v.ppu = Math.min(16, Math.max(1 / 64, v.ppu * (e.deltaY > 0 ? 1 / 1.2 : 1.2)));
      const after = this.toUV(i, e.clientX, e.clientY);
      v.cu += before[0] - after[0];
      v.cv += before[1] - after[1];
      this.layout();
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.on || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || !e.shiftKey || e.code !== 'KeyZ') return;
      e.preventDefault();
      this.toggleMax(this.input);
    });
  }

  /** Rebuilds the shared wireframe (brushes, entities, selection) when what it shows changed. */
  private syncWire(): void {
    const ed = this.editor, er = ed.entities;
    if (this.keys.brush !== ed.world.revision) {
      buildBrushLines(ed, this.brushes);
      this.keys.brush = ed.world.revision;
      this.rev++;
    }
    const ek = `${ed.contentRev}|${er.showProps}|${er.showMarkers}|${ed.hidden.size}|${er.stats.models}|${ed.doc.entities.length}|${ed.busy()}`;
    if (ek !== this.keys.ents) {
      buildEntityLines(ed, this.ents);
      this.keys.ents = ek;
      this.rev++;
    }
    const sk = `${this.selRev}|${ed.contentRev}|${ed.world.revision}|${ek}`;
    if (sk !== this.keys.sel) {
      buildSelectionLines(ed, this.sel);
      this.keys.sel = sk;
      this.selBox.copy(ed.selection.isEmpty ? new Box3() : ed.selection.bounds());
      this.rev++;
    }
  }

  /** Draws the shared wireframe and the grid into a 2D pane's render target, when anything in it changed. */
  private drawPane(i: number): void {
    const ed = this.editor, r = ed.renderer, p = this.panes[i], ax = this.axes(i)!, v = this.view(i);
    const pr = r.getPixelRatio(), W = Math.max(1, Math.round(p.rect.w * pr)), H = Math.max(1, Math.round(p.rect.h * pr));
    if (!p.rt || p.rt.width !== W || p.rt.height !== H) {
      p.rt?.dispose();
      p.rt = new WebGLRenderTarget(W, H, { samples: 4 });
      p.rt.texture.colorSpace = SRGBColorSpace;
      p.drawn = '';
    }
    const key = `${this.rev}|${p.kind}|${v.cu},${v.cv},${v.ppu}|${p.rect.w}x${p.rect.h}|${ed.grid}`;
    if (key === p.drawn) return;
    p.drawn = key;
    buildGridLines(ax, v.cu, v.cv, v.ppu, p.rect.w, p.rect.h, ed.grid, p.grid);
    this.wire.add(p.grid);
    const clear = r.getClearColor(new Color()), alpha = r.getClearAlpha();
    r.setRenderTarget(p.rt);
    r.setClearColor(0x000000, 1);
    r.render(this.wire, p.cam);
    r.setRenderTarget(null);
    r.setClearColor(clear, alpha);
    this.wire.remove(p.grid);
  }

  /** Draws the shown panes; called by the editor's render loop instead of its single-view render. */
  render(): void {
    const ed = this.editor, r = ed.renderer;
    r.info.reset();
    this.syncWire();
    const H = ed.container.clientHeight;
    r.setScissorTest(true);
    for (const i of this.shown()) {
      const p = this.panes[i], { x, y, w, h } = p.rect, by = H - y - h;
      if (w < 2 || h < 2) continue;
      if (p.kind === 'camera') {
        this.cameraAspect(i);
        r.setViewport(x, by, w, h);
        r.setScissor(x, by, w, h);
        r.render(ed.scene, ed.camera);
        continue;
      }
      this.applyCamera(i);
      this.drawPane(i);
      r.setViewport(x, by, w, h);
      r.setScissor(x, by, w, h);
      r.autoClear = false;
      this.blitMat.map = p.rt!.texture;
      r.render(this.blitScene, this.blitCam);
      const ax = this.axes(i)!, ppu = this.view(i).ppu;
      clearGroup(this.marks);
      if (this.showsHandles()) {
        const [u0, v0, u1, v1] = this.selRect(ax);
        buildHandles(ax, handlePoints(u0, v0, u1, v1), 3.5 / ppu, this.marks);
      }
      buildCameraMarker(ax, ed.camera.position, ed.controls.forward(), 1 / ppu, this.marks);
      r.render(this.overlay, p.cam);
      for (const o of this.helpers) if (o.parent && o.visible) r.render(o, p.cam);
      r.autoClear = true;
    }
    r.setScissorTest(false);
    this.cameraAspect(this.input);
  }
}
