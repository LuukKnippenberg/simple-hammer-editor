import { Box3, Box3Helper, BufferGeometry, Color, LineBasicMaterial, LineLoop, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { placeEntity } from './actions.ts';
import { placeDecal } from './decals.ts';
import { expandName } from './entityKeys.ts';
import { pickObject, pickSurface, snap, type Tool, type ToolName } from './tools.ts';
import { entityStyle } from '../render/entityRenderer.ts';
import { nextInList, recentClasses, recentDecals } from '../ui/recent.ts';
import { h, toast } from '../ui/dom.ts';

/** What the Entity tool sets on each entity it places of one class. */
export interface PlaceOptions {
  /** Name pattern: `cp_#` names them cp_1, cp_2, ... (first free number); empty leaves them unnamed. */
  name: string;
  /** Extra keys set on each placed entity (owner, capture time, ...). */
  keys: Record<string, string>;
}

/**
 * Places the class chosen in the Entities tab or the tool options, with a ghost under the cursor.
 * Alt+click an entity (without dragging) to copy its class; Tab cycles the recent classes.
 */
export class EntityTool implements Tool {
  name: ToolName = 'entity';
  private editor: Editor;
  private options: Record<string, PlaceOptions> = {};
  /** Control points: add the trigger_capture_area that makes them capturable. */
  captureArea = true;
  private ghost = new Box3Helper(new Box3(), new Color(0xf0a040));
  private ring = new LineLoop(new BufferGeometry().setFromPoints(Array.from({ length: 48 }, (_, i) =>
    new Vector3(Math.cos((i / 48) * Math.PI * 2), Math.sin((i / 48) * Math.PI * 2), 0))), new LineBasicMaterial({ color: 0xf0a040, depthTest: false, transparent: true, opacity: 0.8 }));
  private label = h('div.ghost-label', { hidden: true });
  private altDown: { x: number; y: number } | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
    (this.ghost.material as LineBasicMaterial).depthTest = false;
    this.ghost.renderOrder = this.ring.renderOrder = 14;
    const dom = editor.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => {
      this.altDown = editor.tools.current === this && e.button === 0 && e.altKey ? { x: e.clientX, y: e.clientY } : null;
    });
    window.addEventListener('pointerup', (e) => {
      const d = this.altDown;
      this.altDown = null;
      if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
      const hit = pickObject(editor, editor.ndcFromEvent(e));
      const ent = hit?.entity ?? hit?.solid?.entity;
      if (!ent || ent === editor.doc.worldEntity) return;
      this.setClass(ent.classname);
      toast(editor.container, `Entity tool: ${ent.classname}`);
    });
    dom.addEventListener('pointerleave', () => this.hide());
  }

  optionsFor(cls: string): PlaceOptions {
    return (this.options[cls] ??= { name: cls === 'control_point' ? 'cp_#' : '', keys: {} });
  }

  setClass(cls: string): void {
    this.editor.entityClass = cls;
    recentClasses.push(cls);
    this.editor.emit('entityclass');
  }

  activate(): void {
    this.editor.container.append(this.label);
  }
  deactivate(): void {
    this.hide();
  }
  down(): void {}
  move(): void {}

  private spot(ndc: Vector2): Vector3 | null {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return null;
    const g = this.editor.grid;
    return new Vector3(snap(hit.point.x, g), snap(hit.point.y, g), Math.round(hit.point.z));
  }

  private hide(): void {
    this.editor.scene.remove(this.ghost, this.ring);
    this.label.hidden = true;
  }

  hoverAt(ndc: Vector2): void {
    const p = this.spot(ndc);
    if (!p) return this.hide();
    const cls = this.editor.entityClass;
    const s = entityStyle(cls).size / 2;
    this.ghost.box.set(new Vector3(p.x - s, p.y - s, p.z), new Vector3(p.x + s, p.y + s, p.z + s * 2));
    this.editor.scene.add(this.ghost);
    const cap = cls === 'control_point' && this.captureArea;
    if (cap) {
      this.ring.position.set(p.x, p.y, p.z + 2);
      this.ring.scale.setScalar(192);
      this.editor.scene.add(this.ring);
    } else this.editor.scene.remove(this.ring);
    // A label beside the ghost: class and what a click does.
    const v = p.clone().setZ(p.z + s * 2).project(this.editor.activeCamera);
    const r = this.editor.renderer.domElement;
    this.label.hidden = v.z > 1;
    this.label.style.left = `${((v.x + 1) / 2) * r.clientWidth + 14}px`;
    this.label.style.top = `${((1 - v.y) / 2) * r.clientHeight - 10}px`;
    this.label.replaceChildren(h('b', {}, cls), h('span.muted', {}, ` · click to place${cap ? ' · capture area 192' : ''}`));
  }

  up(e: PointerEvent, ndc: Vector2): void {
    if (e.altKey) return;
    const origin = this.spot(ndc);
    if (!origin) return;
    const cls = this.editor.entityClass;
    const opts = this.optionsFor(cls);
    const keys: Record<string, string> = { ...opts.keys };
    if (cls.startsWith('prop_')) keys.model = this.editor.entityModel;
    const used = new Set(this.editor.doc.entities.map((x) => x.get('targetname')).filter((x): x is string => !!x));
    const name = expandName(opts.name, used);
    if (name) keys.targetname = name;
    placeEntity(this.editor, cls, origin, keys, { captureArea: this.captureArea });
    recentClasses.push(cls);
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== 'Tab' || e.shiftKey || e.altKey) return false;
    const next = nextInList(recentClasses.items, this.editor.entityClass);
    if (!next) return false;
    this.editor.entityClass = next;
    this.editor.emit('entityclass');
    return true;
  }
}

/** Places a decal or overlay where the cursor hits a brush face; Tab cycles the recent decals. */
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
    recentDecals.push(this.editor.decal.material);
    void placeDecal(this.editor, ndc, this.editor.decal);
  }
  key(e: KeyboardEvent): boolean {
    if (e.key !== 'Tab' || e.shiftKey || e.altKey) return false;
    const next = nextInList(recentDecals.items, this.editor.decal.material);
    if (!next) return false;
    this.editor.decal.material = next;
    this.editor.emit('decal');
    return true;
  }
}
