import type { Editor } from '../editor.ts';
import { pathLabels, type PathPoint } from '../edit/pathPoints.ts';
import { h } from './dom.ts';

/**
 * The Selection panel's Points list for a path (stairs now, streets and powerlines later): a row per point with its
 * numbers. Clicking a row picks the point's pin; typing a number moves the point. A generator's panel uses
 * `pathPointsSection` with its own columns.
 */

/** One number of each point in the list: how to read it from a point and write it back. */
export interface PointColumn {
  title: string;
  /** Step of the number field. */
  step?: number;
  get(point: PathPoint): number;
  set(point: PathPoint, value: number): PathPoint;
}

/** A column for x, y or the height (z). */
export const pointAxis = (title: string, axis: 'x' | 'y' | 'z', step = 1): PointColumn =>
  ({ title, step, get: (point) => point[axis], set: (point, value) => ({ ...point, [axis]: value }) });

/**
 * The Points section of a generated object's panel: a row per point of the path the Select tool's pins edit, when
 * that is the object with `key` (the pins' `PathTarget.key`); else only the heading and `hint`. Typed numbers move
 * points through the pins (checked like a drag, one undo step each); a picked point can be removed.
 */
export function pathPointsSection(editor: Editor, key: string, columns: PointColumn[], hint: string): HTMLElement {
  const pins = editor.tools.select.pins;
  const section = h('div.section', {}, h('h3', {}, 'Points'), h('p.hint', {}, hint));
  // While a generator's tool is placing it, the pins in the viewport are that tool's own.
  const target = pins.target;
  if (target?.key !== key || editor.tools.current !== editor.tools.select) return section;
  const path = target.path();
  const names = pathLabels(path);
  section.append(pointsList({
    names, columns: columns.map((c) => c.title), steps: columns.map((c) => c.step ?? 1),
    values: path.points.map((point) => columns.map((c) => c.get(point))), selected: pins.selected,
    select: (i) => pins.select(i),
    set: (i, column, value) => pins.setPoint(i, columns[column].set(path.points[i], value)),
  }));
  const picked = pins.selected;
  if (picked >= 0 && names[picked]) section.append(h('div.row', { style: { marginTop: '6px' } }, h('button', { onclick: () => pins.remove(picked) }, `Remove ${names[picked]}`)));
  return section;
}
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
