import type { Editor } from '../editor.ts';
import { VmfDocument } from '../vmf/map.ts';
import { h, toast } from './dom.ts';
import { Vector3, type MeshLambertMaterial } from 'three';

/** Top bar: map picker, open-file, and view toggles. */
export function mountTopBar(editor: Editor, bar: HTMLElement, loading: HTMLElement): void {
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

  select.addEventListener('change', () => {
    const id = select.value;
    if (!id) return;
    const url = new URL(location.href);
    url.searchParams.set('map', id);
    history.replaceState(null, '', url);
    busy(`Loading ${id.split(':')[1]}…`, () => editor.loadMapById(id));
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    busy(`Loading ${f.name}…`, async () => {
      const text = await f.text();
      editor.loadDocument(VmfDocument.parse(text), f.name, text);
    });
  });

  const newMap = () => {
    if (editor.dirty && !confirm('Discard unsaved changes?')) return;
    editor.loadDocument(VmfDocument.empty(), 'untitled.vmf');
    editor.dirty = true;
    select.value = '';
    editor.setView(new Vector3(-1200, -1200, 1100), new Vector3(0, 0, 0));
  };
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
    h('div.brand', {}, 'Simple ', h('span', {}, 'Hammer'), ' Editor'),
    select,
    h('button', { onclick: () => newMap(), title: 'Start an empty map' }, 'New'),
    h('button', { onclick: () => fileInput.click(), title: 'Open a .vmf from disk' }, 'Open file…'),
    fileInput,
    h('button', { onclick: () => save(), title: 'Save to maps/ (Ctrl+S)' }, 'Save'),
    h('button', { onclick: () => saveAs(), title: 'Save under a new name in maps/' }, 'Save as…'),
    h('button', { onclick: () => download(), title: 'Download the .vmf' }, 'Download'),
    h('div.spacer'),
    toggle('Top view', 'Orthographic top-down view (T)', () => editor.view === 'top', (v) => editor.setView3dOrTop(v ? 'top' : '3d')),
    toggle('Lighting', 'Preview in-game lighting: sun with shadows, ambient and light entities (L)', () => !!window.__editor?.lighting?.enabled, (v) => { window.__editor.lighting.setEnabled(v); editor.emit('lighting'); }),
    toggle('Tool brushes', 'Show clip, trigger, nodraw and other tool brushes', () => wr.visibleKinds.tool, (v) => { wr.visibleKinds.tool = v; wr.applyVisibility(); }),
    toggle('Sky brushes', 'Show skybox brushes', () => wr.visibleKinds.sky, (v) => { wr.visibleKinds.sky = v; wr.applyVisibility(); }),
    toggle('Props', 'Show prop models', () => editor.entities.showProps, (v) => editor.entities.setVisibility(v, editor.entities.showMarkers)),
    toggle('Entities', 'Show point entity markers', () => editor.entities.showMarkers, (v) => editor.entities.setVisibility(editor.entities.showProps, v)),
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

  void refreshMaps().then((maps) => {
    const wanted = new URL(location.href).searchParams.get('map') ?? maps.find((m) => m.id.startsWith('repo:'))?.id;
    if (wanted) {
      select.value = wanted;
      select.dispatchEvent(new Event('change'));
    }
  });
}
