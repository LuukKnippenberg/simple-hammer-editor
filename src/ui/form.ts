import { h } from './dom.ts';

/**
 * Small form controls for the option sheets. Each calls `set` with the new value on change; inputs and drop-downs
 * give up the focus first, so the editor's keys work again straight away.
 */

/** A labelled row: the label, then the controls (a hint goes last, as a `span.hint`). */
export function row(label: string, ...controls: (HTMLElement | null)[]): HTMLElement {
  return h('div.row', {}, h('label', {}, label), ...controls);
}

/** A number input; a typed value is clamped to min..max, an empty or bad one becomes min. */
export function num(value: number, set: (v: number) => void, o: { min?: number; max?: number; step?: number; title?: string } = {}): HTMLInputElement {
  const min = o.min ?? 0, max = o.max ?? Infinity;
  const i = h('input', { type: 'number', value: String(value), step: String(o.step ?? 1), min: String(min), max: o.max === undefined ? undefined : String(o.max), title: o.title || undefined }) as HTMLInputElement;
  i.addEventListener('change', () => {
    i.blur();
    set(Math.max(min, Math.min(max, parseFloat(i.value) || min)));
  });
  return i;
}

/** A drop-down of `[value, label, title?]` choices. */
export function select(choices: [string, string, string?][], value: string, set: (v: string) => void, title = ''): HTMLSelectElement {
  const el = h('select', { title: title || undefined }, ...choices.map(([v, l, t]) => h('option', { value: v, title: t }, l))) as HTMLSelectElement;
  el.value = value;
  el.addEventListener('change', () => {
    el.blur();
    set(el.value);
  });
  return el;
}

/** A checkbox. */
export function toggle(checked: boolean, set: (v: boolean) => void, title = ''): HTMLInputElement {
  const el = h('input', { type: 'checkbox', checked, title: title || undefined }) as HTMLInputElement;
  el.addEventListener('change', () => set(el.checked));
  return el;
}

/** The 🎲 next to a seed. */
export function seedButton(onclick: () => void, title = 'New seed'): HTMLButtonElement {
  return h('button', { title, onclick }, '🎲');
}
