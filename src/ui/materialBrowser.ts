import type { Editor } from '../editor.ts';
import { materialThumbnail } from '../assets/thumbnails.ts';
import { h } from './dom.ts';
import { loadDecals, openDecalPicker } from './decalPicker.ts';
import { recentDecals } from './recent.ts';

/** Folders that hold model, UI or effect materials rather than brush textures. */
const SKIP = /^(models|effects|vgui|sprites|particle|particles|console|debug|engine|editor|skybox|correction|perftest|voice|hud|cable|decals|overlays|fow|deferred|environment maps|shadertest|pg_tex)\//;

/** Thumbnail grid of materials: the ones used in the map first, or a search over everything the game has. */
export function mountMaterialBrowser(editor: Editor): HTMLElement {
  const search = h('input', { placeholder: 'Search materials (e.g. brick, concrete, metal)…', style: { width: '100%' } }) as HTMLInputElement;
  const current = h('div.current-mat');
  const grid = h('div.mat-grid');
  let mode: 'brush' | 'decal' = 'brush';
  const modeBar = h('div.seg', { style: { marginBottom: '8px' } });
  const panel = h('div', {}, modeBar, h('div.section', {}, h('h3', {}, 'Current material'), current), search, grid);
  let all: string[] | null = null;
  let decalList: string[] | null = null;
  const renderMode = () => modeBar.replaceChildren(...([['brush', 'Brush materials'], ['decal', 'Decals']] as const).map(([m, l]) =>
    h((m === mode ? 'button.active' : 'button') as 'button', { onclick: () => { mode = m; renderMode(); renderCurrent(); render(); } }, l)));

  const observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const img = en.target as HTMLImageElement;
      observer.unobserve(img);
      void materialThumbnail(img.dataset.mat!).then((url) => {
        if (url) img.src = url;
        else img.classList.add('missing');
      });
    }
  }, { root: panel.parentElement ?? null, rootMargin: '200px' });

  const tile = (name: string) => {
    const img = h('img', { alt: '' }) as HTMLImageElement;
    img.dataset.mat = name;
    observer.observe(img);
    const pick = () => {
      if (mode === 'decal') {
        recentDecals.push(name);
        editor.decal.material = name;
        editor.tools.set('decal');
        editor.emit('toolchange');
        editor.emit('decal');
        renderCurrent();
      } else editor.setMaterial(name);
    };
    const el = h('div.mat-tile', { title: name, onclick: pick }, img, h('span', {}, name.split('/').pop()!));
    if (mode === 'brush' ? name.toUpperCase() === editor.currentMaterial : name === editor.decal.material) el.classList.add('active');
    return el;
  };

  const usedInMap = () => {
    const counts = new Map<string, number>();
    for (const s of editor.doc.allSolids()) for (const side of s.sides) {
      const m = side.material.toLowerCase();
      if (!m.startsWith('tools/')) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  };

  const render = () => {
    const q = search.value.trim().toLowerCase();
    let list: string[];
    if (mode === 'decal') {
      if (!decalList) {
        grid.replaceChildren(h('p.hint', {}, 'Indexing decals…'));
        // The same list as the decal picker (no blood, impacts or engine decals).
        void loadDecals().then((list) => {
          decalList = list;
          render();
        });
        return;
      }
      const words = q.split(/\s+/).filter(Boolean);
      list = decalList.filter((m) => words.every((w) => m.includes(w))).slice(0, 300);
      grid.replaceChildren(h('p.hint', {}, `${list.length} decals${q ? ' matching' : ''}. Click one to use the decal tool (6). `,
        h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); void openDecalPicker(editor, { current: editor.decal.material, subtitle: 'for the Decal tool', mode: editor.decal.mode, useLabel: 'Use decal', onPick: (m, dm) => { editor.decal.material = m; editor.decal.mode = dm; editor.emit('decal'); } }); } }, 'Open the decal picker…')),
        ...list.map(tile));
      return;
    }
    if (!q) list = usedInMap();
    else {
      if (!all) {
        grid.replaceChildren(h('p.hint', {}, 'Indexing game materials…'));
        void fetch('/api/list?folder=materials&ext=.vmt').then((r) => r.json()).then((paths: string[]) => {
          all = paths.map((p) => p.slice(10, -4)).filter((p) => !SKIP.test(p));
          render();
        });
        return;
      }
      const words = q.split(/\s+/);
      list = all.filter((m) => words.every((w) => m.includes(w))).slice(0, 240);
    }
    grid.replaceChildren(
      h('p.hint', {}, q ? `${list.length} match${list.length === 1 ? '' : 'es'}` : 'Used in this map (search to browse all)'),
      ...list.map(tile),
    );
  };

  // The Decal tool's options and picker change the decal too.
  editor.on('decal', () => renderCurrent());
  const renderCurrent = () => {
    const img = h('img') as HTMLImageElement;
    const name = mode === 'decal' ? editor.decal.material : editor.currentMaterial.toLowerCase();
    void materialThumbnail(name).then((u) => u && (img.src = u));
    current.replaceChildren(img, h('span', {}, name));
    for (const t of grid.querySelectorAll<HTMLElement>('.mat-tile')) t.classList.toggle('active', t.title.toLowerCase() === name.toLowerCase());
  };

  let timer = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(render, 150);
  });
  editor.on('document', render);
  editor.on('material', renderCurrent);
  // The sidebar opens this panel for the Paint and Decal tools: show the list that tool uses.
  editor.on('toolchange', () => {
    const t = editor.tools.current.name;
    const want = t === 'decal' ? 'decal' : t === 'paint' ? 'brush' : mode;
    if (want !== mode) { mode = want; renderMode(); renderCurrent(); render(); }
  });
  renderMode();
  render();
  renderCurrent();
  return panel;
}
