import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { entitiesByName, getConnections, resolveTarget, validateConnections } from '../vmf/io.ts';
import { entityStyle } from '../render/entityRenderer.ts';
import { h } from './dom.ts';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

interface Edge { from: MapEntity; to: MapEntity; label: string }

/** Layered graph of all entity I/O plus a list of broken connections. */
export function mountLogicPanel(editor: Editor): { panel: HTMLElement; openGraph(): void } {
  const problemsEl = h('div');
  const summary = h('p.hint');
  const panel = h('div', {},
    h('div.section', {}, h('h3', {}, 'Map logic'), summary,
      h('button.primary', { onclick: () => openGraph() }, 'Open logic graph')),
    h('div.section', {}, h('h3', {}, 'Problems'), problemsEl));

  const backdrop = h('div.modal-backdrop', { hidden: true });
  const body = h('div.graph-body');
  const close = () => (backdrop.hidden = true);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.append(h('div.modal.graph', {}, h('div.modal-head', {}, h('b', {}, 'Logic graph'), h('span.hint', {}, 'Click a node to select it'), h('button', { onclick: close }, '✕')), body));
  document.body.append(backdrop);

  const edges = (): Edge[] => {
    const byName = entitiesByName(editor.doc);
    const out: Edge[] = [];
    for (const e of editor.doc.entities) {
      for (const c of getConnections(e)) {
        const t = resolveTarget(byName, c.target);
        if (t === 'special') continue;
        for (const to of t) out.push({ from: e, to, label: `${c.output} → ${c.input}${c.delay ? ` +${c.delay}s` : ''}` });
      }
    }
    return out;
  };

  const render = () => {
    const problems = validateConnections(editor.doc);
    const n = editor.doc.entities.reduce((s, e) => s + getConnections(e).length, 0);
    summary.textContent = `${n} connection${n === 1 ? '' : 's'}, ${problems.length} problem${problems.length === 1 ? '' : 's'}.`;
    problemsEl.replaceChildren(...(problems.length ? problems.slice(0, 100).map((p) =>
      h((p.severity === 'error' ? 'div.problem.err' : 'div.problem') as 'div', { onclick: () => editor.selection.set([], [p.entity]) },
        h('b', {}, p.entity.get('targetname') ?? p.entity.classname), ' ', p.message)) : [h('p.hint', {}, 'No problems found.')]));
  };

  /** Longest-path layering left to right, nodes ordered by their parents to reduce crossings. */
  const openGraph = () => {
    const es = edges();
    const nodes = [...new Set(es.flatMap((e) => [e.from, e.to]))];
    if (!nodes.length) {
      body.replaceChildren(h('p.hint', {}, 'This map has no entity connections yet. Add outputs in the Selection tab.'));
      backdrop.hidden = false;
      return;
    }
    const layer = new Map<MapEntity, number>(nodes.map((n) => [n, 0]));
    for (let pass = 0; pass < nodes.length; pass++) {
      let changed = false;
      for (const e of es) {
        if (e.from === e.to) continue;
        const want = layer.get(e.from)! + 1;
        if (want > layer.get(e.to)! && want < 30) { layer.set(e.to, want); changed = true; }
      }
      if (!changed) break;
    }
    const columns: MapEntity[][] = [];
    for (const n of nodes) (columns[layer.get(n)!] ??= []).push(n);
    const order = new Map<MapEntity, number>();
    columns.forEach((col, ci) => {
      if (ci > 0) {
        const parentPos = (n: MapEntity) => {
          const ps = es.filter((e) => e.to === n && order.has(e.from)).map((e) => order.get(e.from)!);
          return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 1e9;
        };
        col.sort((a, b) => parentPos(a) - parentPos(b));
      }
      col.forEach((n, i) => order.set(n, i));
    });
    const W = 190, H = 46, GX = 70, GY = 14;
    const pos = new Map<MapEntity, { x: number; y: number }>();
    columns.forEach((col, ci) => col.forEach((n, i) => pos.set(n, { x: 16 + ci * (W + GX), y: 16 + i * (H + GY) })));
    const width = 32 + columns.length * (W + GX), height = 32 + Math.max(...columns.map((c) => c.length)) * (H + GY);
    const root = svg('svg', { width, height, class: 'logic-svg' });
    const defs = svg('defs', {});
    const marker = svg('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#e8a33d' }));
    defs.append(marker);
    root.append(defs);
    for (const e of es) {
      const a = pos.get(e.from)!, b = pos.get(e.to)!;
      const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
      const self = e.from === e.to;
      const d = self ? `M ${x1} ${y1} C ${x1 + 50} ${y1 - 40}, ${a.x - 50} ${y1 - 40}, ${a.x} ${y1}` : `M ${x1} ${y1} C ${x1 + GX * 0.6} ${y1}, ${x2 - GX * 0.6} ${y2}, ${x2} ${y2}`;
      const path = svg('path', { d, class: 'edge', 'marker-end': 'url(#arrow)' });
      const title = svg('title', {});
      title.textContent = e.label;
      path.append(title);
      root.append(path);
    }
    for (const [n, p] of pos) {
      const g = svg('g', { class: 'node', transform: `translate(${p.x},${p.y})` });
      const color = `#${entityStyle(n.classname).color.toString(16).padStart(6, '0')}`;
      g.append(svg('rect', { width: W, height: H, rx: 6 }), svg('rect', { width: 5, height: H, rx: 2, fill: color }));
      const t1 = svg('text', { x: 12, y: 19, class: 'name' });
      t1.textContent = n.get('targetname') ?? `#${n.id}`;
      const t2 = svg('text', { x: 12, y: 36, class: 'cls' });
      t2.textContent = n.classname;
      g.append(t1, t2);
      g.addEventListener('click', () => {
        editor.selection.set([], [n]);
        const box = editor.selection.bounds();
        if (!box.isEmpty()) editor.frameBox(box.expandByScalar(384));
        close();
      });
      root.append(g);
    }
    body.replaceChildren(root);
    backdrop.hidden = false;
  };

  for (const ev of ['document', 'change', 'fgd']) editor.on(ev, render);
  render();
  return { panel, openGraph };
}
