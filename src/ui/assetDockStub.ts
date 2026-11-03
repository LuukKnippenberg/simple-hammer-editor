// STUB until task A (src/assets/assetCatalog.ts) and task D (src/edit/assetDrop.ts) land. Same signatures as theirs:
// delete this file and point the imports in assetDock.ts at those modules.
import type { Editor } from '../editor.ts';
import { loadModelIndex, modelFolder, modelName } from '../assets/modelIndex.ts';
import { loadDecals, decalsInMap } from './decalPicker.ts';
import { modelsInMap } from './modelPicker.ts';
import { soundList } from './soundBrowser.ts';
import { decalKind } from '../edit/overlays.ts';
import { StoredList, favouriteModels, recentDecals, recentModels } from './recent.ts';
import { toast } from './dom.ts';

export type AssetKind = 'model' | 'material' | 'decal' | 'sound';
export interface AssetItem { kind: AssetKind; id: string; name: string; group: string; badges: string[] }

const SKIP = /^(models|effects|vgui|sprites|particle|particles|console|debug|engine|editor|skybox|correction|perftest|voice|hud|cable|decals|overlays|fow|deferred|environment maps|shadertest|pg_tex)\//;
const lists = new Map<AssetKind, Promise<AssetItem[]>>();
const last = (p: string) => p.split('/').pop()!;

/** Every asset of a kind the game has (stub: the same sources the pickers use today). */
export function loadAssets(kind: AssetKind): Promise<AssetItem[]> {
  let p = lists.get(kind);
  if (!p) {
    p = kind === 'model'
      ? loadModelIndex().then((l) => l.map((m) => ({ kind, id: m.path, name: modelName(m.path), group: modelFolder(m.path),
        badges: [...m.static ? [] : ['physics'], ...m.skins > 1 ? ['skins'] : []] })))
      : kind === 'material'
        ? fetch('/api/list?folder=materials&ext=.vmt').then((r) => r.json()).then((paths: string[]) => paths.map((x) => x.slice(10, -4)).filter((x) => !SKIP.test(x))
          .map((id) => ({ kind, id, name: last(id), group: id.split('/')[0], badges: [...id.startsWith('tools/') ? ['tool'] : [], ...id.includes('blend') ? ['blend'] : []] })))
        : kind === 'decal'
          ? loadDecals().then((l) => l.map((id) => ({ kind, id, name: last(id), group: decalKind(id), badges: id.startsWith('overlays/') ? ['overlay'] : [] })))
          : soundList().then((l) => l.map((id) => ({ kind, id, name: last(id), group: id.split('/')[0], badges: /loop/.test(id) ? ['loop'] : [] })));
    lists.set(kind, p);
  }
  return p;
}

/** The items whose path holds every word of `query`. */
export function searchAssets(items: AssetItem[], query: string): AssetItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? items.filter((i) => words.every((w) => i.id.includes(w))) : items;
}

/** Groups (folders or decal kinds) with their item counts, largest first. */
export function assetGroups(items: AssetItem[]): { group: string; count: number }[] {
  const n = new Map<string, number>();
  for (const i of items) if (i.group) n.set(i.group, (n.get(i.group) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).map(([group, count]) => ({ group, count }));
}

/** How many times the map uses each asset. */
export function usedInMap(editor: Editor, kind: AssetKind): Map<string, number> {
  if (kind === 'model') return modelsInMap(editor);
  if (kind === 'decal') return new Map([...decalsInMap(editor)].map(([k, v]) => [k, v.length]));
  const used = new Map<string, number>();
  const add = (k: string) => used.set(k, (used.get(k) ?? 0) + 1);
  if (kind === 'material') for (const s of editor.doc.allSolids()) for (const side of s.sides) add(side.material.toLowerCase());
  else for (const e of editor.doc.entities) if (e.classname === 'ambient_generic' && e.get('message')) add(e.get('message')!.toLowerCase().replace(/\\/g, '/'));
  return used;
}

const recent: Partial<Record<AssetKind, StoredList>> = { model: recentModels, decal: recentDecals };
const favourite: Partial<Record<AssetKind, StoredList>> = { model: favouriteModels };
/** Recently used assets of a kind (24), kept in this browser. */
export function recentAssets(kind: AssetKind): StoredList {
  return (recent[kind] ??= new StoredList(`recent.${kind}s`, 24));
}
/** Favourite assets of a kind (200), kept in this browser. */
export function favouriteAssets(kind: AssetKind): StoredList {
  return (favourite[kind] ??= new StoredList(`fav.${kind}s`, 200));
}

/** Drags an asset from a dock tile into the view (stub: says it isn't there yet). */
export function startAssetDrag(kind: AssetKind, id: string, e: PointerEvent): void {
  void id;
  void e;
  const container = document.getElementById('viewport');
  if (container) toast(container, `Dragging a ${kind} into the view comes with the drag-and-drop task; click the tile to use it`);
}
