import type { Editor } from '../editor.ts';
import { fgdClass } from '../assets/fgd.ts';
import type { EntityTool } from '../edit/entityTool.ts';
import { expandName } from '../edit/entityKeys.ts';
import { classCombo } from './classPicker.ts';
import { h } from './dom.ts';

/** Entity tool options: the class to place (searchable) and what each placed entity gets. */
export function entityToolOptions(editor: Editor, render: () => void, modelField?: () => HTMLElement): HTMLElement[] {
  const tool = editor.tools.tools.entity as EntityTool;
  const cls = editor.entityClass;
  const def = fgdClass(cls);
  const opts = tool.optionsFor(cls);
  const rows: HTMLElement[] = [
    h('div.row', {}, h('label', {}, 'Class'), classCombo({ value: cls, onPick: (c) => tool.setClass(c) })),
    h('div.sub-head', {}, 'Place with'),
  ];
  const keyDef = (name: string) => def?.keys.find((k) => k.name.toLowerCase() === name);
  const setKey = (name: string, value: string) => { opts.keys[name] = value; };

  const owner = keyDef('ownernumber');
  if (owner?.choices?.length) {
    const sel = h('select', { 'aria-label': 'Owner' }, ...owner.choices.map((c) => h('option', { value: c.value }, c.label))) as HTMLSelectElement;
    sel.value = opts.keys.ownernumber ?? owner.default;
    sel.addEventListener('change', () => { setKey('ownernumber', sel.value); sel.blur(); });
    rows.push(h('div.row', {}, h('label', {}, 'Owner'), sel));
  }
  if (keyDef('targetname') || cls === 'control_point') {
    const used = new Set(editor.doc.entities.map((x) => x.get('targetname')).filter((x): x is string => !!x));
    const preview = () => {
      if (!opts.name.includes('#')) return opts.name ? 'same name' : 'unnamed';
      const a = expandName(opts.name, used);
      return `${a}, ${expandName(opts.name, new Set([...used, a]))}…`;
    };
    const next = h('span.unit', {}, preview());
    const name = h('input', { value: opts.name, placeholder: 'unnamed', title: '# becomes the first free number', 'aria-label': 'Name pattern' }) as HTMLInputElement;
    name.addEventListener('input', () => { opts.name = name.value.trim(); next.textContent = preview(); });
    name.addEventListener('change', () => name.blur());
    rows.push(h('div.row', {}, h('label', {}, 'Name'), name, next));
  }
  if (cls === 'control_point') {
    const k = keyDef('capturetime');
    const time = h('input', { value: opts.keys.CaptureTime ?? k?.default ?? '15', 'aria-label': 'Capture time' }) as HTMLInputElement;
    time.addEventListener('change', () => { setKey('CaptureTime', time.value.trim()); time.blur(); });
    const area = h('input', { type: 'checkbox', checked: tool.captureArea }) as HTMLInputElement;
    area.addEventListener('change', () => { tool.captureArea = area.checked; area.blur(); });
    rows.push(
      h('div.row', {}, h('label', {}, 'Capture'), time, h('span.unit', {}, 's')),
      h('label.check', {}, area, ' Add capture area (trigger_capture_area)'));
  }
  if (cls.startsWith('prop_')) {
    if (modelField) rows.push(modelField());
    else {
      const model = h('input', { value: editor.entityModel, 'aria-label': 'Model' }) as HTMLInputElement;
      model.addEventListener('change', () => { editor.entityModel = model.value.trim(); model.blur(); render(); });
      rows.push(h('div.row', {}, h('label', {}, 'Model'), model));
    }
  }
  return rows;
}
