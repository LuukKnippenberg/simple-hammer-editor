import { Raycaster, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { solidBounds } from '../edit/brushes.ts';
import { entityNode } from '../edit/actions.ts';
import type { BuildingOptions } from './buildings.ts';
import type { BlockDressing } from './streets.ts';
import { roadGround, roadOf, type RoadSpec } from './roads.ts';
import {
  BLOCK_ID_KEY, BLOCK_KEY, blockHandleNode, blockMembers, blockOf, blockOwner, blocksInGroup, generateBlock, groupDressing, groupStreet,
  movedBy, newBlockUid, rememberDressing, storeBlock, type BlockSpec,
} from './buildingStore.ts';
import { BUILDING_HANDLE, findHandle, fitHandleTo, handleBox, kindOf, turnedHandleDrag, turnedHandleUnmoved } from './handle.ts';
import { fineTurn, normAngle, splitAngle, turnedBounds } from './turn.ts';

/**
 * Editor actions for blocks of buildings: generate them from block brushes, rebuild one in place from its stored
 * spec (after a settings change, a move or a resize of its handle), duplicate and delete. Each is one undo step,
 * and each rebuilds the street dressing of the block's group.
 */

/** Replaces each selected block brush with a stored block of buildings, all in one group (one undo step). */
export function buildingsFromSelection(editor: Editor, opts: Omit<BuildingOptions, 'seed'> & { seed?: number; street?: boolean }): number {
  const solids = [...editor.selection.solids].filter((s) => !s.entity);
  if (!solids.length) return 0;
  const { street, ...options } = opts;
  const seed = opts.seed ?? Date.now() % 100000;
  const group = newBlockUid();
  let count = 0;
  const made: MapEntity[] = [];
  editor.history.group('Generate buildings', () => {
    const known: BlockDressing[] = [];
    solids.forEach((s, i) => {
      const box = solidBounds(s);
      // The panel's seed for the first block, a derived one for each further block.
      const spec: BlockSpec = {
        uid: newBlockUid(), group, street: (street ?? true) ? 'flat' : 'none', groupSeed: seed,
        rect: { x0: Math.round(box.min.x), y0: Math.round(box.min.y), x1: Math.round(box.max.x), y1: Math.round(box.max.y) }, z: Math.round(box.min.z),
        options: { ...options, seed: seed + i * 7919 },
      };
      const r = applyBlock(editor, spec, 'Generate buildings', null, false);
      count += r.buildings;
      made.push(r.detail);
      known.push(r.dressing);
    });
    // Cables across the streets between the selected blocks, lamps and trees.
    dressGroup(editor, group, known);
    editor.history.remove('Remove block', solids);
  });
  editor.selection.set([], made.map((d) => findHandle(editor.doc, BUILDING_HANDLE, d.get(BLOCK_ID_KEY) ?? '') ?? d));
  editor.changed();
  return count;
}

/**
 * Builds (or rebuilds) a block from its spec and swaps the result in for its old parts; with `dress`, the
 * group's street dressing is rebuilt too. One undo step. Returns the block's func_detail.
 */
export function applyBlock(editor: Editor, spec: BlockSpec, label: string, existing: MapEntity | null = null, dress = true): { detail: MapEntity; buildings: number; houses: number; ring: boolean; dressing: BlockDressing } {
  const doc = editor.doc;
  let detail = existing;
  let buildings = 0, houses = 0, ring = false;
  let dressing!: BlockDressing;
  editor.history.group(label, () => {
    const old = existing ? blockMembers(doc, existing.get(BLOCK_ID_KEY) ?? spec.uid) : { detail: null, entities: [], world: [], handle: null };
    if (old.entities.length || old.world.length) editor.history.remove('Remove old block parts', old.world, old.entities);
    const out = generateBlock(doc, spec);
    buildings = out.buildings;
    houses = out.interiorHouses;
    ring = !!out.ring;
    dressing = out.dressing;
    rememberDressing(spec, out.dressing);
    if (detail) {
      const end = editor.history.begin('Rebuild block', [], [detail]);
      storeBlock(doc, spec, out, detail.node);
      detail.reload();
      end();
    } else {
      detail = doc.addEntity(storeBlock(doc, spec, out, null));
    }
    const world = out.solids.map((n) => doc.addSolid(n));
    const ents = out.entities.map((e) => doc.addEntity(entityNode(editor, e.classname, e.origin, { ...e.keys, [BLOCK_ID_KEY]: spec.uid })));
    // The handle follows the footprint; it keeps its identity, so a selected handle stays selected.
    if (old.handle) {
      const end = editor.history.begin('Fit block handle', [], [old.handle]);
      fitHandleTo(doc, old.handle, spec.rect, spec.z, spec.angle ?? 0);
      end();
    } else {
      ents.push(doc.addEntity(blockHandleNode(doc, spec)));
    }
    editor.history.added('Add buildings', world, existing ? ents : [detail, ...ents]);
    if (dress) dressGroup(editor, spec.group, [], { [spec.uid]: out.dressing });
  });
  editor.changed();
  return { detail: detail!, buildings, houses, ring, dressing };
}

/**
 * Rebuilds a group's street dressing from all its blocks (or removes it when the group has no blocks left).
 * `known` holds the dressing input of the group's blocks in order, `fresh` that of blocks just rebuilt.
 */
export function dressGroup(editor: Editor, group: string, known: BlockDressing[] = [], fresh: Record<string, BlockDressing> = {}): void {
  const doc = editor.doc;
  const old = groupDressing(doc, group);
  if (old.length) editor.history.remove('Remove street dressing', [], old);
  const specs = blocksInGroup(doc, group).map((e) => blockOf(e)!);
  const ds = specs.map((b, i) => known[i] ?? fresh[b.uid]);
  const ents = groupStreet(specs, streetGround(editor, Math.min(...specs.map((b) => b.z))), ds)
    .map((e) => doc.addEntity(entityNode(editor, e.classname, e.origin, e.keys)));
  if (ents.length) editor.history.added('Street dressing', [], ents);
}

const SKIP = /^(trigger_|fow_blocker|func_nav_blocker|func_clip|func_areaportal)/;

/**
 * Where lamps and trees stand in the editor: on the roads' pavements (never on a carriageway), else on the
 * brushes under them, looking past blocks of buildings (which may be mid-rebuild) and triggers.
 */
function streetGround(editor: Editor, fallback: number): (x: number, y: number) => number | null {
  const doc = editor.doc;
  const onRoad = roadGround(doc.entities.map((e) => roadOf(e)).filter((r): r is RoadSpec => !!r));
  const live = new Set(doc.allSolids());
  const blockWorld = new Set(doc.entities.filter((e) => e.get(BLOCK_KEY)).flatMap((e) => blockMembers(doc, e.get(BLOCK_ID_KEY) ?? '').world));
  const ray = new Raycaster();
  return (x, y) => {
    const g = onRoad(x, y);
    if (g) return g.kind === 'surface' || g.kind === 'rail' ? null : g.z;
    let top = fallback + 4096;
    for (let i = 0; i < 8; i++) {
      ray.set(new Vector3(x, y, top), new Vector3(0, 0, -1));
      const hit = editor.world.raycast(ray);
      if (!hit) return fallback;
      const ent = hit.solid.entity;
      const skip = !live.has(hit.solid) || blockWorld.has(hit.solid) || (ent && (ent.get(BLOCK_ID_KEY) || SKIP.test(ent.classname)));
      if (!skip) return hit.point.z;
      top = hit.point.z - 1;
    }
    return fallback;
  };
}

/** Rebuilds a block with changes to its spec (options, footprint). */
export function regenerateBlock(editor: Editor, detail: MapEntity, patch: Partial<Omit<BlockSpec, 'options'>> & { options?: Partial<BuildingOptions> } = {}, label = 'Regenerate buildings'): MapEntity | null {
  const b = blockOf(detail);
  if (!b) return null;
  const spec: BlockSpec = { ...b, ...patch, options: { ...b.options, ...patch.options } };
  // The block was moved by its brushes (handles hidden): follow it (its brushes moved, the stored footprint didn't).
  if (!patch.rect) {
    const moved = movedBy(detail);
    if (moved) spec.rect = { x0: spec.rect.x0 + moved[0], y0: spec.rect.y0 + moved[1], x1: spec.rect.x1 + moved[0], y1: spec.rect.y1 + moved[1] };
  }
  const e = applyBlock(editor, spec, label, detail).detail;
  selectBlock(editor, e);
  return e;
}

/** The blocks (their func_details) whose handles are selected, if the selection is nothing but block handles. */
export function selectedBlocks(editor: Editor): MapEntity[] {
  const sel = editor.selection;
  if (sel.solids.size || !sel.entities.size || ![...sel.entities].every((e) => kindOf(e) === BUILDING_HANDLE)) return [];
  return [...sel.entities].map((h) => blockOwner(editor.doc, h)).filter((d): d is MapEntity => !!d);
}

/** Selects a block by its handle (or its func_detail if it has none). */
export function selectBlock(editor: Editor, detail: MapEntity): void {
  editor.selection.set([], [findHandle(editor.doc, BUILDING_HANDLE, detail.get(BLOCK_ID_KEY) ?? '') ?? detail]);
}

/** The smallest footprint a block is resized to (one building). */
const MIN_SIZE = 128;

/**
 * Rebuilds a block where its handle was dragged to (call when a move or resize of the handle ends). A move keeps
 * the block's level unless the handle was lifted or lowered; a resize keeps the level and at least 128 × 128.
 */
export function blockHandleDragged(editor: Editor, handle: MapEntity, mode: 'translate' | 'scale'): void {
  const detail = blockOwner(editor.doc, handle);
  const b = detail && blockOf(detail);
  const box = handleBox(handle);
  if (!detail || !b || !box) return;
  // A block at an angle: its handle is turned, and the gizmo moved or scaled the box round it.
  const turned = turnedHandleDrag(handle, b.rect, b.angle ?? 0);
  if (turned) {
    if (turnedHandleUnmoved(turned, b.rect, b.z)) {
      const end = editor.history.begin('Fit block handle', [], [handle]);
      fitHandleTo(editor.doc, handle, b.rect, b.z, b.angle ?? 0);
      end();
      return;
    }
    const [w, h] = mode === 'scale' ? [Math.max(MIN_SIZE, Math.round(turned.w)), Math.max(MIN_SIZE, Math.round(turned.h))] : [b.rect.x1 - b.rect.x0, b.rect.y1 - b.rect.y0];
    const x0 = Math.round(turned.cx - w / 2), y0 = Math.round(turned.cy - h / 2);
    const z = mode === 'translate' && Math.abs(turned.z - b.z) >= 1 ? Math.round(turned.z) : b.z;
    regenerateBlock(editor, detail, { rect: { x0, y0, x1: x0 + w, y1: y0 + h }, z }, mode === 'translate' ? 'Move buildings' : 'Resize buildings');
    return;
  }
  const rect = { x0: Math.round(box.min.x), y0: Math.round(box.min.y), x1: Math.round(box.max.x), y1: Math.round(box.max.y) };
  rect.x1 = Math.max(rect.x1, rect.x0 + MIN_SIZE);
  rect.y1 = Math.max(rect.y1, rect.y0 + MIN_SIZE);
  const z = mode === 'translate' && Math.abs(box.min.z - b.z) >= 1 ? Math.round(box.min.z) : b.z;
  const r = b.rect;
  if (rect.x0 === r.x0 && rect.y0 === r.y0 && rect.x1 === r.x1 && rect.y1 === r.y1 && z === b.z) {
    // Nothing to rebuild (a resize of its height): put the handle back.
    const end = editor.history.begin('Fit block handle', [], [handle]);
    fitHandleTo(editor.doc, handle, b.rect, b.z, b.angle ?? 0);
    end();
    return;
  }
  regenerateBlock(editor, detail, { rect, z }, mode === 'translate' ? 'Move buildings' : 'Resize buildings');
}

/**
 * Turns a block `degrees` counter-clockwise about its centre. A block has no front, so a quarter turn just swaps its
 * footprint's sides (the buildings are generated anew to fit it, as a quarter turn always did) and only the rest is
 * stored as its angle (within 45° of 0): the generated block is turned by that much.
 */
export function turnBlockBy(editor: Editor, detail: MapEntity, degrees: number, label = 'Turn buildings'): void {
  const b = blockOf(detail);
  if (!b) return;
  regenerateBlock(editor, detail, blockTurnedBy(b, degrees), label);
}

/** A block's footprint and angle after turning it `degrees` (see `turnBlockBy`). */
export function blockTurnedBy(b: BlockSpec, degrees: number): { rect: BlockSpec['rect']; angle: number } {
  const { quarter, fine } = splitAngle((b.angle ?? 0) + degrees);
  return { rect: quarter % 180 ? swapSides(b.rect) : b.rect, angle: normAngle(fine) };
}

/** A footprint turned a quarter turn about its centre (its sides swapped). */
function swapSides(r: BlockSpec['rect']): BlockSpec['rect'] {
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, w = r.y1 - r.y0, h = r.x1 - r.x0;
  return { x0: Math.round(cx - w / 2), y0: Math.round(cy - h / 2), x1: Math.round(cx - w / 2) + w, y1: Math.round(cy - h / 2) + h };
}

/** Turns a block's footprint a quarter turn around its centre (the buildings are generated anew to fit it). */
export function turnBlock(editor: Editor, detail: MapEntity, dir: 1 | -1 = 1): void {
  turnBlockBy(editor, detail, dir * 90);
}

/** Builds a copy of a block (same settings and seed) next to it along +x, in the same group, and selects it. */
export function duplicateBlock(editor: Editor, detail: MapEntity): MapEntity | null {
  const b = blockOf(detail);
  if (!b) return null;
  // Beside it: past the box round it when it stands at an angle.
  const bb = turnedBounds(b.rect, fineTurn(b.rect, b.angle ?? 0));
  const dx = Math.ceil(bb.x1 - bb.x0) + 256;
  const spec: BlockSpec = { ...b, uid: newBlockUid(), rect: { x0: b.rect.x0 + dx, y0: b.rect.y0, x1: b.rect.x1 + dx, y1: b.rect.y1 } };
  const e = applyBlock(editor, spec, 'Duplicate buildings').detail;
  selectBlock(editor, e);
  return e;
}

/** Deletes a block and everything it made; the group's street dressing is rebuilt without it (one undo step). */
export function deleteBlock(editor: Editor, detail: MapEntity): void {
  const b = blockOf(detail);
  if (!b) return;
  const m = blockMembers(editor.doc, b.uid);
  editor.history.group('Delete buildings', () => {
    editor.history.remove('Delete buildings', m.world, [detail, ...m.entities, ...(m.handle ? [m.handle] : [])]);
    dressGroup(editor, b.group);
  });
  editor.selection.clear();
  editor.changed();
}

