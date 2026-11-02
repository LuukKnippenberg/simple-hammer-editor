import type { Editor } from '../editor.ts';
import { VmfDocument } from '../vmf/map.ts';
import { h, toast } from './dom.ts';
import { mountNewMapDialog } from './newMapDialog.ts';
import { mountChecklistChip } from './checklist.ts';
import type { MeshLambertMaterial } from 'three';

export interface TopBar {
  /** Opens the New map dialog. */
  newMap(): void;
  /** Asks for a .vmf on disk and opens it. */
  openFile(): void;
  /** Opens a map by id (`repo:x.vmf`) and puts it in the page address, so a reload reopens it. */
  openMap(id: string): Promise<void>;
  /** Runs `fn` behind the loading overlay; an error becomes a toast. */
  busy(label: string, fn: () => Promise<void>): Promise<void>;
}

/** Top bar: map picker, open (the start screen), save, and view toggles. */
export function mountTopBar(editor: Editor, bar: HTMLElement, loading: HTMLElement, showStart: () => void): TopBar {
  const select = h('select', { title: 'Open a map from maps/ or the game mapsrc folder' });
  const fileInput = h('input', { type: 'file', accept: '.vmf', style: { display: 'none' } });
  const busy = async (label: string, fn: () => Promise<void>) => {
    loading.textContent = label;
    loading.hidden = false;
    await new Promise((r) => setTimeout(r, 30));
    try {
      await fn();
    } catch (e) {
      toast(editor.container, (e as Error).message);
      console.error(e);
    } finally {
      loading.hidden = true;
    }
  };

  const openMap = (id: string) => {
    select.value = id;
    const url = new URL(location.href);
    url.searchParams.set('map', id);
    history.replaceState(null, '', url);
    return busy(`Loading ${id.split(':')[1]}…`, () => editor.loadMapById(id));
  };
  select.addEventListener('change', () => {
    if (!select.value) return;
    // Hand the keyboard back to the viewport: a focused picker swallows W A S D (and W picks another map).
    select.blur();
    void openMap(select.value);
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    busy(`Loading ${f.name}…`, async () => {
      const text = await f.text();
      editor.loadDocument(VmfDocument.parse(text), f.name, text);
    });
  });

  // New asks what kind of map to start from (newMapDialog.ts).
  const newMap = mountNewMapDialog(editor, () => (select.value = '')).open;
  const save = async (name?: string) => {
    try {
      const r = await editor.save(name);
      toast(editor.container, `Saved maps/${editor.mapName} (${(r.bytes / 1024).toFixed(0)} KB)`);
      await refreshMaps(r.id);
    } catch (e) {
      toast(editor.container, `Save failed: ${(e as Error).message}`);
    }
  };
  const saveAs = () => {
    const name = prompt('Save as (in maps/):', editor.mapName.replace(/\.vmf$/i, '') + '_copy.vmf');
    if (name) void save(name);
  };
  const download = () => {
    const blob = new Blob([editor.doc.serialize()], { type: 'text/plain' });
    const a = h('a', { href: URL.createObjectURL(blob), download: editor.mapName });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  });
  const syncTitle = () => (document.title = `${editor.dirty ? '• ' : ''}${editor.mapName} – Simple Hammer Editor`);
  for (const ev of ['document', 'change', 'saved']) editor.on(ev, syncTitle);

  const toggle = (label: string, title: string, get: () => boolean, set: (v: boolean) => void) => {
    const b = h('button', { title }, label);
    const sync = () => b.classList.toggle('active', get());
    b.addEventListener('click', () => { set(!get()); sync(); });
    editor.on('view', sync);
    editor.on('lighting', sync);
    sync();
    return b;
  };

  const wr = editor.world;
  bar.append(
    h('div.brand', { title: 'Simple Hammer Editor' }, h('img', { src: '/lambdawars-wordmark.png', alt: 'Lambda Wars', width: 123, height: 22 }), h('span', {}, 'Map editor')),
    select,
    h('button', { onclick: () => newMap(), title: 'Start a new map: a game mode template or an empty map' }, 'New'),
    h('button', { onclick: () => showStart(), title: 'Start screen: recent maps, examples, or a .vmf from disk' }, 'Open…'),
    fileInput,
    h('button', { onclick: () => save(), title: 'Save to maps/ (Ctrl+S)' }, 'Save'),
    h('button', { onclick: () => saveAs(), title: 'Save under a new name in maps/' }, 'Save as…'),
    h('button', { onclick: () => download(), title: 'Download the .vmf' }, 'Download'),
    mountChecklistChip(editor),
    h('div.spacer'),
    toggle('Top view', 'Orthographic top-down view (T)', () => editor.view === 'top', (v) => editor.setView3dOrTop(v ? 'top' : '3d')),
    toggle('Lighting', 'Preview in-game lighting: sun with shadows, ambient and light entities (L)', () => !!window.__editor?.lighting?.enabled, (v) => { window.__editor.lighting.setEnabled(v); editor.emit('lighting'); }),
    toggle('Tool brushes', 'Show clip, trigger, nodraw and other tool brushes', () => wr.visibleKinds.tool, (v) => { wr.visibleKinds.tool = v; wr.applyVisibility(); }),
    toggle('Handles', 'Generator handles: show the boxes that select, move and resize points of interest and blocks of buildings (hide them to pick single props and brushes)', () => wr.visibleKinds.handle, (v) => { wr.visibleKinds.handle = v; wr.applyVisibility(); }),
    toggle('Sky brushes', 'Show skybox brushes', () => wr.visibleKinds.sky, (v) => { wr.visibleKinds.sky = v; wr.applyVisibility(); }),
    toggle('Props', 'Show prop models', () => editor.entities.showProps, (v) => editor.entities.setVisibility(v, editor.entities.showMarkers)),
    toggle('Entities', 'Show point entity markers', () => editor.entities.showMarkers, (v) => editor.entities.setVisibility(editor.entities.showProps, v)),
    toggle('Decals', 'Show decals and overlays', () => editor.decals.visible, (v) => editor.decals.setVisible(v)),
    toggle('Wireframe', 'Draw brushes as wireframe', () => !!(editor.materials.all()[0]?.material as MeshLambertMaterial | undefined)?.wireframe, (v) => {
      for (const m of editor.materials.all()) (m.material as MeshLambertMaterial).wireframe = v;
    }),
    toggle('Grid', 'Show the ground grid', () => editor.gridHelper.visible, (v) => (editor.gridHelper.visible = v)),
  );

  const refreshMaps = async (selectId?: string) => {
    const maps: { id: string; name: string }[] = await fetch('/api/maps').then((r) => r.json());
    select.replaceChildren(h('option', { value: '' }, '— open map —'));
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const m of maps) {
      const prefix = m.id.split(':')[0];
      if (!groups.has(prefix)) {
        const g = h('optgroup', { label: prefix === 'repo' ? 'Editor maps/' : prefix === 'autosave' ? 'Autosaves' : 'Game mapsrc/' }) as HTMLOptGroupElement;
        groups.set(prefix, g);
        select.append(g);
      }
      groups.get(prefix)!.append(h('option', { value: m.id }, m.name));
    }
    if (selectId) select.value = selectId;
    return maps;
  };

  // A map in the address opens straight away; without one the editor starts on the start screen.
  void refreshMaps().then(() => {
    const wanted = new URL(location.href).searchParams.get('map');
    if (wanted) void openMap(wanted);
  });
  return { newMap, openFile: () => fileInput.click(), openMap, busy };
}
