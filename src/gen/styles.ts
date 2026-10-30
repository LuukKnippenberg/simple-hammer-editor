import type { FacadeTile } from './facade.ts';
import type { CornerOption } from './buildingPlan.ts';
import type { RoofKind } from './roofs.ts';

const t = (name: string, bays: number, widthPx?: number): FacadeTile => ({ material: `BUILDING_TEMPLATE/${name.toUpperCase()}`, bays, widthPx });
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
  pale: { windows: [t('building_template002o', 2), t('building_template002p', 2)], ground: [t('building_template002f', 1)], door: ARCH_DOOR, plain: t('building_template004h', 0), trim: TRIM_WHITE },
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
  /** Enterable open-top houses on small lots: none, some (`interiorShare` of the eligible lots) or all. */
  interiors: 'none' | 'some' | 'all';
  interiorShare: number;
  interiorStyles: readonly InteriorStyleName[];
}

export const ARCHITECTURES = {
  mixed: {
    label: 'Mixed', facades: ['stucco', 'stone', 'brown', 'brick', 'pale', 'ochre', 'yellow', 'framed', 'cream', 'blue', 'rose', 'sand'],
    roofs: { flat: 1, hip: 2, mansard: 2, gable: 1, curved: 1 }, corners: 'mixed', towers: 0.35, oriels: true, balconies: true, roofHuts: true, floors: [3, 6],
    interiors: 'none', interiorShare: 0.4, interiorStyles: ['farmhouse', 'brick'],
  },
  tenement: {
    label: 'Pre-war tenements', facades: ['ochre', 'yellow', 'cream', 'framed', 'stucco', 'pale', 'rose', 'sand', 'blue'],
    roofs: { mansard: 3, curved: 2, hip: 2, gable: 1 }, corners: 'mixed', towers: 0.4, oriels: true, balconies: true, roofHuts: false, floors: [3, 6],
    interiors: 'none', interiorShare: 0.4, interiorStyles: ['farmhouse', 'brick'],
  },
  soviet: {
    label: 'Soviet blocks', facades: ['soviet', 'stone', 'pale'],
    roofs: { flat: 1 }, corners: 'square', towers: 0, oriels: false, balconies: true, roofHuts: true, floors: [5, 9],
    interiors: 'none', interiorShare: 0.4, interiorStyles: ['outbuilding'],
  },
  brick: {
    label: 'Brick houses', facades: ['brick', 'brown', 'rose'],
    roofs: { gable: 3, hip: 2, mansard: 1 }, corners: 'chamfer', towers: 0.4, oriels: true, balconies: false, roofHuts: false, floors: [2, 4],
    interiors: 'none', interiorShare: 0.4, interiorStyles: ['brick'],
  },
  sheds: {
    label: 'Sheds and workshops', facades: ['brick', 'brown', 'stone'],
    roofs: { gable: 2, flat: 1, hip: 1 }, corners: 'square', towers: 0, oriels: false, balconies: false, roofHuts: false, floors: [1, 2],
    interiors: 'none', interiorShare: 0.4, interiorStyles: ['outbuilding', 'shack'],
  },
  village: {
    label: 'Village houses', facades: ['cream', 'sand', 'rose', 'stucco', 'pale', 'brick'],
    roofs: { gable: 3, hip: 2 }, corners: 'square', towers: 0, oriels: false, balconies: false, roofHuts: false, floors: [1, 2],
    interiors: 'some', interiorShare: 0.7, interiorStyles: ['farmhouse', 'brick', 'shack'],
  },
  slum: {
    label: 'Slum shacks', facades: ['brown', 'brick', 'stone'],
    roofs: { flat: 1, gable: 1 }, corners: 'square', towers: 0, oriels: false, balconies: false, roofHuts: false, floors: [1, 1],
    interiors: 'all', interiorShare: 1, interiorStyles: ['slum', 'shack'],
  },
} as const satisfies Record<string, Architecture>;
export type ArchitectureName = keyof typeof ARCHITECTURES;

/** Materials for an open-top interior house (see `interiorShell.ts`). */
export interface InteriorStyle {
  label: string;
  /** Outer face of the outside walls (one per house). */
  outer: string[];
  /** Inner walls of living rooms, bedrooms and halls (one per room). */
  inner: string[];
  /** Inner walls of kitchens and baths. */
  wet: string[];
  floor: string[];
  wetFloor: string[];
  /** Top of every cut wall: the bright outline seen from the camera. */
  cap: string;
  stair: string;
  /** Porch deck and window boards. */
  planks: string;
  windows: ('open' | 'black' | 'boarded')[];
}

export const INTERIOR_STYLES = {
  farmhouse: {
    label: 'Plaster farmhouse',
    outer: ['PLASTER/PLASTERWALL005A', 'PLASTER/PLASTERWALL014A', 'PLASTER/PLASTERWALL011A', 'PLASTER/PLASTERWALL003A'],
    inner: ['PLASTER/PLASTERWALLPAPER001A', 'PLASTER/PLASTERWALLPAPER004A', 'PLASTER/PLASTERWALLPAPER005A', 'PLASTER/PLASTERWALLPAPER006A', 'PLASTER/PLASTERWALL034A'],
    wet: ['TILE/TILEWALL007E', 'PLASTER/PLASTERWALL013A'],
    floor: ['WOOD/WOODFLOOR006A', 'WOOD/WOODFLOOR002A', 'WOOD/EP2_WOODFLOOR01'],
    wetFloor: ['TILE/TILEFLOOR001A', 'TILE/TILEFLOOR012A'],
    cap: 'BUILDING_TEMPLATE/BUILDING_TEMPLATE002K', stair: 'WOOD/WOODSTAIR002A', planks: 'WOOD/WOODFLOOR007A', windows: ['black', 'open'],
  },
  shack: {
    label: 'Wooden shack',
    outer: ['WOOD/WOODWALL030A', 'WOOD/WOODWALL002A', 'WOOD/WOODWALL043A', 'WOOD/WOODWALL045A'],
    inner: ['WOOD/WOODWALL009A', 'WOOD/WOODWALL050A', 'WOOD/WOODWALL003A'],
    wet: ['WOOD/WOODWALL050A', 'PLASTER/PLASTERWALL013A'],
    floor: ['WOOD/WOODFLOOR005A', 'WOOD/WOODFLOOR008A', 'WOOD/WOODFLOOR001A'],
    wetFloor: ['WOOD/WOODFLOOR005A', 'CONCRETE/CONCRETEFLOOR001A'],
    cap: 'WOOD/WOODWALL008A', stair: 'WOOD/WOODSTAIR002B', planks: 'WOOD/WOODFLOOR008A', windows: ['boarded', 'open'],
  },
  brick: {
    label: 'Brick cottage',
    outer: ['BRICK/BRICKWALL001A', 'BRICK/BRICKWALL009A', 'BRICK/BRICKWALL032A', 'BRICK/BRICKWALL021A'],
    inner: ['PLASTER/PLASTERWALL013A', 'PLASTER/PLASTERWALL034A', 'PLASTER/PLASTERWALLPAPER004A', 'PLASTER/PLASTERWALLPAPER006A'],
    wet: ['TILE/TILEWALL007E', 'TILE/TILEWALL009B'],
    floor: ['WOOD/WOODFLOOR002A', 'WOOD/WOODFLOOR006A', 'WOOD/EP2_WOODFLOOR02'],
    wetFloor: ['TILE/TILEFLOOR012A', 'TILE/TILEFLOOR001A'],
    cap: 'BUILDING_TEMPLATE/BUILDING_TEMPLATE002K', stair: 'WOOD/WOODSTAIR002A', planks: 'WOOD/WOODFLOOR007A', windows: ['black', 'boarded'],
  },
  outbuilding: {
    label: 'Concrete outbuilding',
    outer: ['CONCRETE/CONCRETEWALL001A', 'CONCRETE/CONCRETEWALL029A', 'CONCRETE/CONCRETEWALL041A', 'CONCRETE/CONCRETEWALL004A'],
    inner: ['CONCRETE/CONCRETEWALL019A', 'CONCRETE/CONCRETEWALL001A', 'PLASTER/PLASTERWALL003A'],
    wet: ['CONCRETE/CONCRETEWALL019A'],
    floor: ['CONCRETE/CONCRETEFLOOR001A', 'CONCRETE/CONCRETEFLOOR028A', 'CONCRETE/CONCRETEFLOOR033A'],
    wetFloor: ['CONCRETE/CONCRETEFLOOR001A'],
    cap: 'CONCRETE/CONCRETEFLOOR028C', stair: 'CONCRETE/CONCRETEFLOOR028A', planks: 'WOOD/WOODFLOOR008A', windows: ['open'],
  },
  slum: {
    label: 'Corrugated slum shack',
    outer: ['METAL/METALWALL018A', 'METAL/METALWALL021A', 'METAL/METALWALL006B', 'METAL/METALWALL001A'],
    inner: ['WOOD/WOODWALL009A', 'WOOD/WOODWALL043A', 'WOOD/WOODWALL002A'],
    wet: ['WOOD/WOODWALL050A'],
    floor: ['WOOD/WOODFLOOR008A', 'CONCRETE/CONCRETEFLOOR001A', 'WOOD/WOODFLOOR001A'],
    wetFloor: ['CONCRETE/CONCRETEFLOOR001A'],
    cap: 'WOOD/WOODWALL048A', stair: 'WOOD/WOODSTAIR002B', planks: 'WOOD/WOODFLOOR008A', windows: ['open', 'boarded'],
  },
} as const satisfies Record<string, InteriorStyle>;
export type InteriorStyleName = keyof typeof INTERIOR_STYLES;
