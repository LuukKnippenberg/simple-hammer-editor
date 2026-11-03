import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { ROAD_STYLES, type RoadSpec, type RoadStyle } from '../gen/roads.ts';
import { roadKey, type RoadPoint } from '../edit/roadPath.ts';
import { num, row, select } from './form.ts';
import { pathPointsSection, pointAxis } from './pathPointsList.ts';

/**
 * A road's option sheet (the Tune step and the Selection panel): style, width, pavement and corner radius. Every
 * change calls back with a patch; the caller rebuilds.
 */
export function roadSheet(road: Pick<RoadSpec, 'style' | 'width' | 'pavement' | 'radius'>, set: (patch: Partial<RoadSpec>) => void): HTMLElement[] {
  return [
    row('Style', select(Object.entries(ROAD_STYLES).map(([key, style]) => [key, style.label]), road.style, (v) => set({ style: v as RoadStyle }))),
    row('Width', num(road.width, (v) => set({ width: v }), { step: 32, min: 64 })),
    row('Pavement', num(road.pavement, (v) => set({ pavement: v }), { step: 16, min: 0 })),
    row('Corner radius', num(road.radius, (v) => set({ radius: v }), { step: 32, min: 0 })),
  ];
}

/**
 * The Points section of a selected road: x, y and each point's own corner radius (the road's until one is typed).
 * Typed numbers move points through the Select tool's pins, one undo step each.
 */
export function roadPointsSection(editor: Editor, entity: MapEntity, road: RoadSpec): HTMLElement {
  return pathPointsSection(editor, roadKey(entity), [
    pointAxis('x', 'x', editor.grid),
    pointAxis('y', 'y', editor.grid),
    { title: 'corner radius', step: 16, get: (point) => (point as RoadPoint).radius ?? road.radius, set: (point, value) => ({ ...point, radius: Math.max(0, value) }) },
  ], 'Height follows the ground. A point\'s own corner radius overrides the road\'s; Tab picks the next pin, Shift+click a pin branches a second road from it.');
}
