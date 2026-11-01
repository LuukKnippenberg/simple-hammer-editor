import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { fgdClass, fgdClasses, type FgdClass } from '../assets/fgd.ts';
import { classChoices, classGroup, classHint } from '../edit/entityClasses.ts';
import { KEY_GROUPS, classChangePlan, differsFromDefault, effectiveKeys, keyGroup, mergeSelection, type KeyDef, type KeyGroup, type MergedKey } from '../edit/entityKeys.ts';
import { deleteSelection, duplicateSelection } from '../edit/actions.ts';
import { ioSection } from './ioEditor.ts';
import { classDot } from './classPicker.ts';
import { h, scrollIntoList } from './dom.ts';
import './entities.css';

/** Groups opened or closed by hand (by label), kept while the editor runs. */
const groupOpen = new Map<string, boolean>();
const OPEN_BY_DEFAULT = new Set<string>(['Model', 'Transform', 'Lambda Wars', 'Properties', 'Texture', 'Outputs']);
const isOpen = (label: string, byDefault = OPEN_BY_DEFAULT.has(label)) => groupOpen.get(label) ?? byDefault;
/** Short labels for keys whose FGD label is long. */
const LABELS: Record<string, string> = { origin: 'Origin', angles: 'Angles', model: 'Model' };

/** Extra groups other modules put at the top of the editor (the model field, a decal's texture). */
export interface SpecialGroup {
  label: KeyGroup | 'Texture' | 'Sound and effects';
  /** Keys the group edits itself; they are left out of the generic groups. */
  keys: string[];
  /** Shown next to a closed group. */
  summary: string;
  body: () => HTMLElement;
}
type SpecialProvider = (editor: Editor, ents: MapEntity[]) => SpecialGroup[];
const providers: SpecialProvider[] = [];
export function addSpecialGroups(p: SpecialProvider): void {
  providers.push(p);
}

const lookup = (cls: string) => fgdClass(cls);

/** Applies `fn` to the entities as one undo step. */
function edit(editor: Editor, label: string, ents: MapEntity[], fn: (e: MapEntity) => void): void {
  const end = editor.history.begin(label, [], ents);
  for (const e of ents) fn(e);
  end();
  editor.changed();
}

export function setKey(editor: Editor, ents: MapEntity[], key: string, value: string | null): void {
  edit(editor, `Edit ${key}`, ents, (e) => {
    if (value === null) { e.node.delete(key); e.version++; } else e.set(key, value);
  });
}

/** One key's input: a select for choices and booleans, three boxes for vectors, a colour well for colours. */
function keyInput(def: KeyDef | undefined, name: string, values: Map<string, number>, onSet: (v: string) => void): HTMLElement {
  const mixed = values.size > 1;
  const value = mixed ? '' : [...values.keys()][0] ?? '';
  const list = [...values.keys()];
  const placeholder = mixed ? `mixed · ${values.size} values` : '';
  const type = def?.type ?? '';
  const choices = def?.choices?.length && type !== 'flags' ? def.choices : type === 'boolean' ? [{ value: '0', label: 'No' }, { value: '1', label: 'Yes' }] : null;
  if (choices) {
    const sel = h(mixed ? 'select.mixed' : 'select', { 'aria-label': def?.label ?? name }, ...choices.map((c) => h('option', { value: c.value }, c.label))) as HTMLSelectElement;
    if (mixed) sel.prepend(h('option', { value: '', disabled: true }, `mixed · ${list.map((v) => choices.find((c) => c.value === v)?.label ?? v).join(', ')}`));
    else if (!choices.some((c) => c.value === value)) sel.append(h('option', { value }, value));
    sel.value = value;
    sel.addEventListener('change', () => { sel.blur(); onSet(sel.value); });
    return sel;
  }
  if (/^(origin|angle|vector)$/.test(type) || /^(origin|angles)$/i.test(name)) {
    const parts = (v: string) => { const p = v.trim().split(/\s+/); return [p[0] ?? '0', p[1] ?? '0', p[2] ?? '0']; };
    const per = list.map(parts);
    const labels = /angle/i.test(type) || /^angles$/i.test(name) ? ['Pitch', 'Yaw', 'Roll'] : ['x', 'y', 'z'];
    const boxes = [0, 1, 2].map((i) => {
      const vals = new Set(per.map((p) => p[i]));
      const inp = h(vals.size > 1 ? 'input.mixed' : 'input', { 'aria-label': `${def?.label ?? name} ${labels[i]}`, value: vals.size > 1 ? '' : [...vals][0] ?? '0', placeholder: vals.size > 1 ? `≠ ${labels[i].toLowerCase()}` : '' }) as HTMLInputElement;
      inp.addEventListener('change', () => {
        // Each entity keeps its own value in the other two boxes.
        const n = inp.value.trim();
        if (n === '' || isNaN(+n)) return;
        onSet(`\u0000${i}\u0000${n}`);
      });
      return inp;
    });
    return h('div.xyz', {}, ...boxes);
  }
  const inp = h(mixed ? 'input.mixed' : 'input', { value, placeholder, 'aria-label': def?.label ?? name, spellcheck: false }) as HTMLInputElement;
  if (/^target_(destination|source|name_or_class)$/.test(type)) inp.setAttribute('list', 'ent-names');
  inp.addEventListener('change', () => onSet(inp.value));
  if (type === 'color255' && !mixed) {
    const rgb = value.trim().split(/\s+/).slice(0, 3).map((x) => Math.max(0, Math.min(255, +x || 0)));
    const well = h('input', { type: 'color', value: '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join(''), title: 'Pick a colour' }) as HTMLInputElement;
    well.addEventListener('change', () => {
      const c = [1, 3, 5].map((i) => parseInt(well.value.slice(i, i + 2), 16));
      const rest = value.trim().split(/\s+/).slice(3);
      onSet([...c, ...rest].join(' '));
    });
    return h('div.xyz', {}, inp, well);
  }
  return inp;
}

/** Spawnflags as checkboxes; a flag set on only some entities shows as indeterminate. */
function flagsInput(def: KeyDef, values: Map<string, number>, onSet: (bit: number, on: boolean) => void): HTMLElement {
  const nums = [...values.keys()].map((v) => parseInt(v, 10) || 0);
  return h('div.flags', {}, ...(def.choices ?? []).map((c) => {
    const bit = parseInt(c.value, 10) || 0;
    const on = nums.filter((n) => n & bit).length;
    const box = h('input', { type: 'checkbox', checked: on === nums.length && on > 0 }) as HTMLInputElement;
    box.indeterminate = on > 0 && on < nums.length;
    box.addEventListener('change', () => onSet(bit, box.checked));
    return h('label.check', { title: `${bit}` }, box, ' ', c.label);
  }));
}

/** Sets one component of a vector key on each entity, or the whole value. */
function applyValue(editor: Editor, ents: MapEntity[], key: string, v: string): void {
  if (!v.startsWith('\u0000')) return setKey(editor, ents, key, v);
  const [, i, n] = v.split('\u0000');
  edit(editor, `Edit ${key}`, ents, (e) => {
    const def = fgdClass(e.classname)?.keys.find((k) => k.name.toLowerCase() === key.toLowerCase())?.default ?? '0 0 0';
    const p = (e.get(key) ?? def).trim().split(/\s+/);
    while (p.length < 3) p.push('0');
    p[+i] = n;
    e.set(key, p.join(' '));
  });
}

/** The value popover of a mixed key: each value with how many have it, and "use for all". */
function mixedPopover(anchor: HTMLElement, label: string, values: Map<string, number>, choose: (v: string) => void): void {
  document.querySelector('.popover')?.remove();
  const pop = h('div.popover', { role: 'dialog', 'aria-label': `${label} values` },
    h('div', {}, h('b', {}, label), h('span.muted', {}, ` · ${values.size} values`)),
    ...[...values].sort((a, b) => b[1] - a[1]).map(([v, n]) => h('div.pop-val', {},
      h('span', {}, v === '' ? '(empty)' : v),
      h('span.muted', {}, `${n} entit${n > 1 ? 'ies' : 'y'} · `, h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); pop.remove(); choose(v); } }, 'use for all')))),
    h('div.hint', {}, `Or type a value to set all ${[...values.values()].reduce((a, b) => a + b, 0)}.`));
  document.body.append(pop);
  // Beside the sidebar, over the viewport, level with the key.
  const r = anchor.getBoundingClientRect();
  const side = (anchor.closest('#sidebar') ?? anchor).getBoundingClientRect();
  pop.style.top = `${Math.max(8, r.top - 8)}px`;
  pop.style.left = `${Math.max(8, side.left - pop.offsetWidth - 8)}px`;
  const off = (e: PointerEvent) => { if (!pop.contains(e.target as Node)) { pop.remove(); window.removeEventListener('pointerdown', off, true); } };
  window.addEventListener('pointerdown', off, true);
}

/** A key row: label, input, a dot when it differs from the default (right-click resets), ≠ when values differ. */
function keyRow(editor: Editor, ents: MapEntity[], mk: MergedKey): HTMLElement {
  const def = mk.def;
  const label = LABELS[mk.name.toLowerCase()] ?? (def?.label && def.label !== def.name ? def.label : mk.name);
  if (def?.type === 'flags') {
    return h('div.row.flag-row', {}, flagsInput(def, mk.values, (bit, on) => edit(editor, `Edit ${mk.name}`, ents, (e) => {
      const n = parseInt(e.get(mk.name) ?? def.default ?? '0', 10) || 0;
      e.set(mk.name, String(on ? n | bit : n & ~bit));
    })));
  }
  const input = keyInput(def, mk.name, mk.values, (v) => applyValue(editor, ents, mk.name, v));
  const mixed = mk.values.size > 1;
  const changed = !!def && !mixed && ents.some((e) => e.get(mk.name) !== undefined) && differsFromDefault([...mk.values.keys()][0] ?? '', def.default);
  const row = h('div.row', { title: [def?.description, mk.name].filter(Boolean).join('\n') },
    changed ? h('span.chg', { title: 'Differs from the default · right-click to reset' }) : null,
    h('label', {}, label), input,
    mixed ? h('button.ne', { title: 'Mixed values: see them', onclick: (e: MouseEvent) => mixedPopover(e.currentTarget as HTMLElement, label, mk.values, (v) => applyValue(editor, ents, mk.name, v)) }, '≠') : null);
  row.addEventListener('contextmenu', (e) => {
    if (!def) return;
    e.preventDefault();
    setKey(editor, ents, mk.name, def.default === '' ? null : def.default);
  });
  return row;
}

/** A collapsible group header and body. */
function group(label: string, summary: string, body: () => (HTMLElement | null)[], forceOpen = false, extra?: HTMLElement, byDefault?: boolean): HTMLElement {
  const open = forceOpen || isOpen(label, byDefault);
  const wrap = h('div.kg');
  const head = h('div.kg-head', {
    role: 'button', tabindex: 0, 'aria-expanded': String(open),
    onclick: (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('a, button')) return;
      groupOpen.set(label, !open);
      wrap.replaceWith(group(label, summary, body, false, extra, byDefault));
    },
  }, h('span.tw', {}, open ? '▾' : '▸'), h('b', {}, label), summary || extra ? h('span.n', {}, summary, extra ?? '') : null);
  wrap.append(head);
  if (open) wrap.append(h('div.kg-body', {}, ...body().filter((x): x is HTMLElement => !!x)));
  return wrap;
}

/** Keys merged over the entities, in their groups, filtered by `q`. */
function keyGroups(editor: Editor, ents: MapEntity[], keys: MergedKey[], q: string, skip: Set<string>, warsClass: boolean, modelFirst = true): HTMLElement[] {
  const by = new Map<string, MergedKey[]>();
  for (const k of keys) {
    const n = k.name.toLowerCase();
    if (skip.has(n) || n === 'targetname') continue;
    if (q && !`${k.name} ${k.def?.label ?? ''}`.toLowerCase().includes(q)) continue;
    const g = keyGroup(k.def ?? k, warsClass, !!k.def);
    by.set(g, [...by.get(g) ?? [], k]);
  }
  const out: HTMLElement[] = [];
  // A class with its own model (control points, units) keeps the Model group further down, closed.
  const order = modelFirst ? KEY_GROUPS : [...KEY_GROUPS.filter((g) => g !== 'Model' && g !== 'Other keys'), 'Model', 'Other keys'] as const;
  for (const g of order) {
    const list = by.get(g);
    if (!list?.length && !(g === 'Other keys' && ents.length === 1 && !q)) continue;
    const rows = list ?? [];
    if (g === 'Transform') {
      rows.sort((a, b) => Number(b.name.toLowerCase() === 'origin') - Number(a.name.toLowerCase() === 'origin'));
      const origin = rows.find((k) => k.name.toLowerCase() === 'origin');
      out.push(group(g, '', () => rows.map((k) => origin === k && k.values.size > 1
        ? h('div.row', {}, h('label', {}, 'Origin'), h('span.mixed', {}, `${ents.length} positions · move with the gizmo`))
        : k.name.toLowerCase() === 'angles' && ents.length > 1
          ? h('div.row-wrap', {}, keyRow(editor, ents, k), h('button.icon', { title: 'Random yaw for each', 'aria-label': 'Randomize yaw', onclick: () => edit(editor, 'Randomize yaw', ents, (e) => {
            const p = (e.get('angles') ?? '0 0 0').split(/\s+/);
            e.set('angles', `${p[0] ?? 0} ${Math.floor(Math.random() * 360)} ${p[2] ?? 0}`);
          }) }, '🎲'))
          : keyRow(editor, ents, k)), !!q));
      continue;
    }
    if (g === 'Other keys' && ents.length === 1) {
      out.push(group(g, rows.length ? `${rows.length} key${rows.length > 1 ? 's' : ''} · ` : '', () => [...rows.map((k) => keyRow(editor, ents, k)), addKeyRow(editor, ents[0])], !!q, h('span', {}, '+ add')));
      continue;
    }
    const summary = g === 'Model' && !modelFirst ? rows.map((k) => LABELS[k.name.toLowerCase()] ?? k.def?.label ?? k.name).join(', ') : `${rows.length} key${rows.length > 1 ? 's' : ''}`;
    out.push(group(g, summary, () => rows.map((k) => keyRow(editor, ents, k)), !!q, undefined, g === 'Model' && !modelFirst ? false : undefined));
  }
  return out;
}

function addKeyRow(editor: Editor, e: MapEntity): HTMLElement {
  const newKey = h('input', { placeholder: 'key', 'aria-label': 'New key' }) as HTMLInputElement;
  const newVal = h('input', { placeholder: 'value', 'aria-label': 'New value' }) as HTMLInputElement;
  return h('div.row', {}, newKey, newVal, h('button', { onclick: () => newKey.value.trim() && setKey(editor, [e], newKey.value.trim(), newVal.value) }, '+'));
}

function nameDatalist(editor: Editor): HTMLElement {
  const names = [...new Set(editor.doc.entities.map((x) => x.get('targetname')).filter((x): x is string => !!x))].sort();
  return h('datalist', { id: 'ent-names' }, ...names.map((n) => h('option', { value: n })));
}

/** One entity: header card (name, class, id), grouped and filterable keys, outputs. */
export function entityEditor(editor: Editor, e: MapEntity, tail: SpecialGroup[] = []): HTMLElement {
  const cls = fgdClass(e.classname);
  const sameClass = editor.doc.entities.filter((x) => x.classname === e.classname);
  const name = h('input.ent-name-in', { value: e.get('targetname') ?? '', placeholder: 'unnamed · add a name', 'aria-label': 'Name', spellcheck: false }) as HTMLInputElement;
  name.addEventListener('change', () => setKey(editor, [e], 'targetname', name.value.trim() || null));
  const root = h('div.section.ent-editor');
  const head = h('div.ent-head', {},
    h('div.ent-head-row', {}, classDot(e.classname, 14), name),
    h('div.ent-head-row', {},
      h('button.cls-btn', { title: 'Change class', 'aria-haspopup': 'dialog', onclick: () => openChangeClass(editor, [e], root) }, e.classname, h('span.muted', {}, ' ▾')),
      h('span.muted.small', { style: { marginLeft: 'auto' } }, `id ${e.id}`)),
    classHint(cls, e.classname) ? h('p.hint', {}, classHint(cls, e.classname)) : null,
    h('div.row', {},
      h('button', { onclick: () => duplicateSelection(editor) }, 'Duplicate'),
      h('button', { onclick: () => deleteSelection(editor) }, 'Delete'),
      sameClass.length > 1 ? h('button', { style: { marginLeft: 'auto' }, title: `Select every ${e.classname}`, onclick: () => editor.selection.set([], sameClass) }, `Select all ${sameClass.length}`) : null));
  const filter = h('input.key-filter', { placeholder: 'Filter keys…', 'aria-label': 'Filter keys' }) as HTMLInputElement;
  const body = h('div');
  const specials = providers.flatMap((p) => p(editor, [e]));
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const keys = [...effectiveKeys(e.node.props, cls).values()].map((k) => ({ name: k.name, def: k.def, values: new Map([[k.value, 1]]) }));
    const skip = new Set(specials.flatMap((s) => s.keys.map((k) => k.toLowerCase())));
    const conns = e.node.children.find((c) => c.name.toLowerCase() === 'connections')?.props.length ?? 0;
    body.replaceChildren(
      ...specials.filter(() => !q).map((s) => group(s.label, s.summary, () => [s.body()])),
      ...keyGroups(editor, [e], keys, q, skip, classGroup(cls ?? { name: e.classname, type: 'PointClass' }).id === 'wars', !cls?.studio),
      q ? h('span') : group('Outputs', String(conns), () => [ioSection(editor, e)]),
      ...tail.filter(() => !q).map((s) => group(s.label, s.summary, () => [s.body()])),
      h('p.hint', {}, h('span.chg.inline'), ' differs from the FGD default · right-click a key to reset it'));
  };
  filter.addEventListener('input', render);
  render();
  root.append(nameDatalist(editor), head, filter, body);
  return root;
}

/** Several entities: class chips, the keys they share (mixed values marked ≠), and per-class groups. */
export function multiEntityEditor(editor: Editor, ents: MapEntity[]): HTMLElement {
  const counts = new Map<string, MapEntity[]>();
  for (const e of ents) counts.set(e.classname, [...counts.get(e.classname) ?? [], e]);
  const root = h('div.section.ent-editor');
  const head = h('div.ent-head', {},
    h('div.ent-title', {}, `${ents.length} entities`),
    h('div.chips', {}, ...[...counts].map(([c, list]) => h('button.cchip', {
      title: 'Click: keep only these · Shift-click: drop them',
      onclick: (ev: MouseEvent) => editor.selection.set([], ev.shiftKey ? ents.filter((e) => e.classname !== c) : list),
    }, classDot(c), c, h('b', {}, ` ×${list.length}`)))),
    counts.size > 1 ? h('p.hint', {}, 'Click a class to keep only those · Shift-click to drop them') : null,
    h('div.row', {},
      h('button', { onclick: () => duplicateSelection(editor) }, 'Duplicate'),
      h('button', { onclick: () => deleteSelection(editor) }, 'Delete'),
      h('button', { style: { marginLeft: 'auto' }, onclick: () => openChangeClass(editor, ents, root) }, 'Change class…')));
  const filter = h('input.key-filter', { placeholder: 'Filter keys…', 'aria-label': 'Filter keys' }) as HTMLInputElement;
  const body = h('div');
  const specials = providers.flatMap((p) => p(editor, ents));
  const merged = mergeSelection(ents.map((e) => ({ classname: e.classname, props: e.node.props })), lookup);
  const wars = ents.every((e) => classGroup(fgdClass(e.classname) ?? { name: e.classname, type: 'PointClass' }).id === 'wars');
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const skip = new Set(specials.flatMap((s) => s.keys.map((k) => k.toLowerCase())));
    body.replaceChildren(
      h('div.shared-head', {}, h('span', {}, `Shared by all ${ents.length}`), h('span.legend', {}, h('span.ne', {}, '≠'), ' mixed values')),
      ...specials.filter(() => !q).map((s) => group(s.label, s.summary, () => [s.body()])),
      ...keyGroups(editor, ents, merged.shared, q, skip, wars, ents.some((e) => !fgdClass(e.classname)?.studio)),
      ...merged.only.map((o) => {
        const these = ents.filter((e) => e.classname === o.classname);
        return group(`Only on ${o.classname} ×${o.count}`, '', () => keyGroups(editor, these, o.keys, q, skip, classGroup(fgdClass(o.classname) ?? { name: o.classname, type: '' }).id === 'wars'), !!q,
        h('a', { href: '#', onclick: (ev: Event) => { ev.preventDefault(); editor.selection.set([], these); } }, `Select those ${o.count}`));
      }),
      h('p.hint', {}, 'Outputs are edited one entity at a time.'));
  };
  filter.addEventListener('input', render);
  render();
  root.append(nameDatalist(editor), head, filter, body);
  return root;
}

/**
 * Change class: search the classes of the same kind (point or brush), same family first, with what
 * happens to the keys of the chosen class shown before anything changes. One undo step.
 */
export function openChangeClass(editor: Editor, ents: MapEntity[], host: HTMLElement): void {
  host.querySelector('.cc-dialog, .cc-dim')?.remove();
  const from = fgdClass(ents[0].classname) ?? { name: ents[0].classname, type: ents[0].solids.length ? 'SolidClass' : 'PointClass', description: '', keys: [], inputs: [], outputs: [] } as FgdClass;
  const search = h('input', { placeholder: 'Search classes…', 'aria-label': 'Search classes' }) as HTMLInputElement;
  const list = h('div.cc-list', { role: 'listbox' });
  const preview = h('div.cc-preview');
  const apply = h('button.primary', { disabled: true }) as HTMLButtonElement;
  let options: FgdClass[] = [];
  let hl = 0;
  const dim = h('div.cc-dim', { onclick: () => close() });
  const dialog = h('div.cc-dialog', { role: 'dialog', 'aria-label': 'Change class' });
  const close = () => { dim.remove(); dialog.remove(); };

  const plans = (to: FgdClass) => ents.map((e) => classChangePlan(e.node.props, fgdClass(e.classname), to));
  const chips = (names: string[], cls: string, max = 12) => h('div.chips', {}, ...names.slice(0, max).map((n) => h(`span.kchip${cls}` as 'span', {}, n)),
    names.length > max ? h(`span.kchip${cls}` as 'span', {}, `+${names.length - max}`) : null);
  const renderPreview = () => {
    const to = options[hl];
    apply.disabled = !to;
    if (!to) { preview.replaceChildren(); return; }
    const p = plans(to);
    const union = (f: (x: (typeof p)[number]) => string[]) => [...new Set(p.flatMap(f))];
    const keep = union((x) => x.keep), drop = union((x) => x.drop), add = union((x) => x.add.map((a) => a.name));
    const outputs = ents.reduce((n, e) => n + (e.node.children.find((c) => c.name.toLowerCase() === 'connections')?.props.length ?? 0), 0);
    const named = ents.length === 1 ? ents[0].get('targetname') : null;
    apply.textContent = `Change to ${to.name}`;
    preview.replaceChildren(
      h('div', {}, h('b', {}, `Keeps ${keep.length} key${keep.length === 1 ? '' : 's'}`)), chips(keep, ''),
      ...drop.length ? [h('div', {}, h('b', {}, `Drops ${drop.length}`), h('span.muted', {}, ` not in ${to.name}`)), chips(drop, '.drop')] : [],
      ...add.length ? [h('div', {}, h('b', {}, 'Adds with defaults')), chips(add, '.add', 6)] : [],
      h('div.muted', {}, `Outputs: ${outputs} kept.`, named ? h('span', {}, ' Inputs aimed at ', h('b', {}, named), ' keep working, the name is unchanged.') : null));
  };
  const render = () => {
    const { family, other } = classChoices(fgdClasses(), from, search.value);
    options = [...family, ...other].slice(0, 40);
    hl = Math.min(hl, Math.max(0, options.length - 1));
    const opt = (c: FgdClass) => {
      const i = options.indexOf(c);
      if (i < 0) return null;
      return h(i === hl ? 'div.combo-opt.hl' : 'div.combo-opt', { role: 'option', 'aria-selected': String(i === hl), onclick: () => { hl = i; render(); }, ondblclick: () => go() },
        classDot(c.name), h('span.combo-txt', {}, h('b', {}, c.name), i === hl ? h('span', {}, classHint(c)) : null));
    };
    const fam = family.map(opt).filter((x): x is HTMLDivElement => !!x);
    const oth = other.map(opt).filter((x): x is HTMLDivElement => !!x);
    list.replaceChildren(
      ...fam.length ? [h('div.combo-sec', {}, `Same family · ${classGroup(from).label}`), ...fam] : [],
      ...oth.length ? [h('div.combo-sec.line', {}, 'Other classes'), ...oth] : [],
      ...options.length ? [] : [h('div.hint', {}, 'No class matches.')]);
    scrollIntoList(list.querySelector('.hl'), list);
    renderPreview();
  };
  const go = () => {
    const to = options[hl];
    if (!to) return;
    const end = editor.history.begin(`Change class to ${to.name}`, [], ents);
    for (const e of ents) {
      const p = classChangePlan(e.node.props, fgdClass(e.classname), to);
      e.set('classname', to.name);
      for (const k of p.drop) e.node.delete(k);
      for (const a of p.add) e.node.set(a.name, a.value);
      e.reload();
    }
    end();
    close();
    editor.changed();
  };
  apply.addEventListener('click', go);
  search.addEventListener('input', () => { hl = 0; render(); });
  search.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { hl = Math.max(0, Math.min(options.length - 1, hl + (ev.key === 'ArrowDown' ? 1 : -1))); render(); }
    else if (ev.key === 'Enter') go();
    else if (ev.key === 'Escape') close();
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  });
  dialog.append(
    h('b', {}, ents.length > 1 ? `Change class of ${ents.length} entities` : 'Change class'),
    search, list, preview,
    h('div.cc-foot', {}, h('span.muted.small', { style: { flex: '1' } }, 'Ctrl+Z undoes it'), h('button', { onclick: close }, 'Cancel'), apply));
  host.append(dim, dialog);
  render();
  search.focus();
}
