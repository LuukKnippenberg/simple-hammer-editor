import type { Editor } from '../editor.ts';
import { GENERATE_TOOLS, type GenerateTool } from '../edit/generateTool.ts';
import { GENERATORS, GROUPS, HOW_LABEL, directGenerator, generator, menuKey, type GeneratorDef, type GeneratorId } from '../edit/generators.ts';
import { POI_TYPES } from '../gen/poi/registry.ts';
import { isTyping } from '../render/cameraControls.ts';
import { h } from './dom.ts';
import { tip } from './tooltip.ts';
import '../gen/poi/catalogue.ts';

/**
 * The Generate button at the bottom of the tool rail and its menu: everything the editor builds, grouped, each
 * with how it is placed. G opens and closes it, 1–7 pick, Enter repeats the last generator, Esc closes. The keys
 * of the Generate flow (Enter: done, Esc: a step back) are handled here too.
 */

/** A magic wand with sparkles, drawn with strokes like the other rail icons. */
export const WAND_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M4 20 13.5 10.5"/><path d="m13.5 10.5 3-3" stroke-width="3.2"/>'
  + '<path d="M18 2.5v3M16.5 4h3"/><path d="M9 3.5v2M8 4.5h2"/><path d="M20 11v2M19 12h2"/></svg>';

let mounted: { open(): void; close(): void; toggle(): void; readonly isOpen: boolean } | null = null;

/** Opens the Generate menu (the Selection tab's Generate box). */
export function openGenerateMenu(): void {
  mounted?.open();
}

const tool = (editor: Editor) => editor.tools.tools.generate as GenerateTool;

/** One line of the menu's description: POIs say how many types there are. */
function describe(g: GeneratorDef): string {
  return g.id === 'poi' ? `${POI_TYPES.length} types: ${g.desc.charAt(0).toLowerCase()}${g.desc.slice(1)}` : g.desc;
}

/** The rail's Generate button (mounts the menu). */
export function mountGenerateButton(editor: Editor): HTMLButtonElement {
  const btn = h('button.gen-btn', { ...tip('Generate: buildings, blocks, interiors, roads, powerlines and points of interest', 'G'), 'aria-haspopup': 'menu' });
  const menu = h('div.gen-menu', { role: 'menu', hidden: true });
  document.body.append(menu);
  let open = false;
  let hot = -1;
  /** The highlight was moved with the arrow keys: Enter picks it instead of repeating the last one. */
  let arrowed = false;

  const items: HTMLElement[] = [];
  const pick = (id: GeneratorId) => {
    close();
    tool(editor).pick(id);
  };
  const render = () => {
    items.length = 0;
    const last = tool(editor).last;
    const rows: HTMLElement[] = [];
    for (const group of GROUPS) {
      rows.push(h('div.gen-group', {}, group));
      for (const g of GENERATORS.filter((x) => x.group === group)) {
        const i = items.length;
        const item = h('div.gen-item', { role: 'menuitem', 'data-gen': g.id, onclick: () => pick(g.id), onpointerenter: () => setHot(i) },
          h('span.gen-icon', {}, g.icon),
          h('div.gen-text', {},
            h('div.gen-name', {}, h('b', {}, g.name), h('span.chip', {}, HOW_LABEL[g.how]), g.fills ? h('span.chip.fills', {}, 'fills selection') : null),
            h('div.gen-desc', {}, describe(g))),
          h('kbd', {}, g.key));
        items.push(item);
        rows.push(item);
      }
    }
    menu.replaceChildren(
      h('div.gen-head', {}, h('b', {}, 'Generate'), h('span.muted', {}, ' · Pick what to build, then place it'), h('kbd', {}, 'G')),
      ...rows,
      h('div.gen-foot', {}, last ? h('span', {}, 'Repeat last: ', h('b', {}, generator(last).name)) : h('span.muted', {}, 'Repeat last: nothing yet'), h('kbd', {}, 'Enter')),
    );
    setHot(hot);
  };
  const setHot = (i: number) => {
    hot = i;
    items.forEach((it, k) => it.classList.toggle('hot', k === i));
  };
  const place = () => {
    const r = btn.getBoundingClientRect();
    menu.style.left = `${r.right + 8}px`;
    // Beside the button, its head a little above it, kept inside the window.
    menu.style.top = `${Math.max(8, Math.min(r.top - 48, innerHeight - menu.offsetHeight - 8))}px`;
  };
  const doOpen = () => {
    open = true;
    hot = -1;
    arrowed = false;
    render();
    menu.hidden = false;
    place();
    sync();
  };
  const close = () => {
    if (!open) return;
    open = false;
    menu.hidden = true;
    sync();
  };
  mounted = { open: doOpen, close, toggle: () => (open ? close() : doOpen()), get isOpen() { return open; } };
  tool(editor).onMenu = doOpen;
  btn.addEventListener('click', () => mounted!.toggle());
  // A click anywhere else closes it.
  document.addEventListener('pointerdown', (e) => {
    if (open && !menu.contains(e.target as Node) && !btn.contains(e.target as Node)) close();
  }, true);
  window.addEventListener('resize', () => open && place());

  /** While a generator is placed or tuned the button shows its icon and is active. */
  const sync = () => {
    const s = tool(editor).session;
    const busy = !!s || GENERATE_TOOLS.has(editor.tools.current.name);
    btn.classList.toggle('active', busy || open);
    if (s) btn.textContent = generator(s.id).icon;
    else btn.innerHTML = WAND_SVG;
  };
  editor.on('toolchange', sync);
  editor.on('generate', sync);
  sync();

  // Ahead of the global shortcuts (and after the tools, which keep Enter, Esc and Backspace while drawing a route).
  window.addEventListener('keydown', (e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = tool(editor);
    const k = e.key.toLowerCase();
    let handled = true;
    if (open) {
      const r = menuKey(e.key, t.last);
      if (k === 'enter' && arrowed && hot >= 0) pick(GENERATORS[hot].id);
      else if (r && 'pick' in r) pick(r.pick);
      else if (r) close();
      else if (k === 'arrowdown' || k === 'arrowup') { arrowed = true; setHot((Math.max(hot, k === 'arrowdown' ? -1 : 0) + (k === 'arrowdown' ? 1 : items.length - 1)) % items.length); }
      else handled = false;
    } else if (k === 'g' && !e.shiftKey) {
      doOpen();
    } else if (t.session && k === 'escape') {
      t.back();
    } else if (t.session?.step === 'tune' && k === 'enter') {
      t.done();
    } else if (!e.shiftKey && directGenerator(e.key)) {
      t.pick(directGenerator(e.key)!);
    } else handled = false;
    if (!handled) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  return btn;
}
