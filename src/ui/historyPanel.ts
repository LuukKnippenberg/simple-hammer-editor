import type { Editor } from '../editor.ts';
import { h, scrollIntoList } from './dom.ts';
import { tip } from './tooltip.ts';

type Tone = 'add' | 'remove' | '';

/** Icons for a step, picked by the first word of its label; the first match wins. */
const STEP_ICONS: { words: string[]; icon: string; tone: Tone }[] = [
  { words: ['generate', 'build', 'rebuild', 'make'], icon: '⌂', tone: '' },
  { words: ['delete', 'remove'], icon: '✕', tone: 'remove' },
  { words: ['place'], icon: '⚑', tone: '' },
  { words: ['add', 'create', 'paste', 'duplicate', 'tie'], icon: '+', tone: 'add' },
  { words: ['move', 'snap', 'send', 'link', 'join'], icon: '↔', tone: '' },
  { words: ['rotate', 'turn'], icon: '⟳', tone: '' },
  { words: ['resize', 'extend', 'fit'], icon: '⤡', tone: '' },
  { words: ['paint', 'apply'], icon: '▣', tone: '' },
];
const OTHER_STEP = { icon: '✎', tone: '' as Tone };

export function stepIcon(label: string): { icon: string; tone: Tone } {
  const first = label.split(/\s/, 1)[0].toLowerCase();
  return STEP_ICONS.find((s) => s.words.includes(first)) ?? OTHER_STEP;
}

/** 24-hour hh:mm, as the board shows it. */
export function stepTime(time: number): string {
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Map panel › History: every undo step with its icon, label and time. The current step is highlighted; the undone
 * steps after it are grey and stay clickable to redo until the next edit drops them.
 */
export function mountHistorySection(editor: Editor, sidebar: HTMLElement): void {
  const undo = h('button.hist-btn', { ...tip('Undo', 'Ctrl+Z'), onclick: () => editor.undo() }, '↶ Undo ', h('span.kbd', {}, 'Ctrl Z'));
  const redo = h('button.hist-btn', { ...tip('Redo', 'Ctrl+Y'), onclick: () => editor.redo() }, '↷ Redo ', h('span.kbd', {}, 'Ctrl Y'));
  const list = h('div.hist-list');
  sidebar.append(h('div.section.hist', {},
    h('h3', {}, 'History'),
    h('div.hist-actions', {}, undo, redo),
    list,
    h('p.hint', {}, 'Click a step to jump back to it; the steps after it turn grey and can be redone until you change something. Generators count as one step each.'),
  ));

  // The name the map had when the history started (Save as renames it later).
  let openedName = editor.mapName;
  editor.on('document', () => (openedName = editor.mapName));
  const jump = (position: number) => {
    if (editor.history.jumpTo(position)) editor.changed();
  };
  const row = (position: number, label: string, time: number, icon: string, tone: Tone) => {
    const current = editor.history.position;
    const cls = position === current ? 'cur' : position > current ? 'fut' : '';
    return h('div', { class: `hist-step ${cls}`, title: label, onclick: () => jump(position) },
      h('span', { class: `hist-icon ${tone}` }, icon),
      h('span.hist-label', {}, label),
      h('span.hist-time', {}, stepTime(time)),
    );
  };
  const render = () => {
    const { history } = editor;
    undo.disabled = !history.canUndo;
    redo.disabled = !history.canRedo;
    list.replaceChildren(
      row(0, `Opened ${openedName}`, history.openedAt, '•', ''),
      ...history.steps.map((s, i) => {
        const { icon, tone } = stepIcon(s.label);
        return row(i + 1, s.label, s.time, icon, tone);
      }),
    );
    scrollIntoList(list.querySelector('.cur'), list);
  };
  for (const ev of ['document', 'history']) editor.on(ev, render);
  render();
}
