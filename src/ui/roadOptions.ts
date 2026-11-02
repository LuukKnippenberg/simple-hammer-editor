import { ROAD_STYLES, type RoadSpec, type RoadStyle } from '../gen/roads.ts';
import { num, row, select } from './form.ts';

/**
 * A road's option sheet (the Tune step and the Selection panel): style, width, pavement and corner radius. Every
 * change calls back with a patch; the caller rebuilds.
 */
export function roadSheet(road: Pick<RoadSpec, 'style' | 'width' | 'pavement' | 'radius'>, set: (patch: Partial<RoadSpec>) => void): HTMLElement[] {
  return [
    row('Style', select(Object.entries(ROAD_STYLES).map(([key, style]) => [key, style.label]), road.style, (v) => set({ style: v as RoadStyle }))),
    row('Width', num(road.width, (v) => set({ width: v }), { step: 32, min: 64 })),
    row('Pavement', num(road.pavement, (v) => set({ pavement: v }), { step: 16, min: 0 })),
    row('Corners', num(road.radius, (v) => set({ radius: v }), { step: 32, min: 0 })),
  ];
}
