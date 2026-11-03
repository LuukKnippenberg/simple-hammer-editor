import { h } from './dom.ts';

/**
 * The Selection panel's Points list for a path (stairs now, streets and powerlines later): a row per point with its
 * numbers. Clicking a row picks the point's pin; typing a number moves the point.
 */
export interface PointsList {
  names: string[];
  /** Column titles ("x", "y", "height"). */
  columns: string[];
  /** Each point's numbers, one per column. */
  values: number[][];
  /** The picked point (-1: none). */
  selected: number;
  select(i: number): void;
  set(i: number, column: number, value: number): void;
  /** Steps the number fields go in, per column. */
  steps?: number[];
}

export function pointsList(o: PointsList): HTMLElement {
  const cols = `--cols: ${o.columns.length}`;
  return h('div.path-points', {},
    h('div.path-cols', { style: cols }, h('span'), ...o.columns.map((c) => h('span', {}, c))),
    ...o.values.map((values, i) => {
      const inputs = values.map((v, c) => {
        const input = h('input.num', { type: 'number', value: String(Math.round(v * 100) / 100), step: String(o.steps?.[c] ?? 1), title: `${o.names[i]} ${o.columns[c]}` }) as HTMLInputElement;
        input.addEventListener('change', () => {
          const value = parseFloat(input.value);
          input.blur();
          if (Number.isFinite(value) && value !== v) o.set(i, c, value);
        });
        return input;
      });
      return h(`div.path-row${i === o.selected ? '.on' : ''}`, {
        style: cols, 'data-point': o.names[i],
        onclick: (e: MouseEvent) => { if (!(e.target instanceof HTMLInputElement)) o.select(i === o.selected ? -1 : i); },
      }, h('span.k', {}, o.names[i]), ...inputs);
    }));
}
