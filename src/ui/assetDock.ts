import type { Editor } from '../editor.ts';
import type { EntityTool } from '../edit/entityTool.ts';
import type { SoundTool } from '../edit/soundTool.ts';
import { modelEntry, sizeClass, SIZE_CLASSES, type SizeClass } from '../assets/modelIndex.ts';
import { modelThumbnail } from '../render/modelViews.ts';
import { materialThumbnail } from '../assets/thumbnails.ts';
import { DECAL_KINDS } from '../edit/overlays.ts';
import { isTyping } from '../render/cameraControls.ts';
import { audio } from '../audio/engine.ts';
import { decalThumb, openDecalPicker } from './decalPicker.ts';
import { openModelPicker } from './modelPicker.ts';
import { setToolButtons } from './toolbar.ts';
import { getPref, setPref } from './prefs.ts';
import { h, toast } from './dom.ts';
import {
  assetGroups, favouriteAssets, loadAssets, recentAssets, searchAssets, startAssetDrag, usedInMap, type AssetItem, type AssetKind,
} from './assetDockStub.ts';
import './assetDock.css';

export type DockSize = 'hidden' | 'strip' | 'open';

/** The dock's controls, for main.ts and scripted tests. */
export interface AssetDock {
  readonly size: DockSize;
  readonly kind: AssetKind;
  setSize(size: DockSize): void;
  /** Shows the dock (at its last size) on a tab. */
  show(kind?: AssetKind): void;
  /** Hidden ↔ the last size it was shown at. */
  toggle(): void;
  /** Types into the search (and shows the dock). */
  search(query: string): void;
  /** Settles once the current tab's grid is drawn. */
  rendered(): Promise<void>;
}

const KINDS: { kind: AssetKind; label: string; plural: string }[] = [
  { kind: 'model', label: 'Models', plural: 'models' },
  { kind: 'material', label: 'Materials', plural: 'materials' },
  { kind: 'decal', label: 'Decals', plural: 'decals' },
  { kind: 'sound', label: 'Sounds', plural: 'sounds' },
];
/** Heights of the two shown sizes; a drag snaps to them, hides below HIDE_BELOW and stops at 60% of the window. */
export const DOCK_HEIGHT = { strip: 132, open: 300 } as const;
const HIDE_BELOW = 64;
const PAGE = 160;

interface Source { id: string; label: string; icon?: string; indent?: boolean; test: (i: AssetItem) => boolean }
interface Chip { id: string; label: string; title: string; test: (i: AssetItem) => boolean; group?: string }

/** Filter chips per tab; `group` chips exclude each other. */
const CHIPS: Record<AssetKind, Chip[]> = {
  model: [
    { id: 'static', label: 'Works as prop_static', title: 'Compiled with $staticprop and without physics data (others are placed as prop_dynamic)', test: (i) => !i.badges.includes('physics') },
    { id: 'skins', label: 'Has skins', title: 'Models with more than one skin', test: (i) => i.badges.includes('skins') },
  ],
  material: [
    { id: 'notool', label: 'Hide tool textures', title: 'Leave out tools/ (nodraw, clip, trigger…)', test: (i) => !i.badges.includes('tool') },
    { id: 'blend', label: 'Blends only', title: 'Materials that blend two textures (for displacements)', test: (i) => i.badges.includes('blend') },
  ],
  decal: [
    { id: 'decal', label: 'Decal', title: 'Made as decals (materials/decals): fixed size', group: 'place', test: (i) => !i.badges.includes('overlay') },
    { id: 'overlay', label: 'Overlay', title: 'Made as overlays (materials/overlays): any size', group: 'place', test: (i) => i.badges.includes('overlay') },
  ],
  sound: [{ id: 'loop', label: 'Loops', title: 'Sounds that play continuously', test: (i) => i.badges.includes('loop') }],
};
const CHIPS_ON: Record<string, boolean> = { static: true, notool: true };

/** The dock height a resize drag ends on: hidden, one of the two snaps, or free above Open. */
export function snapDockHeight(px: number): { size: DockSize; height: number } {
  if (px < HIDE_BELOW) return { size: 'hidden', height: 0 };
  if (px < (DOCK_HEIGHT.strip + DOCK_HEIGHT.open) / 2) return { size: 'strip', height: DOCK_HEIGHT.strip };
  if (px < DOCK_HEIGHT.open + 40) return { size: 'open', height: DOCK_HEIGHT.open };
  return { size: 'open', height: Math.round(px) };
}

/** The asset path as the map stores it (the model key, the material name, the sound path under sound/). */
const keyOf = (s: string) => s.toLowerCase().replace(/\\/g, '/');

/** What the tool for `kind` uses now, so its tile shows as current. */
function currentAsset(editor: Editor, kind: AssetKind): string {
  if (kind === 'model') return keyOf(editor.entityModel);
  if (kind === 'material') return editor.currentMaterial.toLowerCase();
  if (kind === 'decal') return editor.decal.material.toLowerCase();
  return keyOf((editor.tools.tools.sound as SoundTool).sound);
}

/**
 * Makes an asset the current one of its tool and switches to that tool: a model goes to the Entity tool (as
 * prop_static, or prop_dynamic when vbsp would delete it as a static prop), a material to Paint, a decal to
 * Decal, a sound to the Sound tool's local sound.
 */
export function useAsset(editor: Editor, item: AssetItem): void {
  recentAssets(item.kind).push(item.id);
  if (item.kind === 'model') {
    editor.entityModel = item.id;
    const dynamic = item.badges.includes('physics');
    (editor.tools.tools.entity as EntityTool).setClass(dynamic ? 'prop_dynamic' : 'prop_static');
    setToolButtons(editor, 'entity');
    if (dynamic) toast(editor.container, `${item.name}: placed as prop_dynamic (vbsp deletes it as a prop_static)`, 3500);
  } else if (item.kind === 'material') {
    editor.setMaterial(item.id);
    setToolButtons(editor, 'paint');
  } else if (item.kind === 'decal') {
    editor.decal.material = item.id;
    editor.emit('decal');
    setToolButtons(editor, 'decal');
  } else {
    const tool = editor.tools.tools.sound as SoundTool;
    tool.mode = 'sound';
    tool.local = 'file';
    tool.sound = item.id;
    setToolButtons(editor, 'sound');
  }
}

/** Selects every brush or entity in the map that uses the asset; returns how many. */
export function selectUses(editor: Editor, item: AssetItem): number {
  const id = item.id;
  if (item.kind === 'material') {
    const solids = editor.doc.allSolids().filter((s) => s.sides.some((side) => side.material.toLowerCase() === id));
    editor.selection.set(solids, []);
    return solids.length;
  }
  const value = (e: (typeof editor.doc.entities)[number]) =>
    item.kind === 'model' ? e.get('model')
      : item.kind === 'decal' ? (e.classname === 'infodecal' ? e.get('texture') : e.classname === 'info_overlay' ? e.get('material') : undefined)
        : e.classname === 'ambient_generic' ? e.get('message') : undefined;
  const ents = editor.doc.entities.filter((e) => keyOf(value(e) ?? '') === id);
  editor.selection.set([], ents);
  return ents.length;
}

const plural = (n: number, word: string) => `${n.toLocaleString('en')} ${n === 1 ? word.replace(/s$/, '') : word}`;

/**
 * The asset finder: a dock under the 3D view with Models, Materials, Decals and Sounds. Sources on the left
 * (favourites, recent, used in this map, folders), filter chips and a paged tile grid. Click a tile to make it its
 * tool's asset, drag it into the view to place it, right-click for more. Hidden, Strip or Open; drag the top
 * edge to resize, double-click it to switch Strip ↔ Open. B shows or hides it, / searches. The ▤ Assets button
 * goes into `statusSlot`.
 */
export function mountAssetDock(editor: Editor, dock: HTMLElement, statusSlot: HTMLElement): AssetDock {
  const saved = getPref('assetDock');
  let size: DockSize = saved?.size ?? 'hidden';
  let last: 'strip' | 'open' = saved?.last ?? 'open';
  let height = Math.max(DOCK_HEIGHT.open, saved?.height ?? DOCK_HEIGHT.open);
  let kind: AssetKind = KINDS.some((k) => k.kind === saved?.tab) ? saved!.tab as AssetKind : 'model';
  const sources: Record<string, string> = { ...saved?.sources };
  const chipOn: Record<string, boolean> = { ...CHIPS_ON };
  let modelSize: SizeClass | '' = '';
  const used = new Map<AssetKind, Map<string, number>>();
  const usedOf = (k: AssetKind) => {
    let u = used.get(k);
    if (!u) used.set(k, (u = usedInMap(editor, k)));
    return u;
  };
  const save = () => setPref('assetDock', { size, last, height: height > DOCK_HEIGHT.open ? height : undefined, tab: kind, sources });

  // ---- layout ----
  const edge = h('div.ad-edge', { title: 'Drag to resize · double-click: Strip or Open' });
  const tabs = h('div.ad-tabs', { role: 'tablist', 'aria-label': 'Asset kinds' });
  const search = h('input.ad-search', { type: 'search', placeholder: 'Search models…', 'aria-label': 'Search assets', spellcheck: false }) as HTMLInputElement;
  const others = h('span.ad-others');
  const sizeSeg = h('div.seg.ad-size');
  const nav = h('nav.ad-nav', { 'aria-label': 'Sources' });
  const chips = h('div.ad-chips');
  const count = h('span.ad-count');
  const grid = h('div.ad-grid', { tabindex: 0, role: 'listbox', 'aria-label': 'Assets' });
  const keyHint = h('div.ad-keys', {},
    h('span', {}, h('b', {}, 'Click'), ' sets the tool’s asset'),
    h('span', {}, h('b', {}, 'Drag'), ' into the view to place it'),
    h('span', {}, h('b', {}, 'Right-click'), ' favourite · select uses · copy path · picker'),
    h('span', { style: { marginLeft: 'auto' } }, h('kbd', {}, '← → ↑ ↓'), ' ', h('kbd', {}, 'Enter'), ' ', h('kbd', {}, 'F'), ' in the grid · ', h('kbd', {}, '/'), ' search · ', h('kbd', {}, 'B'), ' hide'));
  dock.append(edge,
    h('div.ad-head', {}, tabs, search, others, h('span', { style: { flex: '1' } }), sizeSeg,
      h('button.ad-x', { title: 'Hide (B)', 'aria-label': 'Hide the asset finder', onclick: () => setSize('hidden') }, '✕')),
    h('div.ad-body', {}, nav, h('div.ad-main', {}, h('div.ad-bar', {}, chips, h('span', { style: { flex: '1' } }), count), grid, keyHint)));
  const button = h('button.ad-toggle', { title: 'Asset finder: models, materials, decals and sounds (B)', onclick: () => toggle() }, '▤ Assets ', h('kbd', {}, 'B'));
  statusSlot.append(button);

  function applySize(): void {
    dock.hidden = size === 'hidden';
    dock.classList.toggle('strip', size === 'strip');
    dock.style.height = size === 'hidden' ? '' : `${size === 'strip' ? DOCK_HEIGHT.strip : Math.min(height, Math.round(window.innerHeight * 0.6))}px`;
    button.classList.toggle('active', size !== 'hidden');
    sizeSeg.replaceChildren(...(['strip', 'open'] as const).map((s) => h(s === size ? 'button.active' : 'button', { title: s === 'strip' ? 'One row of tiles' : 'Sources, filters and a grid', onclick: () => setSize(s) }, s === 'strip' ? 'Strip' : 'Open')));
  }

  function setSize(s: DockSize): void {
    const was = size;
    size = s;
    if (s !== 'hidden') last = s;
    applySize();
    save();
    if (s !== 'hidden' && was !== s) void render();
    if (s === 'hidden') { hideMenu(); if (dock.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); }
  }
  const toggle = () => setSize(size === 'hidden' ? last : 'hidden');

  function setKind(k: AssetKind): void {
    kind = k;
    save();
    void render();
  }

  // ---- lists ----
  function sourceList(items: AssetItem[]): Source[] {
    const u = usedOf(kind), fav = favouriteAssets(kind), rec = recentAssets(kind);
    const label = (g: string) => (kind === 'decal' ? DECAL_KINDS.find((d) => d.id === g)?.label ?? (g === 'other' ? 'Other' : g) : g);
    return [
      { id: 'fav', label: 'Favourites', icon: '★', test: (i) => fav.has(i.id) },
      { id: 'recent', label: 'Recent', icon: '⟲', test: (i) => rec.has(i.id) },
      { id: 'used', label: 'Used in this map', icon: '●', test: (i) => u.has(i.id) },
      { id: 'all', label: `All ${KINDS.find((x) => x.kind === kind)!.plural}`, icon: '▾', test: () => true },
      ...assetGroups(items).map(({ group }) => ({ id: `g:${group}`, label: label(group), indent: true, test: (i: AssetItem) => i.group === group })),
    ];
  }

  /** The source to show: the remembered one, else Used in this map, else All. */
  function pickSource(list: Source[], items: AssetItem[]): Source {
    const want = list.find((s) => s.id === sources[kind]);
    if (want) return want;
    return list.find((s) => s.id === 'used' && items.some(s.test)) ?? list.find((s) => s.id === 'all')!;
  }

  /** Sorts a source's items: used ones by count, recent and favourites in their list order. */
  function ordered(src: Source, list: AssetItem[]): AssetItem[] {
    if (src.id === 'used') { const u = usedOf(kind); return [...list].sort((a, b) => u.get(b.id)! - u.get(a.id)!); }
    if (src.id === 'recent' || src.id === 'fav') {
      const order = (src.id === 'fav' ? favouriteAssets(kind) : recentAssets(kind)).items.map(keyOf);
      return [...list].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
    return list;
  }

  function chipFilter(list: AssetItem[]): AssetItem[] {
    const on = CHIPS[kind].filter((c) => chipOn[c.id]);
    return list.filter((i) => on.every((c) => c.test(i)) && (kind !== 'model' || !modelSize || sizeClass(modelEntry(i.id) ?? { size: [0, 0, 0] }) === modelSize));
  }

  // ---- tiles ----
  const observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      observer.unobserve(en.target);
      (en.target as HTMLElement & { load?: () => void }).load?.();
    }
  }, { root: grid, rootMargin: '200px' });

  function tile(item: AssetItem, index: number): HTMLElement {
    const n = usedOf(item.kind).get(item.id);
    const marks = [
      ...item.badges.filter((b) => b !== 'skins').slice(0, 1).map((b) => h(`span.bd.bd-is-${b}` as 'span', {}, b)),
      n ? h('span.used', { title: `${n} in this map` }, `×${n}`) : null,
      favouriteAssets(item.kind).has(item.id) ? h('span.fav', { title: 'Favourite' }, '★') : null,
    ];
    const on = item.id === currentAsset(editor, item.kind);
    let el: HTMLElement & { load?: () => void };
    if (item.kind === 'sound') {
      el = h(on ? 'div.ad-row.on' : 'div.ad-row', { title: item.id },
        h('button.ad-play', { title: 'Play', 'aria-label': `Play ${item.name}`, onclick: (e: Event) => { e.stopPropagation(); void audio.preview(`sound/${item.id}`); } }, '▶'),
        h('span.ad-path', {}, item.id), ...marks);
    } else {
      const img = h('img', { alt: '', draggable: false }) as HTMLImageElement;
      const th = h('div.th', {}, img);
      el = h(on ? 'div.ad-tile.on' : 'div.ad-tile', { title: item.id }, th, h('div.nm', {}, item.name), ...marks);
      el.load = () => {
        const show = (u: string | null) => (u ? (img.src = u) : img.classList.add('missing'));
        if (item.kind === 'model') void modelThumbnail(editor, item.id, 0, 96).then(show);
        else if (item.kind === 'material') void materialThumbnail(item.id).then(show);
        else th.replaceWith(decalThumb(item.id, 'div.th', 64));
      };
      observer.observe(el);
    }
    el.tabIndex = -1;
    el.setAttribute('role', 'option');
    el.dataset.index = String(index);
    el.dataset.id = item.id;
    return el;
  }

  // ---- render ----
  let shown: AssetItem[] = [];
  let paged = PAGE;
  let cursor = 0;
  let renderId = 0;
  let renderDone: Promise<void> = Promise.resolve();

  function renderTabs(): void {
    tabs.replaceChildren(...KINDS.map((k) => h(k.kind === kind ? 'button.on' : 'button', {
      role: 'tab', 'aria-selected': String(k.kind === kind), onclick: () => setKind(k.kind),
    }, k.label)));
    search.placeholder = `Search ${KINDS.find((k) => k.kind === kind)!.plural}…   /`;
  }

  function renderChips(): void {
    const list = CHIPS[kind].map((c) => h(chipOn[c.id] ? 'button.fchip.on' : 'button.fchip', {
      title: c.title, 'aria-pressed': String(!!chipOn[c.id]),
      onclick: () => {
        const was = chipOn[c.id];
        if (c.group) for (const o of CHIPS[kind]) if (o.group === c.group) chipOn[o.id] = false;
        chipOn[c.id] = !was;
        void render();
      },
    }, chipOn[c.id] ? `✓ ${c.label}` : c.label));
    if (kind === 'model') {
      const sel = h('select.fchip-select', { 'aria-label': 'Size' }, h('option', { value: '' }, 'Size: any'),
        ...SIZE_CLASSES.map((c) => h('option', { value: c.id }, c.label))) as HTMLSelectElement;
      sel.value = modelSize;
      sel.addEventListener('change', () => { modelSize = sel.value as SizeClass | ''; void render(); });
      list.push(sel as unknown as HTMLButtonElement);
    }
    chips.replaceChildren(...list);
  }

  /** "+21 materials · +2 decals": hits for the search in the other tabs; a click goes there. */
  async function renderOthers(id: number, query: string): Promise<void> {
    if (!query) { others.replaceChildren(); return; }
    const hits = await Promise.all(KINDS.filter((k) => k.kind !== kind).map(async (k) => ({ k, n: searchAssets(await loadAssets(k.kind), query).length })));
    if (id !== renderId) return;
    others.replaceChildren(...hits.filter((x) => x.n).map(({ k, n }) =>
      h('button.ad-other', { title: `Show the ${k.plural} that match`, onclick: () => setKind(k.kind) }, `+${n.toLocaleString('en')} ${n === 1 ? k.plural.replace(/s$/, '') : k.plural}`)));
  }

  async function draw(): Promise<void> {
    const id = ++renderId;
    renderTabs();
    if (size === 'hidden') return;
    const query = search.value.trim();
    const k = kind;
    const others$ = renderOthers(id, query);
    if (!grid.childElementCount) grid.replaceChildren(h('p.hint', {}, 'Loading…'));
    const items = await loadAssets(k);
    if (id !== renderId) return;
    const srcs = sourceList(items);
    const src = pickSource(srcs, items);
    const counts = new Map(assetGroups(items).map((g) => [`g:${g.group}`, g.count]));
    nav.replaceChildren(...srcs.map((s) => h(s === src && !query ? 'div.src.on' : 'div.src', {
      role: 'button', tabindex: -1, style: s.indent ? { paddingLeft: '20px' } : undefined, title: s.label,
      onclick: () => { sources[kind] = s.id; search.value = ''; save(); void render(); },
    }, s.icon ? h('span.src-icon', {}, s.icon) : null, h('span.src-label', {}, s.label), h('span.n', {}, String(counts.get(s.id) ?? (s.id === 'all' ? items.length : items.filter(s.test).length))))));
    const base = query ? searchAssets(items, query) : ordered(src, items.filter(src.test));
    shown = chipFilter(base);
    const hidden = base.length - shown.length;
    renderChips();
    count.textContent = `${query ? `“${query}”` : src.label} · ${plural(shown.length, KINDS.find((x) => x.kind === k)!.plural)}${hidden ? ` (${hidden.toLocaleString('en')} hidden by filters)` : ''}`;
    paged = PAGE;
    cursor = 0;
    grid.classList.toggle('rows', k === 'sound');
    grid.scrollTop = grid.scrollLeft = 0;
    grid.replaceChildren(...shown.slice(0, paged).map(tile));
    if (!shown.length) grid.append(h('p.hint', {}, query ? `No ${KINDS.find((x) => x.kind === k)!.plural} match “${query}”.` : 'Nothing here yet.'));
    await others$;
  }

  function render(): Promise<void> {
    renderDone = draw();
    return renderDone;
  }

  /** Adds the next page of tiles. */
  function more(): boolean {
    if (paged >= shown.length) return false;
    const from = paged;
    paged += PAGE;
    grid.append(...shown.slice(from, paged).map((it, i) => tile(it, from + i)));
    return true;
  }
  grid.addEventListener('scroll', () => {
    const end = size === 'strip'
      ? grid.scrollLeft + grid.clientWidth > grid.scrollWidth - 400
      : grid.scrollTop + grid.clientHeight > grid.scrollHeight - 400;
    if (end) more();
  });

  // ---- tile input: click uses, drag places, right-click menu ----
  const tileOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.<HTMLElement>('.ad-tile, .ad-row') ?? null;
  const itemOf = (el: HTMLElement) => shown[Number(el.dataset.index)];
  let dragged = false;
  grid.addEventListener('pointerdown', (e) => {
    const el = tileOf(e.target);
    dragged = false;
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const item = itemOf(el);
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      stop();
      dragged = true;
      startAssetDrag(item.kind, item.id, ev);
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  });
  grid.addEventListener('click', (e) => {
    const el = tileOf(e.target);
    if (!el || dragged || (e.target as HTMLElement).closest('button')) return;
    pick(Number(el.dataset.index));
  });

  function pick(index: number): void {
    const item = shown[index];
    if (!item) return;
    setCursor(index, false);
    useAsset(editor, item);
    markCurrent();
  }

  function markCurrent(): void {
    const cur = currentAsset(editor, kind);
    for (const t of grid.querySelectorAll<HTMLElement>('.ad-tile, .ad-row')) t.classList.toggle('on', t.dataset.id === cur);
  }

  function toggleFavourite(item: AssetItem): void {
    favouriteAssets(item.kind).toggle(item.id);
    const on = favouriteAssets(item.kind).has(item.id);
    const el = grid.querySelector<HTMLElement>(`[data-index="${shown.indexOf(item)}"]`);
    el?.querySelector('.fav')?.remove();
    if (on) el?.append(h('span.fav', { title: 'Favourite' }, '★'));
    toast(editor.container, `${item.name}: ${on ? 'added to' : 'removed from'} favourites`, 1500);
    // The source counts change; redraw the column only.
    const fav = nav.querySelector('.src .n');
    if (fav) fav.textContent = String(favouriteAssets(item.kind).items.length);
  }

  const menu = h('div.ad-menu', { hidden: true, role: 'menu' });
  document.body.append(menu);
  function hideMenu(): void { menu.hidden = true; }
  function showMenu(item: AssetItem, x: number, y: number): void {
    const entry = (label: string, fn: () => void) => h('button', { role: 'menuitem', onclick: () => { hideMenu(); fn(); } }, label);
    const fav = favouriteAssets(item.kind).has(item.id);
    menu.replaceChildren(
      h('div.ad-menu-head', {}, item.id),
      entry(fav ? '☆ Remove from favourites' : '★ Favourite', () => toggleFavourite(item)),
      entry('Select every use in this map', () => {
        const n = selectUses(editor, item);
        toast(editor.container, n ? `Selected ${n} ${item.kind === 'material' ? (n === 1 ? 'brush' : 'brushes') : n === 1 ? 'entity' : 'entities'} using ${item.name}` : `${item.name} is not used in this map`);
      }),
      entry('Copy path', () => {
        void navigator.clipboard?.writeText(item.id).then(() => toast(editor.container, `Copied ${item.id}`, 1500), () => toast(editor.container, 'Copy failed'));
      }),
    );
    if (item.kind === 'model' || item.kind === 'decal') menu.append(entry(`Open in the ${item.kind} picker…`, () => openPickerFor(item)));
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  }
  grid.addEventListener('contextmenu', (e) => {
    const el = tileOf(e.target);
    if (!el) return;
    e.preventDefault();
    setCursor(Number(el.dataset.index), false);
    showMenu(itemOf(el), e.clientX, e.clientY);
  });
  window.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target as Node)) hideMenu(); }, true);
  grid.addEventListener('scroll', hideMenu);

  /** The model and decal pickers have what the dock has no room for: skins, the live preview, the overlay budget. */
  function openPickerFor(item: AssetItem): void {
    const done = () => { void render(); };
    if (item.kind === 'model') {
      void openModelPicker(editor, {
        current: item.id, subtitle: 'for the Entity tool', staticOnly: !item.badges.includes('physics'), useLabel: 'Use model',
        onPick: (path, skin) => {
          useAsset(editor, { ...item, id: path, name: path.split('/').pop()!, badges: modelEntry(path)?.static === false ? ['physics'] : [] });
          const keys = (editor.tools.tools.entity as EntityTool).optionsFor(editor.entityClass).keys;
          if (skin) keys.skin = String(skin);
          else delete keys.skin;
          editor.emit('entityclass');
          done();
        },
      });
    } else {
      void openDecalPicker(editor, {
        current: item.id, subtitle: 'for the Decal tool', mode: editor.decal.mode, useLabel: 'Use decal',
        onPick: (material, mode) => {
          editor.decal.mode = mode;
          useAsset(editor, { ...item, id: material, name: material.split('/').pop()! });
          done();
        },
      });
    }
  }

  // ---- keys ----
  function setCursor(index: number, focus = true): void {
    if (!shown.length) return;
    cursor = Math.max(0, Math.min(shown.length - 1, index));
    while (cursor >= paged && more()) { /* page in */ }
    const el = grid.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    if (focus && el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /** Tiles per line in the direction the grid flows: per row when Open, per column in the Strip. */
  function perLine(): number {
    const tiles = [...grid.querySelectorAll<HTMLElement>('.ad-tile, .ad-row')];
    if (!tiles.length) return 1;
    const along = size === 'strip' ? (t: HTMLElement) => t.offsetLeft : (t: HTMLElement) => t.offsetTop;
    const first = along(tiles[0]);
    let n = 0;
    while (n < tiles.length && along(tiles[n]) === first) n++;
    return Math.max(1, n);
  }

  grid.addEventListener('focus', () => setCursor(cursor));
  grid.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const n = perLine();
    const strip = size === 'strip';
    const step: Record<string, number> = strip
      ? { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -n, ArrowRight: n }
      : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -n, ArrowDown: n };
    if (e.key in step) setCursor(cursor + step[e.key]);
    else if (e.key === 'Enter') pick(cursor);
    else if (e.key.toLowerCase() === 'f' && shown[cursor]) toggleFavourite(shown[cursor]);
    else if (e.key === 'Escape') (document.activeElement as HTMLElement)?.blur();
    else return;
    // Kept from the camera (arrows fly) and the global shortcuts (F focuses the selection).
    e.preventDefault();
    e.stopPropagation();
  });

  let timer = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void render(), 150);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') search.blur();
    else if ((e.key === 'ArrowDown' || e.key === 'Enter') && shown.length) setCursor(0);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener('keydown', (e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-backdrop:not([hidden])')) return;
    if (e.code === 'KeyB' && !e.shiftKey) toggle();
    else if (e.key === '/') {
      if (size === 'hidden') setSize(last);
      search.focus();
      search.select();
    } else return;
    e.preventDefault();
  });

  // Resize by the top edge: live while dragging, then snapped.
  edge.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const y0 = e.clientY, h0 = dock.offsetHeight;
    edge.setPointerCapture(e.pointerId);
    let px = h0;
    const move = (ev: PointerEvent) => {
      px = Math.max(0, Math.min(window.innerHeight * 0.6, h0 + y0 - ev.clientY));
      dock.style.height = `${Math.max(HIDE_BELOW / 2, px)}px`;
      dock.classList.toggle('strip', px < (DOCK_HEIGHT.strip + DOCK_HEIGHT.open) / 2);
    };
    const up = () => {
      edge.removeEventListener('pointermove', move);
      edge.removeEventListener('pointerup', up);
      const snap = snapDockHeight(px);
      if (snap.size === 'open') height = snap.height;
      setSize(snap.size);
    };
    edge.addEventListener('pointermove', move);
    edge.addEventListener('pointerup', up);
    e.preventDefault();
  });
  edge.addEventListener('dblclick', () => setSize(size === 'strip' ? 'open' : 'strip'));
  window.addEventListener('resize', () => { if (size === 'open') applySize(); });

  // The one-time hint: on the first Change… click or the first use of the Paint or Decal tool.
  function hint(): void {
    if (getPref('assetHint') || size !== 'hidden') return;
    setPref('assetHint', true);
    const bubble = h('div.ad-bubble', { role: 'status' },
      h('span', {}, 'Try the asset finder ', h('kbd', {}, 'B')),
      h('button.primary', { onclick: () => { bubble.remove(); setSize(last); } }, 'Open'),
      h('button.ad-x', { 'aria-label': 'Dismiss', onclick: () => bubble.remove() }, '✕'));
    document.body.append(bubble);
    const r = button.getBoundingClientRect();
    bubble.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    bubble.style.bottom = `${window.innerHeight - r.top + 8}px`;
    setTimeout(() => bubble.remove(), 12000);
  }
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement | null)?.closest?.('button');
    if (b && /^(Change…|Set for all)/.test(b.textContent ?? '')) hint();
  }, true);
  editor.on('toolchange', () => {
    const t = editor.tools.current.name;
    if (t === 'paint' || t === 'decal') hint();
    if (size !== 'hidden') markCurrent();
  });
  for (const ev of ['material', 'decal', 'entityclass']) editor.on(ev, () => { if (size !== 'hidden') markCurrent(); });

  // "Used in this map" belongs to the map that is open; edits change the counts for the next draw.
  editor.on('change', () => used.clear());
  editor.on('document', () => { used.clear(); if (size !== 'hidden') void render(); });

  applySize();
  renderTabs();
  if (size !== 'hidden') void render();

  return {
    get size() { return size; },
    get kind() { return kind; },
    setSize,
    show(k) {
      if (k && k !== kind) { kind = k; save(); }
      if (size === 'hidden') setSize(last);
      else void render();
    },
    toggle,
    search(q) {
      search.value = q;
      if (size === 'hidden') setSize(last);
      else void render();
    },
    rendered: () => renderDone,
  };
}
