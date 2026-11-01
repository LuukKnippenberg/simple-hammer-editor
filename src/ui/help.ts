import { h } from './dom.ts';

const SHORTCUTS: [string, string][] = [
  ['Right drag (+ WASD · E/Q)', 'Look; hold the right button to fly with WASD, E up, Q down (arrows fly any time)'],
  ['Middle drag · Alt+left drag', 'Pan · orbit'],
  ['T', 'Toggle the top view (right drag pans, wheel zooms)'],
  ['Q', 'Select tool'],
  ['1 – 6', 'Select · Block · Paint · Entity · Lambda Wars kit · Decal tool'],
  ['8 · 0 · C', 'Ground · Sound · Cinema tool'],
  ['G', 'Generate menu: buildings, blocks, interior buildings, roads, powerlines, points of interest'],
  ['1 – 7 · Enter', 'In the Generate menu: pick a generator · repeat the last one (Esc closes it)'],
  ['7 · 9 · P', 'Generate a road · powerline · point of interest at once (Enter builds a road or line, Backspace removes a point)'],
  ['Shift+drag', 'Placing a building, block or house: a square footprint'],
  ['Enter · Esc', 'Generating: done · one step back (Tune → Place → menu)'],
  ['Click · Shift+click · drag', 'Select · add to selection · box select'],
  ['W · E · R', 'Gizmo: move · rotate (in steps, Shift: free) · resize'],
  ['Hold V + drag', 'Snap move: grab a corner, edge or face of the selection and drop it on another (Shift: one axis, Ctrl: keep height, Esc cancels)'],
  ['Shift+1 – 4', 'Select objects · faces · edges · vertices (move them with the gizmo; brushes are rebuilt round their corners)'],
  ['X', 'Face mode: extrude the selected faces (move the mouse, click or Enter confirms, Esc cancels, Alt extends the brush)'],
  ['Ctrl+C · Ctrl+V', 'Copy · paste at the cursor'],
  ['Ctrl+D · Delete', 'Duplicate · delete'],
  ['Ctrl+T', 'Tie selected brushes to a trigger_once'],
  ['Ctrl+Z · Ctrl+Y', 'Undo · redo'],
  ['H · U', 'Hide selection · unhide all (editor only)'],
  ['L', 'Toggle the lighting preview'],
  ['M · PageUp PageDown', 'Mission objectives in the viewport · previous / next objective'],
  ['[ ]', 'Grid size'],
  [', .', 'Rotate entities (Shift: 90°); turn a selected POI or block of buildings a quarter turn'],
  ['F', 'Focus the selection'],
  ['Ctrl+S', 'Save'],
  ['?', 'This overlay'],
];

/** Keyboard shortcut overlay. */
export function mountHelp(): { toggle(): void } {
  const backdrop = h('div.modal-backdrop', { hidden: true });
  const close = () => (backdrop.hidden = true);
  backdrop.addEventListener('click', close);
  backdrop.append(h('div.modal', { style: { width: 'min(560px, 94vw)' } },
    h('div.modal-head', {}, h('b', {}, 'Keyboard and mouse'), h('button', { onclick: close }, '✕')),
    h('table.keys', {}, ...SHORTCUTS.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v))))));
  document.body.append(backdrop);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return { toggle: () => (backdrop.hidden = !backdrop.hidden) };
}
