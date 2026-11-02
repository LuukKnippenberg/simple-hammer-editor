import { h } from './dom.ts';

/**
 * Small form controls for the option sheets. Each calls `set` with the new value on change; inputs and drop-downs
 * give up the focus first, so the editor's keys work again straight away.
 */

/** A labelled row: the label, then the controls (a hint goes last, as a `span.hint`). */
export function row(label: string, ...controls: (HTMLElement | null)[]): HTMLElement {
  return h('div.row', {}, h('label', {}, label), ...controls);
}

/** A typed number clamped to min..max; an empty or bad one (or 0) becomes min. */
export function typedNumber(text: string, min: number, max: number): number {
  return Math.max(min, Math.min(max, parseFloat(text) || min));
}

/** A number input; a typed value is clamped to min..max (typedNumber). */
export function num(value: number, set: (v: number) => void, options: { min?: number; max?: number; step?: number; title?: string } = {}): HTMLInputElement {
  const min = options.min ?? 0, max = options.max ?? Infinity;
  const input = h('input', { type: 'number', value: String(value), step: String(options.step ?? 1), min: String(min), max: options.max === undefined ? undefined : String(options.max), title: options.title || undefined }) as HTMLInputElement;
  input.addEventListener('change', () => {
    input.blur();
    set(typedNumber(input.value, min, max));
  });
  return input;
}

/** A drop-down of `[value, label, title?]` choices. */
export function select(choices: [string, string, string?][], value: string, set: (v: string) => void, title = ''): HTMLSelectElement {
  const dropdown = h('select', { title: title || undefined }, ...choices.map(([optionValue, text, hint]) => h('option', { value: optionValue, title: hint }, text))) as HTMLSelectElement;
  dropdown.value = value;
  dropdown.addEventListener('change', () => {
    dropdown.blur();
    set(dropdown.value);
  });
  return dropdown;
}

/** A checkbox. */
export function toggle(checked: boolean, set: (v: boolean) => void, title = ''): HTMLInputElement {
  const checkbox = h('input', { type: 'checkbox', checked, title: title || undefined }) as HTMLInputElement;
  checkbox.addEventListener('change', () => set(checkbox.checked));
  return checkbox;
}

/** The 🎲 next to a seed. */
export function seedButton(onclick: () => void, title = 'New seed'): HTMLButtonElement {
  return h('button', { title, onclick }, '🎲');
}
