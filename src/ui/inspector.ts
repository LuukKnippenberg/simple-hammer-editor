import { Box3, Vector3 } from 'three';
import type { MapEntity } from '../vmf/map.ts';
import type { Editor } from '../editor.ts';
import { applyMaterial, BRUSH_CLASSES, deleteSelection, duplicateSelection, moveToWorld, tieToEntity } from '../edit/actions.ts';
import { remapSolid } from '../edit/brushes.ts';
import { h, toast } from './dom.ts';
import { buildingsFromSelection, deleteBlock, duplicateBlock, regenerateBlock, selectBlock, selectedBlocks } from '../gen/buildingAction.ts';
import { blockFinder, blockOf } from '../gen/buildingStore.ts';
import type { BuildingOptions } from '../gen/buildings.ts';
import { buildingSheet, type BuildingRow } from './buildingOptions.ts';
import { roadSheet } from './roadOptions.ts';
import { powerlineSheet } from './powerlineOptions.ts';
import { num, row, select } from './form.ts';
import { entityEditor, multiEntityEditor } from './entityEditor.ts';
import { centreline, roadOf, type RoadSpec } from '../gen/roads.ts';
import { CARRIAGEWAYS, GUTTERS, KERBS, PAVEMENTS, type StreetMaterial } from '../gen/streetMaterials.ts';
import { blendRoadIntoGround, rebuildRoads } from '../gen/roadAction.ts';
import { powerlineOf, type PowerlineSpec } from '../gen/powerlines.ts';
import { editPowerline } from '../edit/powerlineTool.ts';
import { auditionSoundscape, soundscapeSelect } from './soundUi.ts';
import { soundBrowser } from './soundBrowser.ts';
import { audio } from '../audio/engine.ts';
import { presetsFor } from '../lw/soundPresets.ts';
import { addPreset } from '../edit/presetAction.ts';
import { poiEditor, selectedPoi } from './poiPanel.ts';
import { duplicatePoi, selectedPois } from '../gen/poi/action.ts';
import { cinemaInspector } from './cinemaPanel.ts';
import { deleteRooms, regenerateRooms, selectedRooms } from '../gen/rooms/action.ts';
import { roomsOf } from '../gen/rooms/store.ts';
import { roomLayout } from '../gen/rooms/model.ts';
import { roomType } from '../gen/rooms/types.ts';
import { openRoomsDialog } from './roomsDialog.ts';
import { openGenerateMenu } from './generateMenu.ts';
import { partInspector } from './partPanel.ts';
import { deleteStairs, duplicateStairs, regenerateStairs, selectedStairs } from '../gen/stairsAction.ts';
import { stairsOf } from '../gen/stairsStore.ts';
import { buildStairs, pointNames, stairsSummary, type StairsFlight } from '../gen/stairs.ts';
import { stairsSheet } from './stairsOptions.ts';
import type { GenerateTool } from '../edit/generateTool.ts';
import { VmfDocument } from '../vmf/map.ts';
import { snapMoveSection } from './snapMovePanel.ts';

/** Properties of the selection: entity keyvalues (typed from the FGD) or brush size and materials. */
export function mountInspector(editor: Editor): HTMLElement {
  const panel = h('div');
  const render = () => {
    const sel = editor.selection;
    panel.replaceChildren();
    // Faces, edges or vertices (Shift+2/3/4).
    if (sel.mode !== 'object') return void panel.append(partInspector(editor));
    if (sel.isEmpty) {
      panel.append(
        h('div.section', {}, h('h3', {}, 'Selection'),
          h('p.hint', {}, 'Click a brush or entity to select it. Shift-click adds to the selection.'),
          h('p.hint', {}, 'Tools: 1 select · 2 block · 3 paint · 4 entity. Q select · W move · E rotate · R resize · F focus · Ctrl+D duplicate · Del delete · [ ] grid.')),
        h('div.section', {}, h('h3', {}, 'Generate'),
          h('p.hint', {}, 'Buildings, blocks of buildings, interior buildings, roads, powerlines and points of interest are in the Generate menu: the wand at the bottom of the tool rail, or G. Select a block brush first to fill it.')),
        h('div.section', {}, h('h3', {}, 'Interior building'),
          h('p.hint', {}, 'A building made of rooms (train hall, customs, rations, waiting room, hallway, concourse), each furnished for its type. Built in front of the camera; select a block brush first to build it there.'),
          h('button', { onclick: () => openRoomsDialog(editor) }, '🏛 Interior building…')),
      );
      return;
    }
    // POI handles stand for their POIs: only the POI's settings (a handle's own keys are internal).
    const pois = selectedPois(editor);
    if (pois.length) {
      panel.append(h('div.section', {}, h('h3', {}, 'Selection'),
        h('div', {}, pois.length > 1 ? `${pois.length} points of interest` : 'Point of interest'),
        h('p.hint', {}, 'Drag the gizmo to move (W) or resize (R) it. The comma and period keys turn it, Ctrl+D duplicates it, Delete removes it. Hide the handles (Handles in the view bar) to pick single props and brushes.'),
        pois.length === 1 ? h('div.row', {}, h('button', { onclick: () => duplicatePoi(editor, pois[0]) }, 'Duplicate')) : null));
      if (pois.length === 1) { const p = poiEditor(editor, pois[0]); if (p) panel.append(p); }
      return;
    }
    // Building handles stand for their blocks: only the block's building settings.
    const blocks = selectedBlocks(editor);
    if (blocks.length) {
      panel.append(h('div.section', {}, h('h3', {}, 'Selection'),
        h('div', {}, blocks.length > 1 ? `${blocks.length} blocks of buildings` : LAYOUT_LABEL[blockOf(blocks[0])?.options.layout ?? 'block']),
        h('p.hint', {}, 'Drag the gizmo to move (W) or resize (R) it; it is rebuilt to fit, with the street dressing of the blocks generated with it. Ctrl+D duplicates it, Delete removes it. Hide the handles (Handles in the view bar) to pick single props and brushes.'),
        blocks.length === 1 ? h('div.row', {}, h('button', { onclick: () => duplicateBlock(editor, blocks[0]) }, 'Duplicate')) : null));
      const p = blocks.length === 1 && blockPanel(editor, blocks[0]);
      if (p) panel.append(p);
      return;
    }
    // Stairs handles stand for their stairs.
    const stairs = selectedStairs(editor);
    if (stairs.length) {
      panel.append(...stairsPanel(editor, stairs));
      return;
    }
    // Interior building handles stand for their buildings.
    const rooms = selectedRooms(editor);
    if (rooms.length) {
      panel.append(roomsPanel(editor, rooms));
      return;
    }
    const solids = sel.allSolids();
    const ents = [...sel.entities];
    const summary = [solids.length && `${solids.length} brush${solids.length > 1 ? 'es' : ''}`, ents.length && `${ents.length} entit${ents.length > 1 ? 'ies' : 'y'}`].filter(Boolean).join(', ');
    // Entities alone get their own header card (entityEditor.ts) with these buttons.
    if (solids.length) panel.append(h('div.section', {}, h('h3', {}, 'Selection'), h('div', {}, summary),
      h('div.row', { style: { marginTop: '6px' } },
        h('button', { onclick: () => duplicateSelection(editor) }, 'Duplicate'),
        h('button', { onclick: () => deleteSelection(editor) }, 'Delete'))));
    // Block brushes: what the Generate menu can fill them with.
    const blockBrushes = [...sel.solids].filter((s) => !s.entity && !s.isDisplacement);
    if (blockBrushes.length && !ents.length && !blockBrushes.some(blockFinder(editor.doc))) {
      panel.append(h('div.section.gen-box', {}, h('h3', {}, 'Generate'),
        h('p.hint', {}, `Fill ${blockBrushes.length > 1 ? 'these blocks' : 'this block'} with a building, a block of buildings, an interior building or a point of interest.`),
        h('button.primary', { onclick: () => openGenerateMenu() }, 'Generate… ', h('kbd', {}, 'G'))));
    }

    // A brush picked out of a brush entity (func_detail, triggers, ...): offer the whole entity.
    const owners = new Set([...sel.solids].map((s) => s.entity).filter((e): e is MapEntity => !!e && !sel.entities.has(e)));
    for (const owner of owners) {
      panel.append(h('div.section', {}, h('div.hint', {}, `Part of ${owner.classname} (${owner.solids.length} brushes)`),
        h('button', { onclick: () => sel.set([], [owner]) }, `Select whole ${owner.classname}`)));
    }
    // Brushes picked out of a generated block (handles hidden): offer the whole block.
    const looseWorld = [...sel.solids].filter((s) => !s.entity);
    const findBlock = blockFinder(editor.doc);
    const partOf = new Set(looseWorld.map(findBlock).filter((b): b is MapEntity => !!b));
    for (const b of partOf) {
      panel.append(h('div.section', {}, h('div.hint', {}, 'Part of a block of generated buildings'),
        h('button', { onclick: () => selectBlock(editor, b) }, 'Select whole block')));
    }
    if ([...sel.solids].some((s) => !s.entity)) {
      const cls = h('select', {}, ...BRUSH_CLASSES.map((b) => h('option', { value: b.cls }, b.label))) as HTMLSelectElement;
      panel.append(h('div.section', {}, h('h3', {}, 'Tie to entity'),
        h('div.row', {}, cls, h('button', { onclick: () => tieToEntity(editor, cls.value) }, 'Tie (Ctrl+T)'))));
    }
    if (ents.length === 1 && ents[0].solids.length) {
      panel.append(h('div.section', {}, h('button', { onclick: () => moveToWorld(editor, ents[0]) }, 'Move brushes to world')));
    }
    // A road, or a brush picked out of one: the road's settings.
    const roadEnt = ents.length === 1 ? ents[0] : !ents.length && owners.size === 1 ? [...owners][0] : null;
    const road = roadEnt ? roadOf(roadEnt) : null;
    if (roadEnt && road) panel.append(roadPanel(editor, roadEnt, road));
    const poi = selectedPoi(editor);
    const poiPanel = poi && poiEditor(editor, poi);
    if (poiPanel) panel.append(poiPanel);
    if (ents.length === 1 && ents[0].classname === 'env_soundscape') panel.append(soundscapePanel(editor, ents[0]));
    if (ents.length === 1 && ents[0].classname === 'ambient_generic') panel.append(ambientPanel(editor, ents[0]));
    const fits = ents.length === 1 ? presetsFor(ents[0].get('model')) : [];
    // Shown as the last group of the entity editor.
    const effects = fits.length ? [{ label: 'Sound and effects' as const, keys: [], summary: fits.map((p) => `${p.icon} ${p.label}`).join(' '), body: () => h('div', {},
      h('p.hint', {}, 'Bring this prop to life:'),
      h('div.row', {}, ...fits.map((p) => h('button', { onclick: () => addPreset(editor, p, ents[0].origin!, ents[0].angles.y, ents[0]) }, `${p.icon} ${p.label}`)))) }] : [];
    const line = ents.length === 1 ? powerlineOf(editor.doc.entities, ents[0]) : null;
    if (line) panel.append(powerlinePanel(editor, ents[0], line.spec, line.members.length));
    panel.append(...cinemaInspector(editor, ents));
    if (ents.length === 1) panel.append(entityEditor(editor, ents[0], effects));
    else if (ents.length > 1) panel.append(multiEntityEditor(editor, ents));
    if (solids.length) panel.append(brushEditor(editor));
    if (looseWorld.length && !partOf.size) panel.append(newBuildingsPanel(editor));
    if (looseWorld.length === 1 && !partOf.size) {
      panel.append(h('div.section', {}, h('h3', {}, 'Interior building'),
        h('p.hint', {}, 'Replace this block with a building made of rooms, drawn on a floor plan.'),
        h('button', { onclick: () => openRoomsDialog(editor, { brush: looseWorld[0] }) }, '🏛 Design interior building…')));
    }
  };
  editor.on('selection', render);
  editor.on('change', render);
  editor.on('fgd', render);
  render();
  return h('div', {}, snapMoveSection(editor), panel);
}

function brushEditor(editor: Editor): HTMLElement {
  const sel = editor.selection;
  const solids = sel.allSolids();
  const box = sel.bounds();
  const size = box.getSize(new Vector3());
  const mats = new Map<string, number>();
  for (const s of solids) for (const side of s.sides) mats.set(side.material, (mats.get(side.material) ?? 0) + 1);

  const dims = (['x', 'y', 'z'] as const).map((axis) => {
    const input = h('input', { type: 'number', value: String(Math.round(size[axis])), step: String(editor.grid), min: '1' }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const v = Math.max(1, parseFloat(input.value) || size[axis]);
      const to = box.clone();
      to.max[axis] = to.min[axis] + v;
      const end = editor.history.begin('Resize', solids);
      for (const s of solids) remapSolid(s, box, new Box3(to.min.clone(), to.max.clone()));
      end();
      editor.changed();
    });
    return input;
  });
  return h('div.section', {},
    h('h3', {}, 'Brushes'),
    h('div.row', {}, h('label', {}, 'Size W×D×H'), ...dims),
    h('div.row', {}, h('label', {}, 'Origin'), h('span', {}, `${Math.round(box.min.x)} ${Math.round(box.min.y)} ${Math.round(box.min.z)}`)),
    h('h3', { style: { marginTop: '10px' } }, 'Materials'),
    ...[...mats].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, n]) =>
      h('div.row', {}, h('span.mat-name', { title: m, onclick: () => editor.setMaterial(m) }, m.toLowerCase()), h('span.muted', {}, `×${n}`))),
    h('button.primary', { style: { marginTop: '6px' }, onclick: () => applyMaterial(editor, solids, editor.currentMaterial) }, `Apply ${editor.currentMaterial.toLowerCase()}`),
  );
}

/** A road's style, sizes and materials; changes rebuild all roads, so crossings stay open. */
function roadPanel(editor: Editor, e: MapEntity, road: RoadSpec): HTMLElement {
  const apply = (patch: Partial<RoadSpec>) => rebuildRoads(editor, 'Edit road', { replace: [e, { ...road, ...patch }] });
  const len = centreline(road.points, road.radius).reduce((s, p, i, a) => s + (i ? p.distanceTo(a[i - 1]) : 0), 0);
  const mat = (label: string, list: StreetMaterial[], key: 'carriageway' | 'pavement' | 'kerb' | 'gutter') =>
    row(label, select([['', 'From style'], ...list.map((m) => [m.id, m.label] as [string, string])], road.materials?.[key] ?? '',
      (v) => apply({ materials: { ...road.materials, [key]: v || undefined } })));
  return h('div.section', {}, h('h3', {}, 'Road'),
    h('p.hint', {}, `${road.points.length} points, ${Math.round(len)} units long. Draw new roads with the Road tool (7).`),
    ...roadSheet(road, apply),
    mat('Carriageway', CARRIAGEWAYS, 'carriageway'),
    mat('Pavement', PAVEMENTS, 'pavement'),
    mat('Kerb', KERBS, 'kerb'),
    mat('Gutter', GUTTERS, 'gutter'),
    row('Round kerbs', num(road.materials?.corner ?? 0, (v) => apply({ materials: { ...road.materials, corner: v } }), { step: 16, min: 0, title: 'Kerb radius where this road crosses another' })),
    h('div.row', {},
      h('button', { onclick: () => rebuildRoads(editor, 'Rebuild roads') }, 'Rebuild all roads'),
      h('button', {
        title: 'Paint the terrain\'s second texture along the road (its verges, or under a dirt track)',
        onclick: () => {
          const n = blendRoadIntoGround(editor, road);
          toast(editor.container, n ? `Blended into ${n} terrain patch${n > 1 ? 'es' : ''}` : 'No terrain under this road (Ground tool: turn the floor into terrain)');
        },
      }, 'Blend into ground')));
}

/** A local sound: the file, how far it carries and how loud. */
function ambientPanel(editor: Editor, e: MapEntity): HTMLElement {
  const set = (key: string, value: string) => {
    const end = editor.history.begin('Edit sound', [], [e]);
    e.set(key, value);
    end();
    editor.changed();
  };
  const radius = h('input', { type: 'number', value: e.get('radius') ?? '1250', step: '64', min: '32' }) as HTMLInputElement;
  radius.addEventListener('change', () => set('radius', String(Math.round(Number(radius.value) || 1250))));
  const vol = h('input', { type: 'range', min: 0, max: 10, step: 1, value: e.get('health') ?? '10' }) as HTMLInputElement;
  vol.addEventListener('change', () => set('health', vol.value));
  const path = (e.get('message') ?? '').replace(/^sound\//i, '');
  return h('div.section', {}, h('h3', {}, 'Local sound'),
    h('div.row', {}, h('label', {}, 'Radius'), radius, h('button', { title: 'Play once', onclick: () => void audio.preview(`sound/${(e.get('message') ?? '').replace(/^sound\//i, '')}`) }, '▶')),
    h('div.row', {}, h('label', {}, 'Volume'), vol),
    soundBrowser(path, (p) => set('message', p)));
}

/** A soundscape zone: which soundscape and how far it reaches. */
function soundscapePanel(editor: Editor, e: MapEntity): HTMLElement {
  const set = (key: string, value: string) => {
    const end = editor.history.begin('Edit soundscape', [], [e]);
    e.set(key, value);
    end();
    editor.changed();
  };
  const sel = soundscapeSelect(e.get('soundscape') ?? '', (v) => set('soundscape', v));
  const radius = h('input', { type: 'number', value: e.get('radius') ?? '128', step: '64', min: '-1' }) as HTMLInputElement;
  radius.addEventListener('change', () => set('radius', String(Math.round(Number(radius.value) || -1))));
  return h('div.section', {}, h('h3', {}, 'Soundscape'),
    h('p.hint', {}, e.get('radius') === '-1' ? 'Heard everywhere outside other zones (the map default).' : 'Heard while the camera looks at a point inside the radius.'),
    h('div.row', {}, h('label', {}, 'Soundscape'), sel, h('button', { title: 'Listen for 15 seconds', onclick: () => void auditionSoundscape(sel.value) }, '▶')),
    h('div.row', {}, h('label', {}, 'Radius'), radius, h('span.unit', {}, '-1 = everywhere')));
}

/** A powerline's settings; changes rebuild its poles and wires. */
function powerlinePanel(editor: Editor, e: MapEntity, spec: PowerlineSpec, count: number): HTMLElement {
  return h('div.section', {}, h('h3', {}, 'Powerline'),
    h('p.hint', {}, `${spec.points.length} route points, ${count} entities (poles and rope keyframes).`),
    ...powerlineSheet(spec, (patch) => editPowerline(editor, e, patch)),
    h('button', { onclick: () => { const l = powerlineOf(editor.doc.entities, e); if (l) { editor.history.remove('Delete powerline', [], l.members); editor.selection.clear(); editor.changed(); } } }, 'Delete powerline'));
}

/** An interior building's handle: its rooms, what is wrong with them, and the dialog to change them. */
function roomsPanel(editor: Editor, details: MapEntity[]): HTMLElement {
  const one = details.length === 1 ? details[0] : null;
  const spec = one ? roomsOf(one) : null;
  const out = h('div.section', {}, h('h3', {}, 'Selection'),
    h('div', {}, details.length > 1 ? `${details.length} interior buildings` : '🏛 Interior building'),
    h('p.hint', {}, 'Drag the gizmo to move it (W); it is rebuilt where it lands. Delete removes it. Hide the handles (Handles in the view bar) to pick single props and brushes.'));
  if (!one || !spec) return out;
  const issues = roomLayout(spec).issues;
  out.append(
    h('div.hint', {}, `${spec.rooms.length} rooms, walls ${spec.height} high:`),
    h('ul.room-list', {}, ...spec.rooms.map((r) => h('li', {}, h('span.swatch', { style: { background: roomType(r.type).color } }), `${r.name || roomType(r.type).label} (${r.cells.x1 - r.cells.x0}×${r.cells.y1 - r.cells.y0})`))),
    ...issues.map((i) => h('div.issue', {}, '⚠ ' + i)),
    h('div.row', {},
      h('button.primary', { onclick: () => openRoomsDialog(editor, { detail: one }) }, 'Edit rooms…'),
      h('button', { title: 'Same rooms, new seed: other furniture and wear', onclick: () => regenerateRooms(editor, one, { seed: Math.floor(Math.random() * 100000) }, 'Re-roll interior building') }, 'Re-roll'),
      h('button', { onclick: () => deleteRooms(editor, one) }, 'Delete')));
  return out;
}

/**
 * Selected stairs: what they are, their points' heights, and the same option sheet as the Tune step (every change
 * rebuilds them). Add flights carries on placing points on them with the Stairs tool.
 */
function stairsPanel(editor: Editor, details: MapEntity[]): HTMLElement[] {
  const one = details.length === 1 ? details[0] : null;
  const spec = one ? stairsOf(one) : null;
  const head = h('div.section', {}, h('h3', {}, 'Selection'),
    h('div', {}, details.length > 1 ? `${details.length} stairs` : '🪜 Stairs'),
    h('p.hint', {}, 'Drag the gizmo to move them (W), up or down too; they are rebuilt where they land. Ctrl+D duplicates, Delete removes them. Hide the handles (Handles in the view bar) to pick single brushes.'));
  if (!one || !spec) return [head];
  const result = buildStairs(VmfDocument.empty(), spec);
  const edit = (patch: Parameters<typeof regenerateStairs>[2]) => regenerateStairs(editor, one, patch);
  head.append(h('div.gen-summary', {}, stairsSummary(result)),
    h('div.row', {},
      h('button.primary', { title: 'Click more points: each one adds a flight; Shift+click a landing to branch from it', onclick: () => (editor.tools.tools.generate as GenerateTool).continueStairs(one) }, 'Add flights…'),
      h('button', { onclick: () => duplicateStairs(editor, one) }, 'Duplicate'),
      h('button', { onclick: () => deleteStairs(editor, one) }, 'Delete')));
  const names = pointNames(spec);
  const points = h('div.section', {}, h('h3', {}, 'Points'), h('p.hint', {}, 'Height of each point; A is the foot.'),
    ...spec.nodes.map((n, i) => {
      const z = h('input.num', { type: 'number', value: String(n.z), step: '8' }) as HTMLInputElement;
      z.addEventListener('change', () => { z.blur(); edit({ nodes: spec.nodes.map((m, k) => (k === i ? { ...m, z: Number(z.value) || 0 } : m)) }); });
      return h('div.row', {}, h('label', {}, names[i]), z, h('span.unit', {}, `at ${Math.round(n.x)} ${Math.round(n.y)}`));
    }));
  const setFlight = (i: number, patch: Partial<StairsFlight>) => edit({
    flights: spec.flights.map((f, k) => {
      if (k !== i) return f;
      const g = { ...f };
      for (const [key, v] of Object.entries(patch) as [keyof StairsFlight, number | undefined][]) { if (v === undefined) delete g[key]; else g[key] = v; }
      return g;
    }),
  });
  const sheet = h('div.section.stairs-sheet', {}, h('h3', {}, 'Stairs'), ...stairsSheet({ spec, result, set: (o) => edit({ options: o }), setFlight }));
  return [head, points, sheet];
}

const LAYOUT_LABEL = { block: 'Block of buildings', single: 'Building', house: 'Simple interior building' } as const;
/** The building sheet's Extras stay folded or open while the panel re-renders. */
const folds = { more: false, extras: false };
const SHEET_KIND = { block: 'block', single: 'building', house: 'house' } as const;
/** Every building option, flat, for each kind of block. */
const SHEET_ROWS: BuildingRow[] = ['architecture', 'floors', 'facade', 'corners', 'roofs', 'quality', 'detail', 'towers', 'courtyards', 'annexes', 'alleys',
  'weathering', 'interiors', 'interiorStyle', 'cutHeight', 'furnish', 'lights', 'lightLevel', 'wideDoors'];
/** What blocks generated from the selected block brushes start with. */
const NEW_BLOCK = {
  minFloors: 3, maxFloors: 6, architecture: 'mixed', alleys: false, roofProps: true, weathering: 0.5, detail: 2, quality: 'high', roofs: 'mixed',
  towers: true, courtyards: true, annexes: true, cutHeight: 112, furnish: 'full', interiorLights: true, wideDoors: false,
} as const;

/** The building sheet over `o`: changes are kept in `o` until the panel's button uses them. */
function draftSheet(o: BuildingOptions): HTMLElement {
  const sheet = h('div');
  const draw = () => sheet.replaceChildren(...buildingSheet({ options: o, kind: SHEET_KIND[o.layout ?? 'block'], rows: SHEET_ROWS, set: (patch) => { Object.assign(o, patch); draw(); }, folds, redraw: draw }));
  draw();
  return sheet;
}

/** A generated block's stored settings; changes wait for Regenerate. */
function blockPanel(editor: Editor, block: MapEntity): HTMLElement | null {
  const stored = blockOf(block);
  if (!stored) return null;
  const o: BuildingOptions = { ...NEW_BLOCK, ...stored.options };
  const r = stored.rect;
  const rebuild = (label: string) => regenerateBlock(editor, block, { options: o }, label);
  return h('div.section', {}, h('h3', {}, stored.options.layout === 'house' ? '🏚 Simple interior building' : stored.options.layout === 'single' ? '🏠 Building' : '🏢 Buildings'),
    h('p.hint', {}, `${r.x1 - r.x0} × ${r.y1 - r.y0} units. Change the settings and press Regenerate.`),
    draftSheet(o),
    h('div.row', {},
      h('button.primary', { title: 'Rebuild with these settings', onclick: () => rebuild('Regenerate buildings') }, 'Regenerate'),
      h('button', { title: 'Same settings, new seed', onclick: () => { o.seed = Math.floor(Math.random() * 100000); rebuild('Re-roll buildings'); } }, 'Re-roll'),
      h('button', { onclick: () => deleteBlock(editor, block) }, 'Delete')));
}

/** Turns the selected block brushes into buildings. */
function newBuildingsPanel(editor: Editor): HTMLElement {
  const o: BuildingOptions = { ...NEW_BLOCK, seed: Math.floor(Math.random() * 100000) };
  const go = () => {
    const n = buildingsFromSelection(editor, o);
    toast(editor.container, n ? `Generated ${n} building${n > 1 ? 's' : ''} (seed ${o.seed})` : 'Selection is too small for a building (min 128×128)');
  };
  return h('div.section', {},
    h('h3', {}, 'Generate buildings'),
    h('p.hint', {}, 'Replaces the selected block(s) with a city block: a ring around a courtyard when large enough, otherwise a row of buildings.'),
    draftSheet(o),
    h('button.primary', { onclick: go }, '🏢 Generate buildings'));
}
