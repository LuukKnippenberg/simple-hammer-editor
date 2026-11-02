import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Plane, PlaneGeometry, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity, MapSolid } from '../vmf/map.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickSurface } from './tools.ts';
import { solidBounds } from './brushes.ts';
import type { RoadTool } from './roadTool.ts';
import type { PowerlineTool } from './powerlineTool.ts';
import type { PoiTool } from './poiTool.ts';
import type { StairsTool } from './stairsTool.ts';
import { ARCHITECTURES, type BuildingOptions } from '../gen/buildings.ts';
import { applyBlock, deleteBlock, dressGroup, selectBlock } from '../gen/buildingAction.ts';
import { blockOf, newBlockUid, type BlockSpec } from '../gen/buildingStore.ts';
import { BUILDING_HANDLE, findHandle, STAIRS_HANDLE } from '../gen/handle.ts';
import { deleteStairs } from '../gen/stairsAction.ts';
import { stairsOf } from '../gen/stairsStore.ts';
import { deletePoi, poisFromBlocks, regeneratePoi } from '../gen/poi/action.ts';
import { poiOf } from '../gen/poi/registry.ts';
import { POI_ID_KEY } from '../gen/poi/spec.ts';
import { handleOf } from '../gen/poi/handle.ts';
import type { PoiSpec } from '../gen/poi/types.ts';
import { ROAD_STYLES, roadOf } from '../gen/roads.ts';
import { powerlineOf } from '../gen/powerlines.ts';
import { openRoomsDialog } from '../ui/roomsDialog.ts';
import {
  BUILDING_LAYOUTS, DEFAULT_SIZE, dragRect, generator, isBuildingGenerator, lotPreview, tuneSummary, type DragRect, type GeneratorId,
} from './generators.ts';

/**
 * The Generate menu's flow: Pick → Place → Tune → Done. Picking a generator places it (drag a footprint, click
 * points along a route) or, with a block brush selected, fills that brush; the Tune step then rebuilds what was
 * made in place on every change, and the whole generate (with its tweaks) is one undo step. The tool itself
 * places buildings, blocks and houses; roads, powerlines and POIs are placed by their own tools.
 */
export type GenStep = 'place' | 'tune';
export type BuildingGenerator = 'building' | 'block' | 'house';

export interface GenSession {
  id: GeneratorId;
  step: GenStep;
  /** What this generate made: blocks' or POIs' func_details, a road, a powerline's first pole. */
  made: MapEntity[];
  /** History depth before it was made: everything since is squashed into one step. */
  mark: number;
  summary: string;
}

/** The tool that places each generator. */
export const TOOL_OF: Record<GeneratorId, ToolName | null> = {
  building: 'generate', block: 'generate', house: 'generate', interior: null, road: 'road', powerline: 'powerline', stairs: 'stairs', poi: 'poi',
};
/** Tools that belong to the Generate menu (the rail shows them on its Generate button). */
export const GENERATE_TOOLS = new Set<ToolName>(['generate', 'road', 'powerline', 'stairs', 'poi']);

/** A POI's size and type, for the Tune step. */
function poiSummary(e: MapEntity): string {
  const p = poiOf(e);
  if (!p) return 'Point of interest';
  const r = p.spec.rect;
  return `${r.x1 - r.x0} × ${r.y1 - r.y0} · ${p.type.label} · turned ${p.spec.rotation}°`;
}

const seed = () => Math.floor(Math.random() * 100000);

function defaults(id: BuildingGenerator): BuildingOptions {
  const common = { seed: seed(), alleys: false, roofProps: true, weathering: 0.5, detail: 2 as const, quality: 'high' as const, roofs: 'mixed' as const, towers: true, annexes: true, courtyards: true, layout: BUILDING_LAYOUTS[id] };
  if (id === 'house') return { ...common, architecture: 'village', minFloors: 1, maxFloors: 1, furnish: 'full', interiorLights: true, cutHeight: 112 };
  if (id === 'building') return { ...common, architecture: 'mixed', minFloors: 3, maxFloors: 5 };
  return { ...common, architecture: 'mixed', minFloors: ARCHITECTURES.mixed.floors[0], maxFloors: ARCHITECTURES.mixed.floors[1] };
}

/** Block brushes in the selection (world brushes, not terrain), which a generator can fill. */
export function selectedBlockBrushes(editor: Editor): MapSolid[] {
  return [...editor.selection.solids].filter((s) => !s.entity && !s.isDisplacement);
}

export class GenerateTool implements Tool {
  name: ToolName = 'generate';
  private editor: Editor;
  session: GenSession | null = null;
  /** The last generator finished with Done: Enter in the menu picks it again. */
  last: GeneratorId | null = null;
  /** Settings of the next (or the tuned) building, block and house. */
  readonly options: Record<BuildingGenerator, BuildingOptions> = { building: defaults('building'), block: defaults('block'), house: defaults('house') };
  /** Opens the menu (set by the menu, for Esc in the Place step). */
  onMenu: () => void = () => {};
  private start: Vector3 | null = null;
  private current = new Vector3();
  private square = false;
  private ghost = new Group();
  private fill: Mesh;
  private outline: LineSegments;
  private label: HTMLDivElement;

  constructor(editor: Editor) {
    this.editor = editor;
    this.fill = new Mesh(new PlaneGeometry(1, 1).translate(0.5, 0.5, 0), new MeshBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.18, depthWrite: false, depthTest: false }));
    this.outline = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xffc46b, depthTest: false, transparent: true }));
    this.fill.renderOrder = 11;
    this.outline.renderOrder = 12;
    this.outline.frustumCulled = false;
    this.ghost.add(this.fill, this.outline);
    this.ghost.visible = false;
    editor.scene.add(this.ghost);
    this.label = document.createElement('div');
    this.label.className = 'gen-ghost';
    this.label.hidden = true;
    editor.container.append(this.label);
    // The session follows the tool: another tool ends it, a generator's tool started elsewhere (the POI tab) begins one.
    editor.on('toolchange', () => this.syncTool());
    // Undone or deleted from outside: back to placing.
    editor.on('change', () => this.checkMade());
    editor.on('document', () => { if (this.session) this.end(); });
    queueMicrotask(() => this.hookTools());
  }

  private get kind(): BuildingGenerator {
    const id = this.session?.id;
    return isBuildingGenerator(id) ? id : 'block';
  }

  // --- Session ------------------------------------------------------------------------------------------

  /** Picks a generator from the menu (or its direct key): fills the selected block brushes, or starts placing it. */
  pick(id: GeneratorId): void {
    const ed = this.editor;
    const brushes = selectedBlockBrushes(ed);
    if (id === 'interior') {
      this.end();
      this.setTool('select');
      this.last = id;
      openRoomsDialog(ed, brushes.length === 1 ? { brush: brushes[0] } : {});
      return;
    }
    this.session = { id, step: 'place', made: [], mark: ed.history.depth, summary: '' };
    this.setTool(TOOL_OF[id]!);
    if (generator(id).fills && brushes.length) this.fillBrushes(brushes);
    ed.emit('generate');
  }

  /** Puts the chosen generator into the selected block brushes (one undo step) and goes on to Tune. */
  private fillBrushes(brushes: MapSolid[]): void {
    const ed = this.editor, s = this.session!;
    s.mark = ed.history.depth;
    if (s.id === 'poi') {
      const t = (ed.tools.tools.poi as PoiTool);
      const type = t.type;
      if (!type) return;
      s.made = poisFromBlocks(ed, type, brushes, { rotation: t.rotation, seed: t.seed, landscape: t.landscape ?? type.landscapes[0], params: t.paramsFor(type) });
      s.summary = `${s.made.length > 1 ? `${s.made.length} × ` : ''}${type.label} in the selected block${s.made.length > 1 ? 's' : ''}`;
    } else if (isBuildingGenerator(s.id)) {
      const id = s.id;
      const o = this.options[id];
      const group = newBlockUid();
      let res = { buildings: 0, houses: 0, ring: false };
      ed.history.group(`Generate ${generator(id).name.toLowerCase()}`, () => {
        const known = brushes.map((b, i) => {
          const box = solidBounds(b);
          const spec: BlockSpec = {
            uid: newBlockUid(), group, street: 'flat', groupSeed: o.seed,
            rect: { x0: Math.round(box.min.x), y0: Math.round(box.min.y), x1: Math.round(box.max.x), y1: Math.round(box.max.y) }, z: Math.round(box.min.z),
            options: { ...o, seed: o.seed + i * 7919 },
          };
          const r = applyBlock(ed, spec, 'Generate buildings', null, false);
          s.made.push(r.detail);
          res = { buildings: res.buildings + r.buildings, houses: res.houses + r.houses, ring: res.ring || r.ring };
          return r.dressing;
        });
        dressGroup(ed, group, known);
        ed.history.remove('Remove block', brushes);
      });
      const r = blockOf(s.made[0])!.rect;
      s.summary = (brushes.length > 1 ? `${brushes.length} blocks · ` : '') + tuneSummary(id, r.x1 - r.x0, r.y1 - r.y0, res);
    }
    this.selectMade();
    s.step = 'tune';
    ed.changed();
  }

  /** Builds a building generator on a footprint the user dragged. */
  private place(r: DragRect, z: number): void {
    const ed = this.editor, s = this.session;
    if (!s || !isBuildingGenerator(s.id)) return;
    // A drag in the Tune step starts the next one: the one being tuned stays as it is.
    if (s.step === 'tune') this.options[s.id].seed = seed();
    s.mark = ed.history.depth;
    const o = this.options[s.id];
    const uid = newBlockUid();
    const spec: BlockSpec = { uid, group: uid, street: 'flat', groupSeed: o.seed, rect: { ...r }, z, options: { ...o } };
    const res = applyBlock(ed, spec, `Generate ${generator(s.id).name.toLowerCase()}`);
    s.made = [res.detail];
    s.summary = tuneSummary(s.id, r.x1 - r.x0, r.y1 - r.y0, res);
    s.step = 'tune';
    this.selectMade();
    ed.emit('generate');
  }

  /** Something a generator's own tool just built (a road, a powerline, a POI). */
  private built(id: GeneratorId, e: MapEntity, summary: string): void {
    const ed = this.editor;
    if (this.session?.id !== id) return;
    // The tool built it as one undo step just now.
    this.session = { id, step: 'tune', made: [e], mark: ed.history.depth - 1, summary };
    ed.emit('generate');
  }

  /** Rebuilds what is being tuned with the current settings (POIs: with `poi` changes); one undo step with the generate. */
  rebuild(poi: Partial<PoiSpec> = {}): void {
    const ed = this.editor, s = this.session;
    if (!s || s.step !== 'tune' || !s.made.length) return;
    const id = s.id;
    if (isBuildingGenerator(id)) {
      const o = this.options[id];
      let res = { buildings: 0, houses: 0, ring: false };
      s.made.forEach((detail, i) => {
        const b = blockOf(detail);
        if (!b) return;
        const r = applyBlock(ed, { ...b, options: { ...o, cut: b.options.cut, seed: o.seed + i * 7919 } }, `Generate ${generator(id).name.toLowerCase()}`, detail);
        res = { buildings: res.buildings + r.buildings, houses: res.houses + r.houses, ring: res.ring || r.ring };
      });
      const r = blockOf(s.made[0])!.rect;
      s.summary = (s.made.length > 1 ? `${s.made.length} blocks · ` : '') + tuneSummary(id, r.x1 - r.x0, r.y1 - r.y0, res);
    } else if (id === 'poi') {
      s.made = s.made.map((d, i) => regeneratePoi(ed, d, { ...poi, ...(poi.seed !== undefined ? { seed: poi.seed + i * 7919 } : {}) }, 'Generate POI') ?? d);
      if (s.made.length === 1) s.summary = poiSummary(s.made[0]);
    }
    ed.history.squash(s.mark, `Generate ${generator(id).name.toLowerCase()}`);
    this.selectMade();
    ed.emit('generate');
  }

  /** Carries on placing points on stairs already built (their Selection panel): a Tune session for them. */
  continueStairs(detail: MapEntity): void {
    const ed = this.editor, s = stairsOf(detail);
    if (!s) return;
    this.session = { id: 'stairs', step: 'tune', made: [detail], mark: ed.history.depth, summary: '' };
    this.setTool('stairs');
    (ed.tools.tools.stairs as StairsTool).continueStairs(detail);
    this.selectMade();
    ed.emit('generate');
  }

  /** Squashes an edit made through another action (a road's or powerline's rebuild) into the generate. */
  squashed(made?: MapEntity[]): void {
    const s = this.session;
    if (!s) return;
    if (made) { s.made = made; s.step = 'tune'; }
    this.editor.history.squash(s.mark, `Generate ${generator(s.id).name.toLowerCase()}`);
    this.editor.emit('generate');
  }

  /** New seed, rebuilt in place. */
  reroll(): void {
    const s = this.session;
    if (!s) return;
    if (isBuildingGenerator(s.id)) { this.options[s.id].seed = seed(); this.rebuild(); }
    else if (s.id === 'poi') { (this.editor.tools.tools.poi as PoiTool).seed = seed(); this.rebuild({ seed: seed() }); }
  }

  /** Takes back what this generate made (and puts back a filled brush), then places anew. */
  remove(): void {
    const ed = this.editor, s = this.session;
    if (!s || s.step !== 'tune') return;
    if (ed.history.depth === s.mark + 1) ed.undo();
    else for (const d of s.made) {
      if (!ed.doc.entities.includes(d)) continue;
      if (blockOf(d)) deleteBlock(ed, d);
      else if (poiOf(d)) deletePoi(ed, d);
      else if (stairsOf(d)) deleteStairs(ed, d);
    }
    ed.selection.clear();
    s.made = [];
    s.summary = '';
    s.step = 'place';
    ed.changed();
    ed.emit('generate');
  }

  /** Done: back to the Select tool with what was made selected; remembered for Repeat last. */
  done(): void {
    const s = this.session;
    if (!s) return;
    this.last = s.id;
    const made = s.made;
    this.session = null;
    this.setTool('select');
    if (made.length) this.selectMade(made);
    this.editor.emit('generate');
  }

  /** Esc: Tune → Place → the menu. */
  back(): void {
    const s = this.session;
    if (!s) return;
    if (s.step === 'tune') {
      s.step = 'place';
      s.made = [];
      s.summary = '';
      if (isBuildingGenerator(s.id)) this.options[s.id].seed = seed();
      this.editor.selection.clear();
      this.editor.emit('generate');
      return;
    }
    this.toMenu();
  }

  /** Back to the menu (what was made stays). */
  toMenu(): void {
    this.end();
    this.setTool('select');
    this.onMenu();
  }

  /** Ends the session without changing the tool. */
  end(): void {
    if (!this.session) return;
    this.session = null;
    this.cancelDrag();
    this.editor.emit('generate');
  }

  private setTool(name: ToolName): void {
    if (this.editor.tools.current.name === name) return;
    this.editor.tools.set(name);
    this.editor.emit('toolchange');
  }

  private syncTool(): void {
    const name = this.editor.tools.current.name;
    const s = this.session;
    if (s && TOOL_OF[s.id] === name) return;
    if (s) this.end();
    if (!GENERATE_TOOLS.has(name)) return;
    const id: GeneratorId = name === 'generate' ? (isBuildingGenerator(this.last) ? this.last : 'block') : (name as GeneratorId);
    this.session = { id, step: 'place', made: [], mark: this.editor.history.depth, summary: '' };
    this.editor.emit('generate');
  }

  private checkMade(): void {
    const s = this.session;
    if (!s || s.step !== 'tune') return;
    if (s.made.every((e) => this.editor.doc.entities.includes(e))) return;
    s.made = [];
    s.summary = '';
    s.step = 'place';
    this.editor.emit('generate');
  }

  /** Selects what was made by its handles. */
  private selectMade(made = this.session?.made ?? []): void {
    const doc = this.editor.doc;
    const ents = made.map((d) => (blockOf(d) ? findHandle(doc, BUILDING_HANDLE, d.get(BUILDING_HANDLE.idKey) ?? '')
      : poiOf(d) ? handleOf(doc, d.get(POI_ID_KEY) ?? '')
        : stairsOf(d) ? findHandle(doc, STAIRS_HANDLE, d.get(STAIRS_HANDLE.idKey) ?? '') : null) ?? d);
    if (made.length === 1 && blockOf(made[0])) selectBlock(this.editor, made[0]);
    else this.editor.selection.set([], ents);
  }

  /** Hears when the road, powerline and POI tools build something. */
  private hookTools(): void {
    const t = this.editor.tools.tools;
    (t.road as RoadTool).onBuilt = (e) => {
      const r = roadOf(e);
      const len = r ? r.points.reduce((n, p, i) => n + (i ? p.distanceTo(r.points[i - 1]) : 0), 0) : 0;
      this.built('road', e, r ? `${ROAD_STYLES[r.style].label} · ${r.points.length} points · ${Math.round(len)} units` : 'Road built');
    };
    (t.powerline as PowerlineTool).onBuilt = (e) => {
      const l = powerlineOf(this.editor.doc.entities, e);
      this.built('powerline', e, l ? `${l.spec.points.length} route points · ${l.members.filter((m) => m.classname === 'prop_static').length} poles and mounts` : 'Powerline built');
    };
    (t.poi as PoiTool).onBuilt = (e) => this.built('poi', e, poiSummary(e));
    const stairs = t.stairs as StairsTool;
    stairs.onBuilt = (e, summary) => this.built('stairs', e, summary);
    // Each point added or taken back joins the generate's undo step; with none left it is back to placing.
    stairs.onChanged = (e, summary) => {
      const s = this.session;
      if (s?.id !== 'stairs') return;
      s.summary = summary;
      if (e) this.squashed([e]);
      else { this.editor.history.squash(s.mark, 'Generate stairs'); s.made = []; s.step = 'place'; this.editor.emit('generate'); }
    };
    stairs.onFinish = () => this.done();
  }

  // --- Placing buildings ----------------------------------------------------------------------------------

  activate(): void {}
  deactivate(): void {
    this.cancelDrag();
  }

  private cancelDrag(): void {
    this.start = null;
    this.ghost.visible = false;
    this.label.hidden = true;
    this.editor.status = '';
  }

  private rect(): DragRect | null {
    if (!this.start) return null;
    return dragRect(this.start, this.current, { square: this.square, size: DEFAULT_SIZE[this.kind] });
  }

  down(e: PointerEvent, ndc: Vector2): void {
    if (!this.session || !isBuildingGenerator(this.session.id)) return;
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return;
    this.start = new Vector3(hit.point.x, hit.point.y, Math.round(hit.point.z));
    this.current.copy(this.start);
    this.square = e.shiftKey;
    this.redraw();
  }

  move(e: PointerEvent, ndc: Vector2): void {
    if (!this.start) return;
    const p = this.editor.raycaster(ndc).ray.intersectPlane(new Plane(new Vector3(0, 0, 1), -this.start.z), new Vector3());
    if (!p) return;
    this.current.copy(p);
    this.square = e.shiftKey;
    this.redraw();
  }

  up(): void {
    const r = this.rect(), z = this.start?.z ?? 0;
    this.cancelDrag();
    if (r) this.place(r, z);
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.start) {
      this.cancelDrag();
      return true;
    }
    return false;
  }

  private redraw(): void {
    const r = this.rect();
    if (!r || !this.start) return;
    const z = this.start.z + 2, w = r.x1 - r.x0, d = r.y1 - r.y0;
    this.fill.position.set(r.x0, r.y0, z);
    this.fill.scale.set(w, d, 1);
    const L: number[] = [];
    const c = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
    for (let i = 0; i < 4; i++) L.push(c[i][0], c[i][1], z, c[(i + 1) % 4][0], c[(i + 1) % 4][1], z);
    // Corner posts, so the footprint reads in the 3D view too.
    for (const [x, y] of c) L.push(x, y, z, x, y, z + 96);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(L), 3));
    this.outline.geometry.dispose();
    this.outline.geometry = g;
    this.ghost.visible = true;
    // The size and what it will become, over the middle of the footprint.
    const v = new Vector3((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, z).project(this.editor.activeCamera);
    const cr = this.editor.container.getBoundingClientRect(), rr = this.editor.renderer.domElement.getBoundingClientRect();
    this.label.style.left = `${rr.left - cr.left + ((v.x + 1) / 2) * rr.width}px`;
    this.label.style.top = `${rr.top - cr.top + ((1 - v.y) / 2) * rr.height}px`;
    const what = lotPreview(this.kind, w, d, { courtyards: this.options[this.kind].courtyards });
    this.label.replaceChildren(Object.assign(document.createElement('b'), { textContent: `${w} × ${d}` }), Object.assign(document.createElement('span'), { textContent: what }));
    this.label.hidden = false;
    this.editor.status = `${generator(this.kind).name} · ${w} × ${d} · release to build`;
  }
}
