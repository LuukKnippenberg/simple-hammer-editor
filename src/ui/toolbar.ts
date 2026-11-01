import type { Editor } from '../editor.ts';
import type { ToolName } from '../edit/tools.ts';
import { copySelection, deleteSelection, duplicateSelection, pasteClipboard, rotateEntities, tieToEntity } from '../edit/actions.ts';
import { isTyping } from '../render/cameraControls.ts';
import { deletePoi, duplicatePoi, selectedPois, turnPoi } from '../gen/poi/action.ts';
import { deleteBlock, duplicateBlock, selectedBlocks, turnBlock } from '../gen/buildingAction.ts';
import { deleteRooms, selectedRooms } from '../gen/rooms/action.ts';
import { h, toast } from './dom.ts';
import { tip } from './tooltip.ts';
import { mountGenerateButton } from './generateMenu.ts';

/** The rail's tools. Roads, powerlines and points of interest are in the Generate menu below them (keys 7, 9, P). */
const TOOLS: { name: ToolName; icon: string; label: string; key: string }[] = [
  { name: 'select', icon: '⬚', label: 'Select & move', key: '1' },
  { name: 'block', icon: '▣', label: 'Block: drag on a surface to create a brush', key: '2' },
  { name: 'paint', icon: '🖌', label: 'Paint: click a face (Shift: whole brush, Ctrl: pick material)', key: '3' },
  { name: 'entity', icon: '⚑', label: 'Entity: click to place the class chosen in the Entities tab', key: '4' },
  { name: 'kit', icon: '⚔', label: 'Lambda Wars kit: click to place the kit chosen in the Mission tab', key: '5' },
  { name: 'decal', icon: '◩', label: 'Decal: click a surface to place the decal chosen in the Materials tab', key: '6' },
  { name: 'ground', icon: '⛰', label: 'Ground: paint and sculpt terrain', key: '8' },
  { name: 'sound', icon: '🔊', label: 'Sound: place soundscape zones and local sounds', key: '0' },
  { name: 'cinema', icon: '🎬', label: 'Cinema: paths, particles and screens (camera shots and atmosphere are in the Cinema tab)', key: 'c' },
];
const GRIDS = [1, 2, 4, 8, 16, 32, 64, 128, 256];
/** Keys that fly the camera while the right mouse button is held (and are shortcuts otherwise). */
const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space']);

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
    // Q picks the Select tool too, as in Unity.
    const b = h('button', { ...tip(t.label, `${t.name === 'select' ? 'Q ' : ''}${t.key.toUpperCase()}`), onclick: () => setTool(t.name) }, t.icon);
    buttons.set(t.name, b);
    bar.append(b);
  }
  buttons.get('select')!.classList.add('active');
  // Everything the editor builds, in one menu (G).
  bar.append(h('div.rail-sep'), mountGenerateButton(editor));

  const sel = editor.tools.select;
  const move = h('button', { ...tip('Gizmo: move', 'W'), onclick: () => sel.setMode('translate') }, '✥');
  const resize = h('button', { ...tip('Gizmo: resize brushes', 'R'), onclick: () => sel.setMode('scale') }, '⤡');
  const rotate = h('button', { ...tip('Gizmo: rotate in steps', 'E'), onclick: () => sel.setMode('rotate') }, '⟳');
  const syncMode = () => {
    move.classList.toggle('active', sel.mode === 'translate');
    resize.classList.toggle('active', sel.mode === 'scale');
    rotate.classList.toggle('active', sel.mode === 'rotate');
  };
  editor.on('toolchange', syncMode);
  syncMode();

  const grid = h('button', { ...tip('Grid size: click to cycle', '[ ]'), style: { fontSize: '11px' } });
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

  const undo = h('button', { ...tip('Undo', 'Ctrl+Z'), onclick: () => editor.undo() }, '↶');
  const redo = h('button', { ...tip('Redo', 'Ctrl+Y'), onclick: () => editor.redo() }, '↷');
  const syncHistory = () => {
    undo.disabled = !editor.history.canUndo;
    redo.disabled = !editor.history.canRedo;
  };
  editor.history.onChange = syncHistory;
  editor.on('document', syncHistory);
  syncHistory();

  const helpBtn = h('button', { ...tip('Keyboard shortcuts', '?'), onclick: () => hooks.help() }, '?');
  bar.append(h('div', { style: { height: '10px' } }), move, resize, rotate, h('div', { style: { flex: '1' } }), grid, undo, redo, helpBtn);

  const focus = () => {
    const b = editor.selection.isEmpty ? editor.world.bounds() : editor.selection.bounds();
    if (!b.isEmpty()) editor.frameBox(b);
  };

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    // While the right mouse button is held these keys fly the camera, as in Unity.
    if (!ctrl && FLY_KEYS.has(e.code) && (editor.controls.isLooking || editor.topView.panning)) return;
    const k = e.key.toLowerCase();
    // Selected POI handles act for their whole POI.
    const pois = selectedPois(editor);
    if (pois.length && poiKey(k, ctrl)) {
      if (k === 'delete' || k === 'backspace') editor.history.group(pois.length > 1 ? 'Delete POIs' : 'Delete POI', () => pois.forEach((p) => deletePoi(editor, p)));
      else if (k === 'd' && pois.length === 1) duplicatePoi(editor, pois[0]);
      else if (k === 'c') toast(editor.container, 'POIs are copied with Ctrl+D (duplicate)', 1800);
      else if (k === ',' || k === '.') editor.history.group('Turn POI', () => pois.forEach((p) => turnPoi(editor, p, k === ',' ? 1 : -1)));
      editor.emit('poi');
      e.preventDefault();
      return;
    }
    // Selected building handles act for their whole block.
    const blocks = selectedBlocks(editor);
    if (blocks.length && poiKey(k, ctrl)) {
      const many = blocks.length > 1 ? 'blocks of buildings' : 'buildings';
      if (k === 'delete' || k === 'backspace') editor.history.group(`Delete ${many}`, () => blocks.forEach((b) => deleteBlock(editor, b)));
      else if (k === 'd' && blocks.length === 1) duplicateBlock(editor, blocks[0]);
      else if (k === 'c') toast(editor.container, 'Blocks of buildings are copied with Ctrl+D (duplicate)', 1800);
      else if (k === ',' || k === '.') editor.history.group(`Turn ${many}`, () => blocks.forEach((b) => turnBlock(editor, b)));
      e.preventDefault();
      return;
    }
    // Selected interior building handles: Delete removes the whole building.
    const rooms = selectedRooms(editor);
    if (rooms.length && (k === 'delete' || k === 'backspace')) {
      editor.history.group('Delete interior building', () => rooms.forEach((r) => deleteRooms(editor, r)));
      e.preventDefault();
      return;
    }
    if (ctrl && k === 'z' && !e.shiftKey) editor.undo();
    else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) editor.redo();
    else if (ctrl && k === 'd') duplicateSelection(editor);
    else if (ctrl && k === 't') tieToEntity(editor, 'trigger_once');
    else if (ctrl && k === 'c') { const n = copySelection(editor); if (n) toast(editor.container, `Copied ${n} object${n > 1 ? 's' : ''}`, 1200); }
    else if (ctrl && k === 'v') pasteClipboard(editor, hooks.hoverPoint());
    else if (ctrl) return;
    else if (k === 'delete' || k === 'backspace') deleteSelection(editor);
    else if (k === 'escape') editor.selection.clear();
    else if (k === 'q') setTool('select');
    else if (k === 'w') sel.setMode('translate');
    else if (k === 'e') sel.setMode('rotate');
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

/** Keys that act on a whole POI or block of buildings when its handle is selected. */
function poiKey(k: string, ctrl: boolean): boolean {
  return ctrl ? k === 'd' || k === 'c' : k === 'delete' || k === 'backspace' || k === ',' || k === '.';
}
