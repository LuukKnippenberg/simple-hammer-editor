import { h } from './dom.ts';

const SHORTCUTS: [string, string][] = [
  ['Right drag · WASD · E/Q', 'Look and fly (3D view)'],
  ['Middle drag · Alt+left drag', 'Pan · orbit'],
  ['T', 'Toggle the top view (right drag pans, wheel zooms)'],
  ['1 2 3 4', 'Select · Block · Paint · Entity tool'],
  ['Click · Shift+click · drag', 'Select · add to selection · box select'],
  ['M · R', 'Gizmo: move · resize'],
  ['Ctrl+C · Ctrl+V', 'Copy · paste at the cursor'],
  ['Ctrl+D · Delete', 'Duplicate · delete'],
  ['Ctrl+Z · Ctrl+Y', 'Undo · redo'],
  ['H · U', 'Hide selection · unhide all (editor only)'],
  ['[ ]', 'Grid size'],
  [', .', 'Rotate entities (Shift: 90°)'],
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
