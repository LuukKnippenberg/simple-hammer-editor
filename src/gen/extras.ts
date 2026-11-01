/**
 * What the building generators add beyond the buildings: trees, street lamps, cables across the streets,
 * clutter on the walls and roofs, awnings, the props of green yards and roof props. Each can be turned off (and
 * the trees thinned or doubled) in a block's options, with a master switch over all of them. Left out, an option
 * keeps what the generators always made, so stored blocks rebuild as they were.
 *
 * Turning a category off drops what it made but still deals its random numbers, so nothing else on the block or
 * its streets moves (a different tree density or lamp spacing does move the street dressing).
 */
export type TreeDensity = 'none' | 'sparse' | 'normal' | 'dense';

export interface ExtrasOptions {
  /** Master switch over every extra (default on). Off is the same as each of them off. */
  extras?: boolean;
  /** Street, courtyard and yard trees (default normal). */
  trees?: TreeDensity;
  /** Lamp posts along the pavements (default on). */
  lamps?: boolean;
  /** Distance between lamp (and tree) spots along a block's side (default 448). */
  lampSpacing?: number;
  /** Cables strung across the streets, with their wall brackets (default on). */
  cables?: boolean;
  /** Drainpipes, satellite dishes and gas meters on street walls, TV antennas on pitched roofs (default on). */
  clutter?: boolean;
  /** Awnings over shop windows (default on). */
  awnings?: boolean;
  /** Benches, bins, playgrounds and parked cars in green yards (default on; their lawns stay). */
  yardProps?: boolean;
}

export const TREE_DENSITIES: Record<TreeDensity, { label: string; factor: number }> = {
  none: { label: 'None', factor: 0 },
  sparse: { label: 'Sparse', factor: 0.5 },
  normal: { label: 'Normal', factor: 1 },
  dense: { label: 'Dense', factor: 2 },
};

export const LAMP_SPACING = 448;
/** Lamp spacings the panels offer. */
export const LAMP_SPACINGS: [number, string][] = [[320, 'Close (320)'], [448, 'Normal (448)'], [640, 'Wide (640)'], [896, 'Far (896)']];

/** The categories a generator files what it makes under (roof props have their own `roofProps` option). */
export type ExtraCategory = 'trees' | 'lamps' | 'cables' | 'clutter' | 'awnings' | 'yardProps' | 'roofProps';

/** The options with every default filled in and the master switch applied. */
export interface Extras {
  /** Tree density as a factor (0: none, 1: as always). */
  trees: number;
  lampSpacing: number;
  keep: (c: ExtraCategory) => boolean;
}

export function resolveExtras(o: ExtrasOptions): Extras {
  const on = o.extras ?? true;
  const flags: Record<ExtraCategory, boolean> = {
    trees: on && (o.trees ?? 'normal') !== 'none', lamps: on && (o.lamps ?? true), cables: on && (o.cables ?? true),
    clutter: on && (o.clutter ?? true), awnings: on && (o.awnings ?? true), yardProps: on && (o.yardProps ?? true), roofProps: on,
  };
  const density = TREE_DENSITIES[o.trees ?? 'normal']?.factor ?? 1;
  return {
    // Turned off, trees are still dealt at the normal density (and then dropped), so the rest stays put.
    trees: flags.trees ? density : 1,
    lampSpacing: Math.max(192, o.lampSpacing ?? LAMP_SPACING),
    keep: (c) => flags[c],
  };
}

/** The extras options' keys, for the panels. */
export const EXTRAS_KEYS = ['extras', 'trees', 'lamps', 'lampSpacing', 'cables', 'clutter', 'awnings', 'yardProps'] as const satisfies readonly (keyof ExtrasOptions)[];
