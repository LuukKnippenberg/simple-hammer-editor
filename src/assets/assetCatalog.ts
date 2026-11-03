/**
 * The game's assets of each kind (models, brush materials, decals, sounds) as one list per kind, for the asset
 * finder and the pickers: groups, badges for the filter chips, search, used-in-map counts, recent and favourites.
 */
import type { Editor } from '../editor.ts';
import type { MapEntity, MapSolid } from '../vmf/map.ts';
import { loadModelIndex, modelFolder, modelName, type ModelEntry } from './modelIndex.ts';
import { decalKind, placeableDecals } from '../edit/overlays.ts';
import { soundPath } from '../audio/localSounds.ts';
import { soundList } from '../ui/soundBrowser.ts';
import {
  favouriteDecals, favouriteMaterials, favouriteModels, favouriteSounds,
  recentDecals, recentMaterials, recentModels, recentSounds, type StoredList,
} from '../ui/recent.ts';

export type AssetKind = 'model' | 'material' | 'decal' | 'sound';

/**
 * One asset. `id` is its path as the map stores it, lower case: `models/props_c17/oildrum001.mdl`,
 * `brick/brickwall001a` (under materials/), `decals/lambdaspray_1a`, `ambient/levels/canals/drip1.wav` (under sound/).
 * `badges` say what the filter chips need to know:
 * - model: `static` (vbsp keeps it as a prop_static), `physics` (has physics prop_data), `skins` (more than one skin)
 * - material: `tool` (tools/ textures), `blend` (named as a blend: `blend` in the file name)
 * - decal: `overlay` (made as an overlay, in materials/overlays)
 * - sound: `loop` (named as a loop: `loop` in the file name; `wavLoops` reads the real loop points)
 */
export interface AssetItem {
  kind: AssetKind;
  id: string;
  name: string;
  /** Model folder under models/, material folder, decal kind (`DECAL_KINDS` id or `other`), sound folder. */
  group: string;
  badges: string[];
}

/** Folders that hold model, UI or effect materials rather than brush textures. */
const SKIP = /^(models|effects|vgui|sprites|particle|particles|console|debug|engine|editor|skybox|correction|perftest|voice|hud|cable|decals|overlays|fow|deferred|environment maps|shadertest|pg_tex)\//;

const lastPart = (path: string) => path.split('/').pop()!;
const firstPart = (path: string) => (path.includes('/') ? path.split('/')[0] : '');

/** Model items from the model index. */
export function modelAssets(index: ModelEntry[]): AssetItem[] {
  return index.map((m) => ({
    kind: 'model', id: m.path, name: modelName(m.path), group: modelFolder(m.path),
    badges: [m.static ? 'static' : '', m.physics ? 'physics' : '', m.skins > 1 ? 'skins' : ''].filter(Boolean),
  }));
}

/** Brush material items from `materials/...vmt` paths, without model, UI, effect, decal and overlay materials. */
export function materialAssets(paths: string[]): AssetItem[] {
  return paths.map((p) => p.slice(10, -4)).filter((p) => !SKIP.test(p)).map((p) => ({
    kind: 'material', id: p, name: lastPart(p), group: firstPart(p),
    badges: [p.startsWith('tools/') ? 'tool' : '', /blend/.test(lastPart(p)) ? 'blend' : ''].filter(Boolean),
  }));
}

/** Decal items from placeable decal names (`decals/...`, `overlays/...`). */
export function decalAssets(names: string[]): AssetItem[] {
  return names.map((n) => ({
    kind: 'decal', id: n, name: lastPart(n), group: decalKind(n), badges: n.startsWith('overlays/') ? ['overlay'] : [],
  }));
}

/** Sound items from paths under sound/. */
export function soundAssets(paths: string[]): AssetItem[] {
  return paths.map((p) => ({ kind: 'sound', id: p, name: lastPart(p), group: firstPart(p), badges: /loop/.test(lastPart(p)) ? ['loop'] : [] }));
}

let decals: Promise<string[]> | null = null;

/** Decal and overlay materials the game has, without blood, impacts and engine helpers. */
export function loadDecals(): Promise<string[]> {
  decals ??= Promise.all(['materials/decals', 'materials/overlays'].map((f) =>
    fetch(`/api/list?folder=${f}&ext=.vmt`).then((r) => (r.ok ? r.json() : [])).catch(() => [])))
    .then(([a, b]: string[][]) => placeableDecals([...a, ...b]));
  return decals;
}

const loaded = new Map<AssetKind, Promise<AssetItem[]>>();

/** Every asset of a kind, from the dev server; loaded once, later calls get the same list. */
export function loadAssets(kind: AssetKind): Promise<AssetItem[]> {
  let p = loaded.get(kind);
  if (!p) {
    p = kind === 'model' ? loadModelIndex().then(modelAssets)
      : kind === 'material' ? fetch('/api/list?folder=materials&ext=.vmt').then((r) => (r.ok ? r.json() : [])).catch(() => []).then(materialAssets)
      : kind === 'decal' ? loadDecals().then(decalAssets)
      : soundList().catch(() => []).then(soundAssets);
    loaded.set(kind, p);
  }
  return p;
}

/** The items whose path holds every word of the query (case does not matter); all of them for an empty query. */
export function searchAssets(items: AssetItem[], query: string): AssetItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? items.filter((i) => words.every((w) => i.id.includes(w))) : items;
}

/** The groups of the items with their sizes, largest first (ties in list order); items without a group are left out. */
export function assetGroups(items: AssetItem[]): { group: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of items) if (i.group) counts.set(i.group, (counts.get(i.group) ?? 0) + 1);
  return [...counts].map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count);
}

/** The texture an infodecal or info_overlay shows. */
export const decalTexture = (e: MapEntity) => (e.get(e.classname === 'info_overlay' ? 'material' : 'texture') ?? '').toLowerCase();

/** The model, decal or sound an entity uses, as an item id. */
function entityAsset(e: MapEntity, kind: AssetKind): string | undefined {
  if (kind === 'model') {
    const m = e.get('model')?.toLowerCase().replace(/\\/g, '/');
    return m?.endsWith('.mdl') ? m : undefined;
  }
  if (kind === 'decal') return e.classname === 'infodecal' || e.classname === 'info_overlay' ? decalTexture(e) || undefined : undefined;
  if (kind === 'sound' && e.classname === 'ambient_generic') return soundPath(e.get('message'))?.slice('sound/'.length);
  return undefined;
}

/**
 * How often the map uses each asset of a kind, by id: entities for models, decals and sounds (ambient_generic),
 * brush faces for materials. Worked out on every call, so call it again after the editor's `document` and `change`.
 */
export function usedInMap(editor: Editor, kind: AssetKind): Map<string, number> {
  const used = new Map<string, number>();
  const add = (id: string | undefined) => { if (id) used.set(id, (used.get(id) ?? 0) + 1); };
  if (kind === 'material') for (const s of editor.doc.allSolids()) for (const side of s.sides) add(side.material.toLowerCase());
  else for (const e of editor.doc.entities) add(entityAsset(e, kind));
  return used;
}

/** The brushes (materials) or entities (other kinds) in the map that use an asset. */
export function assetUses(editor: Editor, kind: AssetKind, id: string): { solids: MapSolid[]; entities: MapEntity[] } {
  if (kind === 'material') return { solids: editor.doc.allSolids().filter((s) => s.sides.some((side) => side.material.toLowerCase() === id)), entities: [] };
  return { solids: [], entities: editor.doc.entities.filter((e) => entityAsset(e, kind) === id) };
}

/** Recently used assets of a kind (24), kept in this browser. */
export function recentAssets(kind: AssetKind): StoredList {
  return { model: recentModels, material: recentMaterials, decal: recentDecals, sound: recentSounds }[kind];
}

/** Favourite assets of a kind (200), kept in this browser. */
export function favouriteAssets(kind: AssetKind): StoredList {
  return { model: favouriteModels, material: favouriteMaterials, decal: favouriteDecals, sound: favouriteSounds }[kind];
}
