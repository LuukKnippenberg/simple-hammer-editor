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
    overlay.innerHTML =
      `<span class="k">FPS</span><b>${f.fps}</b><br>` +
      `<span class="k">Draw calls</span>${f.drawCalls}<br>` +
      `<span class="k">Triangles</span>${f.triangles.toLocaleString()}<br>` +
      `<span class="k">Brushes</span>${w.brushes.toLocaleString()}<br>` +
      `<span class="k">Faces</span>${w.faces.toLocaleString()}<br>` +
      `<span class="k">Props</span>${editor.entities.stats.props} (${editor.entities.stats.models} models)` +
      (editor.busy() ? `<br><span class="k">Loading</span>assets…` : '') +
      (audio.enabled ? `<br><span class="k">Soundscape</span><b>${audio.stats.soundscape || '–'}</b>` +
        `<br><span class="k">Sounds</span>${audio.stats.loops} loops, ${audio.stats.oneShots} played` +
        (audio.stats.local ? `, ${audio.stats.local} local` : '') : '');
    const p = editor.camera.position;
    status.innerHTML =
      `<span><b>${editor.mapName}</b></span>` +
      `<span>camera <b>${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}</b></span>` +
      `<span>entities <b>${editor.doc.entities.length}</b></span>` +
      `<span>${editor.view === 'top' ? 'top view' : '3D view'}</span>` +
      `<span>grid <b>${editor.grid}</b></span>` +
      (editor.hidden.size ? `<span>hidden <b>${editor.hidden.size}</b></span>` : '') +
      (editor.lastAutosave ? `<span>autosaved <b>${editor.lastAutosave.toLocaleTimeString()}</b></span>` : '') +
      (hoverLabel() ? `<span class="hover-label">${hoverLabel()}</span>` : '') +
      (editor.status ? `<span><b style="color:var(--accent)">${editor.status}</b></span>` : '') +
      `<span>geometry build <b>${w.buildMs} ms</b></span>` +
      `<span style="margin-left:auto">Press <b>?</b> for shortcuts</span>`;
  });
}
