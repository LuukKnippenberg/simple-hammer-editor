import type { Editor } from '../editor.ts';
import { MAP_MODES, checkState, mapChecklist, modeInfo, type Check, type CheckState, type Checklist, type MapMode } from '../edit/preflight.ts';
import { h } from './dom.ts';

/**
 * Map checklist (F4): the top-bar chip ("Annihilation · 2 to fix", "Annihilation · ready ✓") and its "Ready to play?" popover. Both show
 * `mapChecklist` from preflight.ts, as the compile dialog does; the rows are shared through `checkRows`.
 */

/** Edits settle this long before the checks run again. */
const REFRESH_DELAY_MS = 300;
const POPOVER_GAP = 4;
const ICONS: Record<CheckState, string> = { ok: '✓', warning: '!', error: '✕', pending: '–' };
const FOOTNOTE = 'Compile also checks static props and leaks. This list updates as you edit; it never blocks saving.';

/** Modes picked with Change mode; a map that is loaded or created goes back to the mode it reads as. */
const chosenModes = new WeakMap<Editor, MapMode>();

export function currentChecklist(editor: Editor): Checklist {
  return mapChecklist(editor, chosenModes.get(editor));
}

/** Shows another mode's list (the map itself doesn't change). Emits `checklist`. */
export function chooseMode(editor: Editor, mode: MapMode): void {
  chosenModes.set(editor, mode);
  editor.emit('checklist');
}

function playersText(list: Checklist): string {
  if (list.mode === 'mission') return 'you alone';
  if (list.mode === 'empty') return 'no mode yet';
  return `${list.players} player${list.players === 1 ? '' : 's'}`;
}

/** "Annihilation · 2 players" */
export const checklistSubtitle = (list: Checklist): string => `${modeInfo(list.mode).title} · ${playersText(list)}`;

/** "ready ✓" only when nothing is left to fix, otherwise "3 to fix": a count that can't be read as ready. */
export const checklistStatus = (list: Checklist): string => (list.allReady ? 'ready ✓' : `${list.toFix} to fix`);

export interface RowOptions {
  /** Called after a fix or a mode pick, to draw the list again. */
  onChange(): void;
  /** Fix buttons say what they do ("Add sky shell") instead of "Fix". */
  longLabels?: boolean;
}

/** One row per check: ✓, !, ✕ or – (not checked yet), the name, the detail and an action. */
export function checkRows(editor: Editor, checks: Check[], opts: RowOptions): HTMLElement[] {
  return checks.map((c) => {
    const state = checkState(c);
    return h('div', { class: `cl-row ${state}` },
      h('span.cl-icon', {}, ICONS[state]),
      h('span.cl-text', {}, h('b', {}, c.label), h('span.cl-detail', {}, c.detail)),
      rowAction(editor, c, opts));
  });
}

function rowAction(editor: Editor, c: Check, opts: RowOptions): HTMLElement | null {
  if (c.id === 'mode') {
    return h('span.cl-modes', {}, ...MAP_MODES.filter((m) => m.mode !== 'empty').map((m) =>
      h('button', { onclick: () => { chooseMode(editor, m.mode); opts.onChange(); } }, m.label)));
  }
  if (!c.ok && c.fix) {
    return h('button.primary', { title: c.fixLabel, onclick: () => { c.fix!(); opts.onChange(); } }, opts.longLabels ? c.fixLabel ?? 'Fix' : 'Fix');
  }
  if (c.show) return h('button', { onclick: () => c.show!() }, c.showLabel ?? 'Show');
  return null;
}

/** The top-bar chip; its popover opens below it. Put the returned element in the bar. */
export function mountChecklistChip(editor: Editor): HTMLElement {
  const modeEl = h('span.cl-mode');
  const countEl = h('span.cl-count');
  const caret = h('span.cl-caret', {}, '▾');
  const chip = h('button.cl-chip', { 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, modeEl, countEl, caret);
  const pop = h('div.cl-pop', { role: 'dialog', 'aria-label': 'Map checklist', hidden: true });
  document.body.append(pop);
  let picking = false;
  let timer = 0;

  const renderPopover = (list: Checklist) => {
    const picker = picking ? h('div.cl-picker', {}, ...MAP_MODES.map((m) => h('button', {
      class: m.mode === list.mode ? 'active' : undefined,
      onclick: () => { picking = false; chooseMode(editor, m.mode); },
    }, m.title, m.mode === list.detected ? h('span.cl-from', {}, ' · from the map') : null))) : null;
    pop.replaceChildren(
      h('div.cl-head', {},
        h('b.caps', {}, 'Ready to play?'),
        h('span.cl-sub', {}, checklistSubtitle(list)),
        h('button.cl-link', { 'aria-expanded': String(picking), onclick: () => { picking = !picking; render(); } }, 'Change mode')),
      ...(picker ? [picker] : []),
      h('div.cl-bar', {}, h('div', { style: { width: `${list.total ? (100 * list.ready) / list.total : 0}%` } })),
      ...checkRows(editor, list.checks, { onChange: render }),
      h('p.cl-foot', {}, FOOTNOTE),
    );
    pop.classList.toggle('ready', list.allReady);
  };

  const render = () => {
    clearTimeout(timer);
    const list = currentChecklist(editor);
    modeEl.textContent = modeInfo(list.mode).label;
    countEl.textContent = `· ${checklistStatus(list)}`;
    chip.title = `Map checklist: ${list.ready} of ${list.total} checks pass. Click for the list.`;
    chip.classList.toggle('ready', list.allReady);
    if (!pop.hidden) renderPopover(list);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(render, REFRESH_DELAY_MS);
  };

  const setOpen = (open: boolean) => {
    pop.hidden = !open;
    picking = false;
    caret.textContent = open ? '▴' : '▾';
    chip.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const r = chip.getBoundingClientRect();
    pop.style.left = `${r.left}px`;
    pop.style.top = `${r.bottom + POPOVER_GAP}px`;
    render();
  };
  chip.addEventListener('click', () => setOpen(pop.hidden));
  document.addEventListener('mousedown', (e) => {
    if (!pop.hidden && !pop.contains(e.target as Node) && !chip.contains(e.target as Node)) setOpen(false);
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) setOpen(false); });

  for (const ev of ['change', 'mission', 'saved', 'fgd']) editor.on(ev, schedule);
  editor.on('document', () => { chosenModes.delete(editor); schedule(); });
  editor.on('checklist', render);
  render();
  return chip;
}
