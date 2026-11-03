import type { Editor } from '../editor.ts';
import { makeTerrain, type GroundTool } from '../edit/groundTool.ts';
import { GROUND_SETS, type GroundMode } from '../edit/terrain.ts';
import { BLEND_FOLDER } from '../edit/multiblend.ts';
import { loadVmt } from '../assets/vmt.ts';
import { textureThumbnail } from '../assets/thumbnails.ts';
import { openBlender } from './blender.ts';
import { h, toast } from './dom.ts';
import './groundPanel.css';

const HINTS: Record<GroundMode, string> = {
  paint: 'Drag on terrain to paint the selected layer.',
  erase: 'Drag to bring back the base.',
  raise: 'Drag to raise the ground.',
  lower: 'Drag to lower the ground.',
  smooth: 'Drag to even out bumps.',
  flatten: 'Drag to level the ground to where you started.',
};
const TEXTURE_MODES: [GroundMode, string][] = [['paint', 'Paint'], ['erase', 'Erase']];
const SHAPE_MODES: [GroundMode, string][] = [['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten']];

const short = (path: string) => path.split('/').pop() ?? path;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 'es'}`;

/** Selected displacement patches: what the brush and the noise fill are limited to. */
const selectedPatches = (editor: Editor) => [...editor.selection.solids].filter((s) => s.isDisplacement);

/** The Ground tool's hint line: what a drag does in this mode, and that a selection limits it. */
export function groundHint(editor: Editor): string {
  const tool = editor.tools.tools.ground as GroundTool;
  const n = selectedPatches(editor).length;
  return HINTS[tool.mode] + (n ? ` Only the ${n === 1 ? 'selected patch changes' : `${n} selected patches change`}.` : '');
}

/** A two-texture set's textures: the first (Erase brings it back) and the second (Paint shows it). */
const twoTextures = new Map<string, Promise<string[]>>();
function setTextures(material: string): Promise<string[]> {
  let p = twoTextures.get(material);
  if (!p) {
    p = loadVmt(material).then((v) => ['$basetexture', '$basetexture2'].map((k) => v?.params.get(k)?.toLowerCase() ?? ''));
    twoTextures.set(material, p);
  }
  return p;
}

/** An image filled in once the texture's thumbnail is ready. */
function thumb(texture: string | Promise<string>, size = 128): HTMLImageElement {
  const img = h('img', { alt: '' }) as HTMLImageElement;
  void Promise.resolve(texture).then((t) => (t ? textureThumbnail(t, size) : null)).then((u) => (u ? (img.src = u) : img.classList.add('missing')));
  return img;
}

/**
 * The Ground tool's options: Texture and Shape modes, the blend card (Change… opens the material blender), the
 * layers as texture tiles, the brush, and the noise fill for selected patches (or Turn into terrain for floors).
 */
export function groundRows(editor: Editor, tool: GroundTool, render: () => void): HTMLElement[] {
  const info = editor.materials.get(tool.set);
  // The layers depend on the material's VMT: draw again once it is read.
  if (!info.loaded) void editor.materials.ready(tool.set).then(render);
  const def = info.multiblend;
  const set = GROUND_SETS.find((g) => g.material === tool.set.toUpperCase());
  const textures: (string | Promise<string>)[] = def ? def.layers.map((l) => l.texture) : [0, 1].map((i) => setTextures(tool.set).then((t) => t[i]));
  const kinds = def ? def.layers.map((_, i) => (i ? `Layer ${i}` : 'Base')) : ['First', 'Second'];
  const painting = tool.mode === 'paint' || tool.mode === 'erase';
  if (def) tool.layer = Math.max(1, Math.min(tool.layer, def.layers.length - 1));

  const modeGroup = (label: string, modes: [GroundMode, string][]) => h('div.gp-grp', {}, h('span.gp-l', {}, label), h('div.seg', {}, ...modes.map(([m, l]) => {
    const b = h(tool.mode === m ? 'button.active' : 'button', { onclick: () => { tool.mode = m; render(); } }, l);
    b.dataset.mode = m;
    return b;
  })));

  const name = set?.label ?? short(tool.set).toLowerCase();
  const sub = set ? 'Two-texture set · 2 textures'
    : def ? `${tool.set.toLowerCase().startsWith(BLEND_FOLDER + '/') ? 'My blend' : 'Lambda Wars blend'} · ${def.layers.length} layers` : 'loading…';
  const card = h('div.gp-card', {},
    h('span.gp-swatch', {}, ...textures.map((t) => thumb(t, 64))),
    h('span.gp-name', {}, h('b', {}, name), h('span', {}, sub)),
    h('button.gp-change', { title: 'Open the material blender on this blend: pick another one or edit it', onclick: () => void openBlender(editor, { material: tool.set, layer: tool.layer, from: 'Ground › Change' }) }, 'Change…'));

  const rows: HTMLElement[] = [
    h('div.gp-modes', {}, modeGroup('Texture', TEXTURE_MODES), modeGroup('Shape', SHAPE_MODES)),
    h('div.gp-sh', {}, h('h3', {}, 'Blend'), h('span', {}, 'the material on this terrain')),
    card,
  ];

  if (painting) {
    const tiles = textures.map((t, i) => {
      // Layers 1–3 (or the second texture) paint; the base (or the first) is what Erase brings back.
      const on = i === 0 ? tool.mode === 'erase' : tool.mode === 'paint' && (def ? tool.layer === i : true);
      const tile = h(`button.gp-tile${on ? '.on' : ''}${tool.mode === 'erase' && i > 0 ? '.dim' : ''}` as 'button', {
        title: typeof t === 'string' ? t : undefined,
        onclick: () => {
          if (i === 0) tool.mode = 'erase';
          else { tool.mode = 'paint'; tool.layer = i; }
          render();
        },
      }, thumb(t), h('span.gp-k', {}, kinds[i]), h('span.gp-tex', {}, typeof t === 'string' ? short(t) : ''));
      if (typeof t !== 'string') void t.then((x) => { tile.title = x; tile.querySelector('.gp-tex')!.textContent = short(x); });
      tile.dataset.layer = String(i);
      return tile;
    });
    rows.push(def
      ? h('div.gp-sh', {}, h('h3', {}, 'Layer'), h('span', {}, tool.mode === 'erase' ? 'Erase paints the base back' : 'click a tile to paint with it'))
      : h('div.gp-sh', {}, h('h3', {}, 'Textures')));
    if (!def) rows.push(h('div.hint', {}, 'Paint shows the second, Erase brings back the first.'));
    rows.push(h('div.gp-tiles', {}, ...tiles));
  }

  const slider = (label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, set: (v: number) => void) => {
    const out = h('span.gp-val', {}, fmt(value));
    const range = h('input', { type: 'range', min, max, step, value, 'aria-label': label }) as HTMLInputElement;
    range.addEventListener('input', () => { set(Number(range.value)); out.textContent = fmt(Number(range.value)); });
    return h('div.row', {}, h('label', {}, label), range, out);
  };
  rows.push(h('div.gp-sh', {}, h('h3', {}, 'Brush')),
    slider('Radius', 32, 512, 16, tool.radius, String, (v) => (tool.radius = v)),
    slider('Strength', 0.05, 1, 0.05, tool.strength, (v) => v.toFixed(2), (v) => (tool.strength = v)));

  const patches = selectedPatches(editor);
  const floors = [...editor.selection.solids].filter((s) => !s.entity && !s.isDisplacement);
  if (floors.length) {
    rows.push(h('button.gp-wide', {
      title: 'Replace the selected floor brushes with displacement terrain in this blend',
      onclick: () => { const n = makeTerrain(editor, floors, tool.set); render(); toast(editor.container, `Made ${n} terrain patches`); },
    }, `Turn ${floors.length} selected floor${floors.length > 1 ? 's' : ''} into terrain`));
  } else if (patches.length && def) {
    rows.push(...noiseRows(editor, tool, patches.length, def.layers.map((l) => l.texture)));
  } else {
    rows.push(h('div.gp-note', {}, def ? 'Select terrain patches to noise-fill them. A selected floor brush shows ' : 'A selected floor brush shows ',
      h('b', {}, 'Turn into terrain'), ' here instead.'));
  }
  return rows;
}

/** Noise fill for the selected patches: per layer its swatch, coverage and patch size; one undo step. */
function noiseRows(editor: Editor, tool: GroundTool, n: number, textures: string[]): HTMLElement[] {
  const rows = textures.slice(1).map((t, k) => {
    const noise = tool.noise[k];
    const cov = h('input', { type: 'range', min: 0, max: 0.8, step: 0.05, value: noise.coverage, title: `Share of the ground covered by ${short(t)}`, 'aria-label': `Coverage of layer ${k + 1}` }) as HTMLInputElement;
    cov.addEventListener('input', () => (noise.coverage = Number(cov.value)));
    const size = h('input', { type: 'number', value: String(noise.scale), min: '64', step: '64', title: 'Patch size in units', 'aria-label': `Patch size of layer ${k + 1}` }) as HTMLInputElement;
    size.addEventListener('change', () => { noise.scale = Math.max(64, Number(size.value) || 512); size.blur(); });
    return h('div.gp-noise', { title: t }, h('span.gp-nsw', {}, thumb(t, 64)), cov, size);
  });
  return [
    h('div.gp-sh', {}, h('h3', {}, 'Noise fill'), h('span', {}, plural(n, 'selected patch'))),
    h('div.hint', {}, 'Coverage and patch size per layer; the base fills the rest.'),
    ...rows,
    h('button.primary.gp-wide', {
      title: 'Fill the layer weights of the selected patches from noise, so large areas stop repeating (one undo step)',
      onclick: () => {
        const count = tool.noiseFill(tool.noise.slice(0, textures.length - 1));
        toast(editor.container, count ? `Noise-filled ${plural(count, 'patch')} · one undo step` : 'Select terrain patches first');
      },
    }, `Noise-fill ${plural(n, 'selected patch')}`),
  ];
}
