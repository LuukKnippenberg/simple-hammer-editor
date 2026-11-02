import type { Editor } from '../editor.ts';
import type { GenerateTool } from '../edit/generateTool.ts';
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
import { buildingSheet } from './buildingOptions.ts';
import { roadSheet } from './roadOptions.ts';
import { powerlineSheet } from './powerlineOptions.ts';
import { stairsSheet } from './stairsOptions.ts';
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
    const s = tool.session;
    box.hidden = !s;
    if (!s) return;
    const g = generator(s.id), tune = s.step === 'tune';
    const rows: (HTMLElement | null)[] = [
      h('div.gen-panel-head', {},
        h('button.gen-back', { title: 'Back to the Generate menu (what was made stays)', onclick: () => tool.toMenu() }, '‹ Generate'),
        h('b', {}, h('span.gen-icon', {}, g.icon), g.name)),
      s.id === 'stairs' ? stairsSteps(tune) : h('div.gen-steps', {},
        h(tune ? 'span.done' : 'span.on', {}, h('i'), '1 Place'), h('span.sep'),
        h(tune ? 'span.on' : 'span', {}, h('i'), '2 Tune')),
      h('div.hint', {}, s.id === 'stairs' ? stairsHint(tune) : hintFor(s.id, tune)),
    ];
    if (tune) rows.push(h('div.gen-summary', {}, s.summary));
    else if (g.fills) rows.push(h('div.hint.fills', {}, 'Or select a block brush first: it fills it'));
    let body: HTMLElement[] = [];
    if (isBuildingGenerator(s.id)) {
      // Every change rebuilds what is being tuned.
      const o = tool.options[s.id];
      body = buildingSheet({ options: o, kind: s.id, set: (patch) => { Object.assign(o, patch); changed(); }, folds, redraw: render });
    }
    else if (s.id === 'road') body = roadRows(tune);
    else if (s.id === 'powerline') body = powerlineRows(tune);
    else if (s.id === 'poi') body = poiRows(tune);
    else if (s.id === 'stairs') body = stairsRows(tune);
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

  /** Road settings: the next road's, and in Tune also the one just drawn (all roads rebuild, so crossings stay open). */
  const roadRows = (tune: boolean): HTMLElement[] => {
    const t = editor.tools.tools.road as RoadTool;
    return roadSheet(t, (patch) => {
      // A new style brings its own width and pavement.
      if (patch.style) {
        t.setStyle(patch.style);
        patch = { style: t.style, width: t.width, pavement: t.pavement };
      } else Object.assign(t, patch);
      const e = tool.session?.made[0];
      const road = e && roadOf(e);
      if (tune && e && road) {
        rebuildRoads(editor, 'Edit road', { replace: [e, { ...road, ...patch }] });
        tool.squashed();
      } else render();
    });
  };

  /** Powerline settings: the next line's, and in Tune also the one just built. */
  const powerlineRows = (tune: boolean): HTMLElement[] => {
    const t = editor.tools.tools.powerline as PowerlineTool;
    return powerlineSheet(t, (patch) => {
      Object.assign(t, patch);
      const e = tool.session?.made[0];
      if (!tune || !e || !editor.doc.entities.includes(e)) return;
      editPowerline(editor, e, patch);
      tool.squashed([...editor.selection.entities].slice(0, 1));
    });
  };

  const stairs = editor.tools.tools.stairs as StairsTool;
  let hotFlight = -1;
  /** A, B, Height, Tune: where the stairs tool is. */
  const stairsSteps = (tune: boolean) => {
    const at = stairs.phase === 'height' ? 2 : stairs.phase === 'b' ? (stairs.nodes.length > 1 || tune ? 3 : 1) : 0;
    const step = (i: number, label: string) => h(i < at ? 'span.done' : i === at ? 'span.on' : 'span', {}, h('i'), label);
    return h('div.gen-steps', {}, step(0, 'A'), h('span.sep'), step(1, 'B'), h('span.sep'), step(2, 'Height'), h('span.sep'), step(3, 'Tune'));
  };
  const stairsHint = (tune: boolean) => stairs.phase === 'height'
    ? 'Move the mouse up or down, scroll, or type a number. Click or Enter confirms, Esc goes back.'
    : stairs.phase === 'a' ? 'Click A, the foot of the stairs · Esc: back to the menu'
      : tune ? 'Every change rebuilds them · click the next point to chain · Shift+click branches from the landing just left · Enter: done · Backspace: take back a point'
        : 'Click B, the top end; its height starts at the surface you click · Esc: back to A';
  /** Stairs: the height read-out while setting one, the option sheet in Tune (every change rebuilds them). */
  const stairsRows = (tune: boolean): HTMLElement[] => {
    const out: HTMLElement[] = [];
    if (stairs.phase === 'height') {
      const hIn = h('input.num', { type: 'number', value: String(stairs.height), step: '8', title: 'Height over the point the flight leaves' }) as HTMLInputElement;
      hIn.addEventListener('change', () => { stairs.setHeight(Number(hIn.value) || 0); });
      hIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { stairs.setHeight(Number(hIn.value) || 0); hIn.blur(); stairs.confirm(); } });
      const sIn = h('input.num', { type: 'number', value: String(stairs.pendingSteps), min: '1' }) as HTMLInputElement;
      sIn.addEventListener('change', () => { sIn.blur(); stairs.setSteps(Number(sIn.value) || undefined); });
      const r = buildStairs(VmfDocument.empty(), { ...stairs.spec(true), flights: stairs.spec(true).flights.slice(-1) }).flights[0];
      out.push(h('div.row', {}, h('label', {}, 'Height'), hIn, h('span.unit', {}, 'u')),
        h('div.row', {}, h('label', {}, 'Steps'), sIn, stairs.steps ? h('button', { onclick: () => stairs.setSteps(undefined) }, 'auto') : h('span.unit.auto', {}, 'auto')),
        h('div.row', {}, h('label', {}, 'Rise · tread'), h('span.mono', {}, r && r.steps ? `${Math.round(r.rise * 10) / 10} · ${Math.round(r.tread * 10) / 10}` : 'flat')));
      if (r?.steep) out.push(h('div.hint.warn', {}, 'Too steep for units: put the point further away, or lower.'));
      return out;
    }
    const spec = stairs.spec();
    const set = (patch: Partial<typeof stairs.options>) => { Object.assign(stairs.options, patch); if (tune) stairs.rebuild(); else render(); };
    const setFlight = (i: number, patch: Partial<StairsFlight>) => {
      const f = stairs.flights[i];
      if (!f) return;
      for (const [k, v] of Object.entries(patch) as [keyof StairsFlight, number | undefined][]) { if (v === undefined) delete f[k]; else f[k] = v; }
      stairs.rebuild();
    };
    if (!tune) {
      // Before the first flight: the plan and width the next stairs get.
      return stairsSheet({ spec, result: null, set, setFlight }).slice(0, 3);
    }
    const result = buildStairs(VmfDocument.empty(), spec);
    return stairsSheet({ spec, result, set, setFlight, hot: hotFlight, onHot: (i) => { hotFlight = hotFlight === i ? -1 : i; render(); } });
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
  editor.on('stairs', () => { if (tool.session?.id === 'stairs') render(); });
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
