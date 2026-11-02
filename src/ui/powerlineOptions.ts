import { POLE_TYPES, type PoleType, type PowerlineSpec } from '../gen/powerlines.ts';
import { num, row, select, toggle } from './form.ts';
import { h } from './dom.ts';

/**
 * A powerline's option sheet (the Tune step and the Selection panel): poles, spacing, sag and house feeds. Every
 * change calls back with a patch; the caller rebuilds.
 */
export function powerlineSheet(line: Pick<PowerlineSpec, 'pole' | 'spacing' | 'slack' | 'feeds'>, set: (patch: Partial<PowerlineSpec>) => void): HTMLElement[] {
  const sag = h('input', { type: 'range', min: 0, max: 0.15, step: 0.01, value: line.slack }) as HTMLInputElement;
  sag.addEventListener('change', () => set({ slack: Number(sag.value) }));
  return [
    row('Poles', select(Object.entries(POLE_TYPES).map(([k, p]) => [k, p.label]), line.pole, (v) => set({ pole: v as PoleType }))),
    row('Spacing', num(line.spacing, (v) => set({ spacing: v }), { step: 64, min: 192 })),
    row('Sag', sag),
    row('House feeds', toggle(!!line.feeds, (v) => set({ feeds: v }))),
  ];
}
