import type { Editor } from '../editor.ts';
import { h, toast } from './dom.ts';
import { audio } from '../audio/engine.ts';
import { GRIDS } from './toolbar.ts';

/** Clickable grid sizes for the status bar, kept as one element so clicks land; the note says how lines thin out. */
function gridPicker(editor: Editor): { root: HTMLElement; note: HTMLElement } {
  const buttons = GRIDS.map((n) => {
    const b = h('button', { title: `Grid ${n}` }, String(n));
    b.addEventListener('click', () => editor.setGrid(n));
    return b;
  });
  const step = (d: number) => editor.setGrid(GRIDS[Math.max(0, Math.min(GRIDS.length - 1, GRIDS.indexOf(editor.grid) + d))]);
  const down = h('button', { title: 'Smaller grid ([)', onclick: () => step(-1) }, '[');
  const up = h('button', { title: 'Larger grid (])', onclick: () => step(1) }, ']');
  const note = h('span.grid-note');
  const sync = () => {
    buttons.forEach((b, i) => b.classList.toggle('on', GRIDS[i] === editor.grid));
    note.textContent = editor.quad.gridNote();
  };
  editor.on('grid', sync);
  sync();
  return { root: h('span.grid-pick', {}, h('span', {}, 'grid '), down, ...buttons, up, note), note };
}

/**
 * The amber "unsaved for N min · Save" pill. It stays one element (the rest of the status bar is rebuilt every frame
 * tick) so a click on it always lands.
 */
function saveReminder(editor: Editor): { pill: HTMLButtonElement; sync(): void } {
  const text = h('span');
  const pill = h('button.save-pill', { hidden: true, title: 'Save to maps/ (Ctrl+S)' }, h('span.save-pill-dot'), text);
  pill.addEventListener('click', async () => {
    try {
      const r = await editor.save();
      toast(editor.container, `Saved maps/${editor.mapName} (${(r.bytes / 1024).toFixed(0)} KB)`);
    } catch (e) {
      toast(editor.container, `Save failed: ${(e as Error).message}`);
    }
  });
  const sync = () => {
    const minutes = editor.unsaved.reminderMinutes();
    pill.hidden = minutes === null;
    if (minutes !== null) text.textContent = `unsaved for ${minutes} min · Save`;
  };
  editor.on('saved', sync);
  return { pill, sync };
}

/**
 * Performance overlay in the viewport plus the status bar text. Returns the status bar's right end, a slot that is
 * not rebuilt every tick (the asset finder's button goes there).
 */
export function mountStats(editor: Editor, viewport: HTMLElement, status: HTMLElement, hoverLabel: () => string = () => ''): { right: HTMLElement } {
  const overlay = h('div.overlay.tr');
  viewport.append(overlay);
  const mapName = h('b');
  const reminder = saveReminder(editor);
  const rest = h('span.status-rest');
  const right = h('span.status-right');
  const grid = gridPicker(editor);
  status.replaceChildren(h('span', {}, mapName), reminder.pill, rest, grid.root, right);
  let last = 0;
  editor.on('frame', () => {
    const now = performance.now();
    if (now - last < 250) return;
    last = now;
    const f = editor.frame, w = editor.world.stats;
    // Built from text nodes: the map name, soundscape and hover label come from the map file.
    const row = (key: string, ...value: (Node | string)[]) => [h('span.k', {}, key), ...value];
    const lines = [
      row('FPS', h('b', {}, String(f.fps))),
      row('Draw calls', String(f.drawCalls)),
      row('Triangles', f.triangles.toLocaleString()),
      row('Brushes', w.brushes.toLocaleString()),
      row('Faces', w.faces.toLocaleString()),
      row('Props', `${editor.entities.stats.props} (${editor.entities.stats.models} models)`),
      editor.busy() && row('Loading', 'assets…'),
      audio.enabled && row('Soundscape', h('b', {}, audio.stats.soundscape || '–')),
      audio.enabled && row('Sounds', `${audio.stats.loops} loops, ${audio.stats.oneShots} played` + (audio.stats.local ? `, ${audio.stats.local} local` : '')),
    ].filter((l) => l !== false);
    overlay.replaceChildren(...lines.flatMap((l, i) => (i ? [h('br'), ...l] : l)));
    const p = editor.camera.position;
    const hover = hoverLabel();
    const quad = editor.quad.on ? editor.quad.status() : null;
    grid.note.textContent = editor.quad.gridNote();
    mapName.textContent = editor.mapName;
    reminder.sync();
    rest.replaceChildren(...[
      h('span', {}, 'camera ', h('b', {}, `${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`)),
      h('span', {}, 'entities ', h('b', {}, String(editor.doc.entities.length))),
      quad ? h('span', {}, 'active ', h('b', { style: { color: 'var(--accent-text)' } }, quad.pane)) : h('span', {}, editor.view === 'top' ? 'top view' : '3D view'),
      quad?.cursor && h('span', {}, 'cursor ', h('b', {}, quad.cursor)),
      editor.tools.current.name === 'select' && editor.selection.mode !== 'object' && h('span', {}, h('b', {}, editor.selection.mode), ' mode'),
      editor.hidden.size > 0 && h('span', {}, 'hidden ', h('b', {}, String(editor.hidden.size))),
      editor.lastAutosave && h('span', {}, 'autosaved ', h('b', {}, editor.lastAutosave.toLocaleTimeString())),
      hover && h('span.hover-label', {}, hover),
      editor.status && h('span', {}, h('b', { style: { color: 'var(--accent)' } }, editor.status)),
      h('span', {}, 'geometry build ', h('b', {}, `${w.buildMs} ms`)),
      h('span', { style: { marginLeft: 'auto' } }, 'Press ', h('b', {}, '?'), ' for shortcuts'),
    ].filter((n): n is HTMLSpanElement => !!n));
  });
  return { right };
}
