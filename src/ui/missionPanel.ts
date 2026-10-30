import type { Editor } from '../editor.ts';
import type { KitTool } from '../edit/tools.ts';
import { KITS, UNITS, applyStandardRelations, recordKit, type Kit, type ParamValue } from '../lw/kits.ts';
import { h, toast } from './dom.ts';

/** Singleplayer mission settings stored on worldspawn: `message` is Source's map title key. */
export function missionInfo(editor: Editor): { name: string; description: string } {
  return { name: editor.doc.world.get('message') ?? '', description: editor.doc.world.get('she_description') ?? '' };
}

/** maps/<name>.res for the mission list in the main menu. */
export function missionRes(editor: Editor, mapName: string): string {
  const { name, description } = missionInfo(editor);
  const q = (s: string) => s.replace(/"/g, "'");
  return `"${mapName}"\r\n{\r\n\t"name" "${q(name || mapName)}"\r\n\t"description" "${q(description || 'A mission made with Simple Hammer Editor.')}"\r\n\r\n\t"fow_r" "0.0"\r\n\t"fow_g" "0.0"\r\n\t"fow_b" "0.0"\r\n\t"fow_a" "0.0"\r\n}\r\n`;
}

/** Mission tab: mission info, Lambda Wars kits with their settings, relations and a short summary. */
export function mountMissionPanel(editor: Editor): HTMLElement {
  const tool = editor.tools.tools.kit as KitTool;
  const infoEl = h('div');
  const kitsEl = h('div.kits');
  const formEl = h('div');
  const summary = h('div');

  const renderInfo = () => {
    const info = missionInfo(editor);
    const name = h('input', { value: info.name, placeholder: 'Mission title' }) as HTMLInputElement;
    const desc = h('textarea', { rows: 3, placeholder: 'Shown in the mission list' }) as HTMLTextAreaElement;
    desc.value = info.description;
    // Not recorded in undo: snapshotting worldspawn would copy every world brush.
    const commit = (key: string, value: string) => {
      editor.doc.world.set(key, value);
      editor.dirty = true;
      editor.emit('change');
    };
    name.addEventListener('change', () => commit('message', name.value));
    desc.addEventListener('change', () => commit('she_description', desc.value.replace(/\s+/g, ' ').trim()));
    infoEl.replaceChildren(
      h('div.row', {}, h('label', {}, 'Title'), name),
      h('div.row', {}, h('label', {}, 'Description'), desc),
      h('p.hint', {}, 'Compile with a map name starting with sp_ to list it under Missions in the game menu.'),
    );
  };

  const renderForm = (kit: Kit) => {
    const values = tool.paramsFor(kit.id);
    const rows = kit.params.map((p) => {
      let input: HTMLInputElement | HTMLSelectElement;
      const set = (val: ParamValue) => { values[p.key] = val; };
      if (p.type === 'select') {
        input = h('select', {}, ...(p.options ?? []).map((o) => h('option', { value: o.value }, o.label))) as HTMLSelectElement;
        input.value = String(values[p.key]);
        input.addEventListener('change', () => set((input as HTMLSelectElement).value));
      } else if (p.type === 'check') {
        input = h('input', { type: 'checkbox', checked: !!values[p.key] }) as HTMLInputElement;
        input.addEventListener('change', () => set((input as HTMLInputElement).checked));
      } else {
        input = h('input', { type: p.type === 'number' ? 'number' : 'text', value: String(values[p.key]) }) as HTMLInputElement;
        input.addEventListener('change', () => set(p.type === 'number' ? parseFloat((input as HTMLInputElement).value) || 0 : (input as HTMLInputElement).value));
      }
      return h('div.row', { title: p.hint ?? '' }, h('label', {}, p.label), input);
    });
    formEl.replaceChildren(h('p.hint', {}, kit.hint), ...rows, h('p.hint', {}, 'Click in the viewport to place (tool 5).'));
  };

  const renderKits = () => {
    kitsEl.replaceChildren(...KITS.map((k) => h((k.id === tool.kitId ? 'button.kit.active' : 'button.kit') as 'button', {
      title: k.hint,
      onclick: () => {
        tool.kitId = k.id;
        editor.tools.set('kit');
        editor.emit('toolchange');
        editor.emit('kit');
        renderKits();
      },
    }, h('span.icon', {}, k.icon), k.label)));
    renderForm(tool.kit);
  };

  const renderSummary = () => {
    const ents = editor.doc.entities;
    const count = (f: (cls: string) => boolean) => ents.filter((e) => f(e.classname)).length;
    const byFaction = new Map<string, number>();
    for (const e of ents) {
      const u = UNITS.find((x) => x.cls === e.classname);
      if (!u) continue;
      const side = e.get('ownernumber') === '2' ? 'yours' : u.faction;
      byFaction.set(side, (byFaction.get(side) ?? 0) + 1);
    }
    const waves = ents.filter((e) => e.classname === 'unit_maker').reduce((n, e) => n + (parseInt(e.get('MaxNPCCount') ?? '0', 10) || 0), 0);
    const rows: [string, string][] = [
      ['Player camera', count((c) => c === 'info_player_wars') ? '✓' : '— add a Mission player start'],
      ['Your units', String(byFaction.get('yours') ?? 0)],
      ['Zombies', String(byFaction.get('zombies') ?? 0)],
      ['Combine', String(byFaction.get('combine') ?? 0)],
      ['Wave units', String(waves)],
      ['Objectives', String(count((c) => c === 'wars_mission_objective'))],
      ['Win condition', count((c) => c === 'wars_win_condition') ? '✓' : '—'],
      ['Capture points', String(count((c) => c === 'control_point'))],
    ];
    summary.replaceChildren(...rows.map(([k, v]) => h('div.row', {}, h('label', {}, k), h('span', {}, v))));
  };

  const relations = () => {
    const created = recordKit(editor, 'Apply relations', () => applyStandardRelations(editor));
    toast(editor.container, created.length ? `Added ${created.filter((e) => e.classname === 'wars_player_relation').length} relation(s): you hate every other unit owner` : 'Relations already set');
  };

  for (const ev of ['document', 'change']) editor.on(ev, () => { renderInfo(); renderSummary(); });
  renderInfo();
  renderKits();
  renderSummary();
  return h('div', {},
    h('div.section', {}, h('h3', {}, 'Mission'), infoEl),
    h('div.section', {}, h('h3', {}, 'Lambda Wars kits'), kitsEl, formEl),
    h('div.section', {}, h('h3', {}, 'Relations'),
      h('p.hint', {}, 'Make you (Player 0) and every other unit owner enemies, applied at map start.'),
      h('button', { onclick: relations }, 'Apply standard relations')),
    h('div.section', {}, h('h3', {}, 'Summary'), summary));
}
