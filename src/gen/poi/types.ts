import type { Vector3 } from 'three';
import type { KVNode } from '../../vmf/keyvalues.ts';
import type { KitParam, ParamValue } from '../../lw/kits.ts';
import type { PoiKit } from './kit.ts';

/**
 * Points of interest: one tool fills a rectangle with a finished area (a square, a parking lot, a
 * Combine checkpoint, ...). See docs/poi-generator-plan.md.
 */

export type Landscape = 'city' | 'forest' | 'beach' | 'rocky';
export type Rotation = 0 | 90 | 180 | 270;

export const LANDSCAPES: { id: Landscape; label: string }[] = [
  { id: 'city', label: 'City' }, { id: 'forest', label: 'Forest and rural' }, { id: 'beach', label: 'Beach and coast' }, { id: 'rocky', label: 'Rocky' },
];

/** An axis-aligned rectangle (in the POI's local frame or in the world, as noted where used). */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface PoiSpec {
  type: string;
  /** Ties the POI's func_detail, point entities and world brushes together (survives saving). */
  uid: string;
  seed: number;
  /** World rectangle. */
  rect: Rect;
  /**
   * Turns the layout: 0 puts the POI's local x along world +x. At 90 and 270 the local width runs along
   * world y, so the long side of a checkpoint can span a street either way.
   */
  rotation: Rotation;
  /** Ground height the POI stands on. */
  z: number;
  landscape: Landscape;
  params: Record<string, ParamValue>;
}

/** A point or brush entity a POI places. */
export interface PoiEntity {
  classname: string;
  origin?: Vector3;
  keys: Record<string, string>;
  /** Brush entities (capture areas, fog-of-war blockers). */
  solids?: KVNode[];
}

export interface PoiOutput {
  /** World brushes (water and anything else that must not be func_detail). */
  world: KVNode[];
  /** Brushes stored in the POI's func_detail. */
  detail: KVNode[];
  entities: PoiEntity[];
  /** Reserved through-routes in world coordinates (at least 128 wide), kept clear of props. */
  routes: Rect[];
  /** Highest water surface the POI made (world z), for water_lod_control and the editor preview. */
  waterLevel?: number;
  /**
   * Displacement terrain under the POI is flattened to this rectangle and height; `cuts` (sea, quarry pits)
   * are lowered further, to their own heights.
   */
  terrain?: { rect: Rect; z: number; paint: boolean; cuts?: { rect: Rect; z: number }[] };
}

/** What a POI offers for the game; the framework adds the matching parameters. */
export interface PoiGameplay {
  capture?: boolean;
  scrap?: boolean;
  /** Enemy unit groups (zombies, antlions, Combine) the POI can place. */
  units?: string[];
}

export interface PoiType {
  id: string;
  label: string;
  icon: string;
  hint: string;
  landscapes: Landscape[];
  /** Local width (x) and depth (y). */
  minSize: [number, number];
  maxSize: [number, number];
  defaultSize: [number, number];
  params: KitParam[];
  gameplay?: PoiGameplay;
  build(k: PoiKit): void;
}
