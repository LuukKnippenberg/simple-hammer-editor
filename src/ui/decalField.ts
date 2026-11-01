import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { MAX_OVERLAYS, flipOverlay, overlayFlipped, overlayRotation, overlaySize, setOverlayRotation, setOverlaySize } from '../edit/overlays.ts';
import { convertDecals } from '../edit/decals.ts';
import { edit, type SpecialGroup } from './entityEditor.ts';
import { decalTexture, decalThumb, openDecalPicker, overlayBudget, overlayCount } from './decalPicker.ts';
import { recentDecals } from './recent.ts';
import { h, toast } from './dom.ts';
import './pickers.css';

const isDecal = (e: MapEntity) => e.classname === 'infodecal' || e.classname === 'info_overlay';
const textureKey = (e: MapEntity) => (e.classname === 'info_overlay' ? 'material' : 'texture');
/** Overlays keep the texture's aspect when one side of their size changes. */
let keepAspect = true;

/** `decals/` + bold `decal_posters001a`. */
function texLabel(name: string): HTMLElement {
  const i = name.lastIndexOf('/');
  return h('div.mf-path', { title: name }, name.slice(0, i + 1), h('b', {}, name.slice(i + 1)));
}

function setTexture(editor: Editor, ents: MapEntity[], name: string): void {
  recentDecals.push(name);
  edit(editor, 'Set decal texture', ents, (e) => e.set(textureKey(e), name));
}

/** Recent ▾ for decals. */
function recentMenu(current: string, set: (name: string) => void): HTMLElement {
  const wrap = h('span', { style: { position: 'relative' } });
  const btn = h('button', { 'aria-label': 'Recent decals', 'aria-haspopup': 'menu' }, 'Recent ▾');
  btn.addEventListener('click', () => {
    const open = wrap.querySelector('.menu');
    if (open) return open.remove();
    const items = recentDecals.items.filter((m) => m !== current);
    const menu = h('div.menu', { role: 'menu' }, ...items.length ? items.map((m) =>
      h('div.menu-item', { role: 'menuitem', title: m, onclick: () => { menu.remove(); set(m); } }, decalThumb(m, 'div.menu-th', 32), m.split('/').pop()!))
      : [h('div.hint', { style: { padding: '4px 6px' } }, 'Decals you pick show up here.')]);
    wrap.append(menu);
    const off = (e: PointerEvent) => { if (!wrap.contains(e.target as Node)) { menu.remove(); window.removeEventListener('pointerdown', off, true); } };
    window.addEventListener('pointerdown', off, true);
  });
  wrap.append(btn);
  return wrap;
}

const num = (value: string, label: string, onSet: (v: number) => void, placeholder = '') => {
  const i = h(placeholder ? 'input.mixed' : 'input', { value, placeholder, 'aria-label': label }) as HTMLInputElement;
  i.addEventListener('change', () => { const v = parseFloat(i.value); if (!isNaN(v)) onSet(v); i.blur(); });
  return i;
};

/** Size, turn and flip of one or more overlays; each keeps its own value where the field is left alone. */
function overlayRows(editor: Editor, overlays: MapEntity[]): HTMLElement[] {
  const sizes = overlays.map(overlaySize);
  const same = <T>(list: T[]) => list.every((x) => JSON.stringify(x) === JSON.stringify(list[0]));
  const rots = overlays.map(overlayRotation);
  const one = overlays.length === 1;
  const resize = (w: number | null, hh: number | null) => edit(editor, 'Resize overlay', overlays, (e) => {
    const s = overlaySize(e);
    const aspect = s.w ? s.h / s.w : 1;
    const nw = w ?? (hh !== null && keepAspect ? hh / aspect : s.w);
    const nh = hh ?? (w !== null && keepAspect ? w * aspect : s.h);
    setOverlaySize(e, Math.max(1, nw), Math.max(1, nh));
  });
  const turn = (deg: (e: MapEntity) => number) => edit(editor, 'Turn overlay', overlays, (e) => setOverlayRotation(e, deg(e)));
  const flipped = (axis: 'U' | 'V') => overlays.every((e) => overlayFlipped(e, axis));
  const flip = (axis: 'U' | 'V') => {
    const on = flipped(axis);
    edit(editor, `Flip overlay ${axis}`, overlays, (e) => { if (overlayFlipped(e, axis) === on) flipOverlay(e, axis); });
  };
  const sizeRow = same(sizes)
    ? h('div.row', {}, h('label', {}, 'Size'), num(String(sizes[0].w), 'Width', (v) => resize(v, null)), h('span.muted', {}, '×'), num(String(sizes[0].h), 'Height', (v) => resize(null, v)),
      h(keepAspect ? 'button.icon.active' : 'button.icon', { title: 'Keep the aspect when one side changes', 'aria-label': 'Keep aspect', 'aria-pressed': String(keepAspect), onclick: (ev: MouseEvent) => { keepAspect = !keepAspect; (ev.currentTarget as HTMLElement).classList.toggle('active', keepAspect); } }, '🔗'))
    : h('div.row', {}, h('label', {}, 'Size'), num('', 'Width', (v) => resize(v, null), `mixed · ${new Set(sizes.map((s) => `${s.w}×${s.h}`)).size} sizes`), h('span.ne', {}, '≠'));
  return [
    sizeRow,
    h('div.row', {}, h('label', {}, 'Rotate'), num(same(rots) ? String(rots[0]) : '', 'Rotate', (v) => turn(() => v), same(rots) ? '' : 'mixed'), h('span.unit', {}, '°'),
      h('button.icon', { title: 'Turn 90 degrees', 'aria-label': 'Turn 90 degrees', onclick: () => turn((e) => overlayRotation(e) + 90) }, '⟳ 90°')),
    h('div.row', {}, h('label', {}, 'Flip'), h('div.seg', {},
      h(flipped('U') ? 'button.active' : 'button', { onclick: () => flip('U') }, '↔ U'),
      h(flipped('V') ? 'button.active' : 'button', { onclick: () => flip('V') }, '↕ V'))),
    one ? h('div.row', {}, h('label', {}, 'Fit'), h('button', { onclick: () => {
      const info = editor.decals.info(decalTexture(overlays[0]));
      void info.ready.then(() => { const w = overlaySize(overlays[0]).w; resize(w, w * (info.height / info.width || 1)); });
    } }, 'Fit to texture aspect')) : null,
  ].filter((x): x is HTMLDivElement => !!x);
}

/** The Texture group (and, for several, overlay and convert groups) of decals in the entity editor. */
export function decalGroups(editor: Editor, ents: MapEntity[]): SpecialGroup[] {
  if (!ents.length || !ents.every(isDecal)) return [];
  const overlays = ents.filter((e) => e.classname === 'info_overlay');
  const decals = ents.filter((e) => e.classname === 'infodecal');
  const textures = new Map<string, MapEntity[]>();
  for (const e of ents) textures.set(decalTexture(e), [...textures.get(decalTexture(e)) ?? [], e]);
  const pick = (targets: MapEntity[], current: string) => void openDecalPicker(editor, {
    current, subtitle: `for ${targets.length > 1 ? `${targets.length} decals` : targets[0].classname}`,
    useLabel: targets.length > 1 ? `Use for ${targets.length}` : 'Use decal', onPick: (name) => setTexture(editor, targets, name),
  });
  const out: SpecialGroup[] = [];
  const body = (): HTMLElement => {
    if (textures.size === 1) {
      const name = [...textures.keys()][0];
      const sub = h('div.mf-sub', {}, ' ');
      return h('div', {},
        h('div.mf', {}, decalThumb(name, 'div.mf-thumb', 128, (w, hh) => (sub.textContent = `${w} × ${hh} px`)),
          h('div', { style: { flex: '1', minWidth: '0' } }, texLabel(name), sub,
            h('div.mf-buttons', {}, h('button.primary', { onclick: () => pick(ents, name) }, ents.length > 1 ? `Set for all ${ents.length}…` : 'Change…'),
              recentMenu(name, (m) => setTexture(editor, ents, m))))),
        ...ents.length === 1 && overlays.length ? overlayRows(editor, overlays) : []);
    }
    const top = [...textures].sort((a, b) => b[1].length - a[1].length);
    const swapWrap = h('span', { style: { position: 'relative' } });
    const swap = h('button', { 'aria-haspopup': 'menu', onclick: () => {
      const open = swapWrap.querySelector('.menu');
      if (open) return open.remove();
      const menu = h('div.menu', { role: 'menu' }, h('div.hint', { style: { padding: '2px 6px' } }, 'Replace only the decals using…'),
        ...top.map(([t, list]) => h('div.menu-item', { role: 'menuitem', onclick: () => { menu.remove(); pick(list, t); } }, decalThumb(t, 'div.menu-th', 32), `${t.split('/').pop()} ×${list.length}`)));
      swapWrap.append(menu);
    } }, 'Swap one texture…');
    swapWrap.append(swap);
    return h('div', {},
      h('div.mf-multi', {},
        h('div.mf-stack', {}, ...top.slice(0, 3).map(([t]) => decalThumb(t, 'div.mf-thumb', 64))),
        h('span', {}, h('span.mixed', {}, `${textures.size} textures `), h('span.ne', {}, '≠'),
          h('span.mf-sub', {}, top.map(([t, l]) => `${t.split('/').pop()} ×${l.length}`).join(' · ')))),
      h('div.row', {}, h('button.primary', { onclick: () => pick(ents, top[0][0]) }, `Set for all ${ents.length}…`), swapWrap));
  };
  out.push({ label: 'Texture', keys: ['texture', 'material'], summary: ents.length > 1 ? `shared by all ${ents.length}` : '', body });
  if (ents.length > 1 && overlays.length) {
    out.push({ label: `Overlays ×${overlays.length}`, keys: [], summary: '', open: true, link: decals.length ? { text: `Select those ${overlays.length}`, onclick: () => editor.selection.set([], overlays) } : undefined,
      body: () => h('div', {}, ...overlayRows(editor, overlays)) });
  }
  out.push({
    label: 'Convert', keys: [], summary: '', open: true, body: () => {
      const used = overlayCount(editor);
      return h('div', {},
        h('div.row', {},
          decals.length ? h('button', { onclick: () => void convertDecals(editor, decals, 'overlay').then((n) => toast(editor.container, n ? `${n} decal${n > 1 ? 's' : ''} now overlays` : 'No surface found under these decals')) }, `${decals.length} decal${decals.length > 1 ? 's' : ''} → overlay${decals.length > 1 ? 's' : ''}`) : null,
          overlays.length ? h('button', { onclick: () => void convertDecals(editor, overlays, 'decal') }, `${overlays.length} overlay${overlays.length > 1 ? 's' : ''} → decal${overlays.length > 1 ? 's' : ''}`) : null),
        h('p.hint', {}, `Overlays can be sized and rotated${decals.length ? `; ${decals.length} more would use ${used + decals.length} of ${MAX_OVERLAYS}` : ''}. Decals take the texture’s own size.`));
    },
  });
  return out;
}

/** Decal tool options: the texture (picker and recent strip), decal or overlay, and an overlay's size, turn and flip. */
export function decalToolOptions(editor: Editor, render: () => void): HTMLElement[] {
  const d = editor.decal;
  const set = (patch: Partial<typeof d>) => { Object.assign(d, patch); editor.emit('decal'); };
  const pick = () => void openDecalPicker(editor, {
    current: d.material, subtitle: 'for the Decal tool', mode: d.mode, useLabel: 'Use decal',
    onPick: (m, mode) => set({ material: m, mode }),
  });
  const sub = h('div.mf-sub', {}, ' ');
  // The current decal first, then the recent ones; +N opens the picker.
  const strip = [d.material, ...recentDecals.items.filter((m) => m !== d.material)].slice(0, 5);
  const more = new Set([d.material, ...recentDecals.items]).size - strip.length;
  const rows: HTMLElement[] = [
    h('div.df', {}, decalThumb(d.material, 'div.mf-thumb.small', 64, (w, hh) => (sub.textContent = `${w} × ${hh} px`)),
      h('div', { style: { flex: '1', minWidth: '0' } }, h('div.df-name', { title: d.material }, d.material.split('/').pop()!), sub),
      h('button.primary', { onclick: pick }, 'Change…')),
    h('div.strip', {}, ...strip.map((m) => {
      const t = decalThumb(m, `div.strip-th${m === d.material ? '.on' : ''}`, 32);
      t.title = m;
      t.addEventListener('click', () => { recentDecals.push(m); set({ material: m }); });
      return t;
    }), more > 0 ? h('button.strip-th.more', { title: 'All decals', onclick: pick }, `+${more}`) : null),
    h('div.row', {}, h('label', {}, 'Type'), h('div.seg', {}, ...(['decal', 'overlay'] as const).map((m) =>
      h(d.mode === m ? 'button.active' : 'button', { onclick: () => { set({ mode: m }); render(); } }, m === 'decal' ? 'Decal' : 'Overlay')))),
  ];
  if (d.mode === 'overlay') {
    const size = num(String(d.size), 'Size', (v) => set({ size: Math.max(8, v) }));
    const rot = num(String(d.rotation), 'Rotate', (v) => set({ rotation: v }));
    rows.push(
      h('div.row', {}, h('label', {}, 'Size'), size, h('span.unit', {}, 'u wide')),
      h('div.row', {}, h('label', {}, 'Rotate'), rot, h('span.unit', {}, '°')),
      h('div.row', {}, h('label', {}, 'Flip'), h('div.seg', {},
        h(d.flipU ? 'button.active' : 'button', { onclick: () => { set({ flipU: !d.flipU }); render(); } }, '↔ U'),
        h(d.flipV ? 'button.active' : 'button', { onclick: () => { set({ flipV: !d.flipV }); render(); } }, '↕ V'))),
      overlayBudget(editor));
  }
  return rows;
}
