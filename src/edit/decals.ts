import { Raycaster, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity, MapSide } from '../vmf/map.ts';
import { parseVec, vecStr } from '../vmf/map.ts';
import { buildBrushFaces } from '../geom/brush.ts';
import { entityNode } from './actions.ts';
import { overlayKeys } from './overlays.ts';

export interface DecalSettings {
  material: string;
  /** infodecal: projected by the engine, size from the texture. overlay: info_overlay with free size and rotation. */
  mode: 'decal' | 'overlay';
  /** Overlay size in units (width; height follows the texture's aspect). */
  size: number;
  rotation: number;
  /** Overlays: mirror the texture along U or V. */
  flipU?: boolean;
  flipV?: boolean;
}

/** Brush sides coplanar with `side` whose face lies within `radius` of `center` (the faces an overlay covers). */
export function overlaySides(editor: Editor, side: MapSide, center: Vector3, radius: number): MapSide[] {
  const out: MapSide[] = [side];
  const target = buildBrushFaces(editor.doc.allSolids().find((s) => s.sides.includes(side))!).find((f) => f.side === side);
  if (!target) return out;
  const n = target.plane.normal, d = target.plane.dist;
  for (const solid of editor.doc.worldEntity.solids) {
    for (const f of buildBrushFaces(solid)) {
      if (f.side === side || f.plane.normal.dot(n) < 0.999 || Math.abs(f.plane.dist - d) > 0.5) continue;
      const near = f.verts.some((v) => v.distanceTo(center) < radius) ||
        f.verts.reduce((c, v) => c.add(v), new Vector3()).divideScalar(f.verts.length).distanceTo(center) < radius;
      if (near) out.push(f.side);
    }
  }
  return out.slice(0, 32);
}

/** Places an infodecal or info_overlay where the cursor hits a brush face. */
export function placeDecal(editor: Editor, ndc: Vector2, s: DecalSettings): Promise<MapEntity | null> {
  return placeDecalRay(editor, editor.raycaster(ndc), s);
}

/** Places a decal where a world-space ray hits a brush face (used by scripts and the decal tool). */
export async function placeDecalRay(editor: Editor, ray: Raycaster, s: DecalSettings): Promise<MapEntity | null> {
  const hit = editor.world.raycast(ray);
  if (!hit) return null;
  const n = hit.normal.clone().normalize();
  const info = editor.decals.info(s.material);
  await info.ready;
  const material = s.material.toLowerCase();
  let created: MapEntity;
  if (s.mode === 'decal') {
    created = editor.doc.addEntity(entityNode(editor, 'infodecal', hit.point.clone().addScaledVector(n, 1).round(), { texture: material }));
  } else {
    const w = s.size, h = s.size * (info.height / info.width || 1);
    const center = hit.point.clone();
    const sides = overlaySides(editor, hit.side, center, Math.hypot(w, h) / 2);
    created = editor.doc.addEntity(entityNode(editor, 'info_overlay', center.clone().round(), {
      material, ...overlayKeys(center, n, w, h, s.rotation, sides.map((x) => x.id), { u: s.flipU, v: s.flipV }),
    }));
  }
  editor.history.added('Place decal', [], [created]);
  editor.changed();
  return created;
}

/** Keeps an overlay's basis with its origin when it is moved. */
export function moveOverlayBasis(e: MapEntity, d: Vector3): void {
  if (e.classname !== 'info_overlay') return;
  const b = e.get('BasisOrigin');
  if (!b) return;
  const p = b.trim().split(/\s+/).map(Number);
  e.set('BasisOrigin', vecStr(new Vector3(p[0] + d.x, p[1] + d.y, p[2] + d.z)));
}

/** The brush face an infodecal sits on: the nearest hit of short rays along the axes, as the engine looks. */
export function decalSurface(editor: Editor, origin: Vector3): { point: Vector3; normal: Vector3; side: MapSide } | null {
  let best: { point: Vector3; normal: Vector3; side: MapSide; d: number } | null = null;
  for (const dir of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const hit = editor.world.raycast(new Raycaster(origin, new Vector3(...dir), 0, 24));
    if (hit && (!best || hit.distance < best.d)) best = { point: hit.point, normal: hit.normal.clone().normalize(), side: hit.side, d: hit.distance };
  }
  return best;
}

/**
 * Turns infodecals into info_overlays (texture size, unturned, on the face they sit on) or overlays into
 * infodecals (projected at the overlay's centre). Names are kept; one undo step. Returns how many changed.
 */
export async function convertDecals(editor: Editor, ents: MapEntity[], to: 'overlay' | 'decal'): Promise<number> {
  const from = to === 'overlay' ? 'infodecal' : 'info_overlay';
  const todo = ents.filter((e) => e.classname === from);
  const made: MapEntity[] = [], gone: MapEntity[] = [];
  for (const e of todo) {
    const material = (e.get(to === 'overlay' ? 'texture' : 'material') ?? '').toLowerCase();
    const name = e.get('targetname');
    const keep: Record<string, string> = name ? { targetname: name } : {};
    if (to === 'overlay') {
      const at = e.origin;
      const hit = at && decalSurface(editor, at);
      if (!hit) continue;
      const info = editor.decals.info(material);
      await info.ready;
      const sides = overlaySides(editor, hit.side, hit.point, Math.hypot(info.width, info.height) / 2);
      made.push(editor.doc.addEntity(entityNode(editor, 'info_overlay', hit.point.clone().round(), {
        ...keep, material, ...overlayKeys(hit.point, hit.normal, info.width, info.height, 0, sides.map((x) => x.id)),
      })));
    } else {
      const c = parseVec(e.get('BasisOrigin') ?? vecStr(e.origin ?? new Vector3()));
      const n = parseVec(e.get('BasisNormal') ?? '0 0 1').normalize();
      made.push(editor.doc.addEntity(entityNode(editor, 'infodecal', c.addScaledVector(n, 1).round(), { ...keep, texture: material })));
    }
    gone.push(e);
  }
  if (!made.length) return 0;
  editor.history.group(to === 'overlay' ? 'Decals to overlays' : 'Overlays to decals', () => {
    editor.history.added('', [], made);
    editor.history.remove('', [], gone);
  });
  editor.selection.set([], [...[...editor.selection.entities].filter((e) => !gone.includes(e)), ...made]);
  editor.changed();
  return made.length;
}
