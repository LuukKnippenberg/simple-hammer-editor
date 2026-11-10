import { Box3, Vector3 } from 'three';
import type { MapEntity } from '../vmf/map.ts';
import type { Editor } from '../editor.ts';
import { applyMaterial, BRUSH_CLASSES, deleteSelection, duplicateSelection, moveToWorld, tieToEntity } from '../edit/actions.ts';
import { remapSolid } from '../edit/brushes.ts';
import { h, toast } from './dom.ts';
import { buildingsFromSelection, deleteBlock, duplicateBlock, regenerateBlock, selectBlock, selectedBlocks, turnBlockBy } from '../gen/buildingAction.ts';
import { blockFinder, blockOf } from '../gen/buildingStore.ts';
import type { BuildingOptions } from '../gen/buildings.ts';
import { buildingSheet, type BuildingRow } from './buildingOptions.ts';
import { roadPointsSection, roadSheet } from './roadOptions.ts';
import { powerlineSheet } from './powerlineOptions.ts';
import { num, refill, row, select } from './form.ts';
import { entityEditor, multiEntityEditor } from './entityEditor.ts';
import { roadLine, roadOf, type RoadSpec } from '../gen/roads.ts';
import { CARRIAGEWAYS, GUTTERS, KERBS, PAVEMENTS, type StreetMaterial } from '../gen/streetMaterials.ts';
import { blendRoadIntoGround, rebuildRoads } from '../gen/roadAction.ts';
import { powerlineOf, type PowerlineSpec } from '../gen/powerlines.ts';
import { editPowerline } from '../edit/powerlineTool.ts';
import { powerlineKey, powerlinePath, powerlineSpans, teePoles } from '../edit/powerlinePath.ts';
import { groundAt } from '../edit/pathPins.ts';
import { pathLabels } from '../edit/pathPoints.ts';
import { auditionSoundscape, soundscapeSelect } from './soundUi.ts';
import { soundBrowser } from './soundBrowser.ts';
import { audio } from '../audio/engine.ts';
import { presetsFor } from '../lw/soundPresets.ts';
import { addPreset } from '../edit/presetAction.ts';
import { poiEditor, rotationRow, selectedPoi } from './poiPanel.ts';
import { duplicatePoi, selectedPois } from '../gen/poi/action.ts';
import { cinemaInspector } from './cinemaPanel.ts';
import { deleteRooms, regenerateRooms, selectedRooms } from '../gen/rooms/action.ts';
import { roomsOf } from '../gen/rooms/store.ts';
import { roomLayout } from '../gen/rooms/model.ts';
import { roomType } from '../gen/rooms/types.ts';
import { openRoomsDialog } from './roomsDialog.ts';
import { openBlender } from './blender.ts';
import { openGenerateMenu } from './generateMenu.ts';
import { partInspector } from './partPanel.ts';
import { deleteStairs, duplicateStairs, regenerateStairs, selectedStairs } from '../gen/stairsAction.ts';
import { stairsOf } from '../gen/stairsStore.ts';
import { buildStairs, stairsSummary, type StairsFlight } from '../gen/stairs.ts';
import { pathPointsSection, pointAxis, type PointColumn } from './pathPointsList.ts';
import { stairsKey } from '../edit/stairsPath.ts';
import { stairsSheet } from './stairsOptions.ts';
import type { GenerateTool } from '../edit/generateTool.ts';
import { VmfDocument } from '../vmf/map.ts';
import { snapMoveSection } from './snapMovePanel.ts';
import { deleteFence, duplicateFence, regenerateFence, selectedFences } from '../gen/fenceAction.ts';
import { fenceOf } from '../gen/fenceStore.ts';
import { fencePatch } from '../gen/fences.ts';
import { fenceKey, continueFence } from '../edit/fencePath.ts';
import type { FenceTool } from '../edit/fenceTool.ts';
import { fenceDoorwaysSection, fencePointsSection, fenceSheet } from './fenceOptions.ts';
import { fenceTuneSummary } from '../edit/generateTool.ts';

/** Properties of the selection: entity keyvalues (typed from the FGD) or brush size and materials. */
export function mountInspector(editor: Editor): HTMLElement {
  const panel = h('div');
  const render = () => {
    const selection = editor.selection;
    panel.replaceChildren();
    // Faces, edges or vertices (Shift+2/3/4).
    if (selection.mode !== 'object') return void panel.append(partInspector(editor));
    if (selection.isEmpty) {
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
        h('p.hint', {}, 'Drag the gizmo to move (W), turn (E: 15° steps, Shift: free) or resize (R) it. The comma and period keys turn it a quarter turn, Ctrl+D duplicates it, Delete removes it. Hide the handles (Handles in the view bar) to pick single props and brushes.'),
        pois.length === 1 ? h('div.row', {}, h('button', { onclick: () => duplicatePoi(editor, pois[0]) }, 'Duplicate')) : null));
      if (pois.length === 1) { const poiSheet = poiEditor(editor, pois[0]); if (poiSheet) panel.append(poiSheet); }
      return;
    }
    // Building handles stand for their blocks: only the block's building settings.
    const blocks = selectedBlocks(editor);
    if (blocks.length) {
      panel.append(h('div.section', {}, h('h3', {}, 'Selection'),
        h('div', {}, blocks.length > 1 ? `${blocks.length} blocks of buildings` : LAYOUT_LABEL[blockOf(blocks[0])?.options.layout ?? 'block']),
        h('p.hint', {}, 'Drag the gizmo to move (W), turn (E: 15° steps, Shift: free) or resize (R) it; it is rebuilt to fit, with the street dressing of the blocks generated with it. The comma and period keys turn it a quarter turn, Ctrl+D duplicates it, Delete removes it. Hide the handles (Handles in the view bar) to pick single props and brushes.'),
        blocks.length === 1 ? h('div.row', {}, h('button', { onclick: () => duplicateBlock(editor, blocks[0]) }, 'Duplicate')) : null));
      const blockSheet = blocks.length === 1 && blockPanel(editor, blocks[0]);
      if (blockSheet) panel.append(blockSheet);
      return;
    }
    // Stairs handles stand for their stairs.
    const stairs = selectedStairs(editor);
    if (stairs.length) {
      panel.append(...stairsPanel(editor, stairs));
      return;
    }
    // Fence handles stand for their fences.
    const fences = selectedFences(editor);
    if (fences.length) {
      panel.append(...fencePanel(editor, fences));
      return;
    }
    // Interior building handles stand for their buildings.
    const rooms = selectedRooms(editor);
    if (rooms.length) {
      panel.append(roomsPanel(editor, rooms));
      return;
    }
    const solids = selection.allSolids();
    const entities = [...selection.entities];
    const summary = [solids.length && `${solids.length} brush${solids.length > 1 ? 'es' : ''}`, entities.length && `${entities.length} entit${entities.length > 1 ? 'ies' : 'y'}`].filter(Boolean).join(', ');
    // Entities alone get their own header card (entityEditor.ts) with these buttons.
    if (solids.length) panel.append(h('div.section', {}, h('h3', {}, 'Selection'), h('div', {}, summary),
      h('div.row', { style: { marginTop: '6px' } },
        h('button', { onclick: () => duplicateSelection(editor) }, 'Duplicate'),
        h('button', { onclick: () => deleteSelection(editor) }, 'Delete'))));
    // Block brushes: what the Generate menu can fill them with.
    const blockBrushes = [...selection.solids].filter((solid) => !solid.entity && !solid.isDisplacement);
    if (blockBrushes.length && !entities.length && !blockBrushes.some(blockFinder(editor.doc))) {
      panel.append(h('div.section.gen-box', {}, h('h3', {}, 'Generate'),
        h('p.hint', {}, `Fill ${blockBrushes.length > 1 ? 'these blocks' : 'this block'} with a building, a block of buildings, an interior building or a point of interest.`),
        h('button.primary', { onclick: () => openGenerateMenu() }, 'Generate… ', h('kbd', {}, 'G'))));
    }

    // A brush picked out of a brush entity (func_detail, triggers, ...): offer the whole entity.
    const owners = new Set([...selection.solids].map((solid) => solid.entity).filter((entity): entity is MapEntity => !!entity && !selection.entities.has(entity)));
    for (const owner of owners) {
      panel.append(h('div.section', {}, h('div.hint', {}, `Part of ${owner.classname} (${owner.solids.length} brushes)`),
        h('button', { onclick: () => selection.set([], [owner]) }, `Select whole ${owner.classname}`)));
    }
    // Brushes picked out of a generated block (handles hidden): offer the whole block.
    const looseWorld = [...selection.solids].filter((solid) => !solid.entity);
    const findBlock = blockFinder(editor.doc);
    const partOf = new Set(looseWorld.map(findBlock).filter((block): block is MapEntity => !!block));
    for (const block of partOf) {
      panel.append(h('div.section', {}, h('div.hint', {}, 'Part of a block of generated buildings'),
        h('button', { onclick: () => selectBlock(editor, block) }, 'Select whole block')));
    }
    if ([...selection.solids].some((solid) => !solid.entity)) {
      const classSelect = h('select', {}, ...BRUSH_CLASSES.map((brushClass) => h('option', { value: brushClass.cls }, brushClass.label))) as HTMLSelectElement;
      panel.append(h('div.section', {}, h('h3', {}, 'Tie to entity'),
        h('div.row', {}, classSelect, h('button', { onclick: () => tieToEntity(editor, classSelect.value) }, 'Tie (Ctrl+T)'))));
    }
    if (entities.length === 1 && entities[0].solids.length) {
      panel.append(h('div.section', {}, h('button', { onclick: () => moveToWorld(editor, entities[0]) }, 'Move brushes to world')));
    }
    // A road, or a brush picked out of one: the road's settings.
    const roadEntity = entities.length === 1 ? entities[0] : !entities.length && owners.size === 1 ? [...owners][0] : null;
    const road = roadEntity ? roadOf(roadEntity) : null;
    if (roadEntity && road) panel.append(roadPanel(editor, roadEntity, road), roadPointsSection(editor, roadEntity, road));
    const poi = selectedPoi(editor);
    const poiPanel = poi && poiEditor(editor, poi);
    if (poiPanel) panel.append(poiPanel);
    if (entities.length === 1 && entities[0].classname === 'env_soundscape') panel.append(soundscapePanel(editor, entities[0]));
    if (entities.length === 1 && entities[0].classname === 'ambient_generic') panel.append(ambientPanel(editor, entities[0]));
    const fits = entities.length === 1 ? presetsFor(entities[0].get('model')) : [];
    // Shown as the last group of the entity editor.
    const effects = fits.length ? [{ label: 'Sound and effects' as const, keys: [], summary: fits.map((preset) => `${preset.icon} ${preset.label}`).join(' '), body: () => h('div', {},
      h('p.hint', {}, 'Bring this prop to life:'),
      h('div.row', {}, ...fits.map((preset) => h('button', { onclick: () => addPreset(editor, preset, entities[0].origin!, entities[0].angles.y, entities[0]) }, `${preset.icon} ${preset.label}`)))) }] : [];
    const line = entities.length === 1 ? powerlineOf(editor.doc.entities, entities[0]) : null;
    if (line) panel.append(powerlinePanel(editor, entities[0], line.spec, line.members.length));
    panel.append(...cinemaInspector(editor, entities));
    if (entities.length === 1) panel.append(entityEditor(editor, entities[0], effects));
    else if (entities.length > 1) panel.append(multiEntityEditor(editor, entities));
    if (solids.length) panel.append(brushEditor(editor));
    const blend = groundBlend(editor);
    if (blend) {
      panel.append(h('div.section', {}, h('h3', {}, 'Ground blend'),
        h('div.hint', {}, `${blend.toLowerCase()}: a MultiBlend painted with the Ground tool.`),
        h('button', { onclick: () => void openBlender(editor, { material: blend, from: 'Selection › Edit its blend' }) }, 'Edit its blend')));
    }
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
  // The picked pin of selected stairs lights its row in the Points list.
  editor.on('pathpins', render);
  render();
  return h('div', {}, snapMoveSection(editor), panel);
}

/** The MultiBlend material of the selected terrain (the first painted displacement's), or null. */
function groundBlend(editor: Editor): string | null {
  for (const solid of editor.selection.allSolids()) {
    const side = solid.sides.find((s) => s.dispinfo);
    if (side && editor.materials.get(side.material).multiblend) return side.material;
  }
  return null;
}

function brushEditor(editor: Editor): HTMLElement {
  const selection = editor.selection;
  const solids = selection.allSolids();
  const box = selection.bounds();
  const size = box.getSize(new Vector3());
  const materials = new Map<string, number>();
  for (const solid of solids) for (const side of solid.sides) materials.set(side.material, (materials.get(side.material) ?? 0) + 1);

  const dims = (['x', 'y', 'z'] as const).map((axis) => {
    const input = h('input', { type: 'number', value: String(Math.round(size[axis])), step: String(editor.grid), min: '1' }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const length = Math.max(1, parseFloat(input.value) || size[axis]);
      const resized = box.clone();
      resized.max[axis] = resized.min[axis] + length;
      const end = editor.history.begin('Resize', solids);
      for (const solid of solids) remapSolid(solid, box, new Box3(resized.min.clone(), resized.max.clone()));
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
    ...[...materials].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([material, count]) =>
      h('div.row', {}, h('span.mat-name', { title: material, onclick: () => editor.setMaterial(material) }, material.toLowerCase()), h('span.muted', {}, `×${count}`))),
    h('button.primary', { style: { marginTop: '6px' }, onclick: () => applyMaterial(editor, solids, editor.currentMaterial) }, `Apply ${editor.currentMaterial.toLowerCase()}`),
  );
}

/** A road's style, sizes and materials; changes rebuild all roads, so crossings stay open. */
function roadPanel(editor: Editor, entity: MapEntity, road: RoadSpec): HTMLElement {
  const apply = (patch: Partial<RoadSpec>) => rebuildRoads(editor, 'Edit road', { replace: [entity, { ...road, ...patch }] });
  const length = roadLine(road).reduce((sum, point, i, points) => sum + (i ? point.distanceTo(points[i - 1]) : 0), 0);
  const materialRow = (label: string, list: StreetMaterial[], key: 'carriageway' | 'pavement' | 'kerb' | 'gutter') =>
    row(label, select([['', 'From style'], ...list.map((material) => [material.id, material.label] as [string, string])], road.materials?.[key] ?? '',
      (v) => apply({ materials: { ...road.materials, [key]: v || undefined } })));
  return h('div.section', {}, h('h3', {}, 'Road'),
    h('p.hint', {}, `${road.points.length} points, ${Math.round(length)} units long. Draw new roads with the Road tool (7).`),
    ...roadSheet(road, apply),
    materialRow('Carriageway', CARRIAGEWAYS, 'carriageway'),
    materialRow('Pavement', PAVEMENTS, 'pavement'),
    materialRow('Kerb', KERBS, 'kerb'),
    materialRow('Gutter', GUTTERS, 'gutter'),
    row('Round kerbs', num(road.materials?.corner ?? 0, (v) => apply({ materials: { ...road.materials, corner: v } }), { step: 16, min: 0, title: 'Kerb radius where this road crosses another' })),
    h('div.row', {},
      h('button', { onclick: () => rebuildRoads(editor, 'Rebuild roads') }, 'Rebuild all roads'),
      h('button', {
        title: 'Paint the terrain\'s second texture along the road (its verges, or under a dirt track)',
        onclick: () => {
          const patches = blendRoadIntoGround(editor, road);
          toast(editor.container, patches ? `Blended into ${patches} terrain patch${patches > 1 ? 'es' : ''}` : 'No terrain under this road (Ground tool: turn the floor into terrain)');
        },
      }, 'Blend into ground')));
}

/** A local sound: the file, how far it carries and how loud. */
function ambientPanel(editor: Editor, entity: MapEntity): HTMLElement {
  const set = (key: string, value: string) => {
    const end = editor.history.begin('Edit sound', [], [entity]);
    entity.set(key, value);
    end();
    editor.changed();
  };
  const radius = h('input', { type: 'number', value: entity.get('radius') ?? '1250', step: '64', min: '32' }) as HTMLInputElement;
  radius.addEventListener('change', () => set('radius', String(Math.round(Number(radius.value) || 1250))));
  const volume = h('input', { type: 'range', min: 0, max: 10, step: 1, value: entity.get('health') ?? '10' }) as HTMLInputElement;
  volume.addEventListener('change', () => set('health', volume.value));
  const path = (entity.get('message') ?? '').replace(/^sound\//i, '');
  return h('div.section', {}, h('h3', {}, 'Local sound'),
    h('div.row', {}, h('label', {}, 'Radius'), radius, h('button', { title: 'Play once', onclick: () => void audio.preview(`sound/${(entity.get('message') ?? '').replace(/^sound\//i, '')}`) }, '▶')),
    h('div.row', {}, h('label', {}, 'Volume'), volume),
    soundBrowser(path, (file) => set('message', file)));
}

/** A soundscape zone: which soundscape and how far it reaches. */
function soundscapePanel(editor: Editor, entity: MapEntity): HTMLElement {
  const set = (key: string, value: string) => {
    const end = editor.history.begin('Edit soundscape', [], [entity]);
    entity.set(key, value);
    end();
    editor.changed();
  };
  const picker = soundscapeSelect(entity.get('soundscape') ?? '', (v) => set('soundscape', v));
  const radius = h('input', { type: 'number', value: entity.get('radius') ?? '128', step: '64', min: '-1' }) as HTMLInputElement;
  radius.addEventListener('change', () => set('radius', String(Math.round(Number(radius.value) || -1))));
  return h('div.section', {}, h('h3', {}, 'Soundscape'),
    h('p.hint', {}, entity.get('radius') === '-1' ? 'Heard everywhere outside other zones (the map default).' : 'Heard while the camera looks at a point inside the radius.'),
    h('div.row', {}, h('label', {}, 'Soundscape'), picker, h('button', { title: 'Listen for 15 seconds', onclick: () => void auditionSoundscape(picker.value) }, '▶')),
    h('div.row', {}, h('label', {}, 'Radius'), radius, h('span.unit', {}, '-1 = everywhere')));
}

/** A powerline's settings, points (the Select tool's pins) and spans; changes rebuild its poles and wires. */
function powerlinePanel(editor: Editor, entity: MapEntity, spec: PowerlineSpec, count: number): HTMLElement {
  const name = powerlineOf(editor.doc.entities, entity)?.name ?? '';
  const path = powerlinePath(spec);
  const names = pathLabels(path);
  const tees = teePoles(path).map((i) => names[i]);
  // Points stand on the ground: a typed x or y takes the ground's height there.
  const onGround = (axis: 'x' | 'y'): PointColumn => ({
    ...pointAxis(axis, axis, editor.grid),
    set: (point, value) => { const p = { ...point, [axis]: value }; return { ...p, z: groundAt(editor, p.x, p.y) ?? point.z }; },
  });
  return h('div', {},
    h('div.section', {}, h('h3', {}, 'Powerline'),
      h('p.hint', {}, `${spec.points.length} points, ${count} entities (poles and rope keyframes)${tees.length ? ` · tee pole${tees.length > 1 ? 's' : ''} at ${tees.join(', ')}` : ''}.`),
      h('p.hint', {}, 'Drag a pin to move a point (the poles re-space), click a + to insert one, Alt+click a pin to remove it, Shift+click a pin to branch from it (a tee pole) or carry on from an end.'),
      ...powerlineSheet(spec, (patch) => editPowerline(editor, entity, patch)),
      h('button', { onclick: () => { const found = powerlineOf(editor.doc.entities, entity); if (found) { editor.history.remove('Delete powerline', [], found.members); editor.selection.clear(); editor.changed(); } } }, 'Delete powerline')),
    pathPointsSection(editor, powerlineKey(name), [onGround('x'), onGround('y')], 'A is where the line starts; the points stand on the ground. Typing a number moves the point; Tab picks the next pin, Delete removes it.'),
    h('div.section', {}, h('h3', {}, 'Spans'), h('p.hint', {}, 'Poles fill each stretch at the spacing.'),
      ...powerlineSpans(spec, path).map((s) => h('div.row.power-span', {}, h('label', {}, s.name), h('span', {}, `${s.length} u · ${s.spans} span${s.spans === 1 ? '' : 's'}`)))));
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
    h('ul.room-list', {}, ...spec.rooms.map((room) => h('li', {}, h('span.swatch', { style: { background: roomType(room.type).color } }), `${room.name || roomType(room.type).label} (${room.cells.x1 - room.cells.x0}×${room.cells.y1 - room.cells.y0})`))),
    ...issues.map((issue) => h('div.issue', {}, '⚠ ' + issue)),
    h('div.row', {},
      h('button.primary', { onclick: () => openRoomsDialog(editor, { detail: one }) }, 'Edit rooms…'),
      h('button', { title: 'Same rooms, new seed: other furniture and wear', onclick: () => regenerateRooms(editor, one, { seed: Math.floor(Math.random() * 100000) }, 'Re-roll interior building') }, 'Re-roll'),
      h('button', { onclick: () => deleteRooms(editor, one) }, 'Delete')));
  return out;
}

/**
 * Selected stairs: what they are, their points (the pins' Points list: typing a number moves a point), and the same
 * option sheet as the Tune step (every change rebuilds them). Add flights carries on placing points on them with
 * the Stairs tool.
 */
function stairsPanel(editor: Editor, details: MapEntity[]): HTMLElement[] {
  const one = details.length === 1 ? details[0] : null;
  const spec = one ? stairsOf(one) : null;
  const head = h('div.section', {}, h('h3', {}, 'Selection'),
    h('div', {}, details.length > 1 ? `${details.length} stairs` : '🪜 Stairs'),
    h('p.hint', {}, 'Drag a pin to move a point, click a + to insert one, Alt+click a pin to remove it, Shift+click a pin to place more from it. The gizmo moves the whole stairs (W). Ctrl+D duplicates, Delete removes them (or the picked point). Hide the handles (Handles in the view bar) to pick single brushes.'));
  if (!one || !spec) return [head];
  const result = buildStairs(VmfDocument.empty(), spec);
  const edit = (patch: Parameters<typeof regenerateStairs>[2]) => regenerateStairs(editor, one, patch);
  head.append(h('div.gen-summary', {}, stairsSummary(result)),
    h('div.row', {},
      h('button.primary', { title: 'Click more points: each one adds a flight; Shift+click a landing to branch from it', onclick: () => (editor.tools.tools.generate as GenerateTool).continueStairs(one) }, 'Add flights…'),
      h('button', { onclick: () => duplicateStairs(editor, one) }, 'Duplicate'),
      h('button', { onclick: () => deleteStairs(editor, one) }, 'Delete')));
  // One row per point, the same points (and order) as the pins; Tab or a click on a row picks one.
  const points = pathPointsSection(editor, stairsKey(spec.uid),
    [pointAxis('x', 'x', editor.grid), pointAxis('y', 'y', editor.grid), pointAxis('height', 'z', 8)],
    'A is the foot. Typing a number moves the point; Tab picks the next pin. Height: the wheel while holding a pin, or Page Up / Page Down on a picked one.');
  const setFlight = (i: number, patch: Partial<StairsFlight>) => edit({
    flights: spec.flights.map((flight, k) => {
      if (k !== i) return flight;
      const changed = { ...flight };
      for (const [key, value] of Object.entries(patch) as [keyof StairsFlight, number | undefined][]) { if (value === undefined) delete changed[key]; else changed[key] = value; }
      return changed;
    }),
  });
  const sheet = h('div.section.stairs-sheet', {}, h('h3', {}, 'Stairs'), ...stairsSheet({ spec, result, set: (options) => edit({ options }), setFlight }));
  return [head, points, sheet];
}

/**
 * A selected fence: what it is, the same option sheet as the Tune step (every change rebuilds it), its points (the
 * pins' Points list) and its doorways. Add points carries on placing points on it with the Fence tool.
 */
function fencePanel(editor: Editor, details: MapEntity[]): HTMLElement[] {
  const one = details.length === 1 ? details[0] : null;
  const spec = one ? fenceOf(one) : null;
  const head = h('div.section', {}, h('h3', {}, 'Selection'),
    h('div', {}, details.length > 1 ? `${details.length} fences` : '🚧 Fence'),
    h('p.hint', {}, 'Drag a pin to move a point, click a + to insert one, Alt+click a pin to remove it, Shift+click a pin to place more from it. Drag a doorway chip along the fence. The gizmo moves the whole fence (W). Ctrl+D duplicates, Delete removes it (or the picked point). Hide the handles (Handles in the view bar) to pick single props and brushes.'));
  if (!one || !spec) return [head];
  head.append(h('div.gen-summary', {}, fenceTuneSummary(one)),
    h('div.row', {},
      h('button.primary', { title: 'Click more points from the last one; Shift+click a pin to branch from it', onclick: () => continueFence(editor, one, -1) }, 'Add points…'),
      h('button', { onclick: () => duplicateFence(editor, one) }, 'Duplicate'),
      h('button', { onclick: () => deleteFence(editor, one) }, 'Delete')));
  const sheet = h('div.section', {}, h('h3', {}, 'Fence'), ...fenceSheet(spec, (patch) => regenerateFence(editor, one, fencePatch(spec, patch))));
  const pins = editor.tools.select.pins;
  const target = pins.target?.key === fenceKey(spec.uid) && editor.tools.current === editor.tools.select ? pins.target : null;
  return [head, sheet, fencePointsSection(editor, fenceKey(spec.uid)), fenceDoorwaysSection(target, (editor.tools.tools.fence as FenceTool).placedDoors, spec)];
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

/** The building sheet over `options`: changes are kept in `options` until the panel's button uses them. */
function draftSheet(options: BuildingOptions): HTMLElement {
  const sheet = h('div');
  const draw = () => refill(sheet, buildingSheet({ options, kind: SHEET_KIND[options.layout ?? 'block'], rows: SHEET_ROWS, set: (patch) => { Object.assign(options, patch); draw(); }, folds, redraw: draw }));
  draw();
  return sheet;
}

/** A generated block's stored settings; changes wait for Regenerate. */
function blockPanel(editor: Editor, block: MapEntity): HTMLElement | null {
  const stored = blockOf(block);
  if (!stored) return null;
  const options: BuildingOptions = { ...NEW_BLOCK, ...stored.options };
  const rect = stored.rect;
  const rebuild = (label: string) => regenerateBlock(editor, block, { options }, label);
  return h('div.section', {}, h('h3', {}, stored.options.layout === 'house' ? '🏚 Simple interior building' : stored.options.layout === 'single' ? '🏠 Building' : '🏢 Buildings'),
    h('p.hint', {}, `${rect.x1 - rect.x0} × ${rect.y1 - rect.y0} units. Change the settings and press Regenerate.`),
    draftSheet(options),
    rotationRow(stored.angle ?? 0, (angle) => turnBlockBy(editor, block, angle - (stored.angle ?? 0)),
      'Turns the block about its centre (a quarter turn generates it anew to fit). Type any angle, or turn the selected block with the rotate gizmo (E: 15° steps, Shift: free). At an angle it gets its own lamps and trees but no cables across to the blocks generated with it', 'relative'),
    h('div.row', {},
      h('button.primary', { title: 'Rebuild with these settings', onclick: () => rebuild('Regenerate buildings') }, 'Regenerate'),
      h('button', { title: 'Same settings, new seed', onclick: () => { options.seed = Math.floor(Math.random() * 100000); rebuild('Re-roll buildings'); } }, 'Re-roll'),
      h('button', { onclick: () => deleteBlock(editor, block) }, 'Delete')));
}

/** Turns the selected block brushes into buildings. */
function newBuildingsPanel(editor: Editor): HTMLElement {
  const options: BuildingOptions = { ...NEW_BLOCK, seed: Math.floor(Math.random() * 100000) };
  const go = () => {
    const count = buildingsFromSelection(editor, options);
    toast(editor.container, count ? `Generated ${count} building${count > 1 ? 's' : ''} (seed ${options.seed})` : 'Selection is too small for a building (min 128×128)');
  };
  return h('div.section', {},
    h('h3', {}, 'Generate buildings'),
    h('p.hint', {}, 'Replaces the selected block(s) with a city block: a ring around a courtyard when large enough, otherwise a row of buildings.'),
    draftSheet(options),
    h('button.primary', { onclick: go }, '🏢 Generate buildings'));
}
