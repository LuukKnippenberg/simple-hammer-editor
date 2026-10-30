import { Box3, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { fgdClass } from '../assets/fgd.ts';
import { applyMaterial, deleteSelection, duplicateSelection } from '../edit/actions.ts';
import { remapSolid } from '../edit/brushes.ts';
import type { MapEntity } from '../vmf/map.ts';
import { h, toast } from './dom.ts';
import { buildingsFromSelection } from '../gen/buildingAction.ts';
import { FACADE_STYLES, type FacadeStyle } from '../gen/buildings.ts';

/** Properties of the selection: entity keyvalues (typed from the FGD) or brush size and materials. */
export function mountInspector(editor: Editor): HTMLElement {
  const panel = h('div');
  const render = () => {
    const sel = editor.selection;
    panel.replaceChildren();
    if (sel.isEmpty) {
      panel.append(
        h('div.section', {}, h('h3', {}, 'Selection'),
          h('p.hint', {}, 'Click a brush or entity to select it. Shift-click adds to the selection.'),
          h('p.hint', {}, 'Tools: 1 select · 2 block · 3 paint · 4 entity. M move · R resize · F focus · Ctrl+D duplicate · Del delete · [ ] grid.')),
      );
      return;
    }
    const solids = sel.allSolids();
    const ents = [...sel.entities];
    const summary = [solids.length && `${solids.length} brush${solids.length > 1 ? 'es' : ''}`, ents.length && `${ents.length} entit${ents.length > 1 ? 'ies' : 'y'}`].filter(Boolean).join(', ');
    panel.append(h('div.section', {}, h('h3', {}, 'Selection'), h('div', {}, summary),
      h('div.row', { style: { marginTop: '6px' } },
        h('button', { onclick: () => duplicateSelection(editor) }, 'Duplicate'),
        h('button', { onclick: () => deleteSelection(editor) }, 'Delete'))));

    // A brush picked out of a brush entity (func_detail, triggers, ...): offer the whole entity.
    const owners = new Set([...sel.solids].map((s) => s.entity).filter((e): e is MapEntity => !!e && !sel.entities.has(e)));
    for (const owner of owners) {
      panel.append(h('div.section', {}, h('div.hint', {}, `Part of ${owner.classname} (${owner.solids.length} brushes)`),
        h('button', { onclick: () => sel.set([], [owner]) }, `Select whole ${owner.classname}`)));
    }
    if (ents.length === 1) panel.append(entityEditor(editor, ents[0]));
    if (solids.length) panel.append(brushEditor(editor));
    if ([...sel.solids].some((s) => !s.entity)) panel.append(buildingPanel(editor));
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

/** Turns the selected block brushes into buildings. */
function buildingPanel(editor: Editor): HTMLElement {
  const minF = h('input', { type: 'number', value: '2', min: '1', max: '12' }) as HTMLInputElement;
  const maxF = h('input', { type: 'number', value: '5', min: '1', max: '12' }) as HTMLInputElement;
  const style = h('select', {}, h('option', { value: '' }, 'Mixed'), ...Object.keys(FACADE_STYLES).map((k) => h('option', { value: k }, k))) as HTMLSelectElement;
  const alleys = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const props = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const go = () => {
    const lo = Math.max(1, parseInt(minF.value, 10) || 2);
    const n = buildingsFromSelection(editor, {
      minFloors: lo, maxFloors: Math.max(lo, parseInt(maxF.value, 10) || lo),
      alleys: alleys.checked, roofProps: props.checked, style: (style.value || undefined) as FacadeStyle | undefined,
    });
    toast(editor.container, n ? `Generated ${n} building${n > 1 ? 's' : ''}` : 'Selection is too small for a building (min 128×128)');
  };
  return h('div.section', {},
    h('h3', {}, 'Generate buildings'),
    h('p.hint', {}, 'Replaces the selected block(s) with a block of connected buildings on a 128-unit grid.'),
    h('div.row', {}, h('label', {}, 'Floors'), minF, h('span.muted', {}, 'to'), maxF),
    h('div.row', {}, h('label', {}, 'Facade'), style),
    h('div.row', {}, h('label', {}, 'Alleys'), alleys, h('span.hint', {}, 'with sky bridges')),
    h('div.row', {}, h('label', {}, 'Roof props'), props),
    h('button.primary', { onclick: go }, '🏢 Generate buildings'));
}
