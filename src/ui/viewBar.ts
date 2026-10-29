import type { Editor } from '../editor.ts';
import { VmfDocument } from '../vmf/map.ts';
import { h, toast } from './dom.ts';
import type { MeshLambertMaterial } from 'three';

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
    busy(`Loading ${f.name}…`, async () => editor.loadDocument(VmfDocument.parse(await f.text()), f.name));
  });

  const toggle = (label: string, title: string, get: () => boolean, set: (v: boolean) => void) => {
    const b = h('button', { title }, label);
    const sync = () => b.classList.toggle('active', get());
    b.addEventListener('click', () => { set(!get()); sync(); });
    sync();
    return b;
  };

  const wr = editor.world;
  bar.append(
    h('div.brand', {}, 'Simple ', h('span', {}, 'Hammer'), ' Editor'),
    select,
    h('button', { onclick: () => fileInput.click(), title: 'Open a .vmf from disk' }, 'Open file…'),
    fileInput,
    h('div.spacer'),
    toggle('Tool brushes', 'Show clip, trigger, nodraw and other tool brushes', () => wr.visibleKinds.tool, (v) => { wr.visibleKinds.tool = v; wr.applyVisibility(); }),
    toggle('Sky brushes', 'Show skybox brushes', () => wr.visibleKinds.sky, (v) => { wr.visibleKinds.sky = v; wr.applyVisibility(); }),
    toggle('Wireframe', 'Draw brushes as wireframe', () => !!(editor.materials.all()[0]?.material as MeshLambertMaterial | undefined)?.wireframe, (v) => {
      for (const m of editor.materials.all()) (m.material as MeshLambertMaterial).wireframe = v;
    }),
    toggle('Grid', 'Show the ground grid', () => editor.grid.visible, (v) => (editor.grid.visible = v)),
  );

  fetch('/api/maps')
    .then((r) => r.json())
    .then((maps: { id: string; name: string }[]) => {
      select.append(h('option', { value: '' }, '— open map —'));
      const groups = new Map<string, HTMLOptGroupElement>();
      for (const m of maps) {
        const prefix = m.id.split(':')[0];
        if (!groups.has(prefix)) {
          const g = h('optgroup', { label: prefix === 'repo' ? 'Editor maps/' : 'Game mapsrc/' }) as HTMLOptGroupElement;
          groups.set(prefix, g);
          select.append(g);
        }
        groups.get(prefix)!.append(h('option', { value: m.id }, m.name));
      }
      const wanted = new URL(location.href).searchParams.get('map') ?? maps.find((m) => m.id.startsWith('repo:'))?.id;
      if (wanted) {
        select.value = wanted;
        select.dispatchEvent(new Event('change'));
      }
    });
}
