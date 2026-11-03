import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { fgdClass } from '../assets/fgd.ts';
import { loadModelIndex, modelEntry, modelName } from '../assets/modelIndex.ts';
import { loadModel } from '../assets/mdl.ts';
import { convertToDynamic, staticPropProblem } from '../edit/preflight.ts';
import type { EntityTool } from '../edit/entityTool.ts';
import { dropTarget, swapModel } from '../edit/assetDrop.ts';
import { modelThumbnail } from '../render/modelViews.ts';
import { edit, keyRow, type SpecialGroup } from './entityEditor.ts';
import { modelsInMap, openModelPicker } from './modelPicker.ts';
import { recentModels } from './recent.ts';
import { h } from './dom.ts';
import './pickers.css';

void loadModelIndex();

const norm = (p: string) => p.toLowerCase().replace(/\\/g, '/');

function thumb(editor: Editor, path: string, cls = 'div.mf-thumb'): HTMLElement {
  const img = h('img', { alt: '' }) as HTMLImageElement;
  if (path) void modelThumbnail(editor, path).then((u) => u && (img.src = u));
  return h(cls as 'div', {}, img);
}

/** `models/props_c17/` + bold `oildrum001` + `.mdl`. */
function pathLabel(path: string): HTMLElement {
  if (!path) return h('div.mf-path.muted', {}, 'no model');
  const name = modelName(path);
  const i = path.toLowerCase().lastIndexOf(name.toLowerCase());
  return h('div.mf-path', { title: path }, path.slice(0, i), h('b', {}, path.slice(i, i + name.length)), path.slice(i + name.length));
}

/** A model's skin count, from the index or (for models outside it) the model itself. */
async function skinCount(path: string): Promise<number> {
  await loadModelIndex();
  return modelEntry(path)?.skins ?? (await loadModel(path))?.skins.length ?? 1;
}

const PROBLEM: Record<string, string> = {
  physics: 'Physics-only model: vbsp deletes it as prop_static.',
  notstatic: 'Not compiled with $staticprop: vbsp deletes it as prop_static.',
  moved: 'Moved after it was compiled: vbsp can’t find its .vvd and stops.',
  missing: 'Not found in the game files.',
};

/** ✓ or ⚠ on whether the prop_static entities' models survive vbsp, with the fixes. */
function staticStatus(editor: Editor, ents: MapEntity[], pick: () => void): HTMLElement {
  const out = h('div');
  void Promise.all(ents.map((e) => staticPropProblem(e.get('model') ?? ''))).then((problems) => {
    const bad = ents.filter((_, i) => problems[i]);
    if (!bad.length) {
      out.replaceChildren(h('div.mf-ok', {}, '✓ Works as prop_static: built with $staticprop, no physics data'));
      return;
    }
    const kind = problems.find((p) => p)!;
    const text = ents.length > 1 ? `${bad.length} of ${ents.length}: ${PROBLEM[kind]}` : PROBLEM[kind];
    out.replaceChildren(h('div.mf-warn', {}, `⚠ ${text}`, h('div.row', {},
      kind !== 'missing' ? h('button.primary', { onclick: () => convertToDynamic(editor, bad) }, bad.length > 1 ? `Make ${bad.length} prop_dynamic` : 'Make prop_dynamic') : null,
      h('button', { onclick: pick }, 'Pick another model…'))));
  });
  return out;
}

/** Recent ▾: the recent models, a click sets one. */
function recentMenu(editor: Editor, current: string, set: (path: string) => void): HTMLElement {
  const wrap = h('span', { style: { position: 'relative' } });
  const btn = h('button', { 'aria-label': 'Recent models', 'aria-haspopup': 'menu' }, 'Recent ▾');
  btn.addEventListener('click', () => {
    const open = wrap.querySelector('.menu');
    if (open) return open.remove();
    const items = recentModels.items.filter((m) => norm(m) !== norm(current));
    const menu = h('div.menu', { role: 'menu' }, ...items.length ? items.map((m) => {
      const img = h('img', { alt: '' }) as HTMLImageElement;
      void modelThumbnail(editor, m, 0, 56).then((u) => u && (img.src = u));
      return h('div.menu-item', { role: 'menuitem', title: m, onclick: () => { menu.remove(); set(m); } }, img, modelName(m));
    }) : [h('div.hint', { style: { padding: '4px 6px' } }, 'Models you pick show up here.')]);
    wrap.append(menu);
    const off = (e: PointerEvent) => { if (!wrap.contains(e.target as Node)) { menu.remove(); window.removeEventListener('pointerdown', off, true); } };
    window.addEventListener('pointerdown', off, true);
  });
  wrap.append(btn);
  return wrap;
}

/** Classes whose model is chosen per entity (props), not fixed by the class. */
function pickedModel(e: MapEntity): boolean {
  const c = fgdClass(e.classname);
  return !!c && !c.studio && c.keys.some((k) => k.name.toLowerCase() === 'model' && k.type === 'studio');
}

/** The Model group at the top of the entity editor for props: thumbnail, Change…, recent models, skins. */
export function modelGroups(editor: Editor, ents: MapEntity[]): SpecialGroup[] {
  if (!ents.length || !ents.every(pickedModel)) return [];
  const statics = ents.filter((e) => e.classname === 'prop_static');
  const counts = new Map<string, number>();
  for (const e of ents) counts.set(norm(e.get('model') ?? ''), (counts.get(norm(e.get('model') ?? '')) ?? 0) + 1);
  const setModel = (path: string, skin?: number) => edit(editor, 'Set model', ents, (e) => {
    e.set('model', path);
    if (skin !== undefined) e.set('skin', String(skin));
  });
  const classes = [...new Set(ents.map((e) => e.classname))];
  const pick = () => void openModelPicker(editor, {
    current: ents[0].get('model'),
    subtitle: `for ${ents.length > 1 ? `${ents.length} × ` : ''}${classes.join(' + ')}`,
    staticOnly: statics.length > 0,
    useLabel: ents.length > 1 ? `Use for ${ents.length} props` : 'Use model',
    onPick: (p, skin) => setModel(p, skin),
  });
  const skinDef = fgdClass(ents[0].classname)?.keys.find((k) => k.name.toLowerCase() === 'skin');
  const skinValues = new Map<string, number>();
  for (const e of ents) { const v = e.get('skin') ?? skinDef?.default ?? '0'; skinValues.set(v, (skinValues.get(v) ?? 0) + 1); }

  // A model dragged from the asset dock onto the group sets it like Change… does.
  const target = <T extends HTMLElement>(el: T) => dropTarget(el, 'model',
    (d) => `set the model of ${ents.length > 1 ? `${ents.length} props` : `this ${ents[0].classname}`}${d.unsafe && statics.length ? ' · becomes prop_dynamic' : ''}`,
    (id) => void swapModel(editor, ents, id));
  const body = (): HTMLElement => {
    if (counts.size === 1) {
      const path = ents[0].get('model') ?? '';
      const skins = h('div.seg-n');
      void skinCount(path).then((n) => {
        if (n < 2) { skins.closest('.row')?.remove(); return; }
        const cur = skinValues.size === 1 ? [...skinValues.keys()][0] : '';
        skins.replaceChildren(...Array.from({ length: Math.min(n, 24) }, (_, s) =>
          h(String(s) === cur ? 'button.active' : 'button', { onclick: () => edit(editor, 'Set skin', ents, (e) => e.set('skin', String(s))) }, String(s))));
      });
      return h('div', {},
        target(h('div.mf', {}, thumb(editor, path), h('div', { style: { flex: '1', minWidth: '0' } }, pathLabel(path),
          h('div.mf-buttons', {}, h('button.primary', { onclick: pick }, ents.length > 1 ? 'Set for all…' : 'Change…'),
            recentMenu(editor, path, (p) => { recentModels.push(p); setModel(p, 0); }))))),
        statics.length ? staticStatus(editor, statics, pick) : null,
        h('div.row', {}, h('label', {}, 'Skin'), skins));
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]);
    return h('div', {},
      target(h('div.mf-multi', {},
        h('div.mf-stack', {}, ...top.slice(0, 3).map(([p]) => thumb(editor, p))),
        h('span', {}, h('span.mixed', {}, `${counts.size} models`), h('span.mf-sub', {}, top.map(([p, n]) => `${modelName(p) || 'none'} ×${n}`).join(' · '))),
        h('button', { onclick: pick }, 'Set for all…'))),
      statics.length ? staticStatus(editor, statics, pick) : null,
      keyRow(editor, ents, { name: skinDef?.name ?? 'skin', def: skinDef, values: skinValues }));
  };
  const summary = counts.size === 1 ? modelName([...counts.keys()][0]) : `${counts.size} models`;
  return [{ label: 'Model', keys: ['model', 'skin'], summary, body }];
}

/** The Entity tool's model, for prop classes: thumbnail, name, size and Change…. */
export function toolModelField(editor: Editor): HTMLElement {
  const cls = editor.entityClass;
  const tool = editor.tools.tools.entity as EntityTool;
  const path = editor.entityModel;
  const entry = modelEntry(path);
  const pick = () => void openModelPicker(editor, {
    current: path, subtitle: `for the Entity tool · ${cls}`, staticOnly: cls === 'prop_static', useLabel: 'Use model',
    onPick: (p, skin) => {
      editor.entityModel = p;
      const keys = tool.optionsFor(cls).keys;
      if (skin) keys.skin = String(skin);
      else delete keys.skin;
      editor.emit('entityclass');
    },
  });
  const status = h('div');
  if (cls === 'prop_static') {
    void staticPropProblem(path).then((p) => status.replaceChildren(p
      ? h('div.mf-warn', {}, `⚠ ${PROBLEM[p]}`, h('div.row', {}, h('button', { onclick: pick }, 'Pick another model…'),
        p !== 'missing' ? h('button', { onclick: () => tool.setClass('prop_dynamic') }, 'Place as prop_dynamic') : null))
      : h('div.mf-ok', {}, '✓ Works as prop_static')));
  }
  const used = modelsInMap(editor).get(norm(path));
  const useModel = (p: string) => { editor.entityModel = p; recentModels.push(p); editor.emit('entityclass'); };
  return h('div', {},
    dropTarget(h('div.mf', {}, thumb(editor, path, 'div.mf-thumb.small'),
      h('div', { style: { flex: '1', minWidth: '0' } },
        h('div', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: path }, modelName(path) || 'no model'),
        h('div.mf-sub', {}, [entry ? `${entry.size.join(' × ')} u` : '', used ? `in map ×${used}` : ''].filter(Boolean).join(' · '))),
      h('button.primary', { onclick: pick, style: { alignSelf: 'center' } }, 'Change…')), 'model', 'use for the Entity tool', useModel),
    status);
}
