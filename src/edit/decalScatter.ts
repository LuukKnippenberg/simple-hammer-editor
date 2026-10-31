import { Raycaster, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { placeDecalRay } from './decals.ts';
import type { Rng } from '../gen/rng.ts';

/**
 * Scattering decals by rule (posters along a wall, stains and litter across a floor) for set dressing. A
 * placement is a ray: the decal goes where it hits. Big ones become info_overlays (a map holds 512 of those,
 * against a handful of static decals before the engine starts dropping them), but vbsp only puts overlays on
 * world faces (and func_detail), so on a brush entity's face, or below `minOverlay`, they become infodecals.
 */
export interface DecalPlacement {
  material: string;
  from: Vector3;
  dir: Vector3;
  /** Overlay width in units; 0 for an infodecal at its own size. */
  size: number;
  rotation?: number;
}

export interface ScatterResult { overlays: number; decals: number; missed: number }

export async function placeDecals(editor: Editor, list: DecalPlacement[], reach = 400): Promise<ScatterResult> {
  const out: ScatterResult = { overlays: 0, decals: 0, missed: 0 };
  for (const d of list) {
    const ray = new Raycaster(d.from, d.dir.clone().normalize(), 0, reach);
    const hit = editor.world.raycast(ray);
    if (!hit) { out.missed++; continue; }
    const owner = hit.solid.entity;
    const overlay = d.size > 0 && (!owner || owner.classname === 'func_detail');
    const e = await placeDecalRay(editor, ray, { material: d.material, mode: overlay ? 'overlay' : 'decal', size: d.size, rotation: d.rotation ?? 0 });
    if (!e) out.missed++;
    else if (overlay) out.overlays++;
    else out.decals++;
  }
  return out;
}

/**
 * Placements along a wall face: `along` is the wall's axis, `at` its face coordinate, `n` the direction into the
 * room (±1 on the other axis), every `every` units from `from` to `to` (skipping `skip` ranges), at height z.
 */
export function alongWall(o: {
  along: 'x' | 'y'; at: number; n: 1 | -1; from: number; to: number; every: number; z: number;
  materials: string[]; size: [number, number]; rng: Rng; skip?: [number, number][]; jitter?: number; chance?: number;
}): DecalPlacement[] {
  const out: DecalPlacement[] = [];
  for (let c = o.from; c <= o.to; c += o.every) {
    if (o.skip?.some(([a, b]) => c > Math.min(a, b) && c < Math.max(a, b))) continue;
    if (o.chance !== undefined && !o.rng.chance(o.chance)) continue;
    const t = c + (o.jitter ? o.rng.range(-o.jitter, o.jitter) : 0);
    const off = o.at + o.n * 48;
    const from = o.along === 'x' ? new Vector3(t, off, o.z) : new Vector3(off, t, o.z);
    const dir = o.along === 'x' ? new Vector3(0, -o.n, 0) : new Vector3(-o.n, 0, 0);
    out.push({ material: o.rng.pick(o.materials), from, dir, size: Math.round(o.rng.range(o.size[0], o.size[1])) });
  }
  return out;
}

/** `count` placements on the floor of a rectangle, shot down from `top`, each turned at random. */
export function onFloor(o: { rect: [number, number, number, number]; count: number; top: number; materials: string[]; size: [number, number]; rng: Rng }): DecalPlacement[] {
  const [x0, y0, x1, y1] = o.rect;
  return Array.from({ length: o.count }, () => ({
    material: o.rng.pick(o.materials),
    from: new Vector3(o.rng.range(x0, x1), o.rng.range(y0, y1), o.top),
    dir: new Vector3(0, 0, -1),
    size: Math.round(o.rng.range(o.size[0], o.size[1])),
    rotation: o.rng.int(0, 359),
  }));
}
