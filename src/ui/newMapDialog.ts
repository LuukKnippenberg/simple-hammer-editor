import { Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { GROUND_SETS } from '../edit/terrain.ts';
import { MAP_SIZES, TEMPLATES, WAVE_TYPES, buildTemplate, planTemplate, templateInfo, type MapSize, type TemplateKind, type TemplateOptions } from '../lw/mapTemplates.ts';
import { h, toast } from './dom.ts';

const OWNER_COLORS = ['#4fa3e0', '#e05a4f', '#6cc070', '#e8a33d', '#b07ce0', '#40c8c0', '#e07ab8', '#c8c860'];

/** "New map" dialog: pick a game mode template (or an empty map), its players and size, and a name. */
export function mountNewMapDialog(editor: Editor, onCreated: () => void): { open(): void; dialog: HTMLElement } {
  const backdrop = h('div.modal-backdrop', { hidden: true });
  const dialog = h('div.modal.wide.newmap');
  backdrop.append(dialog);
  document.body.append(backdrop);
  const close = () => (backdrop.hidden = true);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const o: TemplateOptions = { kind: 'annihilation', players: 2, size: 'medium', ground: GROUND_SETS[0].material, wavetype: 'antlions', faction: 'rebels' };
  let existing = new Set<string>();
  let nameEdited = false;

  const cards = h('div.tpl-cards');
  const options = h('div');
  const places = h('ul.tpl-places');
  const canvas = h('canvas.tpl-preview', { width: 240, height: 240 }) as HTMLCanvasElement;
  const name = h('input', { spellcheck: false }) as HTMLInputElement;
  const nameHint = h('p.hint');
  name.addEventListener('input', () => { nameEdited = true; renderName(); });

  const seg = <T extends string | number>(opts: [T, string][], get: () => T, set: (v: T) => void) => {
    const el = h('div.seg');
    const render = () => el.replaceChildren(...opts.map(([v, label]) => h((get() === v ? 'button.active' : 'button') as 'button', { onclick: () => { set(v); render(); update(); } }, label)));
    render();
    return el;
  };
  const select = (opts: { value: string; label: string }[], get: () => string, set: (v: string) => void) => {
    const el = h('select', {}, ...opts.map((x) => h('option', { value: x.value }, x.label))) as HTMLSelectElement;
    el.value = get();
    el.addEventListener('change', () => { set(el.value); update(); });
    return el;
  };

  // Built once and updated in place, so a double click lands on the same card.
  const cardEls = TEMPLATES.map((t) => {
    const sum = h('div.tpl-sum');
    const el = h('button.tpl-card', { 'data-template': t.kind, onclick: () => choose(t.kind), ondblclick: () => create() },
      h('div.tpl-title', {}, h('span.icon', {}, t.icon), t.label),
      h('div.hint', {}, t.description),
      sum);
    cards.append(el);
    return { t, el, sum };
  });
  const renderCards = () => {
    for (const { t, el, sum } of cardEls) {
      el.classList.toggle('active', t.kind === o.kind);
      const lines = t.places({ ...o, kind: t.kind, players: t.kind === o.kind ? o.players : t.defaultPlayers });
      sum.textContent = t.kind === 'empty' ? lines[0] : lines.slice(0, -1).join(' · ') + ' + the basics';
    }
  };

  const renderOptions = () => {
    const t = templateInfo(o.kind);
    const rows: HTMLElement[] = [];
    if (t.players.length) rows.push(h('div.row', {}, h('label', {}, 'Players'), seg(t.players.map((n) => [n, String(n)] as [number, string]), () => o.players, (v) => (o.players = v))));
    if (o.kind !== 'empty') {
      rows.push(h('div.row', {}, h('label', {}, 'Size'), seg((Object.keys(MAP_SIZES) as MapSize[]).map((k) => [k, MAP_SIZES[k].label] as [MapSize, string]), () => o.size, (v) => (o.size = v))));
      rows.push(h('div.row', {}, h('label', {}, 'Ground'), select(GROUND_SETS.map((g) => ({ value: g.material, label: g.label })), () => o.ground!, (v) => (o.ground = v))));
    }
    if (o.kind === 'overrun') rows.push(h('div.row', { title: 'overrun_manager wavetype: what attacks unless the lobby picks another' }, h('label', {}, 'Waves'), select(WAVE_TYPES, () => o.wavetype!, (v) => (o.wavetype = v))));
    if (o.kind === 'mission') rows.push(h('div.row', {}, h('label', {}, 'Faction'), seg<string>([['rebels', 'Rebels'], ['combine', 'Combine']], () => o.faction!, (v) => (o.faction = v as TemplateOptions['faction']))));
    if (o.kind !== 'empty') rows.push(h('p.hint', {}, `Playable area ${MAP_SIZES[o.size].units.toLocaleString()} × ${MAP_SIZES[o.size].units.toLocaleString()} units.`));
    options.replaceChildren(...rows);
  };

  const renderName = () => {
    const file = fileName();
    const prefix = o.kind === 'annihilation' ? 'hlw_' : o.kind === 'overrun' ? 'or_' : o.kind === 'mission' ? 'sp_' : '';
    const notes: string[] = [];
    if (prefix && !file.startsWith(prefix)) notes.push(`The game only lists ${templateInfo(o.kind).label} maps whose name starts with ${prefix}.`);
    if (existing.has(file)) notes.push(`maps/${file} exists: saving would replace it.`);
    nameHint.textContent = notes.join(' ') || 'Saved to maps/ with Save (Ctrl+S).';
    nameHint.classList.toggle('issue', notes.length > 0);
  };

  const drawPreview = () => {
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#111316';
    ctx.fillRect(0, 0, W, W);
    if (o.kind === 'empty') {
      ctx.fillStyle = '#8b939c';
      ctx.font = '12px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Empty map', W / 2, W / 2);
      return;
    }
    const plan = planTemplate(o);
    const pad = 14, s = (W - 2 * pad) / plan.size;
    // North up, like the top view.
    const px = (x: number) => pad + (x + plan.size / 2) * s, py = (y: number) => pad + (plan.size / 2 - y) * s;
    ctx.fillStyle = '#3f5530';
    ctx.fillRect(pad, pad, W - 2 * pad, W - 2 * pad);
    ctx.strokeStyle = '#d9dde2';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(pad + 0.5, pad + 0.5, W - 2 * pad - 1, W - 2 * pad - 1);
    ctx.setLineDash([]);
    const dot = (x: number, y: number, rad: number, fill: string, stroke = '') => {
      ctx.beginPath();
      ctx.arc(px(x), py(y), rad, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    };
    for (const p of plan.points) {
      ctx.strokeStyle = '#ffa630';
      ctx.strokeRect(px(p.x - 192), py(p.y + 192), 384 * s, 384 * s);
      dot(p.x, p.y, 2.5, '#ffa630');
    }
    for (const p of plan.scrap) dot(p.x, p.y, 2, '#d8c040');
    for (const w of plan.waves) {
      ctx.fillStyle = '#e05a4f';
      ctx.beginPath();
      const a = (-w.yaw * Math.PI) / 180, x = px(w.x), y = py(w.y);
      ctx.moveTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
      ctx.lineTo(x + Math.cos(a + 2.4) * 6, y + Math.sin(a + 2.4) * 6);
      ctx.lineTo(x + Math.cos(a - 2.4) * 6, y + Math.sin(a - 2.4) * 6);
      ctx.fill();
    }
    if (plan.goal) {
      const [x0, y0, x1, y1] = plan.goal;
      ctx.strokeStyle = '#6cc070';
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(px(x0), py(y1), (x1 - x0) * s, (y1 - y0) * s);
      ctx.setLineDash([]);
    }
    for (const q of plan.squad) dot(q.x, q.y, 1.6, '#4fa3e0');
    ctx.font = 'bold 10px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const st of plan.starts) {
      const c = OWNER_COLORS[(st.owner - 2) % OWNER_COLORS.length];
      dot(st.x, st.y, 7, c, '#000');
      ctx.fillStyle = '#000';
      ctx.fillText(String(st.owner - 1), px(st.x), py(st.y) + 0.5);
    }
  };

  const update = () => {
    renderCards();
    places.replaceChildren(...templateInfo(o.kind).places(o).map((p) => h('li', {}, p)));
    if (!nameEdited) name.value = templateInfo(o.kind).defaultName(o);
    renderName();
    drawPreview();
  };
  const choose = (kind: TemplateKind) => {
    if (kind !== o.kind) {
      o.kind = kind;
      const t = templateInfo(kind);
      if (!t.players.includes(o.players)) o.players = t.defaultPlayers;
      nameEdited = false;
      renderOptions();
    }
    update();
  };

  const fileName = () => {
    const base = name.value.trim().toLowerCase().replace(/\.vmf$/i, '').replace(/[^a-z0-9_]+/g, '_') || templateInfo(o.kind).defaultName(o).replace(/\.vmf$/, '');
    return `${base}.vmf`;
  };

  const create = () => {
    if (editor.dirty && !confirm('Discard unsaved changes?')) return;
    const t0 = performance.now();
    const built = buildTemplate(o);
    editor.loadDocument(built.doc, fileName());
    editor.dirty = true;
    if (built.mission) {
      editor.mission = built.mission;
      editor.emit('mission');
    }
    editor.emit('change');
    close();
    onCreated();
    if (o.kind === 'empty') {
      editor.setView(new Vector3(-1200, -1200, 1100), new Vector3(0, 0, 0));
      return;
    }
    // Look at the playable area from the south, high enough to see every start.
    const size = built.plan.size;
    editor.setView(new Vector3(0, -size * 0.95, size * 0.85), new Vector3(0, -size * 0.05, 0));
    if (o.kind === 'mission') window.__editor?.tabs?.show('Mission');
    toast(editor.container, `${templateInfo(o.kind).label} map: ${built.doc.entities.length} entities in ${Math.round(performance.now() - t0)} ms`);
  };

  dialog.append(
    h('div.modal-head', {}, h('b', {}, 'New map'), h('button', { onclick: close }, '✕')),
    h('div.gen-body', {},
      h('div', { style: { flex: '1', minWidth: '0' } }, cards,
        h('div.section', {}, h('h3', {}, 'What gets placed'), places)),
      h('div.gen-side.tpl-side', {},
        h('div.section', {}, h('h3', {}, 'Options'), options),
        canvas,
        h('div.tpl-legend', {}, ...([['#4fa3e0', '● player start'], ['#ffa630', '▢ requisition point'], ['#d8c040', '• scrap'], ['#e05a4f', '▲ wave spawn'], ['#6cc070', '⬚ mission goal']] as const)
          .map(([c, t]) => h('span', { style: { color: c } }, t))),
        h('div.section', {}, h('h3', {}, 'Name'), h('div.row', {}, h('label', {}, 'File'), name), nameHint),
        h('button.primary.big', { onclick: create }, 'Create map'))),
  );
  renderOptions();
  update();

  return {
    open() {
      nameEdited = false;
      update();
      backdrop.hidden = false;
      void fetch('/api/maps').then((r) => r.json()).then((maps: { id: string; name: string }[]) => {
        existing = new Set(maps.filter((m) => m.id.startsWith('repo:')).map((m) => m.name.toLowerCase()));
        renderName();
      }).catch(() => {});
    },
    dialog,
  };
}
