import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { h } from './dom.ts';

/** Entity list grouped by class, with search; clicking selects and frames the entity. */
export function mountOutliner(editor: Editor): HTMLElement {
  const search = h('input', { placeholder: 'Find entity by class or name…', style: { width: '100%' } }) as HTMLInputElement;
  const list = h('div.outliner');
  const open = new Set<string>(['info_start_wars', 'control_point']);

  const focus = (e: MapEntity) => {
    editor.selection.set([], [e]);
    const b = editor.selection.bounds();
    if (!b.isEmpty()) editor.frameBox(b.expandByScalar(256));
  };

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const groups = new Map<string, MapEntity[]>();
    for (const e of editor.doc.entities) {
      const name = e.get('targetname') ?? '';
      if (q && !e.classname.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) continue;
      if (!groups.has(e.classname)) groups.set(e.classname, []);
      groups.get(e.classname)!.push(e);
    }
    const rows: HTMLElement[] = [];
    for (const [cls, ents] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      const expanded = open.has(cls) || (q !== '' && ents.length <= 30);
      rows.push(h('div.out-class', { onclick: () => { if (open.has(cls)) open.delete(cls); else open.add(cls); render(); } },
        h('span', {}, expanded ? '▾ ' : '▸ ', cls), h('span.muted', {}, String(ents.length))));
      if (!expanded) continue;
      for (const e of ents.slice(0, 200)) {
        const sel = editor.selection.entities.has(e);
        rows.push(h((sel ? 'div.out-ent.active' : 'div.out-ent') as 'div', { onclick: () => focus(e) },
          e.get('targetname') ?? `#${e.id}`, editor.hidden.has(e) ? h('span.muted', {}, ' (hidden)') : null));
      }
    }
    list.replaceChildren(...rows);
  };
  search.addEventListener('input', render);
  for (const ev of ['document', 'change', 'selection', 'hidden']) editor.on(ev, render);
  render();
  return h('div.section', {}, h('h3', {}, 'Entities'), search, list);
}
