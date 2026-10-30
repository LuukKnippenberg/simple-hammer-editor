import type { FacadeTile } from './facade.ts';
import type { CornerOption } from './buildingPlan.ts';
import type { RoofKind } from './roofs.ts';

/** Share of a bay each tile's window or door takes with its frame and sill, measured from the textures. */
const OPENINGS: Record<string, number> = {
  building_template001b: 0.6, building_template001d: 0.6, building_template002b: 0.7, building_template002c: 0.64,
  building_template002e: 0.52, building_template002f: 0.52, building_template002o: 0.7, building_template002p: 0.38,
  building_template003c: 0.6, building_template003d: 0.72, building_template003e: 0.6, building_template011c: 0.54,
  building_template011g: 0.68, building_template012b: 0.6, building_template012c: 0.6, building_template012d: 0.6,
  building_template012g: 0.6, building_template012h: 0.6, building_template013b: 0.42, building_template013f: 0.42,
  building_template013g: 0.52, building_template014e: 0.54, building_template014i: 0.52, building_template015b: 0.42,
  building_template015c: 0.42, building_template019c: 0.55, building_template019k: 0.55, building_template021c: 0.8,
  courtyard_template001c: 0.4, courtyard_template001g: 0.4, courtyard_template003c: 0.4, courtyard_template003d: 0.22,
  courtyard_template003f: 0.4, courtyard_template005c: 0.4, courtyard_template005f: 0.4, courtyard_template005g: 0.4,
  courtyard_template006e: 0.4, courtyard_template006k: 0.4,
};
const t = (name: string, bays: number, widthPx?: number): FacadeTile => ({ material: `BUILDING_TEMPLATE/${name.toUpperCase()}`, bays, widthPx, opening: OPENINGS[name] });
const TRIM_WHITE = t('building_template002k', 0);
const ARCH_DOOR = t('building_template002e', 1);

/**
 * Facade sets from the game's building_template materials: one 512px tile is one 128-unit floor and holds
 * `bays` windows across. The first five are the original sets; the rest are City 17's plaster colours.
 */
export const FACADE_STYLES = {
  stucco: { windows: [t('building_template002b', 2), t('building_template002c', 2)], ground: [t('building_template002e', 1), t('building_template002f', 1)], door: ARCH_DOOR, plain: t('building_template002h', 0), trim: TRIM_WHITE },
  stone: { windows: [t('building_template003e', 2), t('building_template003d', 2)], ground: [t('building_template003c', 2)], door: ARCH_DOOR, plain: t('building_template003a', 0), trim: t('building_template003a', 0) },
  brown: { windows: [t('building_template001b', 2), t('building_template019c', 2), t('building_template019k', 2)], ground: [t('building_template001d', 2)], door: ARCH_DOOR, plain: t('building_template019a', 0), trim: t('building_template001f', 0, 256) },
  brick: { windows: [t('building_template011c', 1)], ground: [t('building_template011g', 1)], door: t('building_template011g', 1), plain: t('building_template011b', 0), trim: t('building_template011b', 0) },
  pale: { windows: [t('building_template002o', 2), t('building_template002p', 1)], ground: [t('building_template002f', 1)], door: ARCH_DOOR, plain: t('building_template004h', 0), trim: TRIM_WHITE },
  ochre: { windows: [t('building_template012b', 2), t('building_template012c', 2), t('building_template012d', 2), t('building_template012g', 2)], ground: [t('building_template012h', 2)], door: t('building_template013g', 1), plain: t('building_template012n', 0), trim: TRIM_WHITE },
  yellow: { windows: [t('building_template014e', 1), t('building_template015b', 1), t('building_template015c', 1)], ground: [t('building_template015c', 1)], door: t('building_template014i', 1), plain: t('building_template014a', 0), trim: TRIM_WHITE },
  framed: { windows: [t('building_template013b', 1), t('building_template013f', 1)], ground: [t('building_template013f', 1)], door: t('building_template013g', 1), plain: t('building_template013a', 0), trim: t('building_template003a', 0) },
  cream: { windows: [t('courtyard_template001c', 1), t('courtyard_template001g', 1)], ground: [t('courtyard_template001c', 1)], door: ARCH_DOOR, plain: t('courtyard_template001b', 0), trim: TRIM_WHITE },
  blue: { windows: [t('courtyard_template003c', 1), t('courtyard_template003f', 1)], ground: [t('courtyard_template003d', 1)], door: ARCH_DOOR, plain: t('courtyard_template003b', 0), trim: TRIM_WHITE },
  rose: { windows: [t('courtyard_template005c', 1), t('courtyard_template005g', 1)], ground: [t('courtyard_template005f', 1)], door: t('courtyard_template005f', 1), plain: t('courtyard_template005b', 0), trim: TRIM_WHITE },
  sand: { windows: [t('courtyard_template006e', 1), t('courtyard_template006k', 1)], ground: [t('courtyard_template006e', 1)], door: t('building_template013g', 1), plain: t('courtyard_template006a', 0), trim: TRIM_WHITE },
  soviet: { windows: [t('building_template003e', 2), t('building_template021c', 1), t('building_template003d', 2)], ground: [t('building_template003c', 2)], door: ARCH_DOOR, plain: t('building_template021a', 0), trim: t('building_template003a', 0) },
} as const;
export type FacadeStyle = keyof typeof FACADE_STYLES;
export type Style = (typeof FACADE_STYLES)[FacadeStyle];

/** A named kind of city building: which facades, roofs, corners and street features it uses. */
export interface Architecture {
  label: string;
  facades: FacadeStyle[];
  /** Relative weights of roof shapes. */
  roofs: Partial<Record<RoofKind, number>>;
  corners: CornerOption;
  /** Multiplies the chance of a corner tower (0.6 rounded, 0.35 cut, 0.2 square corners at 1). */
  towers: number;
  oriels: boolean;
  balconies: boolean;
  /** Small stair houses on flat roofs. */
  roofHuts: boolean;
  /** Floor range used when the caller doesn't give one. */
  floors: [number, number];
}

export const ARCHITECTURES = {
  mixed: {
    label: 'Mixed', facades: ['stucco', 'stone', 'brown', 'brick', 'pale', 'ochre', 'yellow', 'framed', 'cream', 'blue', 'rose', 'sand'],
    roofs: { flat: 1, hip: 2, mansard: 2, gable: 1, curved: 1 }, corners: 'mixed', towers: 0.35, oriels: true, balconies: true, roofHuts: true, floors: [3, 6],
  },
  tenement: {
    label: 'Pre-war tenements', facades: ['ochre', 'yellow', 'cream', 'framed', 'stucco', 'pale', 'rose', 'sand', 'blue'],
    roofs: { mansard: 3, curved: 2, hip: 2, gable: 1 }, corners: 'mixed', towers: 0.4, oriels: true, balconies: true, roofHuts: false, floors: [3, 6],
  },
  soviet: {
    label: 'Soviet blocks', facades: ['soviet', 'stone', 'pale'],
    roofs: { flat: 1 }, corners: 'square', towers: 0, oriels: false, balconies: true, roofHuts: true, floors: [5, 9],
  },
  brick: {
    label: 'Brick houses', facades: ['brick', 'brown', 'rose'],
    roofs: { gable: 3, hip: 2, mansard: 1 }, corners: 'chamfer', towers: 0.4, oriels: true, balconies: false, roofHuts: false, floors: [2, 4],
  },
  sheds: {
    label: 'Sheds and workshops', facades: ['brick', 'brown', 'stone'],
    roofs: { gable: 2, flat: 1, hip: 1 }, corners: 'square', towers: 0, oriels: false, balconies: false, roofHuts: false, floors: [1, 2],
  },
} as const satisfies Record<string, Architecture>;
export type ArchitectureName = keyof typeof ARCHITECTURES;
