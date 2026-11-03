import type { Editor } from '../editor.ts';
import type { GenerateTool, BuildingGenerator } from '../edit/generateTool.ts';
import { selectedBlockBrushes } from '../edit/generateTool.ts';
import { generator, isBuildingGenerator } from '../edit/generators.ts';
import type { RoadTool } from '../edit/roadTool.ts';
import { editPowerline, type PowerlineTool } from '../edit/powerlineTool.ts';
import type { PoiTool } from '../edit/poiTool.ts';
import type { StairsTool } from '../edit/stairsTool.ts';
import { roadOf } from '../gen/roads.ts';
import { rebuildRoads } from '../gen/roadAction.ts';
import { POI_TYPES, poiOf, poiParams } from '../gen/poi/registry.ts';
import { LANDSCAPES } from '../gen/poi/types.ts';
import { paramRow, rotationRow } from './poiPanel.ts';
import { buildingSheet, type BuildingRow } from './buildingOptions.ts';
import { roadSheet } from './roadOptions.ts';
import { powerlineSheet } from './powerlineOptions.ts';
import { stairsSheet } from './stairsOptions.ts';
import { pathPointsSection, pointAxis } from './pathPointsList.ts';
import { buildStairs, type StairsFlight } from '../gen/stairs.ts';
import { VmfDocument } from '../vmf/map.ts';
import { h } from './dom.ts';

/**
 * The Generate flow's viewport panel (top left, where the tool options are): "‹ Generate  <name>", the steps
 * 1 Place · 2 Tune, a hint, the generator's main options with the rest under "More options", and in the Tune step
 * what was made with Re-roll, Delete and Done. In Tune every change rebuilds it in place.
 */
export function mountGeneratePanel(editor: Editor, viewport: HTMLElement): void {
  const box = h('div.overlay.tl.gen-panel', { hidden: true });
  viewport.append(box);
  const tool = editor.tools.tools.generate as GenerateTool;
  /** More options and Extras stay folded or open while the panel re-renders. */
  const folds = { more: false, extras: false };

  const render = () => {
    const session = tool.session;
    box.hidden = !session;
    if (!session) return;
    const descriptor = generator(session.id), tune = session.step === 'tune';
    const rows: (HTMLElement | null)[] = [
      h('div.gen-panel-head', {},
        h('button.gen-back', { title: 'Back to the Generate menu (what was made stays)', onclick: () => tool.toMenu() }, '‹ Generate'),
        h('b', {}, h('span.gen-icon', {}, descriptor.icon), descriptor.name)),
      session.id === 'stairs' ? stairsSteps(tune) : h('div.gen-steps', {},
        h(tune ? 'span.done' : 'span.on', {}, h('i'), '1 Place'), h('span.sep'),
        h(tune ? 'span.on' : 'span', {}, h('i'), '2 Tune')),
      h('div.hint', {}, session.id === 'stairs' ? stairsHint(tune) : hintFor(session.id, tune)),
    ];
    if (tune) rows.push(h('div.gen-summary', {}, session.summary));
    else if (descriptor.fills) rows.push(h('div.hint.fills', {}, 'Or select a block brush first: it fills it'));
    let body: HTMLElement[] = [];
    if (isBuildingGenerator(session.id)) {
      // Every change rebuilds what is being tuned.
      const options = tool.options[session.id];
      body = buildingSheet({ options, kind: session.id, ...TUNE_ROWS[session.id], set: (patch) => { Object.assign(options, patch); changed(); }, folds, redraw: render });
    }
    else if (session.id === 'road') body = roadRows(tune);
    else if (session.id === 'powerline') body = powerlineRows(tune);
    else if (session.id === 'poi') body = poiRows(tune);
    else if (session.id === 'stairs') body = stairsRows(tune);
    rows.push(...body);
    if (tune) {
      rows.push(h('div.gen-actions', {},
        isBuildingGenerator(session.id) || session.id === 'poi' ? h('button', { title: 'Same settings, new seed', onclick: () => tool.reroll() }, '🎲 Re-roll') : null,
        h('button', { title: 'Take it back (a filled block brush comes back)', onclick: () => tool.remove() }, 'Delete'),
        h('button.primary', { title: 'Finish: back to the Select tool', onclick: () => tool.done() }, 'Done ', h('kbd', {}, 'Enter'))));
    }
    box.replaceChildren(...rows.filter((row): row is HTMLElement => !!row));
  };

  /** Applies a change: in the Tune step it rebuilds what was made. */
  const changed = () => {
    if (tool.session?.step === 'tune') tool.rebuild();
    else render();
  };

  /** Road settings: the next road's, and in Tune also the one just drawn (all roads rebuild, so crossings stay open). */
  const roadRows = (tune: boolean): HTMLElement[] => {
    const roadTool = editor.tools.tools.road as RoadTool;
    return roadSheet(roadTool, (patch) => {
      // A new style brings its own width and pavement.
      if (patch.style) {
        roadTool.setStyle(patch.style);
        patch = { style: roadTool.style, width: roadTool.width, pavement: roadTool.pavement };
      } else Object.assign(roadTool, patch);
      const made = tool.session?.made[0];
      const road = made && roadOf(made);
      if (tune && made && road) {
        rebuildRoads(editor, 'Edit road', { replace: [made, { ...road, ...patch }] });
        tool.squashed();
      } else render();
    });
  };

  /** Powerline settings: the next line's, and in Tune also the one just built. */
  const powerlineRows = (tune: boolean): HTMLElement[] => {
    const powerlineTool = editor.tools.tools.powerline as PowerlineTool;
    return powerlineSheet(powerlineTool, (patch) => {
      Object.assign(powerlineTool, patch);
      const made = tool.session?.made[0];
      if (!tune || !made || !editor.doc.entities.includes(made)) return;
      editPowerline(editor, made, patch);
      tool.squashed([...editor.selection.entities].slice(0, 1));
    });
  };

  const stairs = editor.tools.tools.stairs as StairsTool;
  let hotFlight = -1;
  /** A, B, Height, Tune: where the stairs tool is. */
  const stairsSteps = (tune: boolean) => {
    const current = stairs.phase === 'height' ? 2 : stairs.phase === 'b' ? (stairs.nodes.length > 1 || tune ? 3 : 1) : 0;
    const step = (i: number, label: string) => h(i < current ? 'span.done' : i === current ? 'span.on' : 'span', {}, h('i'), label);
    return h('div.gen-steps', {}, step(0, 'A'), h('span.sep'), step(1, 'B'), h('span.sep'), step(2, 'Height'), h('span.sep'), step(3, 'Tune'));
  };
  const stairsHint = (tune: boolean) => stairs.phase === 'height'
    ? 'Move the mouse up or down, scroll, or type a number. Click or Enter confirms, Esc goes back.'
    : stairs.phase === 'a' ? 'Click A, the foot of the stairs · Esc: back to the menu'
      : tune ? 'Every change rebuilds them · click the next point to chain · drag a pin to move it, click a + to insert one, Alt+click a pin to remove it, Shift+click a pin to branch from it · Enter: done · Backspace: take back a point'
        : 'Click B, the top end; its height starts at the surface you click · Esc: back to A';
  /** Stairs: the height read-out while setting one, the option sheet in Tune (every change rebuilds them). */
  const stairsRows = (tune: boolean): HTMLElement[] => {
    const out: HTMLElement[] = [];
    if (stairs.phase === 'height') {
      const heightInput = h('input.num', { type: 'number', value: String(stairs.height), step: '8', title: 'Height over the point the flight leaves' }) as HTMLInputElement;
      heightInput.addEventListener('change', () => { stairs.setHeight(Number(heightInput.value) || 0); });
      heightInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { stairs.setHeight(Number(heightInput.value) || 0); heightInput.blur(); stairs.confirm(); } });
      const stepsInput = h('input.num', { type: 'number', value: String(stairs.pendingSteps), min: '1' }) as HTMLInputElement;
      stepsInput.addEventListener('change', () => { stepsInput.blur(); stairs.setSteps(Number(stepsInput.value) || undefined); });
      const flight = buildStairs(VmfDocument.empty(), { ...stairs.spec(true), flights: stairs.spec(true).flights.slice(-1) }).flights[0];
      out.push(h('div.row', {}, h('label', {}, 'Height'), heightInput, h('span.unit', {}, 'u')),
        h('div.row', {}, h('label', {}, 'Steps'), stepsInput, stairs.steps ? h('button', { onclick: () => stairs.setSteps(undefined) }, 'auto') : h('span.unit.auto', {}, 'auto')),
        h('div.row', {}, h('label', {}, 'Rise · tread'), h('span.mono', {}, flight && flight.steps ? `${Math.round(flight.rise * 10) / 10} · ${Math.round(flight.tread * 10) / 10}` : 'flat')));
      if (flight?.steep) out.push(h('div.hint.warn', {}, 'Too steep for units: put the point further away, or lower.'));
      return out;
    }
    const spec = stairs.spec();
    const set = (patch: Partial<typeof stairs.options>) => { Object.assign(stairs.options, patch); if (tune) stairs.rebuild(); else render(); };
    const setFlight = (i: number, patch: Partial<StairsFlight>) => {
      const flight = stairs.flights[i];
      if (!flight) return;
      for (const [key, value] of Object.entries(patch) as [keyof StairsFlight, number | undefined][]) { if (value === undefined) delete flight[key]; else flight[key] = value; }
      stairs.rebuild();
    };
    if (!tune) {
      // Before the first flight: the plan and width the next stairs get.
      return stairsSheet({ spec, result: null, set, setFlight }).slice(0, 3);
    }
    const result = buildStairs(VmfDocument.empty(), spec);
    // The points with their heights, typed or (picked pin) Page Up / Page Down; the pins' own key while placing.
    const points = pathPointsSection(editor, stairs.pins.target?.key ?? '', [pointAxis('x', 'x', editor.grid), pointAxis('y', 'y', editor.grid), pointAxis('height', 'z', 8)],
      'Typing a number moves the point. Height: the wheel while holding a pin, or Page Up / Page Down on a picked one.', stairs.pins);
    return [points, ...stairsSheet({ spec, result, set, setFlight, hot: hotFlight, onHot: (i) => { hotFlight = hotFlight === i ? -1 : i; render(); } })];
  };

  /** POI type (while placing) and its settings; in Tune they rebuild the POI. */
  const poiRows = (tune: boolean): HTMLElement[] => {
    const poiTool = editor.tools.tools.poi as PoiTool;
    const made = tune ? tool.session?.made[0] : null;
    const poi = made ? poiOf(made) : null;
    const type = poi?.type ?? poiTool.type;
    if (!type) return [];
    const out: HTMLElement[] = [];
    if (!poi) {
      const pick = h('select', { title: 'What to build (also in the POI tab)' }, ...LANDSCAPES.map((landscape) => h('optgroup', { label: landscape.label },
        ...POI_TYPES.filter((poiType) => poiType.landscapes[0] === landscape.id).map((poiType) => h('option', { value: `${landscape.id}:${poiType.id}` }, `${poiType.icon} ${poiType.label}`))))) as HTMLSelectElement;
      pick.value = `${poiTool.landscape ?? type.landscapes[0]}:${type.id}`;
      pick.addEventListener('change', () => {
        const [landscape, id] = pick.value.split(':');
        poiTool.typeId = id;
        poiTool.landscape = landscape as typeof poiTool.landscape;
        pick.blur();
        editor.emit('poi');
        render();
      });
      out.push(h('div.row', {}, h('label', {}, 'Type'), pick), h('div.hint', {}, `${type.hint} ${type.minSize.join('×')} to ${type.maxSize.join('×')}.`));
    }
    const values = poi ? poi.spec.params : poiTool.paramsFor(type);
    out.push(...poiParams(type).map((param) => paramRow(param, values[param.key] ?? param.default, (value) => {
      poiTool.paramsFor(type)[param.key] = value;
      if (poi) tool.rebuild({ params: { [param.key]: value } });
    })));
    out.push(rotationRow(poi ? poi.spec.rotation : poiTool.rotation, (rotation) => {
      poiTool.rotation = rotation;
      if (poi) tool.rebuild({ rotation });
      else render();
    }));
    const seedInput = h('input', { type: 'number', value: String(poi ? poi.spec.seed : poiTool.seed) }) as HTMLInputElement;
    seedInput.addEventListener('change', () => {
      seedInput.blur();
      const seed = Number(seedInput.value) || 1;
      if (poi) tool.rebuild({ seed });
      else poiTool.seed = seed;
    });
    out.push(h('div.row', {}, h('label', {}, 'Seed'), seedInput, h('button', { title: 'New layout', onclick: () => { if (poi) tool.reroll(); else { poiTool.seed = Math.floor(Math.random() * 100000); render(); } } }, '🎲')));
    return out;
  };

  editor.on('generate', render);
  editor.on('stairs', () => { if (tool.session?.id === 'stairs') render(); });
  // The picked pin lights its row in the stairs' Points list.
  editor.on('pathpins', () => { if (tool.session?.id === 'stairs' && tool.session.step === 'tune') render(); });
  editor.on('toolchange', render);
  // The block brush hint depends on the selection.
  editor.on('selection', () => { if (tool.session?.step === 'place' && selectedBlockBrushes(editor).length) render(); });
  render();
}

/** The building rows Tune shows per generator: the main ones, then the ones under More options. */
const TUNE_ROWS: Record<BuildingGenerator, { rows: BuildingRow[]; more: BuildingRow[] }> = {
  block: {
    rows: ['architecture', 'floors', 'roofs', 'quality', 'courtyards', 'interiors'],
    more: ['facade', 'corners', 'detail', 'towers', 'annexes', 'alleys', 'weathering', 'interiorStyle', 'cutHeight', 'furnish', 'lights', 'lightLevel', 'wideDoors'],
  },
  building: { rows: ['architecture', 'floors', 'roofs', 'quality', 'facade', 'corners'], more: ['detail', 'towers', 'annexes', 'weathering'] },
  house: { rows: ['interiorStyle', 'floors', 'furnish', 'lights', 'lightLevel', 'architecture'], more: ['cutHeight', 'wideDoors', 'weathering', 'detail'] },
};

function hintFor(id: string, tune: boolean): string {
  if (tune) return `Every change rebuilds it · ${id === 'road' || id === 'powerline' ? 'click points' : 'drag again'} for another · Enter: done · Esc: back`;
  if (id === 'road') return 'Click to add A, B, C… · snaps onto roads to join them · drag a pin to move it, click a + to insert one, Alt+click a pin to remove it, Shift+click a pin to branch (a second road, T junction) · Enter or double-click builds · Backspace removes a point · Esc: back to the menu';
  if (id === 'powerline') return 'Click points along the route (they snap to the pavement of streets) · drag a pin to move it · + inserts · Alt+click removes · Shift+click a pin branches (a tee pole) · Enter or double-click places poles and wires · Esc: back to the menu';
  if (id === 'poi') return 'Drag a rectangle on the ground (a click: its default size) · Esc: back to the menu';
  return 'Drag a rectangle on the ground · Shift: square · Esc: back to the menu';
}
