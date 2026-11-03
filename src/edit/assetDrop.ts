import {
  Box3, Box3Helper, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop, Mesh,
  Matrix4, MeshBasicMaterial, Vector2, Vector3,
} from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity, MapSide, MapSolid } from '../vmf/map.ts';
import { buildBrushFaces } from '../geom/brush.ts';
import { loadModel } from '../assets/mdl.ts';
import { modelEntry, modelName } from '../assets/modelIndex.ts';
import { placeEntity } from './actions.ts';
import { placeDecalRay } from './decals.ts';
import { decalBasis } from '../render/decalRenderer.ts';
import { convertToDynamic, staticPropProblem } from './preflight.ts';
import { pickObject, pickSurface, snap } from './tools.ts';
import { recentDecals, recentMaterials, recentModels } from '../ui/recent.ts';
import { h, toast } from '../ui/dom.ts';
import './assetDrop.css';

/** What can be dragged out of the asset dock. */
export type AssetKind = 'model' | 'material' | 'decal' | 'sound';

/** Why vbsp would not keep a model as prop_static (null: it would). */
type StaticProblem = Awaited<ReturnType<typeof staticPropProblem>>;

/** What a field drop target is told about the asset over it. */
export interface DropInfo {
  id: string;
  /** Short name: `oildrum001`, `concretefloor001a`. */
  name: string;
  /** A model vbsp would delete as prop_static. */
  unsafe: boolean;
}

interface FieldTarget {
  kind: AssetKind;
  label: string | ((d: DropInfo) => string);
  drop: (id: string) => void;
}

/** What letting go here would do: `run` it, or say why not (`bad`), or nothing at all (`cancel`). */
interface Plan {
  text: string;
  hint?: string;
  bad?: boolean;
  cancel?: boolean;
  run?: () => void | Promise<void>;
  /** Where the model or decal ghost goes; the faces to light for a material. */
  at?: Vector3;
  normal?: Vector3;
  faces?: { solid: MapSolid; sides: MapSide[] };
}

interface Drag {
  kind: AssetKind;
  id: string;
  start: Vector2;
  started: boolean;
  x: number;
  y: number;
  alt: boolean;
  shift: boolean;
  /** Model only: undefined until staticPropProblem answers. */
  problem: StaticProblem | undefined;
  checked: Promise<StaticProblem> | null;
  card: HTMLElement;
  ghost: Group;
  hot: HTMLElement | null;
  /** The lit faces of a material drop, and which faces they are. */
  lit: { key: string; group: Group } | null;
  queued: boolean;
}

const MOVE_PX = 5;
const AMBER = 0xf0a040;
const PROBLEM: Record<string, string> = {
  physics: 'physics data',
  notstatic: 'no $staticprop',
  moved: 'moved after compiling',
};

let editor: Editor | null = null;
let drag: Drag | null = null;
const targets = new WeakMap<HTMLElement, FieldTarget>();

/** Makes the editor the one drops go into; call once at start-up. */
export function mountAssetDrop(ed: Editor): void {
  editor = ed;
}

/** True while an asset is being dragged (past the click threshold). */
export function assetDragging(): boolean {
  return !!drag?.started;
}

/**
 * Starts dragging an asset from a dock tile; call it from the tile's left-button `pointerdown`. Nothing happens
 * until the pointer moves 5 px, so a plain click still reaches the tile's own click handler; the click that ends a
 * real drag is swallowed. Esc, or letting go anywhere but the view or a field that takes it, cancels.
 */
export function startAssetDrag(kind: AssetKind, id: string, e: PointerEvent): void {
  if (!editor || e.button !== 0) return;
  if (drag) end();
  const checked = kind === 'model' ? staticPropProblem(id) : null;
  drag = {
    kind, id, start: new Vector2(e.clientX, e.clientY), started: false, x: e.clientX, y: e.clientY, alt: e.altKey, shift: e.shiftKey,
    problem: kind === 'model' ? knownProblem(id) : null, checked,
    card: h('div.asset-drag-card', { hidden: true }), ghost: new Group(), hot: null, lit: null, queued: false,
  };
  const d = drag;
  void checked?.then((p) => { d.problem = p; if (drag === d) refresh(); });
}

/**
 * Makes `el` take drops of one kind of asset: while one is dragged over it the card says `label` and the field
 * lights up; letting go calls `drop` with the asset's path or name (which should be one undo step).
 */
export function dropTarget<T extends HTMLElement>(el: T, kind: AssetKind, label: FieldTarget['label'], drop: (id: string) => void): T {
  targets.set(el, { kind, label, drop });
  el.dataset.drop = kind;
  return el;
}

/**
 * Sets the model of props as one undo step. A prop_static given a model vbsp would delete becomes a prop_dynamic
 * in the same step, with a toast saying so.
 */
export async function swapModel(ed: Editor, props: MapEntity[], path: string): Promise<void> {
  const problem = await staticPropProblem(path);
  const turn = problem && problem !== 'missing' ? props.filter((e) => e.classname === 'prop_static') : [];
  ed.history.group(props.length > 1 ? `Set model of ${props.length} props` : 'Set model', () => {
    const end = ed.history.begin('Set model', [], props);
    for (const e of props) e.set('model', path);
    end();
    convertToDynamic(ed, turn);
  });
  recentModels.push(path);
  ed.changed();
  if (turn.length) toast(ed.container, `${turn.length > 1 ? `${turn.length} props are` : 'Now'} prop_dynamic: vbsp deletes ${modelName(path)} as prop_static (${PROBLEM[problem!]})`, 4000);
}

/** The model index's answer, while the model itself loads. */
function knownProblem(path: string): StaticProblem | undefined {
  const m = modelEntry(path);
  return m ? (m.static ? null : m.physics ? 'physics' : 'notstatic') : undefined;
}

function shortName(kind: AssetKind, id: string): string {
  return kind === 'model' ? modelName(id) : id.split(/[\\/]/).pop()!.replace(/\.(wav|mp3)$/i, '').toLowerCase();
}

const unsafe = (d: Drag) => d.kind === 'model' && !!d.problem && d.problem !== 'missing';
const num = (v: number) => String(Math.round(v)).replace('-', '−');
const xyz = (p: Vector3) => `${num(p.x)} ${num(p.y)} ${num(p.z)}`;
const isDecal = (e: MapEntity) => e.classname === 'infodecal' || e.classname === 'info_overlay';
const isProp = (e: MapEntity) => e.classname.startsWith('prop_') && !e.solids.length;

/** The field drop target at or above `el`. */
function fieldAt(el: Element | null): [HTMLElement, FieldTarget] | null {
  for (let n = el; n; n = n.parentElement) {
    const t = n instanceof HTMLElement ? targets.get(n) : undefined;
    if (t) return [n as HTMLElement, t];
  }
  return null;
}

/** What a drop at the pointer would do, from what is under it and the keys held. */
function plan(ed: Editor, d: Drag): Plan & { field?: HTMLElement } {
  const el = document.elementFromPoint(d.x, d.y);
  const field = fieldAt(el);
  if (field) {
    const [node, t] = field;
    if (t.kind !== d.kind) return { field: node, bad: true, text: `this field takes a ${t.kind}` };
    const info = { id: d.id, name: shortName(d.kind, d.id), unsafe: unsafe(d) };
    return { field: node, text: typeof t.label === 'string' ? t.label : t.label(info), run: () => t.drop(d.id) };
  }
  if (el !== ed.renderer.domElement) return { cancel: true, text: 'let go to cancel' };
  // In the quad view only a Camera pane takes drops. Aim through it: the quad view only follows the mouse with no
  // button held, so during a drag its input pane would still be the one the pointer left.
  if (ed.quad.on) {
    const pane = ed.quad.paneAt(d.x, d.y);
    if (pane < 0) return { cancel: true, text: 'let go to cancel' };
    if (ed.quad.kindOf(pane) !== 'camera') return { bad: true, text: 'drop it in the Camera pane (3D)' };
    ed.quad.setInput(pane);
  }
  const ndc = ed.ndcFromEvent({ clientX: d.x, clientY: d.y });
  if (d.kind === 'model') return modelPlan(ed, d, ndc);
  if (d.kind === 'material') return materialPlan(ed, d, ndc);
  if (d.kind === 'decal') return decalPlan(ed, d, ndc);
  return { bad: true, text: 'sounds can’t be dropped into the view yet: use the Sound tool' };
}

function modelPlan(ed: Editor, d: Drag, ndc: Vector2): Plan {
  if (d.problem === 'missing') return { bad: true, text: 'not found in the game files' };
  const hit = pickObject(ed, ndc);
  const sel = [...ed.selection.entities].filter(isProp);
  if (hit?.entity && isProp(hit.entity) && ed.selection.entities.has(hit.entity)) {
    const turn = unsafe(d) && sel.some((e) => e.classname === 'prop_static');
    return {
      text: sel.length > 1 ? `swap the model of ${sel.length} selected props` : `swap the model of this ${hit.entity.classname}`,
      hint: turn ? `becomes prop_dynamic: vbsp deletes it as prop_static (${PROBLEM[d.problem!]})` : undefined,
      run: () => swapModel(ed, sel, d.id),
    };
  }
  const s = pickSurface(ed, ndc);
  if (!s) return { bad: true, text: 'nothing to stand it on' };
  const g = ed.grid;
  const at = d.shift ? s.point.clone().round() : new Vector3(snap(s.point.x, g), snap(s.point.y, g), Math.round(s.point.z));
  const forced = unsafe(d);
  const cls = forced || d.alt ? 'prop_dynamic' : 'prop_static';
  const hint = forced ? `vbsp would delete it as prop_static (${PROBLEM[d.problem!]})` : d.alt ? 'Alt: prop_dynamic' : `Alt: prop_dynamic${d.shift ? ' · not snapped' : ''}`;
  return {
    text: `${cls} at ${xyz(at)}`, hint, at,
    run: async () => {
      // The index can be wrong about a model; the model file decides.
      const problem = await d.checked;
      if (problem === 'missing') return toast(ed.container, `${modelName(d.id)} is not in the game files`);
      const dynamic = d.alt || !!problem;
      placeEntity(ed, dynamic ? 'prop_dynamic' : 'prop_static', at, dynamic ? { model: d.id, solid: '6', DisableBoneFollowers: '1' } : { model: d.id });
      recentModels.push(d.id);
      if (problem && !d.alt) toast(ed.container, `Placed as prop_dynamic: vbsp deletes ${modelName(d.id)} as prop_static (${PROBLEM[problem]})`, 4000);
    },
  };
}

function materialPlan(ed: Editor, d: Drag, ndc: Vector2): Plan {
  const hit = pickObject(ed, ndc);
  if (!hit) return { bad: true, text: 'nothing to paint here' };
  if (!hit.solid || !hit.side) return { bad: true, text: 'materials go on brush faces' };
  const solid = hit.solid;
  const sides = d.shift ? solid.sides : [hit.side];
  return {
    text: d.shift ? `paint all ${sides.length} faces of this brush` : 'paint this face', hint: d.shift ? undefined : 'Shift: whole brush',
    faces: { solid, sides },
    run: () => {
      const end = ed.history.begin(d.shift ? 'Paint brush' : 'Paint', [solid]);
      for (const s of sides) s.material = d.id.toUpperCase();
      solid.commit();
      end();
      ed.changed();
      recentMaterials.push(d.id);
    },
  };
}

function decalPlan(ed: Editor, d: Drag, ndc: Vector2): Plan {
  const hit = pickObject(ed, ndc);
  if (hit?.entity && isDecal(hit.entity)) {
    const e = hit.entity;
    return {
      text: `swap the texture of this ${e.classname}`,
      run: () => {
        const end = ed.history.begin('Set decal texture', [], [e]);
        e.set(e.classname === 'info_overlay' ? 'material' : 'texture', d.id.toLowerCase());
        end();
        recentDecals.push(d.id);
        ed.changed();
      },
    };
  }
  if (!hit?.solid || !hit.normal) return { bad: true, text: hit ? 'decals go on brush faces' : 'nothing to put it on' };
  const mode = d.alt ? 'overlay' : 'decal';
  const ray = ed.raycaster(ndc);
  return {
    text: d.alt ? `info_overlay ${ed.decal.size} u wide` : 'infodecal on this face', hint: d.alt ? undefined : 'Alt: info_overlay',
    at: hit.point, normal: hit.normal,
    run: async () => {
      const e = await placeDecalRay(ed, ray, { ...ed.decal, material: d.id, mode });
      if (!e) return;
      recentDecals.push(d.id);
      ed.selection.set([], [e]);
    },
  };
}

/** The real model, standing where it would be placed, in an amber box. */
function modelGhost(ed: Editor, d: Drag): void {
  const box = new Box3Helper(new Box3(), new Color(AMBER));
  (box.material as LineBasicMaterial).depthTest = false;
  box.renderOrder = 14;
  const size = modelEntry(d.id)?.size;
  if (size) box.box.set(new Vector3(-size[0] / 2, -size[1] / 2, 0), new Vector3(size[0] / 2, size[1] / 2, size[2]));
  d.ghost.add(box);
  void loadModel(d.id).then((m) => {
    if (!m || drag !== d) return;
    const row = m.skins[0] ?? [];
    for (const part of m.parts) d.ghost.add(new Mesh(part.geometry, ed.materials.getModel(row[part.skinRef] ?? row[0] ?? 'debug/debugempty').material));
    if (!m.bounds.isEmpty()) box.box.copy(m.bounds);
  });
}

/** An amber outline the decal's size, on the face. */
function decalGhost(ed: Editor, d: Drag): void {
  const info = ed.decals.info(d.id);
  const square = new LineLoop(new BufferGeometry().setFromPoints([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => new Vector3(x, y, 0))),
    new LineBasicMaterial({ color: AMBER, depthTest: false }));
  square.renderOrder = 14;
  square.name = 'decal';
  d.ghost.add(square);
  void info.ready.then(() => { square.userData.aspect = info.height / info.width || 1; });
}

/** The faces a material would go on, lit up. */
function faceGhost(faces: Plan['faces']): Group {
  const g = new Group();
  if (!faces) return g;
  const fill = new MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const edge = new LineBasicMaterial({ color: AMBER, depthTest: false });
  for (const f of buildBrushFaces(faces.solid)) {
    if (!faces.sides.includes(f.side) || f.verts.length < 3) continue;
    const pos: number[] = [];
    for (let i = 1; i < f.verts.length - 1; i++) for (const v of [f.verts[0], f.verts[i], f.verts[i + 1]]) pos.push(v.x, v.y, v.z);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const mesh = new Mesh(geo, fill);
    mesh.renderOrder = 13;
    const line = new LineLoop(new BufferGeometry().setFromPoints(f.verts), edge);
    line.renderOrder = 14;
    g.add(mesh, line);
  }
  return g;
}

/** Adds a ghost to the scene, and to the quad view's 2D panes. */
function show(ed: Editor, o: Group): void {
  ed.scene.add(o);
  ed.quad.helpers.push(o);
}

function hide(ed: Editor, o: Group): void {
  ed.scene.remove(o);
  const i = ed.quad.helpers.indexOf(o);
  if (i >= 0) ed.quad.helpers.splice(i, 1);
}

function unlight(ed: Editor, d: Drag): void {
  if (!d.lit) return;
  hide(ed, d.lit.group);
  d.lit.group.traverse((o) => { if (o instanceof Mesh || o instanceof LineLoop) { o.geometry.dispose(); (o.material as MeshBasicMaterial).dispose(); } });
  d.lit = null;
}

/** Puts the ghost and the card where the pointer is, saying what a drop would do. */
function refresh(): void {
  const ed = editor, d = drag;
  if (!ed || !d?.started) return;
  const p = plan(ed, d);
  d.hot?.classList.remove('drop-hot', 'drop-bad');
  d.hot = p.field ?? null;
  d.hot?.classList.add(p.bad ? 'drop-bad' : 'drop-hot');

  const g = d.ghost;
  g.visible = !!p.at && !p.bad;
  if (p.at) g.position.copy(p.at);
  const square = g.getObjectByName('decal');
  if (square && p.at && p.normal) {
    const w = d.alt ? ed.decal.size : ed.decals.info(d.id).width || 64;
    const aspect = (square.userData.aspect as number | undefined) ?? 1;
    square.scale.set(w, w * aspect, 1);
    g.position.copy(p.at).addScaledVector(p.normal, 1);
    // Laid out as it will be placed: width along the surface's s axis, height along t (down on walls).
    const n = p.normal.clone().normalize();
    const { s, t } = decalBasis(n);
    g.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(s, t.negate(), n));
    if (d.alt) g.rotateZ((ed.decal.rotation * Math.PI) / 180);
  }
  const key = p.faces && !p.bad ? `${p.faces.solid.id}:${p.faces.sides.map((s) => s.id).join(',')}` : '';
  if (key !== (d.lit?.key ?? '')) {
    unlight(ed, d);
    if (key) {
      d.lit = { key, group: faceGhost(p.faces) };
      show(ed, d.lit.group);
    }
  }

  const c = d.card;
  c.hidden = false;
  c.className = `asset-drag-card${p.bad ? ' bad' : p.cancel ? ' cancel' : ''}`;
  c.replaceChildren(h('b', {}, shortName(d.kind, d.id)), h('span', {}, ` · ${p.text}`), p.hint ? h('span.hint', {}, ` · ${p.hint}`) : '');
  // Right of the cursor, or left of it where it would run off the window (over the sidebar's fields).
  c.style.left = `${d.x + 16 + c.offsetWidth > window.innerWidth - 8 ? Math.max(8, d.x - 16 - c.offsetWidth) : d.x + 16}px`;
  c.style.top = `${d.y + 18}px`;
}

function queueRefresh(): void {
  const d = drag;
  if (!d || d.queued) return;
  d.queued = true;
  requestAnimationFrame(() => { d.queued = false; refresh(); });
}

function begin(ed: Editor, d: Drag): void {
  d.started = true;
  document.body.append(d.card);
  document.body.dataset.assetDrag = d.kind;
  window.getSelection()?.removeAllRanges();
  if (d.kind === 'model') modelGhost(ed, d);
  else if (d.kind === 'decal') decalGhost(ed, d);
  d.ghost.visible = false;
  show(ed, d.ghost);
  refresh();
}

/** Takes the ghost, card and highlight away and forgets the drag. */
function end(): void {
  const d = drag, ed = editor;
  drag = null;
  if (!d) return;
  d.card.remove();
  d.hot?.classList.remove('drop-hot', 'drop-bad');
  delete document.body.dataset.assetDrag;
  if (ed) {
    hide(ed, d.ghost);
    unlight(ed, d);
  }
}

function finish(): void {
  const ed = editor, d = drag;
  if (!ed || !d) return;
  const p = plan(ed, d);
  end();
  if (p.bad) toast(ed.container, `Not dropped: ${p.text}`);
  else if (p.run) void p.run();
}

/** Swallows the click that follows the pointerup of a real drag (it would otherwise "click" the tile). */
function swallowClick(): void {
  const stop = (e: Event) => { e.stopImmediatePropagation(); e.preventDefault(); };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

const swallow = (e: Event) => { e.stopImmediatePropagation(); e.preventDefault(); };

// Registered when the module loads, which is before the editor builds its tools: window capture listeners run in the
// order they were added, so these see every pointer and key event first and keep them from the active tool, the
// gizmo, snap move (V) and the camera while a drag is on.
window.addEventListener('pointermove', (e) => {
  const d = drag;
  if (!d || !editor) return;
  d.x = e.clientX;
  d.y = e.clientY;
  d.alt = e.altKey;
  d.shift = e.shiftKey;
  if (!d.started) {
    if (d.start.distanceTo(new Vector2(e.clientX, e.clientY)) < MOVE_PX) return;
    begin(editor, d);
  }
  e.stopImmediatePropagation();
  queueRefresh();
}, true);
window.addEventListener('pointerup', (e) => {
  const d = drag;
  if (!d || e.button !== 0) return;
  if (!d.started) { drag = null; return; }
  swallow(e);
  swallowClick();
  d.x = e.clientX;
  d.y = e.clientY;
  d.alt = e.altKey;
  d.shift = e.shiftKey;
  finish();
}, true);
window.addEventListener('pointerdown', (e) => { if (drag?.started) { swallow(e); end(); } }, true);
window.addEventListener('pointercancel', () => end(), true);
window.addEventListener('blur', () => end());
window.addEventListener('dragstart', (e) => { if (drag) e.preventDefault(); }, true);
window.addEventListener('contextmenu', (e) => { if (drag?.started) swallow(e); }, true);
for (const type of ['keydown', 'keyup'] as const) {
  window.addEventListener(type, (e) => {
    const d = drag;
    if (!d?.started) return;
    swallow(e);
    if (type === 'keydown' && e.key === 'Escape') return end();
    if (e.key === 'Alt' || e.key === 'Shift') {
      d.alt = e.altKey;
      d.shift = e.shiftKey;
      refresh();
    }
  }, true);
}
