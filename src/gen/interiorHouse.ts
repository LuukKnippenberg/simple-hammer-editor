import type { Box2, Vector2 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { Rng } from './rng.ts';
import { planInterior, type InteriorPlan } from './interiorPlan.ts';
import { interiorShell, shellMaterials } from './interiorShell.ts';
import { dressInterior } from './interiorDressing.ts';
import { INTERIOR_STYLES, type InteriorStyleName } from './styles.ts';
import type { FeatureEntity } from './facadeFeatures.ts';

/**
 * Options for an enterable, open-top house (see docs/interior-buildings-plan.md and
 * docs/generators-roadmap.md). The point-of-interest generator builds its houses through this.
 */
export interface InteriorHouseOptions {
  seed: number;
  /** Default 1. */
  storeys?: 1 | 2;
  /** Interior style name (`INTERIOR_STYLES`); default the plaster farmhouse. */
  style?: string;
  /** Height the walls are cut off at (default 112). */
  cutHeight?: number;
  /** Furniture (default full). */
  furnish?: 'none' | 'sparse' | 'full';
  /** Wall lamps with lights in most rooms (default on). */
  lights?: boolean;
  /** Stains, blood, posters and debris, 0 to 1 (default 0.5). */
  weathering?: number;
  wideDoors?: boolean;
  /** Footprint edges that must get an entrance (e.g. the side facing a square). */
  entranceEdges?: number[];
  /** A porch deck in front of the main door (default: half of the houses). */
  porch?: boolean;
  /** Areas next to the house where no entrance may open, such as neighbouring buildings. */
  noEntrance?: Box2[];
  /** Stubs of the cut-away eaves under the cap (default off). */
  eaves?: boolean;
}

/**
 * An enterable house on a counter-clockwise footprint standing at `z0`: rectangles, Ls and other
 * axis-aligned outlines (other edges are stepped on the 64 grid). Floor slabs are world brushes, the walls
 * func_detail (`detail`), so the open-top walls don't cut visibility.
 */
export function interiorHouse(doc: VmfDocument, footprint: Vector2[], z0: number, opts: InteriorHouseOptions): { world: KVNode[]; detail: KVNode[]; entities: FeatureEntity[]; plan: InteriorPlan } {
  const style = INTERIOR_STYLES[(opts.style ?? 'farmhouse') as InteriorStyleName] ?? INTERIOR_STYLES.farmhouse;
  const plan = planInterior(footprint, new Rng(opts.seed), {
    storeys: opts.storeys ?? 1, cut: opts.cutHeight ?? 112, wideDoors: opts.wideDoors, entranceEdges: opts.entranceEdges, porch: opts.porch,
    use: opts.style === 'outbuilding' ? 'workshop' : 'house', noEntrance: opts.noEntrance,
  });
  // Materials and window fills draw from their own sequence, so they never change the floor plan.
  const rng = new Rng(opts.seed * 29 + 1);
  const shell = interiorShell(doc, plan, z0, shellMaterials(plan, style, rng), rng, style.stair, opts.eaves && !opts.wideDoors);
  // Furniture, lamps and grime draw from a third sequence.
  const dressing = dressInterior(plan, z0, new Rng(opts.seed * 23 + 13), { furnish: opts.furnish, lights: opts.lights, weathering: opts.weathering });
  // The light blockers compile as detail on their own (the material says so).
  return { world: [...shell.floors, ...shell.clip, ...shell.ceilings], detail: [...shell.walls, ...shell.fills, ...shell.blockers, ...shell.porch, ...shell.upper, ...shell.eaves], entities: dressing.entities, plan };
}
