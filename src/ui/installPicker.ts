import type { Editor } from '../editor.ts';
import { h, toast } from './dom.ts';
import { apiPost } from '../api.ts';

export interface Install {
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
  let active: string | null = null;
  const sync = () => void fetchInstalls().then((cfg) => {
    if (select.options.length) {
      if (cfg.install === active) return;
      // Switched from another tab: compiles already go to the new install; textures update on reload.
      active = cfg.install;
      select.value = cfg.install ?? '';
      toast(editor.container, `The game install was changed in another tab to ${select.selectedOptions[0]?.textContent?.replace('Game: ', '') ?? cfg.install}. Reload to update textures.`, 6000);
      return;
    }
    active = cfg.install;
    if (!cfg.installs.length) select.append(h('option', { value: '' }, 'No Lambda Wars install found'));
    for (const i of cfg.installs) {
      select.append(h('option', { value: i.dir, title: i.dir }, `Game: ${i.name}`));
    }
    select.value = cfg.install ?? '';
  });
  sync();
  // Another tab (or the config file) can switch the install while this page is open.
  window.addEventListener('focus', sync);

  select.addEventListener('change', () => void switchInstall(editor, select.value));
  return select;
}

/** The installs found and the active one (also for the start screen's "Change game…"). */
export async function fetchInstalls(): Promise<{ installs: Install[]; install: string | null }> {
  return (await fetch('/api/config')).json();
}

/** Makes `dir` the active install and reloads the page; unsaved work goes to an autosave first, and the page reopens it. */
export async function switchInstall(editor: Editor, dir: string): Promise<void> {
  const url = new URL(location.href);
  if (editor.dirty && editor.doc.allSolids().length) {
    const name = editor.mapName.replace(/\.vmf$/i, '') + '.autosave.vmf';
    const r = await apiPost(`/api/autosave?name=${encodeURIComponent(name)}`, editor.doc.serialize());
    if (!r.ok) return toast(editor.container, 'Could not autosave the map; install not switched.');
    url.searchParams.set('map', (await r.json()).id);
  }
  const r = await apiPost('/api/install', JSON.stringify({ dir }));
  if (!r.ok) {
    toast(editor.container, `Switch failed: ${(await r.json().catch(() => ({ error: r.statusText }))).error}`);
    return;
  }
  location.href = url.toString();
}
