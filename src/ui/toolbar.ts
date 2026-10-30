import type { Editor } from '../editor.ts';
import type { ToolName } from '../edit/tools.ts';
import { copySelection, deleteSelection, duplicateSelection, pasteClipboard, rotateEntities, tieToEntity } from '../edit/actions.ts';
import { isTyping } from '../render/cameraControls.ts';
import { h, toast } from './dom.ts';

const TOOLS: { name: ToolName; icon: string; label: string; key: string }[] = [
  { name: 'select', icon: '⬚', label: 'Select & move', key: '1' },
  { name: 'block', icon: '▣', label: 'Block: drag on a surface to create a brush', key: '2' },
  { name: 'paint', icon: '🖌', label: 'Paint: click a face (Shift: whole brush, Ctrl: pick material)', key: '3' },
  { name: 'entity', icon: '⚑', label: 'Entity: click to place the class chosen in the Entities tab', key: '4' },
  { name: 'kit', icon: '⚔', label: 'Lambda Wars kit: click to place the kit chosen in the Mission tab', key: '5' },
  { name: 'decal', icon: '◩', label: 'Decal: click a surface to place the decal chosen in the Materials tab', key: '6' },
  { name: 'road', icon: '🛣', label: 'Road: click points, Enter or double-click to build', key: '7' },
  { name: 'ground', icon: '⛰', label: 'Ground: paint and sculpt terrain', key: '8' },
  { name: 'powerline', icon: '⚡', label: 'Powerline: click points, Enter or double-click to build', key: '9' },
  { name: 'sound', icon: '🔊', label: 'Sound: place soundscape zones and local sounds', key: '0' },
];
const GRIDS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

/** Left tool palette, grid size, undo/redo, and the global keyboard shortcuts. */
export function setToolButtons(editor: Editor, name: ToolName): void {
  editor.tools.set(name);
  editor.emit('toolchange');
}

export function mountToolbar(editor: Editor, bar: HTMLElement, hooks: { hoverPoint: () => import('three').Vector3 | null; help: () => void }): void {
  const buttons = new Map<ToolName, HTMLButtonElement>();
  const setTool = (name: ToolName) => {
    editor.tools.set(name);
    editor.emit('toolchange');
  };
  editor.on('toolchange', () => {
    for (const [n, b] of buttons) b.classList.toggle('active', n === editor.tools.current.name);
  });
  for (const t of TOOLS) {
    const b = h('button', { title: `${t.label} (${t.key})`, onclick: () => setTool(t.name) }, t.icon);
    buttons.set(t.name, b);
    bar.append(b);
  }
  buttons.get('select')!.classList.add('active');

  const sel = editor.tools.select;
  const move = h('button', { title: 'Gizmo: move (M)', onclick: () => sel.setMode('translate') }, '✥');
  const resize = h('button', { title: 'Gizmo: resize brushes (R)', onclick: () => sel.setMode('scale') }, '⤡');
  const syncMode = () => {
    move.classList.toggle('active', sel.mode === 'translate');
    resize.classList.toggle('active', sel.mode === 'scale');
  };
  editor.on('toolchange', syncMode);
  syncMode();

  const grid = h('button', { title: 'Grid size ([ and ])', style: { fontSize: '11px' } });
  const syncGrid = () => (grid.textContent = String(editor.grid));
  const stepGrid = (d: number) => {
    const i = Math.max(0, Math.min(GRIDS.length - 1, GRIDS.indexOf(editor.grid) + d));
    editor.grid = GRIDS[i];
    syncGrid();
    toast(editor.container, `Grid ${editor.grid}`, 900);
  };
  grid.addEventListener('click', () => {
    editor.grid = GRIDS[(GRIDS.indexOf(editor.grid) + 1) % GRIDS.length];
    syncGrid();
  });
  syncGrid();

  const undo = h('button', { title: 'Undo (Ctrl+Z)', onclick: () => editor.undo() }, '↶');
  const redo = h('button', { title: 'Redo (Ctrl+Y)', onclick: () => editor.redo() }, '↷');
  const syncHistory = () => {
    undo.disabled = !editor.history.canUndo;
    redo.disabled = !editor.history.canRedo;
  };
  editor.history.onChange = syncHistory;
  editor.on('document', syncHistory);
  syncHistory();

  const helpBtn = h('button', { title: 'Keyboard shortcuts (?)', onclick: () => hooks.help() }, '?');
  bar.append(h('div', { style: { height: '10px' } }), move, resize, h('div', { style: { flex: '1' } }), grid, undo, redo, helpBtn);

  const focus = () => {
    const b = editor.selection.isEmpty ? editor.world.bounds() : editor.selection.bounds();
    if (!b.isEmpty()) editor.frameBox(b);
  };

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z' && !e.shiftKey) editor.undo();
    else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) editor.redo();
    else if (ctrl && k === 'd') duplicateSelection(editor);
    else if (ctrl && k === 't') tieToEntity(editor, 'trigger_once');
    else if (ctrl && k === 'c') { const n = copySelection(editor); if (n) toast(editor.container, `Copied ${n} object${n > 1 ? 's' : ''}`, 1200); }
    else if (ctrl && k === 'v') pasteClipboard(editor, hooks.hoverPoint());
    else if (ctrl) return;
    else if (k === 'delete' || k === 'backspace') deleteSelection(editor);
    else if (k === 'escape') editor.selection.clear();
    else if (k === 'm') sel.setMode('translate');
    else if (k === 'r') sel.setMode('scale');
    else if (k === 'f') focus();
    else if (k === 't') editor.setView3dOrTop(editor.view === 'top' ? '3d' : 'top');
    else if (k === 'h') editor.hideSelection();
    else if (k === 'u') editor.unhideAll();
    else if (e.key === '?') hooks.help();
    else if (k === '[') stepGrid(-1);
    else if (k === ']') stepGrid(1);
    else if (k === ',') rotateEntities(editor, e.shiftKey ? 90 : 15);
    else if (k === '.') rotateEntities(editor, e.shiftKey ? -90 : -15);
    else {
      const t = TOOLS.find((t) => t.key === e.key);
      if (!t) return;
      setTool(t.name);
    }
    e.preventDefault();
  });
}
