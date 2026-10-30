import { Raycaster, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity, MapSide } from '../vmf/map.ts';
import { fmt, vecStr } from '../vmf/map.ts';
import { buildBrushFaces } from '../geom/brush.ts';
import { decalBasis } from '../render/decalRenderer.ts';
import { entityNode } from './actions.ts';

export interface DecalSettings {
  material: string;
  /** infodecal: projected by the engine, size from the texture. overlay: info_overlay with free size and rotation. */
  mode: 'decal' | 'overlay';
  /** Overlay size in units (width; height follows the texture's aspect). */
  size: number;
  rotation: number;
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
    const { s: sAxis, t: tAxis } = decalBasis(n);
    const r = (s.rotation * Math.PI) / 180;
    const U = sAxis.clone().multiplyScalar(Math.cos(r)).addScaledVector(tAxis, Math.sin(r));
    const V = new Vector3().crossVectors(n, U).normalize();
    const w = s.size / 2, h = (s.size * (info.height / info.width || 1)) / 2;
    const center = hit.point.clone();
    const sides = overlaySides(editor, hit.side, center, Math.hypot(w, h));
    const v3 = (v: Vector3) => vecStr(new Vector3(+fmt(v.x), +fmt(v.y), +fmt(v.z)));
    created = editor.doc.addEntity(entityNode(editor, 'info_overlay', center.clone().round(), {
      material, sides: sides.map((x) => x.id).join(' '),
      BasisOrigin: v3(center), BasisNormal: v3(n), BasisU: v3(U), BasisV: v3(V),
      StartU: '0', StartV: '0', EndU: '1', EndV: '1',
      uv0: `${fmt(-w)} ${fmt(-h)} 0`, uv1: `${fmt(-w)} ${fmt(h)} 0`, uv2: `${fmt(w)} ${fmt(h)} 0`, uv3: `${fmt(w)} ${fmt(-h)} 0`,
      fademindist: '-1',
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
