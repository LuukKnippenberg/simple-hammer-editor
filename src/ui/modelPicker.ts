import type { Editor } from '../editor.ts';
import { modelEntry, modelFolder, sizeClass, SIZE_CLASSES, type ModelEntry, type SizeClass } from '../assets/modelIndex.ts';
import { assetGroups, assetUses, favouriteAssets, loadAssets, recentAssets, usedInMap } from '../assets/assetCatalog.ts';
import { modelPreview, modelThumbnail } from '../render/modelViews.ts';
import { openPicker, kbd, type PickerSource } from './assetPicker.ts';
import { h } from './dom.ts';

interface ModelItem extends ModelEntry {
  id: string;
  name: string;
  folder: string;
}

/** How many entities use each model in the map. */
export const modelsInMap = (editor: Editor) => usedInMap(editor, 'model');

/** What vbsp makes of a model as a prop_static, from the index. */
export function staticNote(m: Pick<ModelEntry, 'static' | 'physics'>): { ok: boolean; text: string } {
  if (m.static) return { ok: true, text: '$staticprop, no physics data' };
  return { ok: false, text: m.physics ? 'physics prop_data: vbsp deletes it as prop_static' : 'no $staticprop: vbsp deletes it as prop_static' };
}

/**
 * Choose a model: favourites, recent, the ones used in this map and the game's model folders, rendered
 * thumbnails, filters for static-prop use, skins and size, and a live preview with skins.
 */
export async function openModelPicker(editor: Editor, opts: {
  current?: string;
  /** "for 3 × prop_static", "for the Entity tool" */
  subtitle: string;
  /** Hide models vbsp would delete as prop_static. */
  staticOnly: boolean;
  useLabel: string;
  onPick: (path: string, skin: number) => void;
}): Promise<void> {
  const assets = await loadAssets('model');
  const items: ModelItem[] = assets.map((a) => ({ ...modelEntry(a.id)!, id: a.id, name: a.name, folder: a.group }));
  const used = usedInMap(editor, 'model');
  const folders = assetGroups(assets);
  const favouriteModels = favouriteAssets('model');
  const recentModels = recentAssets('model');
  const current = opts.current?.toLowerCase().replace(/\\/g, '/');
  const curFolder = current ? modelFolder(current) : '';
  let size: SizeClass | '' = '';
  let skin = 0;
  const icon = (c: string, t: string) => h('span.src-icon', { style: { color: c } }, t);
  const sources: PickerSource<ModelItem>[] = [
    { id: 'fav', label: 'Favourites', icon: icon('var(--accent)', '★'), test: (i) => favouriteModels.has(i.path) },
    { id: 'recent', label: 'Recent', icon: icon('var(--muted)', '⟲'), test: (i) => recentModels.has(i.path) },
    { id: 'used', label: 'Used in this map', icon: icon('var(--ok)', '●'), test: (i) => used.has(i.path) },
  ];
  const folderSources: PickerSource<ModelItem>[] = [
    { id: 'all', label: 'All models', icon: icon('var(--muted)', '▾'), test: () => true },
    ...folders.map(({ group: f }) => ({ id: `f:${f}`, label: f, indent: true, test: (i: ModelItem) => i.folder === f })),
  ];
  const start = curFolder && folders.some((f) => f.group === curFolder) ? `f:${curFolder}` : used.size ? 'used' : 'all';
  const sizeChip = { id: 'size', label: 'Size', on: false, hidden: true, test: (i: ModelItem) => !size || sizeClass(i) === size };

  openPicker<ModelItem>({
    title: 'Choose a model',
    subtitle: opts.subtitle,
    className: 'model-picker',
    items,
    sections: [{ sources }, { heading: 'Folders', sources: folderSources }],
    source: start,
    current,
    searchPlaceholder: `Search ${items.length.toLocaleString('en')} models: barrel, bench, lamp…`,
    searchText: (i) => i.path,
    chips: [
      { id: 'static', label: 'Works as prop_static', on: opts.staticOnly, title: 'Compiled with $staticprop and without physics data', test: (i) => i.static },
      { id: 'skins', label: 'Has skins', on: false, test: (i) => i.skins > 1 },
      sizeChip,
    ],
    toolbar: (refresh) => {
      const sel = h('select.fchip-select', { 'aria-label': 'Size' }, h('option', { value: '' }, 'Size: any'), ...SIZE_CLASSES.map((c) => h('option', { value: c.id }, c.label))) as HTMLSelectElement;
      sel.value = size;
      sel.addEventListener('change', () => { size = sel.value as SizeClass | ''; sizeChip.on = !!size; refresh(); });
      return [sel];
    },
    status: (shown, hidden, src) => `${src.label} · ${shown} shown${hidden ? `, ${hidden} hidden by filters` : ''}`,
    tile: (i, el, whenVisible) => {
      const img = h('img', { alt: '' }) as HTMLImageElement;
      el.append(h('div.th', {}, img), h('div.nm', {}, i.name));
      const n = used.get(i.path);
      if (n) el.append(h('span.badge', {}, `in map ×${n}`));
      if (favouriteModels.has(i.path)) el.append(h('span.fav', {}, '★'));
      whenVisible(() => void modelThumbnail(editor, i.path).then((u) => { if (u) img.src = u; else img.classList.add('missing'); }));
    },
    detail: (i, use, close, refresh) => {
      if (skin >= i.skins) skin = 0;
      const canvas = h('canvas', { width: 340, height: 260, 'aria-label': 'Model preview' }) as HTMLCanvasElement;
      const failed = h('span.preview-msg', {}, 'Loading…');
      let setSkin: ((s: number) => void) | null = null;
      void modelPreview(editor, canvas, i.path, skin).then((f) => { setSkin = f; failed.textContent = f ? '' : 'This model could not be loaded.'; });
      const skins = h('div.skins', {}, ...Array.from({ length: Math.min(i.skins, 16) }, (_, s) => {
        const img = h('img', { alt: '' }) as HTMLImageElement;
        void modelThumbnail(editor, i.path, s, 56).then((u) => u && (img.src = u));
        return h(s === skin ? 'button.sk.on' : 'button.sk', { title: `Skin ${s}`, onclick: (e: MouseEvent) => {
          skin = s;
          setSkin?.(s);
          for (const b of skins.children) b.classList.toggle('on', b === e.currentTarget);
        } }, img, h('span', {}, String(s)));
      }));
      const note = staticNote(i);
      const n = used.get(i.path) ?? 0;
      return h('div.pd', {},
        h('div.preview', {}, canvas, failed, h('span.preview-hint', {}, 'Drag to orbit · scroll to zoom')),
        h('div', {}, h('div.pd-name', {}, i.name), h('div.pd-path', {}, i.path)),
        i.skins > 1 ? h('div', {}, h('h3', {}, 'Skin'), skins) : null,
        h('div.kv', {},
          h('span', {}, 'Size'), h('span', {}, `${i.size.join(' × ')} u`),
          h('span', {}, 'Static prop'), h('span', { style: { color: note.ok ? 'var(--ok)' : 'var(--accent-text)' } }, `${note.ok ? '✓' : '⚠'} ${note.text}`),
          h('span', {}, 'In this map'), n ? h('span', {}, `${n} × · `, h('a', { href: '#', onclick: (e: Event) => {
            e.preventDefault();
            close();
            editor.selection.set([], assetUses(editor, 'model', i.path).entities);
          } }, 'select them')) : h('span', {}, 'not used'),
          h('span', {}, 'Materials'), h('span', {}, String(i.materials))),
        h('div', { style: { flex: '1' } }),
        h('div.pd-foot', {},
          h('button.star', { 'aria-label': 'Favourite (F)', 'aria-pressed': String(favouriteModels.has(i.path)), title: 'Favourite (F)', onclick: () => { favouriteModels.toggle(i.path); refresh(); } }, favouriteModels.has(i.path) ? '★' : '☆'),
          h('span', { style: { flex: '1' } }),
          h('button', { onclick: close }, 'Cancel'),
          h('button.primary', { onclick: use }, opts.useLabel)));
    },
    onUse: (i) => {
      recentModels.push(i.path);
      opts.onPick(i.path, skin);
    },
    keys: { f: (i, refresh) => { if (i) { favouriteModels.toggle(i.path); refresh(); } } },
    footer: [h('span', {}, kbd('←', '→', '↑', '↓'), ' browse'), h('span', {}, kbd('Enter'), ' use'), h('span', {}, kbd('F'), ' favourite'), h('span', {}, kbd('Ctrl'), '+', kbd('F'), ' search'),
      h('span', { style: { marginLeft: 'auto' } }, 'Thumbnails are rendered by the editor’s own MDL loader and cached')],
  });
}
