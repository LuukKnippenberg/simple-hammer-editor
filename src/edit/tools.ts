import {
  BoxGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Object3D, Plane,
  Quaternion, Vector2, Vector3, Box3,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Editor } from '../editor.ts';
import type { MapEntity, MapSolid, TexAxis } from '../vmf/map.ts';
import { boxSolid, remapSolid, rotateSolid, translateSolid } from './brushes.ts';
import { angleAbout, rotateEntity, snapAngle } from './rotate.ts';
import { KITS, recordKit, type ParamValue } from '../lw/kits.ts';
import { moveOverlayBasis } from './decals.ts';
import { shapeSolids, type ShapeKind } from './shapes.ts';
import { RoadTool } from './roadTool.ts';
import { GroundTool } from './groundTool.ts';
import { PowerlineTool } from './powerlineTool.ts';
import { SoundTool } from './soundTool.ts';
import { PoiTool } from './poiTool.ts';
import { CinemaTool } from './cinemaTool.ts';
import { GenerateTool } from './generateTool.ts';
import { StairsTool } from './stairsTool.ts';
import { isTyping } from '../render/cameraControls.ts';
import { toast } from '../ui/dom.ts';
import { handleDragged } from '../gen/poi/action.ts';
import { handleOf } from '../gen/poi/handle.ts';
import { POI_ID_KEY } from '../gen/poi/spec.ts';
import { blockHandleDragged } from '../gen/buildingAction.ts';
import { blockOfSolid, blockOwner } from '../gen/buildingStore.ts';
import { BUILDING_HANDLE, findHandle, isGeneratorHandle, kindOf, POI_HANDLE, ROOMS_HANDLE, STAIRS_HANDLE } from '../gen/handle.ts';
import { selectedStairs, stairsHandleDragged } from '../gen/stairsAction.ts';
import { STAIRS_ID_KEY, stairsOwner } from '../gen/stairsStore.ts';
import { PathPins } from './pathPins.ts';
import { placedStairsTarget } from './stairsPath.ts';
import { roomsHandleDragged } from '../gen/rooms/action.ts';
import { roomsOwner } from '../gen/rooms/store.ts';
import type { KVNode } from '../vmf/keyvalues.ts';
import { moveFaces, moveVertices, sideThrough, topology } from './brushEdit.ts';
import { nearestPart, partCentre, partsOf, partVerts, samePart, SELECT_MODES, type Part, type PartMode, type SelectMode } from './parts.ts';
import { PartOverlay } from './partOverlay.ts';
import { Extruder } from './extrude.ts';
import { DecalTool, EntityTool } from './entityTool.ts';
import { SnapMoveTool } from './snapMoveTool.ts';

export type ToolName = 'select' | 'block' | 'paint' | 'entity' | 'kit' | 'decal' | 'road' | 'ground' | 'powerline' | 'sound' | 'poi' | 'cinema' | 'stairs' | 'generate';

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

/** Nearest brush or entity under the cursor (generator handles count with `handles`). */
export function pickObject(editor: Editor, ndc: Vector2, opts: { handles?: boolean } = {}): { solid?: MapSolid; entity?: MapEntity; point: Vector3; normal?: Vector3; side?: MapSolid['sides'][number] } | null {
  const ray = editor.raycaster(ndc);
  const b = editor.world.raycast(ray, opts);
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

/** Entity keys a rotation changes, restored before each step of a drag. */
const TURNED_KEYS = ['origin', 'angles', 'BasisOrigin', 'BasisU', 'BasisV', 'BasisNormal'];
const GIZMO_AXES: Record<string, Vector3> = { X: new Vector3(1, 0, 0), Y: new Vector3(0, 1, 0), Z: new Vector3(0, 0, 1) };
const MODE_LABELS: Record<GizmoMode, string> = { translate: 'Move', scale: 'Resize', rotate: 'Rotate' };

export type GizmoMode = 'translate' | 'scale' | 'rotate';

/**
 * Click to select (Shift adds), then drag the gizmo to move (W) or resize (R) on the grid, or rotate (E) in steps.
 * In the face, edge and vertex modes (Shift+2/3/4) the same works on parts of brushes; X extrudes faces.
 * Selected stairs show their points' pins (`pathPins.ts`) while generator handles are shown.
 */
export class SelectTool implements Tool {
  name: ToolName = 'select';
  readonly gizmo: TransformControls;
  private proxy = new Object3D();
  private editor: Editor;
  private downAt = new Vector2();
  private start: { pivot: Vector3; bounds: Box3; solids: [MapSolid, SideState[]][]; ents: [MapEntity, Vector3][]; axis: Vector3 | null; keys: [MapEntity, (string | undefined)[]][] } | null = null;
  private endHistory: (() => void) | null = null;
  private lastKey = '';
  mode: GizmoMode = 'translate';
  /** Rotation step in degrees; Shift while dragging turns freely. */
  rotateStep = 15;
  rotateSnap = true;
  private shift = false;
  readonly overlay = new PartOverlay();
  readonly extruder: Extruder;
  /** A drag of faces, edges or vertices: the brushes as they were, and each part's corners at the start. */
  private sub: { pivot: Vector3; snaps: [MapSolid, KVNode][]; parts: Part[]; corners: Vector3[][]; axis: Vector3 | null; ok: boolean } | null = null;
  private pointer = new Vector2();
  private hovered: { part: Part | null; solid: MapSolid | null } = { part: null, solid: null };
  private hoverQueued: Vector2 | null = null;
  /** The offset of a snap move in progress (see snapBegin). */
  private snapD: Vector3 | null = null;
  /** Snap move (hold V): grab a corner, edge or face of the selection and drop it onto another. */
  readonly snapMove: SnapMoveTool;
  /** Pins on the points of selected stairs: drag, insert, remove, Tab, Delete. */
  readonly pins: PathPins;

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
    // Captured on the window so it is current before the gizmo handles the same move.
    window.addEventListener('pointermove', (e) => {
      this.shift = e.shiftKey;
      this.pointer.set(e.clientX, e.clientY);
      this.extruder.pointer(this.pointer, e.altKey);
    }, true);
    this.extruder = new Extruder(editor);
    editor.scene.add(this.overlay.group);
    // While extruding, a click confirms and a right click cancels (before the gizmo or camera see it).
    window.addEventListener('pointerdown', (e) => {
      if (!this.extruder.active || !(e.target instanceof Node) || !editor.container.contains(e.target)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.button === 0) this.extruder.confirm();
      else this.extruder.cancel();
      this.syncGizmo();
    }, true);
    window.addEventListener('keyup', (e) => { if (e.key === 'Alt') this.extruder.pointer(this.pointer, false); });
    // Shift+1-4 pick the selection mode from any tool (e.code: with Shift, e.key is a symbol).
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const m = SELECT_MODES.find((x) => e.code === `Digit${x.key}`);
      if (!m) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (editor.tools.current !== this) editor.tools.set('select');
      this.setSelectMode(m.mode);
    }, true);
    editor.selection.onChange = () => {
      this.syncGizmo();
      this.drawParts();
      editor.emit('selection');
    };
    this.pins = new PathPins(editor, () => editor.tools?.current === this && editor.selection.mode === 'object' && editor.world.visibleKinds.handle);
    const syncPins = () => {
      const stairs = selectedStairs(editor);
      this.pins.show(stairs.length === 1 ? placedStairsTarget(editor, stairs[0].get(STAIRS_ID_KEY) ?? '') : null);
    };
    editor.on('selection', syncPins);
    editor.on('change', syncPins);
    editor.on('document', syncPins);
    editor.on('frame', () => this.hoverFrame());
    this.snapMove = new SnapMoveTool(editor, this);
  }

  get selectMode(): SelectMode {
    return this.editor.selection.mode;
  }

  /** Object, face, edge or vertex selection. */
  setSelectMode(mode: SelectMode): void {
    this.extruder.cancel();
    this.cancelMarquee();
    this.hovered = { part: null, solid: null };
    this.overlay.setHover(null);
    this.editor.selection.setMode(mode);
    this.drawParts();
    this.editor.emit('toolchange');
  }

  /** Starts extruding the selected faces from the cursor (X). */
  startExtrude(): void {
    if (!this.extruder.start(this.pointer)) return;
    this.hovered = { part: null, solid: null };
    this.overlay.setHover(null);
    this.syncGizmo();
  }

  private drawParts(): void {
    const sel = this.editor.selection;
    const brushes = [...sel.editing];
    if (this.hovered.solid) brushes.push(this.hovered.solid);
    this.overlay.update(this.editor.tools?.current === this ? sel.mode : 'object', sel.parts, brushes);
  }

  /** The face, edge or vertex under the cursor (sub-object modes). */
  pickPart(ndc: Vector2): { part: Part | null; solid: MapSolid | null } {
    const ed = this.editor;
    const mode = ed.selection.mode as PartMode;
    const hit = ed.world.raycast(ed.raycaster(ndc));
    const solid = hit && !hit.solid.isDisplacement ? hit.solid : null;
    const side = solid ? solid.sides.indexOf(hit!.side) : -1;
    if (mode === 'face') return { part: solid && side >= 0 ? { solid, kind: 'face', side, verts: [] } : null, solid };
    const r = ed.renderer.domElement.getBoundingClientRect();
    const size = new Vector2(r.width, r.height);
    const cursor = new Vector2(((ndc.x + 1) / 2) * size.x, ((1 - ndc.y) / 2) * size.y);
    const part = nearestPart(mode, cursor, ed.activeCamera, size, solid && side >= 0 ? { solid, side } : null, [...ed.selection.editing]);
    return { part, solid: part?.solid ?? solid };
  }

  hoverAt(ndc: Vector2): void {
    if (this.selectMode !== 'object') this.hoverQueued = ndc.clone();
  }

  /** At most one hover pick per frame. */
  private hoverFrame(): void {
    const ndc = this.hoverQueued;
    this.hoverQueued = null;
    if (!ndc || this.extruder.active || this.sub || this.snapMove.held || this.editor.tools.current !== this) return;
    const h = this.pickPart(ndc);
    const solidChanged = h.solid !== this.hovered.solid;
    const partChanged = !(h.part && this.hovered.part ? samePart(h.part, this.hovered.part) : h.part === this.hovered.part);
    this.hovered = h;
    if (partChanged) this.overlay.setHover(h.part);
    if (solidChanged) this.drawParts();
  }

  key(e: KeyboardEvent): boolean {
    if (this.pins.key(e)) return true;
    if (this.extruder.active) {
      if (e.key === 'Escape') this.extruder.cancel();
      else if (e.key === 'Enter') this.extruder.confirm();
      else if (e.key === 'Alt') this.extruder.pointer(this.pointer, true);
      else return false;
      this.syncGizmo();
      return true;
    }
    if (e.code === 'KeyX' && !e.shiftKey && this.selectMode === 'face') {
      this.startExtrude();
      return true;
    }
    return false;
  }

  setMode(mode: GizmoMode): void {
    this.mode = mode;
    this.gizmo.setMode(mode);
    // Point entities only move.
    this.gizmo.showX = this.gizmo.showY = this.gizmo.showZ = true;
    this.syncGizmo();
    this.editor.emit('toolchange');
  }

  activate(): void {
    this.syncGizmo();
    this.drawParts();
  }
  deactivate(): void {
    this.extruder.cancel();
    this.gizmo.enabled = false;
    this.gizmo.getHelper().visible = false;
    this.overlay.setHover(null);
    this.overlay.update('object', [], []);
  }

  syncGizmo(): void {
    const sel = this.editor.selection;
    const active = this.editor.tools.current === this && !this.extruder.active && !this.snapMove?.held && (sel.mode === 'object' ? !sel.isEmpty : sel.parts.length > 0);
    this.gizmo.enabled = active;
    this.gizmo.getHelper().visible = active;
    // A disabled gizmo misses pointer moves; drop the axis it was hovering, or the next click would drag it.
    if (!active && !this.gizmo.dragging) this.gizmo.axis = null;
    // Faces move along their normals: hide the axes that would only slide them along themselves.
    const normals = sel.mode === 'face' && this.mode === 'translate'
      ? sel.parts.map((p) => topology(p.solid).faces.find((f) => f.side === p.side)?.normal).filter((n): n is Vector3 => !!n) : null;
    this.gizmo.showX = !normals || normals.some((n) => Math.abs(n.x) > 0.01);
    this.gizmo.showY = !normals || normals.some((n) => Math.abs(n.y) > 0.01);
    this.gizmo.showZ = !normals || normals.some((n) => Math.abs(n.z) > 0.01);
    if (!active || this.start || this.sub) return;
    this.proxy.position.copy(sel.bounds().getCenter(new Vector3()));
    this.proxy.scale.set(1, 1, 1);
    this.proxy.quaternion.identity();
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
    if (ed.selection.mode !== 'object') {
      // Parts whose centre is in the box, of the brushes being edited and those with their centre in it.
      const sel = ed.selection, mode = sel.mode as PartMode;
      const brushes = new Set([...sel.editing, ...ed.world.visibleSolids().filter(([s, box]) => !s.isDisplacement && inside(box.getCenter(new Vector3()))).map(([s]) => s)]);
      const picked = [...brushes].flatMap((s) => partsOf(s, mode)).filter((p) => inside(partCentre(p)));
      if (e.shiftKey) sel.setParts([...sel.parts, ...picked.filter((p) => !sel.parts.some((q) => samePart(p, q)))]);
      else sel.setParts(picked);
      return;
    }
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
    const sel = this.editor.selection;
    if (sel.mode !== 'object') {
      // Parts of brushes only; entities and generator handles are picked in object mode.
      const { part } = this.pickPart(ndc);
      if (!part) { if (!e.shiftKey) sel.clear(); return; }
      if (e.shiftKey) sel.togglePart(part);
      else sel.setParts([part], [part.solid]);
      return;
    }
    const hit = pickObject(this.editor, ndc, { handles: true });
    if (!hit) {
      if (!e.shiftKey) sel.clear();
      return;
    }
    const item: { solid?: MapSolid; entity?: MapEntity } = this.ownerHandle(hit.entity ?? hit.solid?.entity ?? undefined, hit.solid) ?? (hit.entity ? { entity: hit.entity } : { solid: hit.solid });
    if (e.shiftKey) sel.toggle(item);
    else sel.set(item.solid ? [item.solid] : [], item.entity ? [item.entity] : []);
  }

  /**
   * A click on a generator's handle (a POI's, a block of buildings') selects the whole thing by its handle; so
   * does a click on anything it made, while handles are shown (hide them to pick single props and brushes).
   */
  private ownerHandle(owner: MapEntity | undefined, solid: MapSolid | undefined): { entity: MapEntity } | null {
    if (owner && isGeneratorHandle(owner)) return { entity: owner };
    if (!this.editor.world.visibleKinds.handle) return null;
    const doc = this.editor.doc;
    const poi = owner?.get(POI_ID_KEY);
    if (poi) { const h = handleOf(doc, poi); return h ? { entity: h } : null; }
    const rooms = roomsOwner(doc, owner, owner ? null : solid);
    if (rooms) { const h = findHandle(doc, ROOMS_HANDLE, rooms.get(ROOMS_HANDLE.idKey) ?? ''); return h ? { entity: h } : null; }
    const stairs = stairsOwner(doc, owner, owner ? null : solid);
    if (stairs) { const h = findHandle(doc, STAIRS_HANDLE, stairs.get(STAIRS_HANDLE.idKey) ?? ''); return h ? { entity: h } : null; }
    const block = owner ? blockOwner(doc, owner) : solid ? blockOfSolid(doc, solid) : null;
    const h = block && findHandle(doc, BUILDING_HANDLE, block.get(BUILDING_HANDLE.idKey) ?? '');
    return h ? { entity: h } : null;
  }

  /** Snap move drags translate by `snapD`, whatever the gizmo mode. */
  private get dragMode(): GizmoMode {
    return this.snapD ? 'translate' : this.mode;
  }

  /** Starts a move driven by snap move (V) instead of the gizmo; false when nothing can move. */
  snapBegin(): boolean {
    this.snapD = new Vector3();
    this.dragStart();
    if (this.start || this.sub) return true;
    this.snapD = null;
    return false;
  }

  /** Moves the selection (or its parts) by `d` from where it started. */
  snapStep(d: Vector3): void {
    if (!this.snapD) return;
    this.snapD.copy(d);
    this.dragUpdate();
  }

  /** Drops it: one undo step, like a gizmo drag. Not moved at all: no step. */
  snapEnd(): void {
    if (!this.snapD) return;
    if (this.snapD.lengthSq() === 0) return this.snapCancel();
    this.dragEnd();
    this.snapD = null;
  }

  /** Puts it back where it was, without an undo step. */
  snapCancel(): void {
    if (!this.snapD) return;
    if (this.sub) {
      this.restoreParts();
      this.editor.selection.parts = this.sub.parts;
      this.sub = null;
    } else if (this.start) {
      this.restore();
      // restore() only resets the planes in memory; write them back to the brush nodes.
      for (const [s] of this.start.solids) s.commit();
      for (const [e, o] of this.start.ents) {
        const prev = e.origin ?? o;
        e.origin = o.clone();
        moveOverlayBasis(e, o.clone().sub(prev));
      }
      this.start = null;
    }
    this.snapD = null;
    this.endHistory = null;
    this.lastKey = '';
    this.editor.status = '';
    this.editor.changed();
    this.syncGizmo();
    this.drawParts();
  }

  private dragStart(): void {
    if (this.selectMode !== 'object') return this.partDragStart();
    const sel = this.editor.selection;
    const solids = sel.allSolids();
    const ents = sel.pointEntities();
    const brushEnts = [...sel.entities].filter((e) => e.solids.length);
    if (this.dragMode === 'rotate') {
      // Generated things are rebuilt from their handles, which only move and resize.
      if ([...sel.entities].some((e) => isGeneratorHandle(e))) {
        toast(this.editor.container, 'POIs, buildings and interiors turn with , and . (rotate works on brushes and entities)', 2500);
        return;
      }
      // Only the three axis rings; the view ring and the free trackball are not used.
      if (!GIZMO_AXES[this.gizmo.axis ?? '']) return;
    }
    this.start = {
      pivot: this.proxy.position.clone(),
      bounds: sel.bounds(),
      solids: solids.map((s) => [s, s.sides.map((side) => ({ plane: side.plane.map((p) => p.clone()), u: { ...side.uaxis, axis: side.uaxis.axis.clone() }, v: { ...side.vaxis, axis: side.vaxis.axis.clone() } }))]),
      ents: ents.map((e) => [e, e.origin ?? new Vector3()]),
      axis: GIZMO_AXES[this.gizmo.axis ?? ''] ?? null,
      keys: ents.map((e) => [e, TURNED_KEYS.map((k) => e.get(k))]),
    };
    this.lastKey = '';
    this.endHistory = this.editor.history.begin(this.snapD ? 'Snap move' : MODE_LABELS[this.dragMode], solids, [...ents, ...brushEnts]);
  }

  private restore(): void {
    for (const [s, sides] of this.start!.solids) {
      s.sides.forEach((side, i) => {
        side.plane = sides[i].plane.map((p) => p.clone()) as [Vector3, Vector3, Vector3];
        side.uaxis = { ...sides[i].u, axis: sides[i].u.axis.clone() };
        side.vaxis = { ...sides[i].v, axis: sides[i].v.axis.clone() };
      });
    }
    if (this.dragMode !== 'rotate') return;
    for (const [e, values] of this.start!.keys) {
      TURNED_KEYS.forEach((k, i) => (values[i] === undefined ? e.node.delete(k) : e.node.set(k, values[i]!)));
      e.version++;
    }
  }

  private dragUpdate(): void {
    if (this.sub) return this.partDragUpdate();
    if (!this.start) return;
    const g = this.editor.grid;
    if (this.dragMode === 'translate') {
      const raw = this.proxy.position.clone().sub(this.start.pivot);
      const d = this.snapD?.clone() ?? new Vector3(snap(raw.x, g), snap(raw.y, g), snap(raw.z, g));
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
    } else if (this.dragMode === 'rotate') {
      const axis = this.start.axis;
      if (!axis) return;
      const deg = snapAngle(angleAbout(this.proxy.quaternion, axis), this.rotateSnap && !this.shift ? this.rotateStep : 0);
      const key = deg.toFixed(2);
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.restore();
      const q = new Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180);
      for (const [s] of this.start.solids) rotateSolid(s, this.start.pivot, q);
      for (const [e] of this.start.ents) rotateEntity(e, this.start.pivot, axis, deg);
      this.editor.status = `Rotate ${Math.round(deg * 100) / 100}° about ${axis.x ? 'X' : axis.y ? 'Y' : 'Z'}`;
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
    if (this.sub) return this.partDragEnd();
    if (!this.start) {
      // A refused rotate drag: put the gizmo back.
      this.syncGizmo();
      return;
    }
    this.start = null;
    this.editor.status = '';
    const sel = this.editor.selection;
    const handle = sel.entities.size === 1 && !sel.solids.size ? [...sel.entities][0] : null;
    const kind = kindOf(handle);
    if (handle && kind && this.dragMode !== 'rotate') {
      // A dragged generator handle: what it stands for is rebuilt to fit, in the same undo step as the drag.
      const mode = this.dragMode;
      const what = kind === POI_HANDLE ? 'POI' : kind === ROOMS_HANDLE ? 'interior building' : kind === STAIRS_HANDLE ? 'stairs' : 'buildings';
      this.editor.history.group(mode === 'translate' ? `Move ${what}` : `Resize ${what}`, () => {
        this.endHistory?.();
        if (kind === POI_HANDLE) handleDragged(this.editor, handle, mode);
        else if (kind === ROOMS_HANDLE) roomsHandleDragged(this.editor, handle, mode);
        else if (kind === STAIRS_HANDLE) stairsHandleDragged(this.editor, handle, mode);
        else blockHandleDragged(this.editor, handle, mode);
      });
    } else {
      this.endHistory?.();
    }
    this.endHistory = null;
    this.editor.changed();
    this.syncGizmo();
  }

  private partDragStart(): void {
    const sel = this.editor.selection;
    if (this.dragMode === 'rotate' && !GIZMO_AXES[this.gizmo.axis ?? '']) return;
    const solids = [...new Set(sel.parts.map((p) => p.solid))];
    this.sub = {
      pivot: this.proxy.position.clone(),
      snaps: solids.map((s) => [s, s.node.clone()]),
      parts: sel.parts.map((p) => ({ ...p, verts: p.verts.map((v) => v.clone()) })),
      corners: sel.parts.map((p) => partVerts(p).map((v) => v.clone())),
      axis: GIZMO_AXES[this.gizmo.axis ?? ''] ?? null,
      ok: true,
    };
    this.lastKey = '';
    const what = sel.mode === 'vertex' ? 'vertices' : `${sel.mode}s`;
    this.endHistory = this.editor.history.begin(`${this.snapD ? 'Snap move' : MODE_LABELS[this.dragMode]} ${what}`, solids);
  }

  private restoreParts(): void {
    for (const [s, node] of this.sub!.snaps) { s.node.items = node.clone().items; s.reload(); }
  }

  /** Moves the parts: faces move their planes; anything else moves corners and rebuilds the brush round them. */
  private partDragUpdate(): void {
    const sub = this.sub!, ed = this.editor, sel = ed.selection, g = ed.grid;
    let move: (v: Vector3) => Vector3;
    let d: Vector3 | null = null;
    if (this.dragMode === 'translate') {
      const raw = this.proxy.position.clone().sub(sub.pivot);
      const off = this.snapD?.clone() ?? new Vector3(snap(raw.x, g), snap(raw.y, g), snap(raw.z, g));
      d = off;
      move = (v) => v.add(off);
    } else if (this.dragMode === 'rotate') {
      if (!sub.axis) return;
      const deg = snapAngle(angleAbout(this.proxy.quaternion, sub.axis), this.rotateSnap && !this.shift ? this.rotateStep : 0);
      const q = new Quaternion().setFromAxisAngle(sub.axis, (deg * Math.PI) / 180);
      move = (v) => v.sub(sub.pivot).applyQuaternion(q).add(sub.pivot).round();
      ed.status = `Rotate ${Math.round(deg * 100) / 100}°`;
    } else {
      const k = this.proxy.scale.clone();
      move = (v) => { v.sub(sub.pivot).multiply(k).add(sub.pivot); return v.set(snap(v.x, g), snap(v.y, g), snap(v.z, g)); };
    }
    const corners = sub.corners.map((vs) => vs.map((v) => move(v.clone())));
    const key = corners.flat().map((v) => `${v.x},${v.y},${v.z}`).join(';');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.restoreParts();
    const planes = sel.mode === 'face' && d;
    let ok = true;
    for (const [s] of sub.snaps) {
      const mine = sub.parts.map((p, i) => (p.solid === s ? i : -1)).filter((i) => i >= 0);
      if (planes) ok = moveFaces(s, mine.map((i): [number, Vector3] => [sub.parts[i].side, d!.clone()])) && ok;
      else ok = moveVertices(ed.doc, s, mine.flatMap((i) => sub.corners[i]), move) && ok;
    }
    sub.ok = ok;
    if (!ok) {
      this.restoreParts();
      sel.parts = sub.parts.map((p) => ({ ...p }));
      ed.status = 'Refused: the brush would collapse or lose a face';
    } else {
      // The parts follow: corners to where they went; faces rebuilt round their corners to the side through them.
      sel.parts = sub.parts.map((p, i) => (p.kind !== 'face' ? { ...p, verts: corners[i] } : planes ? { ...p } : { ...p, side: sideThrough(p.solid, corners[i]) }));
      if (d) ed.status = `Move ${d.x} ${d.y} ${d.z}`;
    }
    ed.changed(true);
  }

  private partDragEnd(): void {
    const sub = this.sub!, ed = this.editor;
    ed.status = '';
    if (!sub.ok) {
      this.restoreParts();
      ed.selection.parts = sub.parts;
      toast(ed.container, 'Not moved: the brush would collapse or lose a face', 2200);
    } else if (this.lastKey) {
      this.endHistory?.();
    }
    this.sub = null;
    this.endHistory = null;
    ed.changed();
    this.syncGizmo();
    this.drawParts();
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
      kit: new KitTool(editor), decal: new DecalTool(editor), road: new RoadTool(editor), ground: new GroundTool(editor), powerline: new PowerlineTool(editor), sound: new SoundTool(editor), poi: new PoiTool(editor), cinema: new CinemaTool(editor),
      stairs: new StairsTool(editor), generate: new GenerateTool(editor),
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
