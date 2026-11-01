import { Box3, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { fgdClass } from '../assets/fgd.ts';
import { applyMaterial, BRUSH_CLASSES, deleteSelection, duplicateSelection, moveToWorld, tieToEntity } from '../edit/actions.ts';
import { remapSolid } from '../edit/brushes.ts';
import type { MapEntity } from '../vmf/map.ts';
import { h, toast } from './dom.ts';
import { buildingsFromSelection, deleteBlock, duplicateBlock, regenerateBlock, selectBlock, selectedBlocks } from '../gen/buildingAction.ts';
import { blockFinder, blockOf } from '../gen/buildingStore.ts';
import { ARCHITECTURES, FACADE_STYLES, QUALITY, type ArchitectureName, type BuildingOptions, type BuildingQuality, type DetailLevel, type FacadeStyle } from '../gen/buildings.ts';
import { INTERIOR_STYLES, type InteriorStyleName } from '../gen/styles.ts';
import type { CornerOption } from '../gen/buildingPlan.ts';
import type { RoofOption } from '../gen/roofs.ts';
import { ioSection } from './ioEditor.ts';
import { ROAD_STYLES, centreline, roadOf, type RoadSpec, type RoadStyle } from '../gen/roads.ts';
import { CARRIAGEWAYS, GUTTERS, KERBS, PAVEMENTS, type StreetMaterial } from '../gen/streetMaterials.ts';
import { blendRoadIntoGround, rebuildRoads } from '../gen/roadAction.ts';
import { POLE_TYPES, powerlineOf, type PoleType, type PowerlineSpec } from '../gen/powerlines.ts';
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
      if (blocks.length === 1) panel.append(buildingPanel(editor, blocks[0]));
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
    panel.append(h('div.section', {}, h('h3', {}, 'Selection'), h('div', {}, summary),
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
    if (fits.length) {
      panel.append(h('div.section', {}, h('h3', {}, 'Sound and effects'),
        h('p.hint', {}, 'Bring this prop to life:'),
        h('div.row', {}, ...fits.map((p) => h('button', { onclick: () => addPreset(editor, p, ents[0].origin!, ents[0].angles.y, ents[0]) }, `${p.icon} ${p.label}`)))));
    }
    const line = ents.length === 1 ? powerlineOf(editor.doc.entities, ents[0]) : null;
    if (line) panel.append(powerlinePanel(editor, ents[0], line.spec, line.members.length));
    panel.append(...cinemaInspector(editor, ents));
    if (ents.length === 1) panel.append(entityEditor(editor, ents[0]), ioSection(editor, ents[0]));
    if (solids.length) panel.append(brushEditor(editor));
    if (looseWorld.length && !partOf.size) panel.append(buildingPanel(editor));
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
  return panel;
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

function entityEditor(editor: Editor, e: MapEntity): HTMLElement {
  const cls = fgdClass(e.classname);
  const section = h('div.section', {}, h('h3', {}, e.classname), cls?.description ? h('p.hint', {}, cls.description.slice(0, 200)) : null);
  const commit = (key: string, value: string) => {
    if (e.get(key) === value) return;
    const end = editor.history.begin(`Edit ${key}`, [], [e]);
    e.set(key, value);
    end();
    editor.changed();
  };
  const shown = new Set<string>();
  const field = (key: string, label: string, value: string, choices?: { value: string; label: string }[], title = '') => {
    shown.add(key.toLowerCase());
    let input: HTMLInputElement | HTMLSelectElement;
    if (choices?.length) {
      input = h('select', {}, ...choices.map((c) => h('option', { value: c.value }, c.label)));
      if (!choices.some((c) => c.value === value)) input.append(h('option', { value }, value));
      input.value = value;
    } else {
      input = h('input', { value });
    }
    input.addEventListener('change', () => commit(key, input.value));
    section.append(h('div.row', { title: title || key }, h('label', {}, label), input));
  };
  field('origin', 'Origin', e.get('origin') ?? '');
  if (e.get('angles') !== undefined || cls?.keys.some((k) => k.name.toLowerCase() === 'angles')) field('angles', 'Angles', e.get('angles') ?? '0 0 0');
  for (const k of cls?.keys ?? []) {
    if (shown.has(k.name.toLowerCase()) || k.type === 'flags') continue;
    field(k.name, k.label, e.get(k.name) ?? k.default, k.choices, k.description);
  }
  // Keys the FGD does not describe.
  for (const [k, v] of e.node.props) {
    if (shown.has(k.toLowerCase()) || ['id', 'classname'].includes(k.toLowerCase())) continue;
    field(k, k, v);
  }
  const newKey = h('input', { placeholder: 'key' }) as HTMLInputElement;
  const newVal = h('input', { placeholder: 'value' }) as HTMLInputElement;
  section.append(h('div.row', {}, newKey, newVal, h('button', { onclick: () => newKey.value && commit(newKey.value, newVal.value) }, '+')));
  return section;
}

/** A road's style and sizes; changes rebuild all roads, so crossings stay open. */
function roadPanel(editor: Editor, e: MapEntity, road: RoadSpec): HTMLElement {
  const apply = (patch: Partial<RoadSpec>) => rebuildRoads(editor, 'Edit road', { replace: [e, { ...road, ...patch }] });
  const style = h('select', {}, ...Object.entries(ROAD_STYLES).map(([k, s]) => h('option', { value: k }, s.label))) as HTMLSelectElement;
  style.value = road.style;
  style.addEventListener('change', () => apply({ style: style.value as RoadStyle }));
  const num = (key: 'width' | 'pavement' | 'radius', step: number, min: number) => {
    const i = h('input', { type: 'number', value: String(road[key]), step: String(step), min: String(min) }) as HTMLInputElement;
    i.addEventListener('change', () => apply({ [key]: Math.max(min, parseFloat(i.value) || min) }));
    return i;
  };
  const len = centreline(road.points, road.radius).reduce((s, p, i, a) => s + (i ? p.distanceTo(a[i - 1]) : 0), 0);
  const mat = (list: StreetMaterial[], key: 'carriageway' | 'pavement' | 'kerb' | 'gutter') => {
    const sel = h('select', {}, h('option', { value: '' }, 'From style'), ...list.map((m) => h('option', { value: m.id }, m.label))) as HTMLSelectElement;
    sel.value = road.materials?.[key] ?? '';
    sel.addEventListener('change', () => apply({ materials: { ...road.materials, [key]: sel.value || undefined } }));
    return sel;
  };
  const corner = h('input', { type: 'number', value: String(road.materials?.corner ?? 0), step: '16', min: '0', title: 'Kerb radius where this road crosses another' }) as HTMLInputElement;
  corner.addEventListener('change', () => apply({ materials: { ...road.materials, corner: Math.max(0, parseFloat(corner.value) || 0) } }));
  return h('div.section', {}, h('h3', {}, 'Road'),
    h('p.hint', {}, `${road.points.length} points, ${Math.round(len)} units long. Draw new roads with the Road tool (7).`),
    h('div.row', {}, h('label', {}, 'Style'), style),
    h('div.row', {}, h('label', {}, 'Width'), num('width', 32, 64)),
    h('div.row', {}, h('label', {}, 'Pavement'), num('pavement', 16, 0)),
    h('div.row', {}, h('label', {}, 'Corners'), num('radius', 32, 0)),
    h('div.row', {}, h('label', {}, 'Carriageway'), mat(CARRIAGEWAYS, 'carriageway')),
    h('div.row', {}, h('label', {}, 'Pavement'), mat(PAVEMENTS, 'pavement')),
    h('div.row', {}, h('label', {}, 'Kerb'), mat(KERBS, 'kerb')),
    h('div.row', {}, h('label', {}, 'Gutter'), mat(GUTTERS, 'gutter')),
    h('div.row', {}, h('label', {}, 'Round kerbs'), corner),
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
  const pole = h('select', {}, ...Object.entries(POLE_TYPES).map(([k, p]) => h('option', { value: k }, p.label))) as HTMLSelectElement;
  pole.value = spec.pole;
  pole.addEventListener('change', () => editPowerline(editor, e, { pole: pole.value as PoleType }));
  const spacing = h('input', { type: 'number', value: String(spec.spacing), step: '64', min: '192' }) as HTMLInputElement;
  spacing.addEventListener('change', () => editPowerline(editor, e, { spacing: Math.max(192, Number(spacing.value) || 640) }));
  const sag = h('input', { type: 'range', min: 0, max: 0.15, step: 0.01, value: spec.slack }) as HTMLInputElement;
  sag.addEventListener('change', () => editPowerline(editor, e, { slack: Number(sag.value) }));
  const feeds = h('input', { type: 'checkbox', checked: !!spec.feeds }) as HTMLInputElement;
  feeds.addEventListener('change', () => editPowerline(editor, e, { feeds: feeds.checked }));
  return h('div.section', {}, h('h3', {}, 'Powerline'),
    h('p.hint', {}, `${spec.points.length} route points, ${count} entities (poles and rope keyframes).`),
    h('div.row', {}, h('label', {}, 'Poles'), pole),
    h('div.row', {}, h('label', {}, 'Spacing'), spacing),
    h('div.row', {}, h('label', {}, 'Sag'), sag),
    h('div.row', {}, h('label', {}, 'House feeds'), feeds),
    h('button', { onclick: () => { const l = powerlineOf(editor.doc.entities, e); if (l) { editor.history.remove('Delete powerline', [], l.members); editor.selection.clear(); editor.changed(); } } }, 'Delete powerline'));
}

/** Turns the selected block brushes into buildings; for a generated block (`block`), its stored settings. */
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

const LAYOUT_LABEL = { block: 'Block of buildings', single: 'Building', house: 'Simple interior building' } as const;

function buildingPanel(editor: Editor, block: MapEntity | null = null): HTMLElement {
  const minF = h('input', { type: 'number', value: '3', min: '1', max: '12' }) as HTMLInputElement;
  const maxF = h('input', { type: 'number', value: '6', min: '1', max: '12' }) as HTMLInputElement;
  const arch = h('select', { title: 'Kind of buildings: facades, roofs, corners, towers and street features' },
    ...Object.entries(ARCHITECTURES).map(([k, a]) => h('option', { value: k }, a.label))) as HTMLSelectElement;
  // Each architecture has its usual height.
  arch.addEventListener('change', () => {
    const f = ARCHITECTURES[arch.value as ArchitectureName].floors;
    minF.value = String(f[0]);
    maxF.value = String(f[1]);
  });
  const style = h('select', {}, h('option', { value: '' }, 'From architecture'), ...Object.keys(FACADE_STYLES).map((k) => h('option', { value: k }, k))) as HTMLSelectElement;
  const alleys = h('input', { type: 'checkbox', checked: false }) as HTMLInputElement;
  const props = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const corners = h('select', {},
    h('option', { value: '' }, 'From architecture'), h('option', { value: 'mixed' }, 'Mixed'), h('option', { value: 'chamfer' }, 'Cut (45°)'),
    h('option', { value: 'round' }, 'Rounded'), h('option', { value: 'square' }, 'Square')) as HTMLSelectElement;
  const weathering = h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: 0.5, title: 'Water stains and dirt on street walls' }) as HTMLInputElement;
  const seed = h('input', { type: 'number', value: String(Math.floor(Math.random() * 100000)), title: 'The same seed and settings give the same buildings' }) as HTMLInputElement;
  const reroll = h('button', { title: 'New seed', onclick: () => (seed.value = String(Math.floor(Math.random() * 100000))) }, '🎲');
  const detail = h('select', { title: 'Facade decoration, built as func_detail' },
    h('option', { value: '0' }, 'None'), h('option', { value: '1' }, 'Low: base and cornice'),
    h('option', { value: '2', selected: true }, 'Medium: + ledges, columns'), h('option', { value: '3' }, 'High: + brackets')) as HTMLSelectElement;
  // Filler blocks away from the action cost vbsp far less (decoration is what fills its t-junction buffer).
  const quality = h('select', { title: 'High near the action, filler further away: decoration is what a big map runs out of room for' },
    ...Object.entries(QUALITY).map(([k, q]) => h('option', { value: k, title: q.hint }, q.label))) as HTMLSelectElement;
  const roofs = h('select', {},
    h('option', { value: 'mixed' }, 'Mixed'), h('option', { value: 'mansard' }, 'Mansard with dormers'),
    h('option', { value: 'hip' }, 'Hipped'), h('option', { value: 'gable' }, 'Gabled'),
    h('option', { value: 'curved' }, 'Curved (bell)'), h('option', { value: 'flat' }, 'Flat with parapet')) as HTMLSelectElement;
  const towers = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  // Enterable open-top houses on small lots and sheds.
  const interiors = h('select', { title: 'Enterable open-top houses on small lots and sheds of 1–2 floors (rooms, doors, furniture)' },
    h('option', { value: '' }, 'From architecture'), h('option', { value: 'none' }, 'None'), h('option', { value: 'some' }, 'Some'), h('option', { value: 'all' }, 'All')) as HTMLSelectElement;
  const interiorStyle = h('select', {}, h('option', { value: '' }, 'From architecture'),
    ...Object.entries(INTERIOR_STYLES).map(([k, st]) => h('option', { value: k }, st.label))) as HTMLSelectElement;
  const cut = h('input', { type: 'number', value: '112', min: '96', max: '128', step: '8', title: 'Height the walls are cut off at; the RTS camera sees more floor when lower' }) as HTMLInputElement;
  const furnish = h('select', {}, h('option', { value: 'full' }, 'Full'), h('option', { value: 'sparse' }, 'Sparse'), h('option', { value: 'none' }, 'None')) as HTMLSelectElement;
  const lights = h('input', { type: 'checkbox', checked: true, title: 'Wall lamps with lights in most rooms' }) as HTMLInputElement;
  const wideDoors = h('input', { type: 'checkbox', checked: false, title: '128-wide doorways so the antlion guard fits through' }) as HTMLInputElement;
  const courtyards = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const annexes = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const stored = blockOf(block);
  if (stored) {
    const o = stored.options;
    arch.value = o.architecture ?? 'mixed';
    minF.value = String(o.minFloors);
    maxF.value = String(o.maxFloors);
    style.value = o.style ?? '';
    corners.value = o.corners ?? '';
    roofs.value = o.roofs ?? 'mixed';
    detail.value = String(o.detail ?? 2);
    quality.value = o.quality ?? 'high';
    towers.checked = o.towers ?? true;
    courtyards.checked = o.courtyards ?? true;
    annexes.checked = o.annexes ?? true;
    alleys.checked = o.alleys;
    props.checked = o.roofProps;
    weathering.value = String(o.weathering ?? 0.5);
    interiors.value = o.interiors ?? '';
    interiorStyle.value = o.interiorStyle ?? '';
    cut.value = String(o.cutHeight ?? 112);
    furnish.value = o.furnish ?? 'full';
    lights.checked = o.interiorLights ?? true;
    wideDoors.checked = o.wideDoors ?? false;
    seed.value = String(o.seed);
  }
  const read = (): BuildingOptions => {
    const lo = Math.max(1, parseInt(minF.value, 10) || 2);
    return {
      seed: parseInt(seed.value, 10) || 1,
      minFloors: lo, maxFloors: Math.max(lo, parseInt(maxF.value, 10) || lo),
      alleys: alleys.checked, roofProps: props.checked, style: (style.value || undefined) as FacadeStyle | undefined,
      architecture: arch.value as ArchitectureName, weathering: parseFloat(weathering.value),
      corners: (corners.value || undefined) as CornerOption | undefined, courtyards: courtyards.checked, annexes: annexes.checked,
      detail: Number(detail.value) as DetailLevel, quality: quality.value as BuildingQuality, roofs: roofs.value as RoofOption, towers: towers.checked,
      interiors: (interiors.value || undefined) as BuildingOptions['interiors'], interiorStyle: (interiorStyle.value || undefined) as InteriorStyleName | undefined,
      cutHeight: Math.max(96, Math.min(128, parseInt(cut.value, 10) || 112)), furnish: furnish.value as BuildingOptions['furnish'],
      interiorLights: lights.checked, wideDoors: wideDoors.checked,
    };
  };
  const go = () => {
    const n = buildingsFromSelection(editor, read());
    toast(editor.container, n ? `Generated ${n} building${n > 1 ? 's' : ''} (seed ${seed.value})` : 'Selection is too small for a building (min 128×128)');
  };
  const rows = [
    h('div.row', {}, h('label', {}, 'Architecture'), arch),
    h('div.row', {}, h('label', {}, 'Floors'), minF, h('span.muted', {}, 'to'), maxF),
    h('div.row', {}, h('label', {}, 'Facade'), style),
    h('div.row', {}, h('label', {}, 'Corners'), corners),
    h('div.row', {}, h('label', {}, 'Roofs'), roofs),
    h('div.row', {}, h('label', {}, 'Quality'), quality),
    h('div.row', {}, h('label', {}, 'Detail'), detail),
    h('div.row', {}, h('label', {}, 'Towers'), towers, h('span.hint', {}, 'domes and spires on corners')),
    h('div.row', {}, h('label', {}, 'Courtyards'), courtyards, h('span.hint', {}, 'blocks of 896+ units')),
    h('div.row', {}, h('label', {}, 'Annexes'), annexes, h('span.hint', {}, 'sheds in yards')),
    h('div.row', {}, h('label', {}, 'Alleys'), alleys, h('span.hint', {}, 'with sky bridges')),
    h('div.row', {}, h('label', {}, 'Roof props'), props),
    h('div.row', {}, h('label', {}, 'Weathering'), weathering),
    h('div.row', {}, h('label', {}, 'Interiors'), interiors),
    h('div.row', {}, h('label', {}, 'Interior style'), interiorStyle),
    h('div.row', {}, h('label', {}, 'Cut height'), cut),
    h('div.row', {}, h('label', {}, 'Furnish'), furnish),
    h('div.row', {}, h('label', {}, 'Lights'), lights),
    h('div.row', {}, h('label', {}, 'Wide doors'), wideDoors, h('span.hint', {}, 'for large units')),
    h('div.row', {}, h('label', {}, 'Seed'), seed, reroll),
  ];
  if (block && stored) {
    const r = stored.rect;
    const rebuild = (label: string) => regenerateBlock(editor, block, { options: read() }, label);
    return h('div.section', {}, h('h3', {}, stored.options.layout === 'house' ? '🏚 Simple interior building' : stored.options.layout === 'single' ? '🏠 Building' : '🏢 Buildings'),
      h('p.hint', {}, `${r.x1 - r.x0} × ${r.y1 - r.y0} units. Change the settings and press Regenerate.`),
      ...rows,
      h('div.row', {},
        h('button.primary', { title: 'Rebuild with these settings', onclick: () => rebuild('Regenerate buildings') }, 'Regenerate'),
        h('button', { title: 'Same settings, new seed', onclick: () => { seed.value = String(Math.floor(Math.random() * 100000)); rebuild('Re-roll buildings'); } }, 'Re-roll'),
        h('button', { onclick: () => deleteBlock(editor, block) }, 'Delete')));
  }
  return h('div.section', {},
    h('h3', {}, 'Generate buildings'),
    h('p.hint', {}, 'Replaces the selected block(s) with a city block: a ring around a courtyard when large enough, otherwise a row of buildings.'),
    ...rows,
    h('button.primary', { onclick: go }, '🏢 Generate buildings'));
}
