import type { PoiType } from '../types.ts';

/** The simplest POI: a paved lot with kerbs, lamp posts at the corners and two routes across. */
export const LOT: PoiType = {
  id: 'lot', label: 'Paved lot', icon: '▭', hint: 'A plain paved area with kerbs and lamp posts.',
  landscapes: ['city'], minSize: [384, 384], maxSize: [4096, 4096], defaultSize: [768, 768],
  params: [
    { key: 'surface', label: 'Surface', type: 'select', default: 'paving', options: [{ value: 'paving', label: 'Paving' }, { value: 'asphalt', label: 'Asphalt' }, { value: 'gravel', label: 'Gravel' }] },
    { key: 'lamps', label: 'Lamp posts', type: 'check', default: true },
    { key: 'lights', label: 'Lights on', type: 'check', default: false },
  ],
  gameplay: { capture: true, scrap: true },
  build(k) {
    const { W, D } = k;
    const surface = { paving: 'CONCRETE/CONCRETEFLOOR050A', asphalt: 'CONCRETE/CONCRETEFLOOR033A', gravel: 'NATURE/GRAVELFLOOR002B' }[k.str('surface')] ?? 'CONCRETE/CONCRETEFLOOR050A';
    k.pad(k.bounds, surface);
    k.crossRoute('x');
    k.crossRoute('y');
    k.perimeter('kerb', 6);
    if (k.flag('lamps')) for (const [x, y, yaw] of [[48, 48, 45], [W - 48, 48, 135], [W - 48, D - 48, 225], [48, D - 48, 315]]) k.lamp(x, y, yaw);
    k.gameplay(k.centre);
  },
};
