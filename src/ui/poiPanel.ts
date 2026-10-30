import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import type { KitParam, ParamValue } from '../lw/kits.ts';
import type { PoiTool } from '../edit/poiTool.ts';
import { POI_TYPES, poiOf, poiParams } from '../gen/poi/registry.ts';
import { deletePoi, poiOwner, poisFromBlocks, regeneratePoi } from '../gen/poi/action.ts';
import { LANDSCAPES, type Landscape, type PoiType, type Rotation } from '../gen/poi/types.ts';
import { h, toast } from './dom.ts';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

function paramRow(p: KitParam, value: ParamValue, set: (v: ParamValue) => void): HTMLElement {
  let input: HTMLInputElement | HTMLSelectElement;
  if (p.type === 'select') {
    input = h('select', {}, ...(p.options ?? []).map((o) => h('option', { value: o.value }, o.label))) as HTMLSelectElement;
    input.value = String(value);
    input.addEventListener('change', () => { set((input as HTMLSelectElement).value); input.blur(); });
  } else if (p.type === 'check') {
    input = h('input', { type: 'checkbox', checked: value === true || value === '1' }) as HTMLInputElement;
    input.addEventListener('change', () => set((input as HTMLInputElement).checked));
  } else {
    input = h('input', { type: p.type === 'number' ? 'number' : 'text', value: String(value) }) as HTMLInputElement;
    input.addEventListener('change', () => { set(p.type === 'number' ? parseFloat((input as HTMLInputElement).value) || 0 : (input as HTMLInputElement).value); input.blur(); });
  }
  return h('div.row', { title: p.hint ?? '' }, h('label', {}, p.label), input);
}

function rotationRow(value: Rotation, set: (r: Rotation) => void): HTMLElement {
  return h('div.row', { title: 'Turns the layout; the arrow in the preview points to the POI\'s back' }, h('label', {}, 'Rotation'),
    h('div.seg', {}, ...ROTATIONS.map((r) => {
      const b = h('button', { onclick: () => set(r) }, `${r}°`);
      b.classList.toggle('active', r === value);
      return b;
    })));
}

/** The settings of an existing POI: changes rebuild it in place (one undo step each). */
export function poiEditor(editor: Editor, detail: MapEntity): HTMLElement | null {
  const p = poiOf(detail);
  if (!p) return null;
  const { spec, type } = p;
  const apply = (patch: Parameters<typeof regeneratePoi>[2], label = `Edit ${type.label.toLowerCase()}`) => {
    regeneratePoi(editor, detail, patch, label);
    editor.emit('poi');
  };
  const seed = h('input', { type: 'number', value: String(spec.seed), title: 'The same seed and settings give the same layout' }) as HTMLInputElement;
  seed.addEventListener('change', () => apply({ seed: Number(seed.value) || 1 }));
  const r = spec.rect;
  return h('div.section', {}, h('h3', {}, `${type.icon} ${type.label}`),
    h('p.hint', {}, `${r.x1 - r.x0} × ${r.y1 - r.y0} units, seed ${spec.seed}. ${type.hint}`),
    ...poiParams(type).map((q) => paramRow(q, spec.params[q.key] ?? q.default, (v) => apply({ params: { [q.key]: v } }))),
    rotationRow(spec.rotation, (rot) => apply({ rotation: rot })),
    h('div.row', {}, h('label', {}, 'Seed'), seed,
      h('button', { title: 'Re-roll: same settings, new layout', onclick: () => apply({ seed: Math.floor(Math.random() * 100000) }, `Re-roll ${type.label.toLowerCase()}`) }, '🎲')),
    h('div.row', {},
      h('button.primary', { title: 'Rebuild from the stored settings (after moving it, or after terrain changes)', onclick: () => apply({}, `Regenerate ${type.label.toLowerCase()}`) }, 'Regenerate'),
      h('button', { onclick: () => apply({ seed: Math.floor(Math.random() * 100000) }, `Re-roll ${type.label.toLowerCase()}`) }, 'Re-roll'),
      h('button', { onclick: () => { deletePoi(editor, detail); editor.emit('poi'); } }, 'Delete')));
}

/** The POI selected (directly, or through one of its brushes or entities). */
export function selectedPoi(editor: Editor): MapEntity | null {
  const sel = editor.selection;
  const ents = [...sel.entities];
  const owners = new Set([...sel.solids].map((s) => s.entity).filter((e): e is MapEntity => !!e));
  const pick = ents.length === 1 ? ents[0] : !ents.length && owners.size === 1 ? [...owners][0] : null;
  return poiOwner(editor, pick);
}

/** The POI tab: type picker by landscape, settings for the next POI, and the selected POI's settings. */
export function mountPoiPanel(editor: Editor, showTab: () => void): HTMLElement {
  const panel = h('div');
  const tool = () => editor.tools.tools.poi as PoiTool;
  const render = () => {
    const t = tool();
    const current = t.type;
    const groups = LANDSCAPES.map((l) => ({ l, types: POI_TYPES.filter((p) => p.landscapes[0] === l.id) })).filter((g) => g.types.length);
    const pickType = (p: PoiType, l: Landscape) => {
      t.typeId = p.id;
      t.landscape = l;
      editor.tools.set('poi');
      editor.emit('toolchange');
      render();
    };
    const sections: HTMLElement[] = [h('div.section', {}, h('h3', {}, 'Points of interest'),
      h('p.hint', {}, 'Pick a type, then drag a rectangle on the ground with the POI tool (P). A click places one at its default size. Select a POI to change it.'))];
    const sel = selectedPoi(editor);
    const ed = sel ? poiEditor(editor, sel) : null;
    if (ed) sections.push(ed);
    for (const g of groups) {
      sections.push(h('div.section', {}, h('h3', {}, g.l.label),
        h('div.kits', {}, ...g.types.map((p) => h((p.id === current?.id ? 'button.kit.active' : 'button.kit') as 'button', { title: p.hint, onclick: () => pickType(p, g.l.id) }, h('span.icon', {}, p.icon), p.label)))));
    }
    if (current) {
      const values = t.paramsFor(current);
      const seed = h('input', { type: 'number', value: String(t.seed) }) as HTMLInputElement;
      seed.addEventListener('change', () => { t.seed = Number(seed.value) || 1; seed.blur(); });
      const blocks = [...editor.selection.solids].filter((s) => !s.entity && !s.isDisplacement);
      sections.push(h('div.section', {}, h('h3', {}, `New ${current.label.toLowerCase()}`),
        h('p.hint', {}, `${current.hint} Size ${current.minSize.join('×')} to ${current.maxSize.join('×')}.`),
        ...poiParams(current).map((q) => paramRow(q, values[q.key] ?? q.default, (v) => { values[q.key] = v; })),
        rotationRow(t.rotation, (r) => { t.rotation = r; render(); }),
        h('div.row', {}, h('label', {}, 'Seed'), seed, h('button', { title: 'New layout', onclick: () => { t.seed = Math.floor(Math.random() * 100000); render(); } }, '🎲')),
        h('div.row', {},
          h('button.primary', { onclick: () => { editor.tools.set('poi'); editor.emit('toolchange'); } }, 'Draw in viewport (P)'),
          h('button', {
            disabled: !blocks.length, title: 'Replace the selected block brush(es) with this POI',
            onclick: () => {
              const made = poisFromBlocks(editor, current, blocks, { rotation: t.rotation, seed: t.seed, landscape: t.landscape ?? current.landscapes[0], params: values });
              toast(editor.container, made.length ? `Generated ${made.length} ${current.label.toLowerCase()}${made.length > 1 ? 's' : ''}` : 'Select a block brush first');
              render();
            },
          }, 'Fill selected block'))));
    }
    panel.replaceChildren(...sections);
  };
  for (const ev of ['selection', 'poi', 'document']) editor.on(ev, render);
  editor.on('toolchange', () => {
    if (editor.tools.current.name === 'poi') showTab();
    render();
  });
  render();
  return panel;
}
