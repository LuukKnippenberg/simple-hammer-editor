import { h } from './dom.ts';
import { tip } from './tooltip.ts';

export type BadgeTone = 'accent' | 'danger';

export interface SidebarTabs {
  add(name: string, panel: HTMLElement): void;
  /** A rail item that runs `run` instead of opening a panel (Material opens the asset finder). */
  link(name: string, run: () => void): void;
  /** Opens a panel when code asks for it, whatever is pinned. */
  show(name: string): void;
  /** Opens a panel because of what the user does with a tool, unless a pin holds the current one. */
  follow(name: string, focus?: (panel: HTMLElement) => HTMLElement | null): boolean;
  /** A tool switch: the hold that clicking a panel put on ends (the pin in the header stays). */
  release(): void;
  /** Sets or clears (null) the badge on a rail item; `detail` is said in its tooltip. */
  badge(name: string, text: string | null, tone?: BadgeTone, detail?: string): void;
  setPinned(on: boolean): void;
  readonly current: string | null;
  readonly pinned: boolean;
}

/** Rail items in order; a new group starts a divider. Stroke icons on a 24 px grid. */
const RAIL: { name: string; short: string; group: number; icon: string }[] = [
  { name: 'Selection', short: 'Select', group: 0, icon: 'M5 3l14 7-6 2-2 6z' },
  { name: 'Materials', short: 'Material', group: 1, icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { name: 'Entities', short: 'Entity', group: 1, icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
  { name: 'POI', short: 'POI', group: 1, icon: 'M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12zM12 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z' },
  { name: 'Mission', short: 'Mission', group: 2, icon: 'M12 3a9 9 0 110 18 9 9 0 010-18zM12 8a4 4 0 110 8 4 4 0 010-8z' },
  { name: 'Cinema', short: 'Cinema', group: 2, icon: 'M3 10h18v10H3zM3 10l1.5-5 16 0L19 10M9 5l-2 5M15 5l-2 5' },
  { name: 'Logic', short: 'Logic', group: 2, icon: 'M5 5h5v5H5zM14 14h5v5h-5zM10 7.5h2.5a2 2 0 012 2V14' },
  { name: 'Map', short: 'Map', group: 3, icon: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5' },
  { name: 'Settings', short: 'Settings', group: 3, icon: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4' },
];
const PIN = 'M9 4h6l-1 6 4 3H6l4-3zM12 13v8';
const OTHER = 'M5 5h14v14H5z';

const SVG = 'http://www.w3.org/2000/svg';
const icon = (d: string, size: number) => {
  const el = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) el.setAttribute(k, String(v));
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', d);
  el.append(p);
  return el;
};

interface Tab { name: string; button: HTMLButtonElement; badge: HTMLElement; panel: HTMLElement | null; order: number; group: number; scroll: number; key: string; detail: string; run?: () => void }

/**
 * The panel column with a labelled rail of panels on its right. Panels follow the tool in use (`follow`) unless
 * the pin in the header is on, or the user opened the panel themself since the last tool switch.
 * Alt+1…9 open the panels in rail order, Alt+P toggles the pin.
 */
export function mountSidebar(sidebar: HTMLElement): SidebarTabs {
  const title = h('span.panel-title');
  const pinBtn = h('button.pin', { onclick: () => setPinned(!pinned) }, icon(PIN, 13));
  const body = h('div.tab-body');
  const rail = h('nav.rail', { 'aria-label': 'Panels' });
  sidebar.append(h('div.panel-col', {}, h('div.panel-head', {}, title, pinBtn), body), rail);
  const tabs = new Map<string, Tab>();
  let current: string | null = null;
  let pinned = false;
  /** The user opened the current panel themself: it stays until the next tool switch. */
  let held = false;

  const ordered = () => [...tabs.values()].sort((a, b) => a.order - b.order);
  const syncTip = (t: Tab) => {
    for (const [k, v] of Object.entries(tip(t.detail ? `${t.name}: ${t.detail}` : t.name, t.key))) if (v) t.button.setAttribute(k, v);
  };
  const syncPin = () => {
    pinBtn.classList.toggle('active', pinned);
    pinBtn.setAttribute('aria-pressed', String(pinned));
    for (const [k, v] of Object.entries(tip(pinned ? 'Unpin: panels follow the tool again' : 'Pin this panel: keep it open while you switch tools', 'Alt+P'))) if (v) pinBtn.setAttribute(k, v);
  };
  /** Rebuilds the rail in order, with dividers between groups and Alt+n keys by position. */
  const layout = () => {
    const items: HTMLElement[] = [];
    let group = -1;
    ordered().forEach((t, i) => {
      if (group >= 0 && t.group !== group) items.push(h('div.rail-div'));
      group = t.group;
      t.key = i < 9 ? `Alt+${i + 1}` : '';
      syncTip(t);
      items.push(t.button);
    });
    rail.replaceChildren(...items);
  };
  const show = (name: string) => {
    const next = tabs.get(name);
    if (!next?.panel) return;
    const prev = current ? tabs.get(current) : undefined;
    if (prev && prev !== next) prev.scroll = body.scrollTop;
    for (const t of tabs.values()) {
      t.button.classList.toggle('active', t === next);
      t.button.setAttribute('aria-current', String(t === next));
      if (t.panel) t.panel.hidden = t !== next;
    }
    title.textContent = next.name;
    if (prev !== next) body.scrollTop = next.scroll;
    current = name;
  };
  const open = (name: string) => {
    const t = tabs.get(name);
    if (t?.run) return t.run();
    show(name);
    held = true;
  };
  const setPinned = (on: boolean) => {
    pinned = on;
    syncPin();
  };

  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const n = /^Digit([1-9])$/.exec(e.code);
    if (n) {
      const t = ordered()[Number(n[1]) - 1];
      if (t) open(t.name);
    } else if (e.code === 'KeyP') setPinned(!pinned);
    else return;
    // Before the toolbar's handler, which would read Alt+1 as tool 1.
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  syncPin();

  const addItem = (name: string, panel: HTMLElement | null, run?: () => void) => {
    const r = RAIL.findIndex((x) => x.name === name);
    const def = RAIL[r] ?? { name, short: name, group: RAIL[RAIL.length - 1].group + 1, icon: OTHER };
    const badge = h('span.rail-badge', { hidden: true, 'aria-hidden': 'true' });
    const button = h('button.rail-item', { onclick: () => open(name) }, icon(def.icon, 18), h('span.rail-label', {}, def.short), badge);
    if (panel) body.append(panel);
    tabs.set(name, { name, button, badge, panel, order: r >= 0 ? r : RAIL.length + tabs.size, group: def.group, scroll: 0, key: '', detail: '', run });
    layout();
  };

  return {
    add(name, panel) {
      addItem(name, panel);
      if (current === null) show(name);
      else panel.hidden = true;
    },
    link(name, run) {
      addItem(name, null, run);
    },
    show,
    follow(name, focus) {
      if (pinned || held || !tabs.get(name)?.panel) return false;
      const switched = current !== name;
      show(name);
      // Scroll to the part the tool needs, only when the panel was not open already (so a click inside it stays put).
      const el = switched && focus ? focus(tabs.get(name)!.panel!) : null;
      if (el) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 4;
      return true;
    },
    release() {
      held = false;
    },
    badge(name, text, tone = 'accent', detail = '') {
      const t = tabs.get(name);
      if (!t) return;
      t.badge.hidden = text === null;
      t.badge.textContent = text ?? '';
      t.badge.classList.toggle('danger', tone === 'danger');
      t.detail = text === null ? '' : detail;
      syncTip(t);
    },
    setPinned,
    get current() { return current; },
    get pinned() { return pinned; },
  };
}
