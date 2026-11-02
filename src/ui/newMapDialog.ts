import { Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { GROUND_SETS } from '../edit/terrain.ts';
import { CAPTURE_RADIUS, WAVE_TYPES, planTemplate, templateInfo, type TemplateKind, type TemplateOptions, type TemplatePlan } from '../lw/mapTemplates.ts';
import { h, toast } from './dom.ts';
import { row, select } from './form.ts';
import {
  GROUND_HINT, MODE_CARDS, PLAYERS_HINT, SIZE_CARDS, START_CARDS, buildNewMap, checklistSentence, defaultRest, fileNameFor, nameChecks,
  nameRest, placedLines, prefixFor, previewPlan, sketchFromPlan, validPlayers, type Card, type StartFrom,
} from './newMapModel.ts';

const SVG = 'http://www.w3.org/2000/svg';
/** The preview: a 400 × 300 picture with the playable square (MAP_PX) in the middle. */
const PREVIEW_W = 400, PREVIEW_H = 300, MAP_PX = 280;
/** Half the side of the dirt pad under a base (buildTemplate wears 420 units around each start). */
const BASE_HALF = 420;

/**
 * "New map" wizard: four numbered steps (mode, size and look, start from, name) on the left, the preview from above
 * and what gets placed on the right. The choices and their rules live in newMapModel.ts.
 */
export function mountNewMapDialog(editor: Editor, onCreated: () => void): { open(): void; dialog: HTMLElement } {
  const backdrop = h('div.modal-backdrop', { hidden: true });
  const dialog = h('div.modal.newmap', { role: 'dialog', 'aria-label': 'New map' });
  backdrop.append(dialog);
  document.body.append(backdrop);
  const close = () => (backdrop.hidden = true);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const o: TemplateOptions = { kind: 'annihilation', players: 2, size: 'medium', ground: GROUND_SETS[0].material, wavetype: 'antlions', faction: 'rebels' };
  let start: StartFrom = 'template';
  /** The player count last picked: switching mode shows the closest count the mode offers, and back again. */
  let wantedPlayers = o.players;
  let existing = new Set<string>();
  let nameEdited = false;

  const modeCards = cards(MODE_CARDS, () => o.kind, (kind) => chooseMode(kind), { dblclick: () => create(), attr: 'data-template' });
  const modeOptions = h('div.np-options');
  const sizeCards = cards(SIZE_CARDS, () => o.size, (size) => { o.size = size; update(); }, { inlineNote: true });
  const startCards = cards(START_CARDS, () => start, (value) => { start = value; update(); }, { attr: 'data-start' });

  const prefix = h('span.np-prefix');
  const name = h('input.np-input', { spellcheck: false, 'aria-label': 'Map name' }) as HTMLInputElement;
  const target = h('span.np-path');
  const checks = h('div.np-checks');
  name.addEventListener('input', () => {
    // The prefix is the chip's: typed or pasted in front of the name, it is taken out again.
    const chip = prefixFor(o.kind);
    if (chip && name.value.toLowerCase().startsWith(chip)) name.value = name.value.slice(chip.length);
    nameEdited = true;
    renderName();
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });

  const preview = document.createElementNS(SVG, 'svg');
  preview.setAttribute('viewBox', `0 0 ${PREVIEW_W} ${PREVIEW_H}`);
  preview.classList.add('np-preview');
  const legend = h('div.np-legend');
  const places = h('ul.np-places');
  const sentence = h('p.np-sentence');
  const createButton = h('button.primary', { onclick: () => create() }, 'Create map');

  const rest = () => nameRest(o.kind, name.value);
  const fileName = () => fileNameFor(o.kind, rest());
  const nameOk = () => nameChecks(o.kind, rest(), existing).every((c) => c.ok);

  function renderOptions(): void {
    const rows: HTMLElement[] = [];
    const offered = templateInfo(o.kind).players;
    if (offered.length) rows.push(row('Players', segment(offered.map((n) => [n, String(n)]), () => o.players, (n) => { wantedPlayers = o.players = n; update(); }), h('span.hint', {}, PLAYERS_HINT)));
    if (o.kind === 'overrun') rows.push(row('Waves', select(WAVE_TYPES.map((w) => [w.value, w.label]), o.wavetype!, (v) => { o.wavetype = v; update(); }, 'overrun_manager wavetype: what attacks unless the lobby picks another')));
    if (o.kind === 'mission') rows.push(row('Faction', segment<string>([['rebels', 'Rebels'], ['combine', 'Combine']], () => o.faction!, (v) => { o.faction = v as TemplateOptions['faction']; update(); })));
    modeOptions.replaceChildren(...rows);
  }

  function renderName(): void {
    const chip = prefixFor(o.kind);
    prefix.textContent = chip;
    prefix.hidden = !chip;
    name.classList.toggle('alone', !chip);
    target.textContent = `→ maps/${fileName()}`;
    const results = nameChecks(o.kind, rest(), existing);
    checks.replaceChildren(...results.map((c) => h(c.ok ? 'span.np-check.ok' : 'span.np-check.fail', {}, h('b', {}, c.ok ? '✓' : '✕'), c.text)));
    createButton.disabled = !nameOk();
  }

  function renderPreview(): void {
    const blank = o.kind === 'empty' && start !== 'basics';
    const plan = previewPlan(planTemplate(o), start);
    preview.replaceChildren(...previewShapes(plan, blank));
    preview.classList.toggle('blank', blank);
    // Only what the preview shows.
    const items: [string, string, boolean][] = [
      ['start', 'player start', plan.starts.length > 0], ['point', 'requisition point', plan.points.length > 0], ['scrap', 'scrap', plan.scrap.length > 0],
      ['boundary', 'boundary', !blank], ['wave', 'wave spawn', plan.waves.length > 0], ['goal', 'mission goal', plan.goal !== null],
    ];
    legend.replaceChildren(...items.filter(([, , shown]) => shown).map(([kind, text]) => h('span', {}, h('i', { class: `np-key ${kind}` }), ` ${text}`)));
  }

  function update(): void {
    modeCards.render();
    sizeCards.render();
    startCards.render();
    if (!nameEdited) name.value = defaultRest(o, existing);
    renderName();
    renderPreview();
    places.replaceChildren(...placedLines(o, start).map((line) => h('li', {}, line)));
    sentence.textContent = checklistSentence(o.kind);
  }

  function chooseMode(kind: TemplateKind): void {
    if (kind !== o.kind) {
      // Keep what was typed after the prefix; only an untouched default follows the mode.
      const typed = rest();
      o.kind = kind;
      o.players = validPlayers(kind, wantedPlayers);
      if (nameEdited) name.value = typed;
      renderOptions();
    }
    update();
  }

  function create(): void {
    if (!nameOk()) return;
    if (editor.dirty && !confirm('Discard unsaved changes?')) return;
    const t0 = performance.now();
    const built = buildNewMap(o, start);
    editor.loadDocument(built.doc, fileName());
    editor.dirty = true;
    if (built.mission) {
      editor.mission = built.mission;
      editor.emit('mission');
    }
    editor.emit('change');
    close();
    onCreated();
    if (o.kind === 'empty' && start !== 'basics') editor.setView(new Vector3(-1200, -1200, 1100), new Vector3(0, 0, 0));
    else {
      // Look at the playable area from the south, high enough to see every start.
      const size = built.plan.size;
      editor.setView(new Vector3(0, -size * 0.95, size * 0.85), new Vector3(0, -size * 0.05, 0));
      if (built.mission) window.__editor?.tabs?.show('Mission');
      toast(editor.container, `${templateInfo(o.kind).label} map: ${built.doc.entities.length} entities in ${Math.round(performance.now() - t0)} ms`);
    }
    if (start === 'sketch') {
      // The sketch starts with the template's markers; generating it keeps the map's name (sketchDialog.ts).
      editor.sketch = sketchFromPlan(o, built.plan);
      editor.emit('sketch');
      window.__editor?.sketch?.open();
    }
  }

  dialog.append(
    h('div.modal-head.np-head', {},
      h('b', {}, 'New map'),
      h('span.hint', {}, 'Four choices, then the editor builds the start for you. Everything stays editable.'),
      h('button', { onclick: close, 'aria-label': 'Close' }, '✕')),
    h('div.np-body', {},
      h('div.np-steps', {},
        step(1, 'Mode', modeCards.el, modeOptions),
        step(2, 'Size and look', sizeCards.el,
          row('Ground', select(GROUND_SETS.map((g) => [g.material, g.label]), o.ground!, (v) => { o.ground = v; update(); }), h('span.hint', {}, GROUND_HINT))),
        step(3, 'Start from', startCards.el),
        step(4, 'Name', h('div.np-name', {}, prefix, name, target), checks)),
      h('aside.np-side', {},
        h('div.np-cap', {}, 'Preview · from above'),
        preview,
        legend,
        h('div.np-cap.accent', {}, 'What gets placed'),
        places,
        h('div.np-fill'),
        sentence,
        h('div.np-actions', {}, h('button', { onclick: close }, 'Cancel'), createButton))),
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
        update();
      }).catch(() => {});
    },
    dialog,
  };
}

/** A numbered step: the number, its title and its controls. */
function step(n: number, title: string, ...content: HTMLElement[]): HTMLElement {
  return h('section.np-step', {}, h('span.np-num', {}, String(n)), h('div.np-step-body', {}, h('h3', {}, title), ...content));
}

/**
 * A row of choice cards. Built once and updated in place (`render`), so a double click lands on the same card.
 * `attr` names a data attribute holding each card's value, for scripts.
 */
function cards<T extends string>(list: Card<T>[], get: () => T, set: (v: T) => void, options: { dblclick?: () => void; attr?: string; inlineNote?: boolean } = {}): { el: HTMLElement; render(): void } {
  const buttons = list.map((card) => {
    const note = card.note ? h('span.np-note', {}, card.note) : null;
    return h('button.np-card', { ...(options.attr ? { [options.attr]: card.value } : {}), onclick: () => set(card.value), ondblclick: options.dblclick },
      h('b', {}, card.title, options.inlineNote && note ? ' ' : null, options.inlineNote ? note : null),
      h('span', {}, card.text),
      options.inlineNote ? null : note);
  });
  return {
    el: h('div.np-cards', {}, ...buttons),
    render: () => buttons.forEach((button, i) => button.classList.toggle('active', list[i].value === get())),
  };
}

/** A segmented choice, redrawn on each pick. */
function segment<T extends string | number>(choices: [T, string][], get: () => T, set: (v: T) => void): HTMLElement {
  const el = h('div.np-seg');
  const render = () => el.replaceChildren(...choices.map(([value, label]) => h((get() === value ? 'button.active' : 'button') as 'button', { onclick: () => { set(value); render(); } }, label)));
  render();
  return el;
}

function svg(tag: string, attrs: Record<string, string | number>, text = ''): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text) el.textContent = text;
  return el;
}

/** The preview's shapes, north up like the top view. A blank map shows only a note. */
function previewShapes(plan: TemplatePlan, blank: boolean): SVGElement[] {
  if (blank) return [svg('text', { x: PREVIEW_W / 2, y: PREVIEW_H / 2, class: 'np-blank' }, 'An empty document: nothing placed')];
  const s = MAP_PX / plan.size;
  const left = (PREVIEW_W - MAP_PX) / 2, top = (PREVIEW_H - MAP_PX) / 2;
  const px = (x: number) => left + (x + plan.size / 2) * s, py = (y: number) => top + (plan.size / 2 - y) * s;
  const square = (x: number, y: number, half: number, cls: string, minPx = 0) => {
    const side = Math.max(minPx, 2 * half * s);
    return svg('rect', { x: (px(x) - side / 2).toFixed(1), y: (py(y) - side / 2).toFixed(1), width: side.toFixed(1), height: side.toFixed(1), class: cls });
  };
  const out: SVGElement[] = [svg('rect', { x: left, y: top, width: MAP_PX, height: MAP_PX, class: 'np-boundary' })];
  if (plan.goal) {
    const [x0, y0, x1, y1] = plan.goal;
    out.push(svg('rect', { x: px(x0).toFixed(1), y: py(y1).toFixed(1), width: ((x1 - x0) * s).toFixed(1), height: ((y1 - y0) * s).toFixed(1), class: 'np-goal' }));
  }
  for (const st of plan.starts) out.push(square(st.x, st.y, BASE_HALF, 'np-start'));
  for (const p of plan.points) out.push(square(p.x, p.y, CAPTURE_RADIUS, 'np-point', 8));
  for (const p of plan.scrap) out.push(svg('circle', { cx: px(p.x).toFixed(1), cy: py(p.y).toFixed(1), r: 3, class: 'np-scrap' }));
  for (const w of plan.waves) {
    // A triangle pointing the way the wave faces (yaw is counter-clockwise from east; the picture's y runs down).
    const a = (-w.yaw * Math.PI) / 180, x = px(w.x), y = py(w.y);
    const corner = (turn: number, r: number) => `${(x + Math.cos(a + turn) * r).toFixed(1)},${(y + Math.sin(a + turn) * r).toFixed(1)}`;
    out.push(svg('polygon', { points: [corner(0, 8), corner(2.4, 7), corner(-2.4, 7)].join(' '), class: 'np-wave' }));
  }
  for (const q of plan.squad) out.push(svg('circle', { cx: px(q.x).toFixed(1), cy: py(q.y).toFixed(1), r: 2, class: 'np-squad' }));
  plan.starts.forEach((st) => out.push(svg('text', { x: px(st.x).toFixed(1), y: py(st.y).toFixed(1), class: 'np-start-n' }, String(st.owner - 1))));
  return out;
}
