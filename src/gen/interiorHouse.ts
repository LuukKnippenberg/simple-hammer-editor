import type { Vector2 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { solidNode } from '../edit/brushes.ts';
import { FLOOR, facadePrism } from './facade.ts';
import { FACADE_STYLES } from './styles.ts';
import type { FeatureEntity } from './facadeFeatures.ts';

/**
 * Options for an enterable, open-top house (see docs/interior-buildings-plan.md and
 * docs/generators-roadmap.md). The point-of-interest generator builds its houses through this.
 */
export interface InteriorHouseOptions {
  seed: number;
  /** Default 1. */
  storeys?: 1 | 2;
  /** Interior style name; the default depends on the landscape. */
  style?: string;
  /** Height the walls are cut off at (default 112). */
  cutHeight?: number;
  furnish?: 'none' | 'sparse' | 'full';
  lights?: boolean;
  wideDoors?: boolean;
  /** Footprint edges that must get an entrance (e.g. the side facing a square). */
  entranceEdges?: number[];
}

/**
 * An enterable house on a convex, counter-clockwise footprint standing at `z0`.
 * Stub until interior phase 2: a closed one-storey box, so callers can already use it.
 */
export function interiorHouse(doc: VmfDocument, footprint: Vector2[], z0: number, opts: InteriorHouseOptions): { world: KVNode[]; detail: KVNode[]; entities: FeatureEntity[] } {
  const s = FACADE_STYLES.stucco;
  const top = z0 + (opts.storeys ?? 1) * FLOOR;
  return { world: [solidNode(doc, facadePrism(footprint, z0 - 32, top, s.plain, 'CONCRETE/CONCRETEFLOOR028C', z0))], detail: [], entities: [] };
}
