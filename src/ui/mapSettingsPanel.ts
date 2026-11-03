import type { Editor } from '../editor.ts';
import type { LightingPreview } from '../render/lightingPreview.ts';
import type { MapEntity } from '../vmf/map.ts';
import {
  SETTING_GROUPS, createGroupEntity, detachGroup, groupState, readField, setSwitchedOff, settingsEntity, writeField,
  type Field, type SettingGroup,
} from '../lw/mapSettings.ts';
import { clearThumbCache } from '../assets/thumbCache.ts';
import { h, toast } from './dom.ts';
import { auditionSoundscape, soundscapeSelect } from './soundUi.ts';

const hex = (rgb: string) => '#' + rgb.trim().split(/\s+/).slice(0, 3).map((x) => Math.max(0, Math.min(255, Number(x) || 0)).toString(16).padStart(2, '0')).join('');
const rgbOf = (hx: string) => [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16)).join(' ');
const STATE_LABEL = { set: 'In map', auto: 'Default', off: 'Off' } as const;
const STATE_TITLE = {
  set: 'Stored in the map',
  auto: 'Not in the map yet: added with default values when compiling. Change a value to customise it.',
  off: 'Not used',
} as const;

const fileLists = new Map<string, Promise<string[]>>();
const listFiles = (folder: string, ext: string) => {
  const key = `${folder}|${ext}`;
  if (!fileLists.has(key)) fileLists.set(key, fetch(`/api/list?folder=${encodeURIComponent(folder)}&ext=${ext}`).then((r) => (r.ok ? r.json() : [])));
  return fileLists.get(key)!;
};

/**
 * "Settings" tab: one card per map-wide setting (sky, sun, fog, exposure, colour correction, ...).
 * Editing a value creates the setting's entity if the map has none yet.
 */
export function mountMapSettingsPanel(editor: Editor, preview: LightingPreview): HTMLElement {
  const body = h('div');
  const open = new Set<string>(['sun', 'fog']);
  try {
    const saved = JSON.parse(localStorage.getItem('she.settings.open') ?? 'null');
    if (Array.isArray(saved)) { open.clear(); for (const id of saved) open.add(id); }
  } catch { /* no storage */ }
  const saveOpen = () => { try { localStorage.setItem('she.settings.open', JSON.stringify([...open])); } catch { /* no storage */ } };
  let editing = false;

  const logicAutos = () => editor.doc.entities.filter((e) => e.classname === 'logic_auto');
  const refreshLook = () => {
    editor.applyEnvironment();
    preview.refresh();
  };

  /** Creates the group's entity (one undo step) when the map has none. */
  const ensure = (g: SettingGroup): MapEntity => {
    const existing = settingsEntity(editor.doc, g);
    if (existing) return existing;
    editor.history.group(`Add ${g.title}`, () => {
      const end = editor.history.begin('Update logic', [], [editor.doc.worldEntity, ...logicAutos()]);
      const created = createGroupEntity(editor.doc, g);
      end();
      editor.history.added('Add entities', [], created);
    });
    editor.changed(true);
    return settingsEntity(editor.doc, g)!;
  };

  /** A live edit: the first change opens an undo step, `commit` closes it. */
  const session = (g: SettingGroup) => {
    let end: (() => void) | null = null;
    return {
      set(f: Field, value: string) {
        editing = true;
        const e = ensure(g);
        end ??= editor.history.begin(`Edit ${g.title}`, [], [e, ...logicAutos()]);
        writeField(editor.doc, g, f, value);
        editor.dirty = true;
        refreshLook();
      },
      commit() {
        end?.();
        end = null;
        editing = false;
        editor.changed();
      },
    };
  };

  const toggle = (g: SettingGroup, on: boolean) => {
    const state = groupState(editor.doc, g);
    if (on) {
      if (g.auto && state === 'off') {
        const end = editor.history.begin(`Turn on ${g.title}`, [], [editor.doc.worldEntity]);
        setSwitchedOff(editor.doc, g.id, false);
        end();
      } else if (state === 'off') ensure(g);
    } else {
      editor.history.group(`Turn off ${g.title}`, () => {
        const end = editor.history.begin('Update logic', [], [editor.doc.worldEntity, ...logicAutos()]);
        const e = detachGroup(editor.doc, g);
        if (g.auto) setSwitchedOff(editor.doc, g.id, true);
        end();
        if (e) editor.history.remove('Remove entity', [], [e]);
      });
    }
    editor.changed();
    refreshLook();
  };

  const fieldRow = (g: SettingGroup, f: Field, s: ReturnType<typeof session>): HTMLElement => {
    const value = readField(editor.doc, g, f);
    const label = h('label', { title: f.hint ?? f.label }, f.label);
    const commit = () => s.commit();
    if (f.kind === 'number' || f.kind === 'angle') {
      const sign = f.kind === 'number' && f.negate ? -1 : 1;
      const shown = (parseFloat(value) || 0) * sign;
      const step = f.kind === 'number' ? f.step : 1;
      const range = h('input', { type: 'range', min: f.min, max: f.max, step, value: shown }) as HTMLInputElement;
      const box = h('input.num', { type: 'number', min: f.min, max: f.max, step, value: shown }) as HTMLInputElement;
      const apply = (v: string) => s.set(f, String((parseFloat(v) || 0) * sign));
      range.addEventListener('input', () => { box.value = range.value; apply(range.value); });
      range.addEventListener('change', commit);
      box.addEventListener('change', () => { range.value = box.value; apply(box.value); commit(); });
      const unit = f.kind === 'number' ? f.unit : '°';
      return h('div.row', {}, label, range, box, unit ? h('span.unit', {}, unit) : null);
    }
    if (f.kind === 'color' || f.kind === 'light') {
      const parts = value.trim().split(/\s+/);
      const pick = h('input', { type: 'color', value: hex(value) }) as HTMLInputElement;
      const bright = f.kind === 'light' ? h('input.num', { type: 'number', min: 0, step: 10, value: parts[3] ?? '200', title: 'Brightness' }) as HTMLInputElement : null;
      const apply = () => s.set(f, bright ? `${rgbOf(pick.value)} ${bright.value || '0'}` : rgbOf(pick.value));
      pick.addEventListener('input', apply);
      pick.addEventListener('change', commit);
      bright?.addEventListener('change', () => { apply(); commit(); });
      return h('div.row', {}, label, pick, bright ? h('span.unit', {}, 'brightness') : null, bright, h('span', { style: { flex: '1' } }));
    }
    if (f.kind === 'bool' || f.kind === 'flag') {
      const box = h('input', { type: 'checkbox', checked: value === '1' }) as HTMLInputElement;
      box.addEventListener('change', () => { s.set(f, box.checked ? '1' : '0'); commit(); });
      return h('div.row', {}, label, box);
    }
    if (f.kind === 'choice') {
      const sel = h('select', {}, ...f.options.map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
      sel.value = value;
      sel.addEventListener('change', () => { s.set(f, sel.value); commit(); });
      return h('div.row', {}, label, sel);
    }
    if (f.kind === 'soundscape') {
      const sel = soundscapeSelect(value, (v) => { s.set(f, v); commit(); });
      return h('div.row', {}, label, sel, h('button', { title: 'Listen for 15 seconds', onclick: () => void auditionSoundscape(sel.value) }, '▶'));
    }
    // file
    const sel = h('select', {}, h('option', { value }, value || '(none)')) as HTMLSelectElement;
    sel.addEventListener('focus', () => {
      if (sel.dataset.loaded) return;
      sel.dataset.loaded = '1';
      void listFiles(f.folder, f.ext).then((paths) => {
        const names = [...new Set(paths.map(f.name).filter((n): n is string => !!n))].sort();
        if (value && !names.includes(value)) names.unshift(value);
        sel.replaceChildren(h('option', { value: '' }, '(none)'), ...names.map((n) => h('option', { value: n }, n.replace(/^scripts\/colorcorrection\//, ''))));
        sel.value = value;
      });
    });
    sel.addEventListener('change', () => { s.set(f, sel.value); commit(); });
    return h('div.row', {}, label, sel);
  };

  const card = (g: SettingGroup): HTMLElement => {
    const state = g.classname === 'worldspawn' ? 'set' : groupState(editor.doc, g);
    const isOpen = open.has(g.id);
    const sw = g.classname === 'worldspawn' ? null : h('input.switch', { type: 'checkbox', checked: state !== 'off', title: state === 'off' ? 'Turn on' : 'Turn off' }) as HTMLInputElement;
    sw?.addEventListener('click', (e) => e.stopPropagation());
    sw?.addEventListener('change', () => toggle(g, sw.checked));
    const head = h('div.set-head', {
      onclick: () => { if (isOpen) open.delete(g.id); else open.add(g.id); saveOpen(); render(); },
    },
      h('span.chev', {}, isOpen ? '▾' : '▸'),
      h('b', {}, g.title),
      g.classname === 'worldspawn' ? null : h(`span.badge.${state}` as 'span', { title: STATE_TITLE[state] }, STATE_LABEL[state]),
      h('span', { style: { flex: '1' } }),
      sw,
    );
    const el = h(`div.set-card${state === 'off' ? '.off' : ''}` as 'div', {}, head);
    if (isOpen) {
      const s = session(g);
      el.append(h('div.set-body', {},
        h('p.hint', {}, g.description, g.classname === 'worldspawn' ? '' : h('span.cls', {}, ` ${g.classname}`)),
        ...g.fields.map((f) => fieldRow(g, f, s))));
    }
    return el;
  };

  const render = () => {
    if (editing) return;
    const auto = SETTING_GROUPS.filter((g) => groupState(editor.doc, g) === 'auto').map((g) => g.title);
    body.replaceChildren(
      h('p.hint', {}, auto.length
        ? `Settings marked Default (${auto.join(', ').toLowerCase()}) are added with default values when compiling; change a value to store it in the map.`
        : 'Every setting that is on is stored in the map.'),
      ...SETTING_GROUPS.map(card),
    );
  };
  for (const ev of ['document', 'change']) editor.on(ev, render);
  render();
  // Thumbnails are kept in this browser across reloads; after a game update they can be out of date.
  const clearThumbs = h('button', { title: 'Model, material and decal thumbnails are kept in this browser; they are drawn again as they are needed' }, 'Clear thumbnail cache');
  clearThumbs.addEventListener('click', async () => {
    await clearThumbCache();
    toast(editor.container, 'Thumbnail cache cleared');
  });
  return h('div', {}, h('div.section', {}, h('h3', {}, 'Map settings'), body),
    h('div.section', {}, h('h3', {}, 'Editor'), h('div.row', {}, clearThumbs)));
}
