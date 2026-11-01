import type { Editor } from '../editor.ts';
import type { GenerateTool, BuildingGenerator } from '../edit/generateTool.ts';
import { selectedBlockBrushes } from '../edit/generateTool.ts';
import { generator, isBuildingGenerator } from '../edit/generators.ts';
import type { RoadTool } from '../edit/roadTool.ts';
import { editPowerline, type PowerlineTool } from '../edit/powerlineTool.ts';
import type { PoiTool } from '../edit/poiTool.ts';
import { ARCHITECTURES, FACADE_STYLES, QUALITY, type ArchitectureName, type BuildingOptions } from '../gen/buildings.ts';
import { INTERIOR_STYLES } from '../gen/styles.ts';
import { ROAD_STYLES, roadOf, type RoadSpec, type RoadStyle } from '../gen/roads.ts';
import { rebuildRoads } from '../gen/roadAction.ts';
import { POLE_TYPES, type PoleType, type PowerlineSpec } from '../gen/powerlines.ts';
import { POI_TYPES, poiOf, poiParams } from '../gen/poi/registry.ts';
import { LANDSCAPES } from '../gen/poi/types.ts';
import { paramRow, rotationRow } from './poiPanel.ts';
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
  let more = false;

  const render = () => {
    const s = tool.session;
    box.hidden = !s;
    if (!s) return;
    const g = generator(s.id), tune = s.step === 'tune';
    const rows: (HTMLElement | null)[] = [
      h('div.gen-panel-head', {},
        h('button.gen-back', { title: 'Back to the Generate menu (what was made stays)', onclick: () => tool.toMenu() }, '‹ Generate'),
        h('b', {}, h('span.gen-icon', {}, g.icon), g.name)),
      h('div.gen-steps', {},
        h(tune ? 'span.done' : 'span.on', {}, h('i'), '1 Place'), h('span.sep'),
        h(tune ? 'span.on' : 'span', {}, h('i'), '2 Tune')),
      h('div.hint', {}, hintFor(s.id, tune)),
    ];
    if (tune) rows.push(h('div.gen-summary', {}, s.summary));
    else if (g.fills) rows.push(h('div.hint.fills', {}, 'Or select a block brush first: it fills it'));
    let body: HTMLElement[] = [];
    if (isBuildingGenerator(s.id)) body = buildingRows(s.id);
    else if (s.id === 'road') body = roadRows(tune);
    else if (s.id === 'powerline') body = powerlineRows(tune);
    else if (s.id === 'poi') body = poiRows(tune);
    rows.push(...body);
    if (tune) {
      rows.push(h('div.gen-actions', {},
        isBuildingGenerator(s.id) || s.id === 'poi' ? h('button', { title: 'Same settings, new seed', onclick: () => tool.reroll() }, '🎲 Re-roll') : null,
        h('button', { title: 'Take it back (a filled block brush comes back)', onclick: () => tool.remove() }, 'Delete'),
        h('button.primary', { title: 'Finish: back to the Select tool', onclick: () => tool.done() }, 'Done ', h('kbd', {}, 'Enter'))));
    }
    box.replaceChildren(...rows.filter((r): r is HTMLElement => !!r));
  };

  /** Applies a change: in the Tune step it rebuilds what was made. */
  const changed = () => {
    if (tool.session?.step === 'tune') tool.rebuild();
    else render();
  };

  /** The rows of a building generator's options; the main ones first, the rest folded under More options. */
  const buildingRows = (id: BuildingGenerator): HTMLElement[] => {
    const o = tool.options[id];
    const set = <K extends keyof BuildingOptions>(k: K, v: BuildingOptions[K]) => { o[k] = v; changed(); };
    const select = (label: string, k: keyof BuildingOptions, choices: [string, string][], title = '', fallback = '') => {
      const el = h('select', { title }, ...choices.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
      el.value = String(o[k] ?? fallback);
      el.addEventListener('change', () => { el.blur(); set(k, (el.value || undefined) as never); });
      return h('div.row', {}, h('label', {}, label), el);
    };
    const check = (label: string, k: keyof BuildingOptions, def: boolean, hint = '') => {
      const el = h('input', { type: 'checkbox', checked: (o[k] as boolean | undefined) ?? def }) as HTMLInputElement;
      el.addEventListener('change', () => set(k, el.checked as never));
      return h('div.row', {}, h('label', {}, label), el, hint ? h('span.hint', {}, hint) : null);
    };
    const number = (k: 'minFloors' | 'maxFloors' | 'cutHeight', min: number, max: number, step = 1) => {
      const el = h('input', { type: 'number', value: String(o[k] ?? 112), min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
      el.addEventListener('change', () => {
        const v = Math.max(min, Math.min(max, parseInt(el.value, 10) || min));
        if (k === 'minFloors') o.maxFloors = Math.max(o.maxFloors, v);
        if (k === 'maxFloors') o.minFloors = Math.min(o.minFloors, v);
        el.blur();
        set(k, v);
      });
      return el;
    };
    const house = id === 'house';
    const topFloor = house ? 2 : 12;
    const floors = h('div.row', {}, h('label', {}, 'Floors'), number('minFloors', 1, topFloor), h('span.muted', {}, 'to'), number('maxFloors', 1, topFloor));
    const archs = Object.entries(ARCHITECTURES).map(([k, a]) => [k, a.label] as [string, string]);
    const arch = select('Architecture', 'architecture', archs, 'Kind of buildings: facades, roofs, corners, towers and street features', 'mixed');
    // Each architecture has its usual height.
    arch.querySelector('select')!.addEventListener('change', (e) => {
      const f = ARCHITECTURES[((e.target as HTMLSelectElement).value || 'mixed') as ArchitectureName].floors;
      o.minFloors = Math.min(f[0], topFloor);
      o.maxFloors = Math.min(f[1], topFloor);
    }, { capture: true });
    const roofs = select('Roofs', 'roofs', [['mixed', 'Mixed'], ['mansard', 'Mansard with dormers'], ['hip', 'Hipped'], ['gable', 'Gabled'], ['curved', 'Curved (bell)'], ['flat', 'Flat with parapet']], '', 'mixed');
    const quality = select('Quality', 'quality', Object.entries(QUALITY).map(([k, q]) => [k, q.label]), 'High near the action, filler further away', 'high');
    const facade = select('Facade', 'style', [['', 'From architecture'], ...Object.keys(FACADE_STYLES).map((k) => [k, k] as [string, string])]);
    const corners = select('Corners', 'corners', [['', 'From architecture'], ['mixed', 'Mixed'], ['chamfer', 'Cut (45°)'], ['round', 'Rounded'], ['square', 'Square']]);
    const detailSel = h('select', { title: 'Facade decoration, built as func_detail' }, h('option', { value: '0' }, 'None'), h('option', { value: '1' }, 'Low: base and cornice'),
      h('option', { value: '2' }, 'Medium: + ledges, columns'), h('option', { value: '3' }, 'High: + brackets')) as HTMLSelectElement;
    detailSel.value = String(o.detail ?? 2);
    detailSel.addEventListener('change', () => { detailSel.blur(); set('detail', Number(detailSel.value) as BuildingOptions['detail']); });
    const detail = h('div.row', {}, h('label', {}, 'Detail'), detailSel);
    const weatherIn = h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: o.weathering ?? 0.5, title: 'Water stains and dirt on street walls' }) as HTMLInputElement;
    weatherIn.addEventListener('change', () => set('weathering', parseFloat(weatherIn.value)));
    const weathering = h('div.row', {}, h('label', {}, 'Weathering'), weatherIn);
    const interiors = select('Interiors', 'interiors', [['', 'From architecture'], ['none', 'None'], ['some', 'Some'], ['all', 'All']], 'Enterable open-top houses on small lots and sheds of 1–2 floors');
    const interiorStyle = select(house ? 'Style' : 'Interior style', 'interiorStyle', [['', 'From architecture'], ...Object.entries(INTERIOR_STYLES).map(([k, st]) => [k, st.label] as [string, string])]);
    const cut = h('div.row', { title: 'Height the walls are cut off at; the RTS camera sees more floor when lower' }, h('label', {}, 'Cut height'), number('cutHeight', 96, 128, 8));
    const furnish = select('Furnish', 'furnish', [['full', 'Full'], ['sparse', 'Sparse'], ['none', 'None']], '', 'full');
    const lights = check('Lights', 'interiorLights', true, 'wall lamps');
    const wide = check('Wide doors', 'wideDoors', false, 'for large units');
    const main: HTMLElement[] = [], rest: HTMLElement[] = [];
    if (id === 'block') {
      main.push(arch, floors, roofs, quality, check('Courtyards', 'courtyards', true, 'blocks of 896+ units'), interiors);
      rest.push(facade, corners, detail, check('Towers', 'towers', true, 'domes and spires'), check('Annexes', 'annexes', true, 'sheds in yards'),
        check('Alleys', 'alleys', false, 'with sky bridges'), check('Roof props', 'roofProps', true), weathering, interiorStyle, cut, furnish, lights, wide);
    } else if (id === 'building') {
      main.push(arch, floors, roofs, quality, facade, corners);
      rest.push(detail, check('Towers', 'towers', true, 'on a corner'), check('Annexes', 'annexes', true, 'a shed in its yard'), check('Roof props', 'roofProps', true), weathering);
    } else {
      main.push(interiorStyle, floors, furnish, lights, arch);
      rest.push(cut, wide, weathering, detail);
    }
    const seedIn = h('input', { type: 'number', value: String(o.seed), title: 'The same seed and settings give the same buildings' }) as HTMLInputElement;
    seedIn.addEventListener('change', () => { seedIn.blur(); set('seed', parseInt(seedIn.value, 10) || 1); });
    const seed = h('div.row', {}, h('label', {}, 'Seed'), seedIn, h('button', { title: 'New seed', onclick: () => { if (tool.session?.step === 'tune') tool.reroll(); else { o.seed = Math.floor(Math.random() * 100000); render(); } } }, '🎲'));
    const toggle = h('button.gen-more', { onclick: () => { more = !more; render(); } }, `${more ? '▾' : '▸'} More options (${rest.length})`);
    return [...main, toggle, ...(more ? rest : []), seed];
  };

  const num = (value: number, set: (v: number) => void, step: number, min: number) => {
    const i = h('input', { type: 'number', value: String(value), step: String(step), min: String(min) }) as HTMLInputElement;
    i.addEventListener('change', () => { set(Math.max(min, parseFloat(i.value) || min)); i.blur(); });
    return i;
  };

  /** Road settings: the next road's, and in Tune also the one just drawn (all roads rebuild, so crossings stay open). */
  const roadRows = (tune: boolean): HTMLElement[] => {
    const t = editor.tools.tools.road as RoadTool;
    const apply = (patch: Partial<RoadSpec>) => {
      const e = tool.session?.made[0];
      const road = e && roadOf(e);
      if (tune && e && road) {
        rebuildRoads(editor, 'Edit road', { replace: [e, { ...road, ...patch }] });
        tool.squashed();
      } else render();
    };
    const style = h('select', {}, ...Object.entries(ROAD_STYLES).map(([k, s]) => h('option', { value: k }, s.label))) as HTMLSelectElement;
    style.value = t.style;
    style.addEventListener('change', () => {
      style.blur();
      t.setStyle(style.value as RoadStyle);
      apply({ style: t.style, width: t.width, pavement: t.pavement });
    });
    return [
      h('div.row', {}, h('label', {}, 'Style'), style),
      h('div.row', {}, h('label', {}, 'Width'), num(t.width, (v) => { t.width = v; apply({ width: v }); }, 32, 64)),
      h('div.row', {}, h('label', {}, 'Pavement'), num(t.pavement, (v) => { t.pavement = v; apply({ pavement: v }); }, 16, 0)),
      h('div.row', {}, h('label', {}, 'Corners'), num(t.radius, (v) => { t.radius = v; apply({ radius: v }); }, 32, 0)),
    ];
  };

  /** Powerline settings: the next line's, and in Tune also the one just built. */
  const powerlineRows = (tune: boolean): HTMLElement[] => {
    const t = editor.tools.tools.powerline as PowerlineTool;
    const apply = (patch: Partial<PowerlineSpec>) => {
      const e = tool.session?.made[0];
      if (!tune || !e || !editor.doc.entities.includes(e)) return;
      editPowerline(editor, e, patch);
      tool.squashed([...editor.selection.entities].slice(0, 1));
    };
    const pole = h('select', {}, ...Object.entries(POLE_TYPES).map(([k, p]) => h('option', { value: k }, p.label))) as HTMLSelectElement;
    pole.value = t.pole;
    pole.addEventListener('change', () => { t.pole = pole.value as PoleType; pole.blur(); apply({ pole: t.pole }); });
    const sag = h('input', { type: 'range', min: 0, max: 0.15, step: 0.01, value: t.slack }) as HTMLInputElement;
    sag.addEventListener('change', () => { t.slack = Number(sag.value); apply({ slack: t.slack }); });
    const feeds = h('input', { type: 'checkbox', checked: t.feeds }) as HTMLInputElement;
    feeds.addEventListener('change', () => { t.feeds = feeds.checked; apply({ feeds: t.feeds }); });
    return [
      h('div.row', {}, h('label', {}, 'Poles'), pole),
      h('div.row', {}, h('label', {}, 'Spacing'), num(t.spacing, (v) => { t.spacing = Math.max(192, v); apply({ spacing: t.spacing }); }, 64, 192)),
      h('div.row', {}, h('label', {}, 'Sag'), sag),
      h('div.row', {}, h('label', {}, 'House feeds'), feeds),
    ];
  };

  /** POI type (while placing) and its settings; in Tune they rebuild the POI. */
  const poiRows = (tune: boolean): HTMLElement[] => {
    const t = editor.tools.tools.poi as PoiTool;
    const made = tune ? tool.session?.made[0] : null;
    const p = made ? poiOf(made) : null;
    const type = p?.type ?? t.type;
    if (!type) return [];
    const out: HTMLElement[] = [];
    if (!p) {
      const pick = h('select', { title: 'What to build (also in the POI tab)' }, ...LANDSCAPES.map((l) => h('optgroup', { label: l.label },
        ...POI_TYPES.filter((x) => x.landscapes[0] === l.id).map((x) => h('option', { value: `${l.id}:${x.id}` }, `${x.icon} ${x.label}`))))) as HTMLSelectElement;
      pick.value = `${t.landscape ?? type.landscapes[0]}:${type.id}`;
      pick.addEventListener('change', () => {
        const [l, id] = pick.value.split(':');
        t.typeId = id;
        t.landscape = l as typeof t.landscape;
        pick.blur();
        editor.emit('poi');
        render();
      });
      out.push(h('div.row', {}, h('label', {}, 'Type'), pick), h('div.hint', {}, `${type.hint} ${type.minSize.join('×')} to ${type.maxSize.join('×')}.`));
    }
    const values = p ? p.spec.params : t.paramsFor(type);
    out.push(...poiParams(type).map((q) => paramRow(q, values[q.key] ?? q.default, (v) => {
      t.paramsFor(type)[q.key] = v;
      if (p) tool.rebuild({ params: { [q.key]: v } });
    })));
    out.push(rotationRow(p ? p.spec.rotation : t.rotation, (r) => {
      t.rotation = r;
      if (p) tool.rebuild({ rotation: r });
      else render();
    }));
    const seedIn = h('input', { type: 'number', value: String(p ? p.spec.seed : t.seed) }) as HTMLInputElement;
    seedIn.addEventListener('change', () => {
      seedIn.blur();
      const v = Number(seedIn.value) || 1;
      if (p) tool.rebuild({ seed: v });
      else t.seed = v;
    });
    out.push(h('div.row', {}, h('label', {}, 'Seed'), seedIn, h('button', { title: 'New layout', onclick: () => { if (p) tool.reroll(); else { t.seed = Math.floor(Math.random() * 100000); render(); } } }, '🎲')));
    return out;
  };

  editor.on('generate', render);
  editor.on('toolchange', render);
  // The block brush hint depends on the selection.
  editor.on('selection', () => { if (tool.session?.step === 'place' && selectedBlockBrushes(editor).length) render(); });
  render();
}

function hintFor(id: string, tune: boolean): string {
  if (tune) return `Every change rebuilds it · ${id === 'road' || id === 'powerline' ? 'click points' : 'drag again'} for another · Enter: done · Esc: back`;
  if (id === 'road') return 'Click points · snaps onto roads to join them · Enter or double-click builds · Backspace removes a point · Esc: back to the menu';
  if (id === 'powerline') return 'Click points along the route · Enter or double-click places poles and wires · Esc: back to the menu';
  if (id === 'poi') return 'Drag a rectangle on the ground (a click: its default size) · Esc: back to the menu';
  return 'Drag a rectangle on the ground · Shift: square · Esc: back to the menu';
}
