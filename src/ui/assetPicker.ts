import { h, scrollIntoList } from './dom.ts';
import { isTyping } from '../render/cameraControls.ts';
import './pickers.css';

/** A list on the picker's left: Recent, Used in this map, a folder, a kind of decal. */
export interface PickerSource<T> {
  id: string;
  label: string;
  icon?: string | HTMLElement;
  test: (item: T) => boolean;
  indent?: boolean;
}

/** A filter chip above the grid. */
export interface PickerChip<T> {
  id: string;
  label: string;
  on: boolean;
  test: (item: T) => boolean;
  title?: string;
  /** Driven by a toolbar control instead of a chip of its own. */
  hidden?: boolean;
}

export interface PickerOptions<T extends { id: string }> {
  title: string;
  subtitle: string;
  items: T[];
  sections: { heading?: string; sources: PickerSource<T>[]; note?: string }[];
  /** The source shown first. */
  source: string;
  /** The item selected first. */
  current?: string;
  searchPlaceholder: string;
  searchText: (item: T) => string;
  chips?: PickerChip<T>[];
  /** Extra controls in the filter bar (size, place as, ...); call `refresh` after a change. */
  toolbar?: (refresh: () => void) => HTMLElement[];
  /** Extra controls in the head (decal backdrops). */
  head?: (refresh: () => void) => HTMLElement[];
  /** Above the grid, right: what is shown. `hidden` counts items the chips hid. */
  status: (shown: number, hidden: number, source: PickerSource<T>) => string;
  /** Fills a tile; `whenVisible` runs a thumbnail load once the tile scrolls into view. */
  tile: (item: T, el: HTMLElement, whenVisible: (fn: () => void) => void) => void;
  detail: (item: T, use: () => void, close: () => void, refresh: () => void) => HTMLElement;
  onUse: (item: T) => void;
  /** Single-letter shortcuts while the grid has the keyboard (F favourite, B backdrop). */
  keys?: Record<string, (item: T | undefined, refresh: () => void) => void>;
  footer: (HTMLElement | string)[];
  className?: string;
}

const PAGE = 120;

/**
 * The model and decal pickers' shared dialog: sources on the left, search and filter chips over a tile
 * grid, details of the selected tile on the right. Arrow keys browse, Enter uses, Ctrl+F searches.
 */
export function openPicker<T extends { id: string }>(o: PickerOptions<T>): { close: () => void } {
  document.querySelector('.picker-backdrop')?.remove();
  const backdrop = h('div.modal-backdrop.picker-backdrop');
  const dialog = h(`div.picker${o.className ? '.' + o.className : ''}` as 'div', { role: 'dialog', 'aria-label': o.title, tabindex: -1 });
  backdrop.append(dialog);
  const close = () => {
    backdrop.remove();
    observer.disconnect();
    window.removeEventListener('keydown', onKey, true);
  };
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(); });

  let source = o.sections.flatMap((s) => s.sources).find((s) => s.id === o.source) ?? o.sections[0].sources[0];
  let selected = o.items.find((i) => i.id === o.current);
  let list: T[] = [];
  let shownCount = PAGE;

  const search = h('input.picker-search', { placeholder: o.searchPlaceholder, 'aria-label': o.searchPlaceholder.split(':')[0] }) as HTMLInputElement;
  const nav = h('nav.picker-nav', { 'aria-label': 'Sources' });
  const chipsEl = h('div.picker-chips');
  const statusEl = h('span.picker-status');
  const grid = h('div.picker-grid', { role: 'listbox', 'aria-label': o.title });
  const detail = h('aside.picker-detail');
  const headExtra = h('div.picker-head-extra');

  const visible = new WeakMap<Element, () => void>();
  const observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      observer.unobserve(en.target);
      visible.get(en.target)?.();
    }
  }, { root: grid, rootMargin: '200px' });

  const use = (item: T | undefined) => {
    if (!item) return;
    close();
    o.onUse(item);
  };
  const renderDetail = () => detail.replaceChildren(selected ? o.detail(selected, () => use(selected), close, refresh) : h('p.hint', {}, 'Choose a tile to see it here.'));
  const select = (item: T, scroll = false) => {
    selected = item;
    for (const t of grid.querySelectorAll<HTMLElement>('.ptile')) {
      const on = t.dataset.id === item.id;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', String(on));
      if (on && scroll) scrollIntoList(t, grid);
    }
    renderDetail();
  };

  const renderNav = () => nav.replaceChildren(...o.sections.flatMap((sec): (HTMLElement | null)[] => [
    sec.heading ? h('h3', {}, sec.heading) : null,
    ...sec.sources.map((s) => {
      const n = o.items.filter(s.test).length;
      return h(s.id === source.id ? 'div.src.on' : 'div.src', { role: 'button', tabindex: 0, style: s.indent ? { paddingLeft: '22px' } : undefined, onclick: () => { source = s; shownCount = PAGE; refresh(); } },
        s.icon ?? null, h('span.src-label', {}, s.label), h('span.n', {}, String(n)));
    }),
    sec.note ? h('p.picker-note', {}, sec.note) : null,
  ]).filter((x): x is HTMLElement => !!x));

  const renderChips = () => chipsEl.replaceChildren(...(o.chips ?? []).filter((c) => !c.hidden).map((c) =>
    h(c.on ? 'button.fchip.on' : 'button.fchip', { title: c.title, 'aria-pressed': String(c.on), onclick: () => { c.on = !c.on; refresh(); } }, c.on ? `✓ ${c.label}` : c.label)));

  const renderGrid = () => {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // A search looks through everything; otherwise the chosen source.
    const base = o.items.filter((i) => (words.length ? true : source.test(i)) && words.every((w) => o.searchText(i).includes(w)));
    const chips = (o.chips ?? []).filter((c) => c.on);
    list = base.filter((i) => chips.every((c) => c.test(i)));
    statusEl.textContent = o.status(list.length, base.length - list.length, words.length ? { id: 'search', label: `“${search.value.trim()}”`, test: () => true } : source);
    grid.replaceChildren(...list.slice(0, shownCount).map((item) => {
      const el = h(item.id === selected?.id ? 'div.ptile.on' : 'div.ptile', {
        role: 'option', 'aria-selected': String(item.id === selected?.id), title: item.id,
        onclick: () => select(item), ondblclick: () => use(item),
      });
      el.dataset.id = item.id;
      o.tile(item, el, (fn) => { visible.set(el, fn); observer.observe(el); });
      return el;
    }));
    if (!list.length) grid.append(h('p.hint', {}, 'Nothing matches.'));
  };
  grid.addEventListener('scroll', () => {
    if (grid.scrollTop + grid.clientHeight < grid.scrollHeight - 300 || shownCount >= list.length) return;
    const from = shownCount;
    shownCount += PAGE;
    const more = list.slice(from, shownCount);
    for (const item of more) {
      const el = h('div.ptile', { role: 'option', 'aria-selected': 'false', title: item.id, onclick: () => select(item), ondblclick: () => use(item) });
      el.dataset.id = item.id;
      o.tile(item, el, (fn) => { visible.set(el, fn); observer.observe(el); });
      grid.append(el);
    }
  });

  const toolbar = h('div.picker-tools');
  const refresh = () => {
    renderNav();
    renderChips();
    toolbar.replaceChildren(...o.toolbar?.(refresh) ?? []);
    headExtra.replaceChildren(...o.head?.(refresh) ?? []);
    renderGrid();
    renderDetail();
  };
  let timer = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => { shownCount = PAGE; renderGrid(); }, 120);
  });

  const columns = () => getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { search.focus(); search.select(); }
    else if (e.key === 'Enter') use(selected ?? list[0]);
    else if (e.key.startsWith('Arrow') && !(e.target === search && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
      const i = selected ? list.findIndex((x) => x.id === selected!.id) : -1;
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns(), ArrowDown: columns() }[e.key] ?? 0;
      const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + step))];
      if (!next) return;
      if (list.indexOf(next) >= shownCount) { shownCount = list.indexOf(next) + PAGE; renderGrid(); }
      if (e.target === search) search.blur();
      select(next, true);
    } else if (!isTyping(e) && !e.ctrlKey && !e.metaKey && !e.altKey && o.keys?.[e.key.toLowerCase()]) o.keys[e.key.toLowerCase()](selected, refresh);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', onKey, true);

  dialog.append(
    h('div.picker-head', {}, h('b', {}, o.title), h('span.muted', {}, o.subtitle), h('span', { style: { flex: '1' } }), headExtra,
      h('button.picker-x', { 'aria-label': 'Close', onclick: close }, '✕')),
    h('div.picker-body', {},
      nav,
      h('section.picker-main', {},
        h('div.picker-bar', {}, search, chipsEl, toolbar, h('span', { style: { flex: '1' } }), statusEl),
        grid,
        h('div.picker-keys', {}, ...o.footer)),
      detail));
  document.body.append(backdrop);
  refresh();
  if (selected) select(selected, true);
  search.focus();
  return { close };
}

/** A key hint for picker footers: `kbd('←', '→')` → ←→. */
export function kbd(...keys: string[]): HTMLElement {
  return h('span', {}, ...keys.map((k) => h('kbd', {}, k)));
}
