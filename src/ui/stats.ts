import type { Editor } from '../editor.ts';
import { h } from './dom.ts';

/** Performance overlay in the viewport plus the status bar text. */
export function mountStats(editor: Editor, viewport: HTMLElement, status: HTMLElement): void {
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
      `<span class="k">Faces</span>${w.faces.toLocaleString()}`;
    const p = editor.camera.position;
    status.innerHTML =
      `<span><b>${editor.mapName}</b></span>` +
      `<span>camera <b>${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}</b></span>` +
      `<span>entities <b>${editor.doc.entities.length}</b></span>` +
      `<span>geometry build <b>${w.buildMs} ms</b></span>` +
      `<span style="margin-left:auto">RMB look · WASD fly · MMB pan · Alt+LMB orbit · wheel zoom</span>`;
  });
}
