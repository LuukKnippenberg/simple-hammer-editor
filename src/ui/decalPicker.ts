import type { Editor } from '../editor.ts';
import { materialPreview } from '../assets/thumbnails.ts';
import { assetUses, loadAssets, recentAssets, usedInMap } from '../assets/assetCatalog.ts';
import { DECAL_KINDS, MAX_OVERLAYS } from '../edit/overlays.ts';
import { openPicker, kbd, type PickerSource } from './assetPicker.ts';
import { h } from './dom.ts';
import './pickers.css';

export { decalTexture } from '../assets/assetCatalog.ts';

/** Backgrounds a decal is previewed on; B in the picker cycles them. */
export const BACKDROPS = [
  { id: 'checker', label: 'Checker' }, { id: 'concrete', label: 'Concrete' }, { id: 'brick', label: 'Brick' }, { id: 'dark', label: 'Dark' },
] as const;
let backdrop: string = (() => { try { return localStorage.getItem('she.decal.backdrop') ?? 'concrete'; } catch { return 'concrete'; } })();
export const backdropClass = () => `bd-${backdrop}`;
function setBackdrop(id: string): void {
  backdrop = id;
  try { localStorage.setItem('she.decal.backdrop', id); } catch { /* no storage */ }
}

export const overlayCount = (editor: Editor) => editor.doc.entities.filter((e) => e.classname === 'info_overlay').length;

/** The overlay budget: how many of the map's 512 overlays are used, as a bar. */
export function overlayBudget(editor: Editor, adding = 0): HTMLElement {
  const n = overlayCount(editor) + adding;
  return h('div.budget', {},
    h('div.budget-row', {}, h('span', {}, adding ? `Overlays in this map, with ${adding} more` : 'Overlays in this map'), h('span', {}, h('b', {}, String(n)), ` / ${MAX_OVERLAYS}`)),
    h('div.budget-bar', {}, h('div', { style: { width: `${Math.min(100, (n / MAX_OVERLAYS) * 100)}%`, background: n > MAX_OVERLAYS ? 'var(--danger)' : 'var(--accent-2)' } })));
}

/** A decal thumbnail over the current backdrop, with its pixel size once known. */
export function decalThumb(name: string, cls = 'div.th', size = 64, onSize?: (w: number, h: number) => void): HTMLElement {
  const img = h('img', { alt: '' }) as HTMLImageElement;
  if (name) void materialPreview(name, size).then((p) => { if (p) { img.src = p.url; onSize?.(p.width, p.height); } else img.classList.add('missing'); });
  const el = h(cls as 'div', {}, img);
  el.classList.add(backdropClass());
  return el;
}

interface DecalItem {
  id: string;
  name: string;
  folder: 'decals' | 'overlays';
  kind: string;
}

/**
 * Choose a decal: recent, used in this map, by kind or folder; tiles drawn from the VTFs with their alpha
 * over a chosen backdrop; size as a decal and as an overlay; the overlay budget.
 */
export async function openDecalPicker(editor: Editor, opts: {
  current?: string;
  subtitle: string;
  /** Show the Decal / Overlay choice (the Decal tool), with this mode first. */
  mode?: 'decal' | 'overlay';
  useLabel: string;
  onPick: (material: string, mode: 'decal' | 'overlay') => void;
}): Promise<void> {
  const items: DecalItem[] = (await loadAssets('decal')).map((a) => ({ id: a.id, name: a.name, folder: a.badges.includes('overlay') ? 'overlays' : 'decals', kind: a.group }));
  const used = usedInMap(editor, 'decal');
  const recentDecals = recentAssets('decal');
  let mode = opts.mode ?? 'decal';
  let placeAs: '' | 'decals' | 'overlays' = '';
  const placeChip = { id: 'place', label: '', on: false, hidden: true, test: (i: DecalItem) => !placeAs || i.folder === placeAs };
  const swatch = (c: string) => h('span.src-swatch', { style: { background: c } });
  const icon = (c: string, t: string) => h('span.src-icon', { style: { color: c } }, t);
  const sources: PickerSource<DecalItem>[] = [
    { id: 'recent', label: 'Recent', icon: icon('var(--muted)', '⟲'), test: (i) => recentDecals.has(i.id) },
    { id: 'used', label: 'Used in this map', icon: icon('var(--ok)', '●'), test: (i) => used.has(i.id) },
  ];
  const kinds: PickerSource<DecalItem>[] = [
    { id: 'all', label: 'All kinds', icon: swatch('#a3a7a9'), test: () => true },
    ...DECAL_KINDS.map((k) => ({ id: `k:${k.id}`, label: k.label, icon: swatch(k.color), test: (i: DecalItem) => i.kind === k.id })),
    { id: 'k:other', label: 'Other', icon: swatch('#646b74'), test: (i: DecalItem) => i.kind === 'other' },
  ];
  const folders: PickerSource<DecalItem>[] = (['decals', 'overlays'] as const).map((f) => ({ id: `f:${f}`, label: `materials/${f}`, icon: icon('var(--muted)', '▸'), test: (i: DecalItem) => i.folder === f }));
  const cur = opts.current?.toLowerCase();

  openPicker<DecalItem>({
    title: 'Choose a decal',
    subtitle: opts.subtitle,
    className: 'decal-picker',
    items,
    sections: [{ sources }, { heading: 'Kinds', sources: kinds }, { heading: 'Folders', sources: folders, note: 'Blood, gore, bullet impacts and engine decals are left out, as in the old list.' }],
    source: used.size ? 'used' : 'all',
    current: cur,
    searchPlaceholder: 'Search decals: poster, crack, scorch, arrow…',
    searchText: (i) => i.id,
    chips: [placeChip],
    toolbar: (refresh) => [h('span.muted', {}, 'Place as'), h('div.seg', {}, ...([['', 'Any'], ['decals', 'Decal · fixed size'], ['overlays', 'Overlay · any size']] as const).map(([v, l]) =>
      h(placeAs === v ? 'button.active' : 'button', { title: v === 'overlays' ? 'Made as overlays (materials/overlays)' : v === 'decals' ? 'Made as decals (materials/decals)' : '', onclick: () => { placeAs = v; placeChip.on = !!v; refresh(); } }, l)))],
    head: (refresh) => [h('span.muted.small', {}, 'Preview on'), ...BACKDROPS.map((b) =>
      h(`button.bdc.bd-${b.id}${b.id === backdrop ? '.on' : ''}` as 'button', { title: b.label, 'aria-label': `Backdrop: ${b.label}`, onclick: () => { setBackdrop(b.id); refresh(); } }))],
    status: (shown, _hidden, src) => `${src.label} · ${shown} shown`,
    tile: (i, el, whenVisible) => {
      const sz = h('div.sz', {}, ' ');
      const th = h(`div.th.${backdropClass()}` as 'div');
      el.append(th, h('div.nm', {}, i.name), sz);
      const n = used.get(i.id);
      if (n) el.append(h('span.badge', {}, `in map ×${n}`));
      if (i.folder === 'overlays') el.append(h('span.ov', {}, 'overlay'));
      whenVisible(() => th.replaceWith(decalThumb(i.id, 'div.th', 64, (w, hh) => (sz.textContent = `${w} × ${hh} px`))));
    },
    detail: (i, use, close, refresh) => {
      const info = editor.decals.info(i.id);
      const bar = h('div.scale');
      const kv = h('div.kv');
      const big = decalThumb(i.id, 'div.decal-preview', 256, (w, hh) => {
        void info.ready.then(() => {
          // A 64-unit bar at the scale the preview is drawn.
          const img = big.querySelector('img')!;
          const px = img.clientWidth / (info.width || w);
          bar.replaceChildren(h('span', { style: { width: `${Math.max(8, 64 * px)}px` } }), '64 u');
          kv.replaceChildren(
            h('span', {}, 'Texture'), h('span', {}, `${w} × ${hh} px`),
            h('span', {}, 'As a decal'), h('span', {}, `${Math.round(info.width)} × ${Math.round(info.height)} u, fixed`),
            h('span', {}, 'As an overlay'), h('span', {}, 'any size, rotated, flipped'),
            ...inMap);
        });
      });
      big.append(bar);
      const n = used.get(i.id) ?? 0;
      const inMap = [h('span', {}, 'In this map'), n ? h('span', {}, `${n} × · `, h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); close(); editor.selection.set([], assetUses(editor, 'decal', i.id).entities); } }, 'select them')) : h('span', {}, 'not used')];
      kv.append(...inMap);
      return h('div.pd', {},
        big,
        h('div', {}, h('div.pd-name', {}, i.name), h('div.pd-path', {}, `materials/${i.id}.vmt`)),
        kv,
        opts.mode ? h('div', {}, h('h3', {}, 'Place as'), h('div.seg', {}, ...(['decal', 'overlay'] as const).map((m) =>
          h(mode === m ? 'button.active' : 'button', { onclick: () => { mode = m; refresh(); } }, m === 'decal' ? 'Decal' : 'Overlay')))) : null,
        h('div', {}, overlayBudget(editor),
          h('p.hint', {}, 'Overlays only stick to world brushes and can be sized, turned and flipped; a decal takes its texture’s size and projects onto anything.')),
        h('div', { style: { flex: '1' } }),
        h('div.pd-foot', {}, h('span', { style: { flex: '1' } }), h('button', { onclick: close }, 'Cancel'), h('button.primary', { onclick: use }, opts.useLabel)));
    },
    onUse: (i) => {
      recentDecals.push(i.id);
      opts.onPick(i.id, mode);
    },
    keys: { b: (_i, refresh) => { setBackdrop(BACKDROPS[(BACKDROPS.findIndex((b) => b.id === backdrop) + 1) % BACKDROPS.length].id); refresh(); } },
    footer: [h('span', {}, kbd('←', '→', '↑', '↓'), ' browse'), h('span', {}, kbd('Enter'), ' use'), h('span', {}, kbd('B'), ' next backdrop'), h('span', {}, kbd('Ctrl'), '+', kbd('F'), ' search'),
      h('span', { style: { marginLeft: 'auto' } }, 'Tiles are drawn from the VTFs with their alpha, over the chosen backdrop')],
  });
}
