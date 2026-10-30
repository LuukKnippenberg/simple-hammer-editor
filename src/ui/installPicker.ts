import type { Editor } from '../editor.ts';
import { h, toast } from './dom.ts';

interface Install {
  name: string;
  dir: string;
  hasVpks: boolean;
}

/**
 * Picks the Lambda Wars install the editor works with: textures, models and entity definitions come from
 * it first, and maps are compiled against and launched from it. Switching reloads the page.
 */
export function mountInstallPicker(editor: Editor): HTMLSelectElement {
  const select = h('select.install', { title: 'Lambda Wars install: assets, compile and launch' });
  void fetch('/api/config').then((r) => r.json()).then((cfg: { installs: Install[]; install: string | null }) => {
    if (!cfg.installs.length) select.append(h('option', { value: '' }, 'No Lambda Wars install found'));
    for (const i of cfg.installs) {
      select.append(h('option', { value: i.dir, title: i.dir }, `Game: ${i.name}`));
    }
    select.value = cfg.install ?? '';
  });

  select.addEventListener('change', async () => {
    const dir = select.value;
    const url = new URL(location.href);
    // Unsaved work goes to an autosave first, and the page reopens it.
    if (editor.dirty && editor.doc.allSolids().length) {
      const name = editor.mapName.replace(/\.vmf$/i, '') + '.autosave.vmf';
      const r = await fetch(`/api/autosave?name=${encodeURIComponent(name)}`, { method: 'POST', body: editor.doc.serialize() });
      if (!r.ok) return toast(editor.container, 'Could not autosave the map; install not switched.');
      url.searchParams.set('map', (await r.json()).id);
    }
    const r = await fetch('/api/install', { method: 'POST', body: JSON.stringify({ dir }) });
    if (!r.ok) {
      toast(editor.container, `Switch failed: ${(await r.json().catch(() => ({ error: r.statusText }))).error}`);
      return;
    }
    location.href = url.toString();
  });
  return select;
}
