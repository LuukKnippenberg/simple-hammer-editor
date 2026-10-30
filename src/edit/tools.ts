import {
  BoxGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Object3D, Plane,
  Vector2, Vector3, Box3,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Editor } from '../editor.ts';
import type { MapEntity, MapSolid, TexAxis } from '../vmf/map.ts';
import { boxSolid, remapSolid, translateSolid } from './brushes.ts';
import { placeEntity } from './actions.ts';
import { KITS, recordKit, type ParamValue } from '../lw/kits.ts';
import { moveOverlayBasis, placeDecal } from './decals.ts';
import { shapeSolids, type ShapeKind } from './shapes.ts';
import { RoadTool } from './roadTool.ts';
import { GroundTool } from './groundTool.ts';
import { isTyping } from '../render/cameraControls.ts';

export type ToolName = 'select' | 'block' | 'paint' | 'entity' | 'kit' | 'decal' | 'road' | 'ground';

export interface Tool {
  name: ToolName;
  activate(): void;
  deactivate(): void;
  down(e: PointerEvent, ndc: Vector2): void;
  move(e: PointerEvent, ndc: Vector2): void;
  up(e: PointerEvent, ndc: Vector2): void;
  /** Pointer moving over the viewport with no button held. */
  hoverAt?(ndc: Vector2): void;
  /** Keyboard input while the tool is active; return true to consume it. */
  key?(e: KeyboardEvent): boolean;
}

export const snap = (v: number, g: number) => Math.round(v / g) * g;

/** Nearest brush or entity under the cursor. */
export function pickObject(editor: Editor, ndc: Vector2): { solid?: MapSolid; entity?: MapEntity; point: Vector3; normal?: Vector3; side?: MapSolid['sides'][number] } | null {
  const ray = editor.raycaster(ndc);
  const b = editor.world.raycast(ray);
  const en = editor.entities.raycast(ray);
  if (en && (!b || en.distance < b.distance)) return { entity: en.entity, point: en.point };
  if (b) return { solid: b.solid, point: b.point, normal: b.normal, side: b.side };
  return null;
}

/** Surface point under the cursor, falling back to the z = 0 plane. */
export function pickSurface(editor: Editor, ndc: Vector2): { point: Vector3; normal: Vector3 } | null {
  const ray = editor.raycaster(ndc);
  const b = editor.world.raycast(ray);
  if (b) return { point: b.point, normal: b.normal };
  const p = ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), new Vector3());
  return p ? { point: p, normal: new Vector3(0, 0, 1) } : null;
}

interface SideState { plane: Vector3[]; u: TexAxis; v: TexAxis }

/** Click to select (Shift adds), then drag the gizmo to move (M) or resize (R) on the grid. */
export class SelectTool implements Tool {
  name: ToolName = 'select';
  readonly gizmo: TransformControls;
  private proxy = new Object3D();
  private editor: Editor;
  private downAt = new Vector2();
  private start: { pivot: Vector3; bounds: Box3; solids: [MapSolid, SideState[]][]; ents: [MapEntity, Vector3][] } | null = null;
  private endHistory: (() => void) | null = null;
  private lastKey = '';
  mode: 'translate' | 'scale' = 'translate';

  constructor(editor: Editor) {
    this.editor = editor;
    editor.scene.add(this.proxy);
    this.gizmo = new TransformControls(editor.camera, editor.renderer.domElement);
    this.gizmo.setSpace('world');
    this.gizmo.setSize(0.9);
    this.gizmo.attach(this.proxy);
    this.gizmo.enabled = false;
    this.gizmo.getHelper().visible = false;
    editor.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('mouseDown', () => this.dragStart());
    this.gizmo.addEventListener('objectChange', () => this.dragUpdate());
    this.gizmo.addEventListener('mouseUp', () => this.dragEnd());
    editor.selection.onChange = () => {
      this.syncGizmo();
      editor.emit('selection');
    };
  }

  setMode(mode: 'translate' | 'scale'): void {
    this.mode = mode;
    this.gizmo.setMode(mode);
    // Point entities only move.
    this.gizmo.showX = this.gizmo.showY = this.gizmo.showZ = true;
    this.editor.emit('toolchange');
  }

  activate(): void {
    this.syncGizmo();
  }
  deactivate(): void {
    this.gizmo.enabled = false;
    this.gizmo.getHelper().visible = false;
  }

  syncGizmo(): void {
    const sel = this.editor.selection;
    const active = this.editor.tools.current === this && !sel.isEmpty;
    this.gizmo.enabled = active;
    this.gizmo.getHelper().visible = active;
    if (!active || this.start) return;
    this.proxy.position.copy(sel.bounds().getCenter(new Vector3()));
    this.proxy.scale.set(1, 1, 1);
    this.proxy.updateMatrixWorld();
  }

  cancelMarquee(): void {
    this.marquee?.remove();
    this.marquee = null;
  }

  get busy(): boolean {
    return this.gizmo.dragging || this.gizmo.axis !== null;
  }

  private marquee: HTMLDivElement | null = null;

  down(e: PointerEvent): void {
    this.downAt.set(e.clientX, e.clientY);
  }

  /** Dragging on empty space draws a selection rectangle. */
  move(e: PointerEvent): void {
    if (this.gizmo.dragging || this.downAt.distanceTo(new Vector2(e.clientX, e.clientY)) < 6) return;
    if (!this.marquee) {
      this.marquee = document.createElement('div');
      this.marquee.className = 'marquee';
      this.editor.container.append(this.marquee);
    }
    const r = this.editor.container.getBoundingClientRect();
    const x0 = Math.min(this.downAt.x, e.clientX) - r.left, y0 = Math.min(this.downAt.y, e.clientY) - r.top;
    Object.assign(this.marquee.style, {
      left: `${x0}px`, top: `${y0}px`,
      width: `${Math.abs(e.clientX - this.downAt.x)}px`, height: `${Math.abs(e.clientY - this.downAt.y)}px`,
    });
  }

  private finishMarquee(e: PointerEvent): void {
    this.marquee?.remove();
    this.marquee = null;
    const ed = this.editor;
    const a = ed.ndcFromEvent({ clientX: this.downAt.x, clientY: this.downAt.y }), b = ed.ndcFromEvent(e);
    const min = new Vector2(Math.min(a.x, b.x), Math.min(a.y, b.y)), max = new Vector2(Math.max(a.x, b.x), Math.max(a.y, b.y));
    const cam = ed.activeCamera;
    const inside = (p: Vector3) => {
      const v = p.clone().project(cam);
      return v.z < 1 && v.x >= min.x && v.x <= max.x && v.y >= min.y && v.y <= max.y;
    };
    const solids = ed.world.visibleSolids().filter(([, box]) => inside(box.getCenter(new Vector3()))).map(([s]) => s);
    const ents = ed.doc.entities.filter((en) => !en.solids.length && en.origin && !ed.hidden.has(en) && ed.entities.showMarkers && inside(en.origin));
    if (e.shiftKey) {
      ed.selection.set([...ed.selection.solids, ...solids], [...ed.selection.entities, ...ents]);
    } else {
      ed.selection.set(solids, ents);
    }
  }

  up(e: PointerEvent, ndc: Vector2): void {
    if (this.marquee) return this.finishMarquee(e);
    if (this.downAt.distanceTo(new Vector2(e.clientX, e.clientY)) > 4 || this.gizmo.dragging) return;
    const hit = pickObject(this.editor, ndc);
    const sel = this.editor.selection;
    if (!hit) {
      if (!e.shiftKey) sel.clear();
      return;
    }
    const item = hit.entity ? { entity: hit.entity } : { solid: hit.solid };
    if (e.shiftKey) sel.toggle(item);
    else sel.set(item.solid ? [item.solid] : [], item.entity ? [item.entity] : []);
  }

  private dragStart(): void {
    const sel = this.editor.selection;
    const solids = sel.allSolids();
    const ents = sel.pointEntities();
    const brushEnts = [...sel.entities].filter((e) => e.solids.length);
    this.start = {
      pivot: this.proxy.position.clone(),
      bounds: sel.bounds(),
      solids: solids.map((s) => [s, s.sides.map((side) => ({ plane: side.plane.map((p) => p.clone()), u: { ...side.uaxis, axis: side.uaxis.axis.clone() }, v: { ...side.vaxis, axis: side.vaxis.axis.clone() } }))]),
      ents: ents.map((e) => [e, e.origin ?? new Vector3()]),
    };
    this.lastKey = '';
    this.endHistory = this.editor.history.begin(this.mode === 'translate' ? 'Move' : 'Resize', solids, [...ents, ...brushEnts]);
  }

  private restore(): void {
    for (const [s, sides] of this.start!.solids) {
      s.sides.forEach((side, i) => {
        side.plane = sides[i].plane.map((p) => p.clone()) as [Vector3, Vector3, Vector3];
        side.uaxis = { ...sides[i].u, axis: sides[i].u.axis.clone() };
        side.vaxis = { ...sides[i].v, axis: sides[i].v.axis.clone() };
      });
    }
  }

  private dragUpdate(): void {
    if (!this.start) return;
    const g = this.editor.grid;
    if (this.mode === 'translate') {
      const raw = this.proxy.position.clone().sub(this.start.pivot);
      const d = new Vector3(snap(raw.x, g), snap(raw.y, g), snap(raw.z, g));
      const key = `${d.x},${d.y},${d.z}`;
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.restore();
      for (const [s] of this.start.solids) translateSolid(s, d);
      for (const [e, o] of this.start.ents) {
        const prev = e.origin ?? o;
        e.origin = o.clone().add(d);
        moveOverlayBasis(e, e.origin.clone().sub(prev));
      }
    } else {
      const from = this.start.bounds;
      if (!this.start.solids.length || from.isEmpty()) return;
      const size = from.getSize(new Vector3());
      const sc = this.proxy.scale;
      const ns = new Vector3(Math.max(g, snap(size.x * sc.x, g)), Math.max(g, snap(size.y * sc.y, g)), Math.max(g, snap(size.z * sc.z, g)));
      const key = `${ns.x},${ns.y},${ns.z}`;
      if (key === this.lastKey) return;
      this.lastKey = key;
      // Grow around the centre horizontally (snapped to the grid) and upwards from the floor.
      const c = from.getCenter(new Vector3());
      const min = new Vector3(snap(c.x - ns.x / 2, g), snap(c.y - ns.y / 2, g), from.min.z);
      const to = new Box3(min, min.clone().add(ns));
      this.restore();
      for (const [s] of this.start.solids) remapSolid(s, from, to);
    }
    this.editor.changed(true);
  }

  private dragEnd(): void {
    if (!this.start) return;
    this.start = null;
    this.endHistory?.();
    this.endHistory = null;
    this.editor.changed();
    this.syncGizmo();
  }
}

/** Drag a rectangle on any surface to create a block brush on the grid. */
export class BlockTool implements Tool {
  name: ToolName = 'block';
  private editor: Editor;
  private preview = new Group();
  private box: Mesh;
  private edges: LineSegments;
  private start: Vector3 | null = null;
  private current = new Vector3();
  private baseZ = 0;
  height = 128;
  shape: ShapeKind = 'box';
  sides = 12;

  constructor(editor: Editor) {
    this.editor = editor;
    const geo = new BoxGeometry(1, 1, 1);
    geo.translate(0.5, 0.5, 0.5);
    this.box = new Mesh(geo, new MeshBasicMaterial({ color: 0x4fa3e0, transparent: true, opacity: 0.25, depthWrite: false }));
    this.edges = new LineSegments(new EdgesGeometry(geo), new LineBasicMaterial({ color: 0x8fd0ff, depthTest: false }));
    this.edges.renderOrder = 11;
    this.preview.add(this.box, this.edges);
    this.preview.visible = false;
    editor.scene.add(this.preview);
  }

  activate(): void {}
  deactivate(): void {
    this.start = null;
    this.preview.visible = false;
  }

  private bounds(): Box3 {
    const g = this.editor.grid;
    const a = this.start!, b = this.current;
    const min = new Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), this.baseZ);
    const max = new Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), this.baseZ + this.height);
    if (max.x - min.x < g) max.x = min.x + g;
    if (max.y - min.y < g) max.y = min.y + g;
    return new Box3(min, max);
  }

  private updatePreview(): void {
    const b = this.bounds();
    const s = b.getSize(new Vector3());
    this.preview.position.copy(b.min);
    this.preview.scale.copy(s);
    this.preview.visible = true;
    this.editor.status = `Block ${s.x} × ${s.y} × ${s.z}`;
  }

  down(_e: PointerEvent, ndc: Vector2): void {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return;
    const g = this.editor.grid;
    this.baseZ = snap(hit.point.z, g);
    this.start = new Vector3(snap(hit.point.x, g), snap(hit.point.y, g), this.baseZ);
    this.current.copy(this.start);
    this.updatePreview();
  }

  move(_e: PointerEvent, ndc: Vector2): void {
    if (!this.start) return;
    const ray = this.editor.raycaster(ndc);
    const p = ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), -this.baseZ), new Vector3());
    if (!p) return;
    const g = this.editor.grid;
    this.current.set(snap(p.x, g), snap(p.y, g), this.baseZ);
    this.updatePreview();
  }

  up(): void {
    if (!this.start) return;
    const b = this.bounds();
    this.start = null;
    this.preview.visible = false;
    this.editor.status = '';
    const doc = this.editor.doc;
    const mat = this.editor.currentMaterial;
    const nodes = this.shape === 'box' ? [boxSolid(doc, b.min, b.max, mat)]
      : shapeSolids(doc, this.shape, b.min, b.max, { top: mat, bottom: 'TOOLS/TOOLSNODRAW', sides: mat }, this.sides);
    const solids = nodes.map((n) => doc.addSolid(n));
    this.editor.history.added(`Create ${this.shape}`, solids);
    this.editor.selection.set(solids);
    this.editor.changed();
  }
}

/** Click a face to apply the current material. Shift: whole brush. Ctrl: pick the material under the cursor. */
export class PaintTool implements Tool {
  name: ToolName = 'paint';
  private editor: Editor;
  constructor(editor: Editor) {
    this.editor = editor;
  }
  activate(): void {}
  deactivate(): void {}
  down(): void {}
  move(): void {}
  up(e: PointerEvent, ndc: Vector2): void {
    const hit = this.editor.world.raycast(this.editor.raycaster(ndc));
    if (!hit) return;
    if (e.ctrlKey) {
      this.editor.setMaterial(hit.side.material);
      return;
    }
    const end = this.editor.history.begin('Paint', [hit.solid]);
    const sides = e.shiftKey ? hit.solid.sides : [hit.side];
    for (const s of sides) s.material = this.editor.currentMaterial.toUpperCase();
    hit.solid.commit();
    end();
    this.editor.changed();
  }
}

/** Click a surface to place the entity class chosen in the Entities tab. */
export class EntityTool implements Tool {
  name: ToolName = 'entity';
  private editor: Editor;
  constructor(editor: Editor) {
    this.editor = editor;
  }
  activate(): void {}
  deactivate(): void {}
  down(): void {}
  move(): void {}
  up(_e: PointerEvent, ndc: Vector2): void {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return;
    const g = this.editor.grid;
    const origin = new Vector3(snap(hit.point.x, g), snap(hit.point.y, g), Math.round(hit.point.z));
    const keys: Record<string, string> = {};
    const cls = this.editor.entityClass;
    if (cls.startsWith('prop_')) keys.model = this.editor.entityModel;
    placeEntity(this.editor, cls, origin, keys);
  }
}

/** Places the Lambda Wars kit chosen in the Mission tab (capture point, wave, message, ...). */
export class KitTool implements Tool {
  name: ToolName = 'kit';
  private editor: Editor;
  kitId = 'capture_point';
  params: Record<string, Record<string, ParamValue>> = {};
  constructor(editor: Editor) {
    this.editor = editor;
  }
  get kit() {
    return KITS.find((k) => k.id === this.kitId) ?? KITS[0];
  }
  paramsFor(id: string): Record<string, ParamValue> {
    const kit = KITS.find((k) => k.id === id)!;
    this.params[id] ??= Object.fromEntries(kit.params.map((p) => [p.key, p.default]));
    return this.params[id];
  }
  activate(): void {}
  deactivate(): void {}
  down(): void {}
  move(): void {}
  up(_e: PointerEvent, ndc: Vector2): void {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return;
    const g = this.editor.grid;
    const at = new Vector3(snap(hit.point.x, g), snap(hit.point.y, g), Math.round(hit.point.z));
    const kit = this.kit;
    const created = recordKit(this.editor, `Place ${kit.label}`, () => kit.place(this.editor, at, this.paramsFor(kit.id)));
    this.editor.selection.set([], created.filter((e) => !e.solids.length).slice(0, 1));
  }
}

/** Click a surface to place the decal or overlay chosen in the Materials tab. */
export class DecalTool implements Tool {
  name: ToolName = 'decal';
  private editor: Editor;
  constructor(editor: Editor) {
    this.editor = editor;
  }
  activate(): void {}
  deactivate(): void {}
  down(): void {}
  move(): void {}
  up(_e: PointerEvent, ndc: Vector2): void {
    void placeDecal(this.editor, ndc, this.editor.decal);
  }
}

/** Routes left-button pointer events from the viewport to the active tool. */
export class ToolManager {
  readonly tools: Record<ToolName, Tool>;
  readonly select: SelectTool;
  current: Tool;
  private active = false;

  constructor(editor: Editor) {
    this.select = new SelectTool(editor);
    this.tools = {
      select: this.select, block: new BlockTool(editor), paint: new PaintTool(editor), entity: new EntityTool(editor),
      kit: new KitTool(editor), decal: new DecalTool(editor), road: new RoadTool(editor), ground: new GroundTool(editor),
    };
    this.current = this.select;
    const dom = editor.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.altKey || this.select.busy) return;
      this.active = true;
      this.current.down(e, editor.ndcFromEvent(e));
    });
    window.addEventListener('pointermove', (e) => {
      if (this.active) this.current.move(e, editor.ndcFromEvent(e));
      else if (e.target === dom && e.buttons === 0) this.current.hoverAt?.(editor.ndcFromEvent(e));
    });
    // Before the global shortcuts, so a tool can take Enter, Escape or Backspace.
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey) return;
      if (this.current.key?.(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
    window.addEventListener('pointerup', (e) => {
      if (!this.active || e.button !== 0) return;
      this.active = false;
      this.current.up(e, editor.ndcFromEvent(e));
    });
  }

  set(name: ToolName): void {
    if (this.current.name === name) return;
    this.select.cancelMarquee();
    this.current.deactivate();
    this.current = this.tools[name];
    this.current.activate();
    this.select.syncGizmo();
  }
}
