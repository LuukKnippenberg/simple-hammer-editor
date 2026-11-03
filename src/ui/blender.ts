import type { Editor } from '../editor.ts';
import type { GroundTool } from '../edit/groundTool.ts';
import { forgetVmt, loadVmt } from '../assets/vmt.ts';
import { textureThumbnail } from '../assets/thumbnails.ts';
import {
  BLEND_EDGES, BLEND_FOLDER, EDGE_SPECS, blendFromParams, materialForBlend, safeBlendName, type BlendDef, type BlendEdge, type BlendLayer,
} from '../edit/multiblend.ts';
import { layerOutline, noiseWeights, paintDab, previewGrid, sampleWeights, splitWeights, type PreviewGrid } from '../edit/blendSample.ts';
import { patchesUsing, repointPatches } from '../edit/terrain.ts';
import { blendPreview, type BlendPreview } from '../render/blendPreview.ts';
import { isTyping } from '../render/cameraControls.ts';
import { openPicker, kbd, type PickerSource } from './assetPicker.ts';
import { StoredList } from './recent.ts';
import { multiblendSets } from './blendUi.ts';
import { setToolButtons } from './toolbar.ts';
import { apiPost } from '../api.ts';
import { h } from './dom.ts';
import './blender.css';

/** A blend in the library: as saved on disk and as being edited. */
interface Entry {
  /** Material path, upper case (SHE/BLEND/CANAL_MUD); the old one until a rename is saved. */
  material: string;
  /** Made in the editor (materials/she/blend); the game's own (materials/blends) are read-only. */
  mine: boolean;
  /** As on disk; null for a new blend that was never saved. */
  saved: BlendDef | null;
  draft: BlendDef;
}

type Mode = 'sample' | 'noise' | 'split' | 'paint';

const MODES: [Mode, string, string][] = [
  ['sample', 'Sample', 'A fixed painted stroke, so blends compare fairly.'],
  ['noise', 'Noise', 'The Ground tool’s noise fill, with its coverage and patch size.'],
  ['split', 'Split', 'Each layer in a band, side by side.'],
  ['paint', 'Paint', 'Try it by hand; nothing in the map changes.'],
];
const KIND = ['Base', 'Layer 1', 'Layer 2', 'Layer 3'];
const EDGE_HINT: Record<BlendEdge, string> = {
  crisp: 'no $spectexture · only where fully painted',
  medium: 'forest_grass_10b_spec · from 59% painted',
  soft: 'forest_grass_10a_spec · from 13% painted',
};
const SIZE = { min: 0.25, max: 4 };

/** Kept between openings, so unsaved changes (the amber dot) survive closing the blender. */
const library: Entry[] = [];

const recentTextures = new StoredList('recent.blendtextures', 24);
const favouriteTextures = new StoredList('fav.blendtextures', 200);

const short = (path: string) => path.split('/').pop() ?? path;
/** The children that are there (leaves out null and false). */
const present = (...xs: (Node | string | null | false)[]) => xs.filter((x): x is Node | string => !!x);
const clone = (d: BlendDef): BlendDef => JSON.parse(JSON.stringify(d));
const dirty = (e: Entry) => !e.saved || JSON.stringify(e.saved) !== JSON.stringify(e.draft);

async function listVmts(folder: string): Promise<string[]> {
  const r = await fetch(`/api/list?folder=${encodeURIComponent(folder)}&ext=.vmt`);
  return r.ok ? ((await r.json()) as string[]) : [];
}

/** Reads My blends and the game's blends from disk into `library`, keeping unsaved drafts. */
async function loadLibrary(): Promise<void> {
  const files = [...(await listVmts(`materials/${BLEND_FOLDER}`)), ...(await listVmts('materials/blends'))];
  const found = new Set<string>();
  for (const f of files) {
    const path = f.replace(/^materials\//, '').replace(/\.vmt$/, '');
    const mine = path.startsWith(BLEND_FOLDER + '/');
    // Mine may have changed on disk since they were read.
    if (mine) forgetVmt(path);
    const vmt = await loadVmt(path);
    if (vmt?.shader !== 'multiblend') continue;
    const material = path.toUpperCase();
    found.add(material);
    const saved = blendFromParams(short(path), vmt.params);
    const old = library.find((e) => e.material === material);
    if (!old) library.push({ material, mine, saved, draft: clone(saved) });
    else if (!dirty(old)) Object.assign(old, { saved, draft: clone(saved) });
    else old.saved = saved;
  }
  // Blends deleted on disk go; new ones that were never saved stay.
  for (let i = library.length - 1; i >= 0; i--) if (library[i].saved && !found.has(library[i].material)) library.splice(i, 1);
}

/** A free name in My blends, starting from `base`. */
function freeName(base: string): string {
  const taken = new Set(library.filter((e) => e.mine).flatMap((e) => [e.draft.name, short(e.material).toLowerCase()]));
  let name = safeBlendName(base);
  for (let n = 2; taken.has(name); n++) name = safeBlendName(`${base}_${n}`);
  return name;
}

/** Two textures split corner to corner: the base and layer 1. */
function swatch(def: BlendDef, cls = 'span.bl-swatch'): HTMLElement {
  const a = h('img', { alt: '' }) as HTMLImageElement, b = h('img.second', { alt: '' }) as HTMLImageElement;
  void textureThumbnail(def.layers[0].texture).then((u) => u && (a.src = u));
  void textureThumbnail((def.layers[1] ?? def.layers[0]).texture).then((u) => u && (b.src = u));
  return h(cls as 'span', {}, a, b);
}

function textureImg(texture: string, size = 64): HTMLImageElement {
  const img = h('img', { alt: '' }) as HTMLImageElement;
  void textureThumbnail(texture, size).then((u) => u && (img.src = u));
  return img;
}

/** Where the blender opens: on a blend (material), or on a new one. */
export interface BlenderOptions {
  material?: string;
  /** Layer selected first (0 = base). */
  layer?: number;
  newBlend?: boolean;
  /** Shown in the head: where it was opened from. */
  from?: string;
}

/**
 * The material blender: a library of blends (My blends and the game's own), a live preview on a scratch patch of
 * ground, and the layers of the selected blend. Saving writes materials/she/blend/<name>.vmt and updates the
 * patches that use it; renaming re-points them; Paint with it goes back to the Ground tool on the blend.
 */
export async function openBlender(editor: Editor, opts: BlenderOptions = {}): Promise<void> {
  document.querySelector('.blender-backdrop')?.remove();
  await loadLibrary();
  let sel: Entry | undefined = opts.material ? library.find((e) => e.material === opts.material!.toUpperCase()) : undefined;
  let layer = opts.layer ?? 1;
  let mode: Mode = 'sample';
  let light = true;
  let radius = 128;
  let msg = '';
  let deleting = false;
  const grid = previewGrid();
  const scratch = previewGrid();
  const tool = editor.tools.tools.ground as GroundTool;

  const backdrop = h('div.modal-backdrop.blender-backdrop');
  const dialog = h('section.blender', { role: 'dialog', 'aria-label': 'Material blender' });
  backdrop.append(dialog);
  const libEl = h('aside.bl-lib');
  const layersEl = h('aside.bl-layers');
  const footer = h('footer.bl-foot');
  const canvas = h('canvas.bl-canvas', { width: 760, height: 560 }) as HTMLCanvasElement;
  const tag = h('span.bl-tag');
  const modesEl = h('div.seg.bl-modes');
  const modeHint = h('span.bl-hint');
  const lightBtn = h('button.bl-light', { title: 'Shade the preview like the map’s sun' }, 'Lighting');
  const preview: BlendPreview = blendPreview(editor, canvas, grid);

  const users = (e: Entry) => patchesUsing(editor.doc.allSolids(), e.material);
  const usersText = (n: number) => `${n} patch${n === 1 ? '' : 'es'}`;

  const newBlend = () => {
    const draft: BlendDef = { name: freeName('new_blend'), layers: [
      { texture: 'nature/forest_grass_01', scale: 1, rotation: 0 },
      { texture: 'nature/forest_dirt_02', scale: 1, rotation: 0, edge: 'medium' },
    ] };
    const e: Entry = { material: materialForBlend(draft.name), mine: true, saved: null, draft };
    library.push(e);
    select(e, 1);
  };

  const select = (e: Entry, l = 1) => {
    sel = e;
    layer = Math.min(l, e.draft.layers.length - 1);
    msg = '';
    deleting = false;
    renderAll();
    void preview.setBlend(e.draft);
  };

  /** A change to the selected blend: the library dot, the footer and the preview follow. */
  const changed = (rebuild = true) => {
    msg = '';
    renderLibrary();
    renderFooter();
    if (rebuild) void preview.setBlend(sel!.draft);
    refreshPreview();
  };

  // ---- library ----
  const libItem = (e: Entry) => {
    const n = users(e).length;
    const d = e.draft;
    const item = h(e === sel ? 'button.bl-item.on' : 'button.bl-item', { onclick: () => select(e) },
      swatch(d),
      h('span.bl-item-text', {}, h('b', {}, d.name), h('span', {}, `${d.layers.length} layers${n ? ` · on ${usersText(n)}` : ''}`)),
      e.mine && dirty(e) ? h('span.bl-dot', { title: 'Unsaved changes' }, '●') : null);
    item.dataset.material = e.material;
    return item;
  };
  function renderLibrary(): void {
    const mine = library.filter((e) => e.mine).sort((a, b) => Number(!a.saved) - Number(!b.saved) || a.draft.name.localeCompare(b.draft.name));
    const game = library.filter((e) => !e.mine).sort((a, b) => a.draft.name.localeCompare(b.draft.name));
    libEl.replaceChildren(
      h('div.bl-sh', {}, h('h3', {}, 'My blends'), h('span', {}, `materials/${BLEND_FOLDER}`)),
      ...mine.map(libItem),
      h('button.bl-new', { onclick: newBlend }, '+ New blend'),
      h('div.bl-sh', {}, h('h3', {}, 'Lambda Wars'), h('span', {}, 'read-only')),
      h('div.bl-game', {}, ...game.map(libItem)),
      h('p.bl-note', {}, 'The two-texture ground sets (Grass → dirt and so on) stay as they are; the blender makes four-layer MultiBlend materials, like the game’s own.'));
  }

  // ---- preview ----
  function refreshPreview(): void {
    if (!sel) return;
    const d = sel.draft, n = d.layers.length;
    let g: PreviewGrid = grid;
    if (mode === 'sample') sampleWeights(grid, n);
    else if (mode === 'noise') noiseWeights(grid, tool.noise, n);
    else if (mode === 'split') splitWeights(grid, n);
    else g = scratch;
    preview.setWeights(g);
    preview.setOutline(mode === 'split' ? [] : layerOutline(g, d, layer));
    preview.setLighting(light);
    preview.draw();
    tag.textContent = mode === 'paint' ? `Painting with ${KIND[Math.max(1, layer)]} · brush ${radius}` : mode === 'split' ? KIND.slice(0, n).join(' · ') : `Dashed: where ${KIND[layer]} shows`;
    modesEl.replaceChildren(...MODES.map(([m, label]) => {
      const b = h(m === mode ? 'button.active' : 'button', { onclick: () => { mode = m; refreshPreview(); } }, label);
      b.dataset.mode = m;
      return b;
    }));
    modeHint.textContent = MODES.find(([m]) => m === mode)![2];
    lightBtn.classList.toggle('active', light);
  }
  lightBtn.addEventListener('click', () => { light = !light; refreshPreview(); });

  let stroke: { erase: boolean; last: { x: number; y: number } | null } | null = null;
  const dab = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const p = preview.groundAt(ev.clientX - r.left, ev.clientY - r.top);
    if (!p || !stroke || !sel) return;
    // Dabs a quarter radius apart along the drag, however fast the pointer moves.
    const from = stroke.last ?? { x: p.x, y: p.y };
    const steps = stroke.last ? Math.floor(Math.hypot(p.x - from.x, p.y - from.y) / (radius * 0.25)) : 1;
    if (!steps) return;
    for (let k = 1; k <= steps; k++) {
      const t = stroke.last ? k / steps : 1;
      paintDab(scratch, from.x + (p.x - from.x) * t, from.y + (p.y - from.y) * t, radius, stroke.erase ? 0 : Math.max(1, layer), 0.35);
    }
    stroke.last = { x: p.x, y: p.y };
    refreshPreview();
  };
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  canvas.addEventListener('pointerdown', (ev) => {
    if (mode !== 'paint' || (ev.button !== 0 && ev.button !== 2)) return;
    canvas.setPointerCapture(ev.pointerId);
    stroke = { erase: ev.button === 2 || layer === 0, last: null };
    dab(ev);
  });
  canvas.addEventListener('pointermove', (ev) => { if (stroke) dab(ev); });
  canvas.addEventListener('pointerup', () => (stroke = null));

  // ---- layers ----
  const edit = (fn: (d: BlendDef) => void, rebuild = true) => {
    if (!sel?.mine) return;
    fn(sel.draft);
    changed(rebuild);
  };
  const slider = (label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, set: (v: number) => void, ro: boolean) => {
    const out = h('span.bl-val', {}, fmt(value));
    const range = h('input', { type: 'range', min, max, step, value, disabled: ro, 'aria-label': label }) as HTMLInputElement;
    range.addEventListener('input', () => { set(Number(range.value)); out.textContent = fmt(Number(range.value)); });
    return h('div.bl-row', {}, h('label', {}, label), range, out);
  };
  function layerCard(l: BlendLayer, i: number, ro: boolean): HTMLElement {
    const card = h(i === layer ? 'div.bl-layer.on' : 'div.bl-layer', { onclick: () => { if (layer !== i) { layer = i; renderLayers(); refreshPreview(); } } },
      h('div.bl-layer-head', {},
        textureImg(l.texture),
        h('span.bl-layer-name', {}, h('span.bl-kind', {}, KIND[i]), h('span.bl-tex', { title: l.texture }, l.texture)),
        h('button', { disabled: ro, onclick: (ev: Event) => { ev.stopPropagation(); layer = i; renderLayers(); openTextureBrowser(i); } }, 'Change…'),
        i >= 2 ? h('button.bl-x', { disabled: ro, 'aria-label': 'Remove layer', onclick: (ev: Event) => {
          ev.stopPropagation();
          edit((d) => d.layers.splice(i, 1));
          layer = Math.min(layer, sel!.draft.layers.length - 1);
          renderLayers();
        } }, '✕') : null),
      slider('Size', l.scale, SIZE.min, SIZE.max, 0.05, (v) => `${v.toFixed(2)}×`, (v) => edit(() => (l.scale = v)), ro),
      slider('Rotation', l.rotation, -180, 180, 5, (v) => `${Math.round(v)}°`, (v) => edit(() => (l.rotation = v)), ro));
    card.dataset.layer = String(i);
    if (i > 0) {
      const edge = l.edge ?? 'soft';
      card.append(
        h('div.bl-row', {}, h('label', {}, 'Edge'), h('div.seg.bl-edges', {}, ...BLEND_EDGES.map((e) => {
          const b = h(e === edge ? 'button.active' : 'button', { disabled: ro, title: EDGE_SPECS[e] ?? 'No softness map', onclick: (ev: Event) => { ev.stopPropagation(); edit(() => (l.edge = e)); renderLayers(); } }, e[0].toUpperCase() + e.slice(1));
          b.dataset.edge = e;
          return b;
        }))),
        h('div.bl-edge-hint', {}, EDGE_HINT[edge]));
    }
    return card;
  }
  let detailTypes: string[] = [];
  function renderLayers(): void {
    if (!sel) return layersEl.replaceChildren();
    const d = sel.draft, ro = !sel.mine;
    const sprites = h('select', { disabled: ro, 'aria-label': 'Sprites' },
      h('option', { value: '' }, 'None'), ...detailTypes.map((t) => h('option', { value: t }, t))) as HTMLSelectElement;
    if (d.detailtype && !detailTypes.includes(d.detailtype)) sprites.append(h('option', { value: d.detailtype }, d.detailtype));
    sprites.value = d.detailtype ?? '';
    sprites.addEventListener('change', () => edit((x) => { if (sprites.value) x.detailtype = sprites.value; else delete x.detailtype; }, false));
    layersEl.replaceChildren(...present(
      ro ? h('div.bl-ro', {}, h('span', {}, 'A Lambda Wars blend: look, paint with it, or duplicate it to change it.'), h('button.primary', { onclick: duplicate }, 'Duplicate')) : null,
      h('div.bl-sh', {}, h('h3', {}, 'Layers'), h('span', {}, `${d.layers.length} of 4 · base shows where nothing is painted`)),
      ...d.layers.map((l, i) => layerCard(l, i, ro)),
      !ro && d.layers.length < 4 ? h('button', { onclick: () => {
        edit((x) => x.layers.push({ texture: 'nature/gravelfloor006a', scale: 1, rotation: 0, edge: 'medium' }));
        layer = sel!.draft.layers.length - 1;
        renderLayers();
        refreshPreview();
      } }, '+ Add layer') : null,
      h('div.bl-sh', {}, h('h3', {}, 'Extras')),
      h('div.bl-row', {}, h('label', {}, 'Sprites'), sprites),
      h('p.bl-note', {}, `%detailtype: one of the ${detailTypes.length || 'game’s'} sprite types in the game’s detail.vbsp. vbsp places them when the map compiles.`)));
  }

  /** Texture browser for a layer: search, thumbnails, Recent, Favourites and Used in this map (no alpha textures). */
  async function openTextureBrowser(i: number): Promise<void> {
    const list = (await (await fetch('/api/groundtextures')).json()) as string[];
    const used = await texturesInMap(editor);
    const items = list.map((t) => ({ id: t }));
    const folder = (f: string): PickerSource<{ id: string }> => ({ id: `f:${f}`, label: f, icon: h('span.src-icon', {}, '▸'), test: (t) => t.id.startsWith(f + '/') && !t.id.slice(f.length + 1).includes('/') });
    openPicker<{ id: string }>({
      title: `Texture for ${KIND[i]}`,
      subtitle: 'Ground textures without alpha (cut-outs like leaves or skybox treelines would punch holes in a layer)',
      className: 'blend-tex-picker',
      items,
      sections: [
        { sources: [
          { id: 'all', label: 'All ground textures', test: () => true },
          { id: 'recent', label: 'Recent', icon: h('span.src-icon', {}, '⟲'), test: (t) => recentTextures.has(t.id) },
          { id: 'fav', label: 'Favourites', icon: h('span.src-icon', {}, '★'), test: (t) => favouriteTextures.has(t.id) },
          { id: 'used', label: 'Used in this map', icon: h('span.src-icon', { style: { color: 'var(--ok)' } }, '●'), test: (t) => used.has(t.id) },
        ] },
        { heading: 'Folders', sources: ['nature', 'lostcoast/nature', 'concrete'].map(folder) },
      ],
      source: recentTextures.items.length ? 'recent' : 'all',
      current: sel?.draft.layers[i]?.texture.toLowerCase(),
      searchPlaceholder: 'Search ground textures: grass, mud, gravel…',
      searchText: (t) => t.id,
      status: (shown, _hidden, src) => `${src.label} · ${shown} shown`,
      tile: (t, el, whenVisible) => {
        const th = h('div.th');
        el.append(th, h('div.nm', {}, short(t.id)));
        if (favouriteTextures.has(t.id)) el.append(h('span.badge', {}, '★'));
        whenVisible(() => th.append(textureImg(t.id)));
      },
      detail: (t, use, close, refresh) => h('div.pd', {},
        h('div.bl-tex-big', {}, textureImg(t.id, 256)),
        h('div', {}, h('div.pd-name', {}, short(t.id)), h('div.pd-path', {}, `materials/${t.id}.vtf`)),
        h('div.row', {}, h('button', { onclick: () => { favouriteTextures.toggle(t.id); refresh(); } }, favouriteTextures.has(t.id) ? '★ Favourite' : '☆ Favourite')),
        h('div', { style: { flex: '1' } }),
        h('div.pd-foot', {}, h('span', { style: { flex: '1' } }), h('button', { onclick: close }, 'Cancel'), h('button.primary', { onclick: use }, `Use for ${KIND[i]}`))),
      onUse: (t) => {
        recentTextures.push(t.id);
        edit((d) => (d.layers[i].texture = t.id));
        renderLayers();
      },
      keys: { f: (t, refresh) => { if (t) { favouriteTextures.toggle(t.id); refresh(); } } },
      footer: [h('span', {}, kbd('←', '→', '↑', '↓'), ' browse'), h('span', {}, kbd('Enter'), ' use'), h('span', {}, kbd('F'), ' favourite'), h('span', {}, kbd('Ctrl'), '+', kbd('F'), ' search')],
    });
  }

  // ---- footer: name, save, paint ----
  function duplicate(): void {
    if (!sel) return;
    const draft = clone(sel.draft);
    draft.name = freeName(`${sel.draft.name}_copy`);
    for (const l of draft.layers.slice(1)) l.edge ??= 'soft';
    const e: Entry = { material: materialForBlend(draft.name), mine: true, saved: null, draft };
    library.push(e);
    select(e, layer);
    msg = `Duplicated as ${draft.name}: change it, then Save`;
    renderFooter();
  }

  /** Writes the blend; with `asNew` under a new name, keeping the original. Returns the saved entry. */
  async function save(asNew: boolean): Promise<Entry | null> {
    const e = sel;
    if (!e?.mine) return null;
    const name = safeBlendName(e.draft.name);
    const oldName = e.saved ? short(e.material).toLowerCase() : null;
    if (asNew) {
      const draft = { ...clone(e.draft), name: name === oldName ? freeName(name) : name };
      const r = await apiPost('/api/blend?new=1', JSON.stringify(draft));
      const res = await r.json();
      if (!r.ok) return fail(res.error);
      if (e.saved) e.draft = clone(e.saved);
      const copy: Entry = { material: res.material, mine: true, saved: clone(draft), draft: clone(draft) };
      if (!e.saved) library.splice(library.indexOf(e), 1);
      library.push(copy);
      await multiblendSets(true);
      select(copy, layer);
      msg = `Saved as a new blend: materials/${BLEND_FOLDER}/${draft.name}.vmt`;
      renderFooter();
      return copy;
    }
    const patches = users(e);
    if (oldName && oldName !== name) {
      // Rename: the file, then the patches that use it, as one undo step (undo renames the file back).
      const r = await apiPost('/api/blend/rename', JSON.stringify({ from: oldName, to: name }));
      const res = await r.json();
      if (!r.ok) return fail(res.error);
      const from = e.material, to = res.material as string;
      editor.history.group(`Rename blend ${oldName} → ${name}`, () => {
        const end = editor.history.begin('Re-point patches', patches);
        repointPatches(patches, to);
        end();
        editor.history.effect('Rename blend file',
          () => void apiPost('/api/blend/rename', JSON.stringify({ from: name, to: oldName })).then(() => blendFilesChanged(editor, from)),
          () => void apiPost('/api/blend/rename', JSON.stringify({ from: oldName, to: name })).then(() => blendFilesChanged(editor, to)));
      });
      e.material = to;
    }
    const r = await apiPost(e.saved ? '/api/blend' : '/api/blend?new=1', JSON.stringify({ ...e.draft, name }));
    const res = await r.json();
    if (!r.ok) return fail(res.error);
    e.material = res.material;
    e.draft.name = name;
    e.saved = clone(e.draft);
    // Patches share the material object: reloading it updates them in the viewport at once.
    await editor.materials.reload(e.material);
    await multiblendSets(true);
    editor.changed();
    msg = `Saved materials/${BLEND_FOLDER}/${name}.vmt${patches.length ? ` · ${usersText(patches.length)} updated` : ''}`;
    renderAll();
    return e;
  }
  const fail = (error: string | undefined): null => {
    msg = `⚠ ${error ?? 'Could not save the blend'}`;
    renderFooter();
    return null;
  };

  /** Deletes the selected blend; patches that use it switch to `replacement` (one undo step, which restores the file). */
  async function remove(replacement: string | null): Promise<void> {
    const e = sel;
    if (!e?.mine) return;
    if (!e.saved) {
      library.splice(library.indexOf(e), 1);
    } else {
      const name = short(e.material).toLowerCase(), saved = clone(e.saved);
      const patches = users(e);
      if (patches.length && !replacement) return;
      const r = await apiPost('/api/blend/delete', JSON.stringify({ name }));
      if (!r.ok) return void fail((await r.json()).error);
      editor.history.group(`Delete blend ${name}`, () => {
        if (patches.length) {
          const end = editor.history.begin('Replace blend', patches);
          repointPatches(patches, replacement!);
          end();
        }
        editor.history.effect('Delete blend file',
          () => void apiPost('/api/blend', JSON.stringify(saved)).then(() => blendFilesChanged(editor, e.material)),
          () => void apiPost('/api/blend/delete', JSON.stringify({ name })).then(() => blendFilesChanged(editor, e.material)));
      });
      library.splice(library.indexOf(e), 1);
      await multiblendSets(true);
      editor.changed();
      msg = `Deleted ${name}.vmt${patches.length ? ` · ${usersText(patches.length)} now use ${short(replacement!).toLowerCase()}` : ''}`;
    }
    const next = library.find((x) => x.material === replacement?.toUpperCase()) ?? library.find((x) => x.mine) ?? library[0];
    const keep = msg;
    if (next) select(next);
    msg = keep;
    renderFooter();
  }

  async function paintWithIt(): Promise<void> {
    if (!sel) return;
    let e: Entry | null = sel;
    if (e.mine && dirty(e)) e = await save(false);
    if (!e) return;
    close();
    tool.set = e.material;
    tool.mode = 'paint';
    await editor.materials.ready(e.material);
    tool.layer = Math.max(1, Math.min(layer, e.draft.layers.length - 1));
    setToolButtons(editor, 'ground');
  }

  function renderFooter(): void {
    if (!sel) return footer.replaceChildren();
    const e = sel, ro = !e.mine, n = users(e).length;
    const name = h('input.bl-name', { type: 'text', value: e.draft.name, disabled: ro, 'aria-label': 'Blend name', spellcheck: false }) as HTMLInputElement;
    name.addEventListener('change', () => edit((d) => (d.name = safeBlendName(name.value)), false));
    const delBox = deleting ? deletePanel(e, n) : null;
    footer.replaceChildren(...present(
      h('span.bl-muted', {}, 'Name'), name,
      h('span.bl-path', {}, `→ materials/${BLEND_FOLDER}/${e.draft.name}.vmt`),
      h(n ? 'span.bl-used.on' : 'span.bl-used', {}, n ? `Used on ${usersText(n)} in this map${e.mine ? '; Save updates them' : ''}` : 'Not used in this map yet'),
      h('span', { style: { flex: '1' } }),
      h('span.bl-msg', {}, msg),
      e.mine ? h('button.bl-del', { onclick: () => { deleting = !deleting; renderFooter(); } }, 'Delete…') : null,
      h('button', { disabled: ro, onclick: () => void save(true) }, 'Save as new'),
      h('button', { disabled: ro || !dirty(e), onclick: () => void save(false) }, 'Save'),
      h('button.primary', { onclick: () => void paintWithIt() }, 'Paint with it'),
      delBox));
  }

  function deletePanel(e: Entry, n: number): HTMLElement {
    const others = library.filter((x) => x !== e && x.saved);
    const pick = h('select', { 'aria-label': 'Replacement blend' }, ...others.map((x) => h('option', { value: x.material }, `${x.mine ? '★ ' : ''}${x.draft.name}`))) as HTMLSelectElement;
    return h('div.bl-delete', {},
      h('b', {}, `Delete ${e.draft.name}?`),
      n ? h('p', {}, `${usersText(n)} in this map use it. Which blend replaces it there?`) : h('p', {}, e.saved ? `Removes materials/${BLEND_FOLDER}/${short(e.material).toLowerCase()}.vmt. Undo brings it back.` : 'It was never saved.'),
      n ? pick : null,
      h('div.row', {}, h('span', { style: { flex: '1' } }),
        h('button', { onclick: () => { deleting = false; renderFooter(); } }, 'Cancel'),
        h('button.primary', { onclick: () => { deleting = false; void remove(n ? pick.value : null); } }, n ? 'Delete and replace' : 'Delete')));
  }

  function renderAll(): void {
    renderLibrary();
    renderLayers();
    renderFooter();
    refreshPreview();
  }

  const onKey = (ev: KeyboardEvent) => {
    // The texture browser on top handles its own keys.
    if (document.querySelector('.picker-backdrop')) return;
    if (ev.key === 'Escape') close();
    else if (!isTyping(ev) && (ev.key === '[' || ev.key === ']')) {
      radius = Math.max(32, Math.min(512, radius + (ev.key === ']' ? 32 : -32)));
      refreshPreview();
    } else if (isTyping(ev)) {
      // Typing in the name field: keep it from the editor's shortcuts, but let the key reach the field.
      ev.stopImmediatePropagation();
      return;
    }
    // Everything else stays inside the dialog (the editor's shortcuts would act on the map behind it).
    ev.stopImmediatePropagation();
  };
  window.addEventListener('keydown', onKey, true);
  function close(): void {
    window.removeEventListener('keydown', onKey, true);
    preview.dispose();
    backdrop.remove();
  }
  backdrop.addEventListener('pointerdown', (ev) => { if (ev.target === backdrop) close(); });

  dialog.append(
    h('header.bl-head', {}, h('b', {}, 'Material blender'), h('span.bl-muted', {}, 'Mix up to four ground textures into a blend you can paint with.'),
      h('span', { style: { flex: '1' } }), opts.from ? h('span.bl-from', {}, `Opened from ${opts.from}`) : null,
      h('button.bl-close', { 'aria-label': 'Close', onclick: close }, '✕')),
    h('div.bl-body', {},
      libEl,
      h('main.bl-main', {},
        h('div.bl-bar', {}, modesEl, modeHint, h('span', { style: { flex: '1' } }), lightBtn),
        h('div.bl-view', {}, canvas, tag),
        h('div.bl-keys', {}, h('span', {}, h('b', {}, 'Paint mode:'), ' drag on the preview with the selected layer · right-drag erases'), h('span', {}, kbd('['), ' ', kbd(']'), ' brush size'))),
      layersEl),
    footer);
  document.body.append(backdrop);

  if (opts.newBlend || !sel) {
    if (opts.newBlend || !library.length) newBlend();
    else select(library.find((e) => e.mine) ?? library[0]);
  } else select(sel, layer);
  void fetch('/api/detailtypes').then((r) => (r.ok ? r.json() : [])).then((t: string[]) => { detailTypes = t; renderLayers(); });
}

/** After a blend file changed outside the dialog (undo of a rename or delete): reread it and the blend list. */
async function blendFilesChanged(editor: Editor, material: string): Promise<void> {
  await editor.materials.reload(material);
  await multiblendSets(true);
  editor.changed();
}

/** Textures the map's materials show: base textures, and every layer of its MultiBlend materials. */
async function texturesInMap(editor: Editor): Promise<Set<string>> {
  const names = new Set<string>();
  for (const s of editor.doc.allSolids()) for (const side of s.sides) names.add(side.material);
  const out = new Set<string>();
  await Promise.all([...names].map(async (m) => {
    const vmt = await loadVmt(m);
    for (const [k, v] of vmt?.params ?? []) if (/^\$basetexture\d?$/.test(k)) out.add(v.toLowerCase().replace(/\\/g, '/'));
  }));
  return out;
}
