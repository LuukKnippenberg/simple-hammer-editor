import type { Editor } from '../editor.ts';
import { fgdClass, fgdClasses, type FgdClass } from '../assets/fgd.ts';
import { CLASS_GROUPS, FEATURED, classGroup, classHint, classLabel, isPointClass, searchClasses } from '../edit/entityClasses.ts';
import { tieToEntity } from '../edit/actions.ts';
import { classChip, classDot } from './classPicker.ts';
import { recentClasses } from './recent.ts';
import { h, toast } from './dom.ts';

/** Groups opened by hand, kept while the editor runs. */
const open = new Set(['wars', 'props']);

/** Picks the class the Entity tool places: search, the class being placed, recent classes and every FGD class by group. */
export function mountEntityPalette(editor: Editor, useTool: () => void): HTMLElement {
  const search = h('input', { placeholder: 'Search all entity classes…', 'aria-label': 'Search entity classes', style: { width: '100%' } }) as HTMLInputElement;
  const placing = h('div.placing');
  const recent = h('div');
  const groups = h('div');

  const choose = (c: FgdClass | string) => {
    const cls = typeof c === 'string' ? fgdClass(c) ?? { name: c, type: 'PointClass', description: '' } : c;
    if (!isPointClass(cls)) {
      // Brush entities are made from brushes: tie the selected ones.
      const brushes = [...editor.selection.solids].filter((s) => !s.entity);
      if (!brushes.length) return toast(editor.container, `${cls.name} is a brush entity: select brushes first, then pick it`);
      tieToEntity(editor, cls.name);
      return toast(editor.container, `Tied ${brushes.length} brush${brushes.length > 1 ? 'es' : ''} to ${cls.name}`);
    }
    editor.entityClass = cls.name;
    recentClasses.push(cls.name);
    useTool();
    editor.emit('entityclass');
  };
  const item = (cls: string, label = classLabel(cls), hint = '') =>
    h(editor.entityClass === cls ? 'div.ent-item.active' : 'div.ent-item', { onclick: () => choose(cls), title: classHint(fgdClass(cls), cls) },
      classDot(cls), h('span.ent-name', {}, label === cls ? h('b', {}, cls) : h('span', {}, h('b', {}, label), h('span.muted', {}, ` ${cls}`))),
      hint ? h('div.hint', {}, hint) : null);

  const render = () => {
    const cls = fgdClass(editor.entityClass);
    placing.replaceChildren(
      h('h3', {}, 'Placing'),
      h('div.placing-name', {}, classDot(editor.entityClass, 14), h('b', {}, classLabel(editor.entityClass)),
        classLabel(editor.entityClass) !== editor.entityClass ? h('span.muted', {}, editor.entityClass) : null),
      h('p.hint', {}, classHint(cls, editor.entityClass) || 'Click a surface with the Entity tool (4) to place it.'));
    recent.replaceChildren(...recentClasses.items.length ? [h('h3', {}, 'Recent'),
      h('div.chips', {}, ...recentClasses.items.map((r) => classChip(r, () => choose(r), r === editor.entityClass)))] : []);

    const q = search.value.trim();
    const all = fgdClasses();
    if (q) {
      const found = searchClasses(all, q, 60);
      groups.replaceChildren(h('h3', {}, `${found.length} match${found.length === 1 ? '' : 'es'}`),
        ...found.map((c) => item(c.name, classLabel(c.name), `${classGroup(c).label} · ${classHint(c)}`)));
      return;
    }
    const byGroup = new Map<string, FgdClass[]>();
    for (const c of all) {
      const g = classGroup(c).id;
      byGroup.set(g, [...byGroup.get(g) ?? [], c]);
    }
    const featured = new Set(FEATURED.map((f) => f.cls));
    const section = (id: string, label: string, color: string, pattern: string, items: HTMLElement[]) => {
      const isOpen = open.has(id);
      const head = h('div.gh', { onclick: () => { if (isOpen) open.delete(id); else open.add(id); render(); } },
        h('span.tw', {}, isOpen ? '▾' : '▸'), h('span.dot', { style: { background: color } }), h('b', {}, label),
        h('span.n', {}, isOpen ? String(items.length) : pattern));
      return h('div', {}, head, isOpen ? h('div.gbody', {}, ...items) : null);
    };
    groups.replaceChildren(
      ...CLASS_GROUPS.map((g) => {
        const list = (byGroup.get(g.id) ?? []).sort((a, b) => Number(featured.has(b.name)) - Number(featured.has(a.name)) || a.name.localeCompare(b.name));
        if (!list.length) return null;
        return section(g.id, g.label, g.color, g.pattern, list.map((c) => item(c.name)));
      }).filter((x): x is HTMLDivElement => !!x),
      section('az', 'All classes A–Z', '#646b74', 'from the FGD', all.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => item(c.name))),
    );
  };
  search.addEventListener('input', render);
  editor.on('entityclass', render);
  editor.on('fgd', render);
  render();
  return h('div.ent-palette', {}, search, placing, recent, groups);
}
