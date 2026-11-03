import type { Editor } from '../editor.ts';
import type { GroundTool } from '../edit/groundTool.ts';
import { loadVmt } from '../assets/vmt.ts';
import { BLEND_FOLDER } from '../edit/multiblend.ts';
import { h, toast } from './dom.ts';
import { openBlender } from './blender.ts';

/** A ground set choice: a material plus a label for the picker. */
export interface BlendChoice {
  material: string;
  label: string;
}

let setsCache: Promise<BlendChoice[]> | null = null;

const listVmts = async (folder: string): Promise<string[]> => {
  const r = await fetch(`/api/list?folder=${encodeURIComponent(folder)}&ext=.vmt`);
  return r.ok ? ((await r.json()) as string[]) : [];
};

/** MultiBlend materials to paint with: Lambda Wars' own (materials/blends) and the ones made in the editor. */
export function multiblendSets(refresh = false): Promise<BlendChoice[]> {
  if (!setsCache || refresh) {
    setsCache = (async () => {
      const files = [...(await listVmts(`materials/${BLEND_FOLDER}`)), ...(await listVmts('materials/blends'))];
      const out: BlendChoice[] = [];
      for (const f of files) {
        const name = f.replace(/^materials\//, '').replace(/\.vmt$/, '');
        const vmt = await loadVmt(name);
        if (vmt?.shader !== 'multiblend') continue;
        const mine = name.startsWith(BLEND_FOLDER);
        out.push({ material: name.toUpperCase(), label: `${mine ? '★ ' : ''}${name.split('/').pop()!.replace(/^multiblend_/, '')}` });
      }
      return out;
    })();
  }
  return setsCache;
}

const short = (tex: string) => tex.split('/').pop() ?? tex;

/** The Ground tool's way into the material blender: on a new blend. */
export const newBlendButton = (editor: Editor) =>
  h('button', { title: 'Make a ground blend of up to four textures in the material blender', onclick: () => void openBlender(editor, { newBlend: true, from: 'Ground › New blend' }) }, 'New blend…');

/** Layer picker and noise fill shown under the ground set when it is a MultiBlend, then New blend…. */
export function multiblendRows(editor: Editor, tool: GroundTool, render: () => void): HTMLElement[] {
  const info = editor.materials.get(tool.set);
  const def = info.multiblend;
  if (!def) return [h('div.row', {}, newBlendButton(editor))];

  const names = ['Base', 'Layer 1', 'Layer 2', 'Layer 3'];
  tool.layer = Math.min(tool.layer, def.layers.length - 1);
  const seg = h('div.seg.layers', {}, ...def.layers.map((l, i) => {
    const b = h('button', { title: `${names[i]}: ${l.texture}`, onclick: () => { tool.layer = i; tool.mode = 'paint'; render(); } }, i ? `${i}: ${short(l.texture)}` : `Base: ${short(l.texture)}`);
    b.classList.toggle('active', tool.layer === i && tool.mode === 'paint');
    return b;
  }));

  const noiseRows = def.layers.slice(1).map((l, k) => {
    const n = tool.noise[k];
    const cov = h('input', { type: 'range', min: 0, max: 0.8, step: 0.05, value: n.coverage, title: `Share of the ground covered by ${short(l.texture)}` }) as HTMLInputElement;
    cov.addEventListener('input', () => (n.coverage = Number(cov.value)));
    const size = h('input', { type: 'number', value: String(n.scale), min: '64', step: '64', title: 'Patch size in units' }) as HTMLInputElement;
    size.addEventListener('change', () => { n.scale = Math.max(64, Number(size.value) || 512); size.blur(); });
    return h('div.row', {}, h('label', { title: l.texture }, short(l.texture)), cov, size);
  });
  const sel = [...editor.selection.solids].filter((s) => s.isDisplacement).length;
  return [
    h('div.row', {}, h('label', {}, 'Layer'), seg),
    h('div.hint', {}, 'Noise fill: coverage and patch size per layer'),
    ...noiseRows,
    h('div.row', {},
      h('button', {
        title: 'Fill the layer weights from noise so large areas stop repeating',
        onclick: () => {
          const count = tool.noiseFill(tool.noise.slice(0, def.layers.length - 1));
          toast(editor.container, count ? `Noise-blended ${count} terrain patch${count > 1 ? 'es' : ''}` : 'No terrain to blend');
        },
      }, sel ? `Noise-blend ${sel} selected patch${sel > 1 ? 'es' : ''}` : 'Noise-blend all terrain'),
      newBlendButton(editor),
    ),
  ];
}
