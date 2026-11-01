import { fgdClass, fgdClasses, type FgdClass } from '../assets/fgd.ts';
import { classGroup, classHint, isPointClass, searchClasses } from '../edit/entityClasses.ts';
import { h, scrollIntoList } from './dom.ts';
import { nextInList, recentClasses } from './recent.ts';
import './entities.css';

/** A class's colour dot. */
export function classDot(name: string, size = 10): HTMLElement {
  const c = fgdClass(name);
  return h('span.dot', { style: { background: classGroup(c ?? { name, type: 'PointClass' }).color, width: `${size}px`, height: `${size}px` } });
}

/** A recent-class chip. */
export function classChip(name: string, onclick: (e: MouseEvent) => void, active = false): HTMLElement {
  return h(active ? 'button.chip.active' : 'button.chip', { onclick, title: classHint(fgdClass(name), name) }, classDot(name), name);
}

/**
 * Searchable class field: type to filter, a drop-down with the recent classes and the best matches
 * (name, what it is, group), ↑ ↓ to choose, Enter to set, Tab for the next recent class.
 */
export function classCombo(opts: { value: string; onPick: (cls: string) => void; filter?: (c: FgdClass) => boolean }): HTMLElement {
  const filter = opts.filter ?? isPointClass;
  const input = h('input', { value: opts.value, spellcheck: false, 'aria-label': 'Entity class', role: 'combobox', 'aria-expanded': 'false' }) as HTMLInputElement;
  const field = h('div.combo-field', {}, classDot(opts.value), input, h('span.muted', {}, '▾'));
  const list = h('div.combo-list', { role: 'listbox', 'aria-label': 'Entity classes', hidden: true });
  let matches: FgdClass[] = [];
  let hl = 0;

  const pick = (cls: string) => {
    input.value = cls;
    field.firstElementChild!.replaceWith(classDot(cls));
    close();
    input.blur();
    opts.onPick(cls);
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };
  const render = () => {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    const q = input.value === opts.value ? '' : input.value;
    matches = q ? searchClasses(fgdClasses().filter(filter), q, 8) : [];
    hl = Math.min(hl, Math.max(0, matches.length - 1));
    const recent = recentClasses.items.filter((r) => { const c = fgdClass(r); return c && filter(c); });
    const kids: (Node | null)[] = [
      recent.length ? h('div.combo-sec', {}, 'Recent') : null,
      recent.length ? h('div.chips', {}, ...recent.map((r) => classChip(r, (e) => { e.preventDefault(); pick(r); }))) : null,
      q ? h('div.combo-sec.line', {}, `Matches “${q}”`) : h('div.combo-sec.line', {}, 'Type to search all classes'),
      ...matches.map((c, i) => {
        const g = classGroup(c);
        const opt = h(i === hl ? 'div.combo-opt.hl' : 'div.combo-opt', { role: 'option', 'aria-selected': String(i === hl), onmousedown: (e: MouseEvent) => { e.preventDefault(); pick(c.name); } },
          classDot(c.name),
          h('span.combo-txt', {}, h('b', {}, c.name), h('span', {}, classHint(c))),
          h('span.grp', {}, g.label));
        return opt;
      }),
      q && !matches.length ? h('div.hint', {}, 'No class matches.') : null,
      h('div.combo-keys', {}, h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' choose'), h('span', {}, h('kbd', {}, 'Enter'), ' set'), h('span', {}, h('kbd', {}, 'Tab'), ' next recent')),
    ];
    list.replaceChildren(...kids.filter((x): x is Node => !!x));
    scrollIntoList(list.querySelector('.combo-opt.hl'), list);
  };
  input.addEventListener('focus', () => { input.select(); render(); });
  input.addEventListener('input', () => { hl = 0; render(); });
  input.addEventListener('blur', () => { close(); input.value = opts.value; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      hl = Math.max(0, Math.min(matches.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1)));
      render();
    } else if (e.key === 'Enter') {
      const c = matches[hl] ?? fgdClass(input.value.trim());
      if (c) pick(c.name);
    } else if (e.key === 'Tab') {
      const next = nextInList(recentClasses.items, opts.value);
      if (next) pick(next);
    } else if (e.key === 'Escape') {
      input.blur();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  return h('div.combo', {}, field, list);
}
