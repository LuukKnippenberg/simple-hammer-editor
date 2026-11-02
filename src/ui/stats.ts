import type { Editor } from '../editor.ts';
import { h } from './dom.ts';
import { audio } from '../audio/engine.ts';

/** Performance overlay in the viewport plus the status bar text. */
export function mountStats(editor: Editor, viewport: HTMLElement, status: HTMLElement, hoverLabel: () => string = () => ''): void {
  const overlay = h('div.overlay.tr');
  viewport.append(overlay);
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
    status.replaceChildren(...[
      h('span', {}, h('b', {}, editor.mapName)),
      h('span', {}, 'camera ', h('b', {}, `${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`)),
      h('span', {}, 'entities ', h('b', {}, String(editor.doc.entities.length))),
      h('span', {}, editor.view === 'top' ? 'top view' : '3D view'),
      h('span', {}, 'grid ', h('b', {}, String(editor.grid))),
      editor.tools.current.name === 'select' && editor.selection.mode !== 'object' && h('span', {}, h('b', {}, editor.selection.mode), ' mode'),
      editor.hidden.size > 0 && h('span', {}, 'hidden ', h('b', {}, String(editor.hidden.size))),
      editor.lastAutosave && h('span', {}, 'autosaved ', h('b', {}, editor.lastAutosave.toLocaleTimeString())),
      hover && h('span.hover-label', {}, hover),
      editor.status && h('span', {}, h('b', { style: { color: 'var(--accent)' } }, editor.status)),
      h('span', {}, 'geometry build ', h('b', {}, `${w.buildMs} ms`)),
      h('span', { style: { marginLeft: 'auto' } }, 'Press ', h('b', {}, '?'), ' for shortcuts'),
    ].filter((n): n is HTMLSpanElement => !!n));
  });
}
