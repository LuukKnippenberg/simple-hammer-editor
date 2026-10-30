import type { Editor } from '../editor.ts';
import type { GroundTool } from '../edit/groundTool.ts';
import { loadVmt } from '../assets/vmt.ts';
import { BLEND_FOLDER, DEFAULT_SPEC, safeBlendName, type BlendDef, type BlendLayer } from '../edit/multiblend.ts';
import { h, toast } from './dom.ts';

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

/** Layer picker, noise fill and "new blend" controls shown under the ground set when it is a MultiBlend. */
export function multiblendRows(editor: Editor, tool: GroundTool, render: () => void): HTMLElement[] {
  const info = editor.materials.get(tool.set);
  const def = info.multiblend;
  if (!def) return [h('button', { onclick: () => openBlendDialog(editor, tool, render, null) }, 'New blend material…')];

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
      h('button', { onclick: () => openBlendDialog(editor, tool, render, def) }, 'Copy as new blend…'),
    ),
  ];
}

let textureList: Promise<string[]> | null = null;

/** Ground-like textures for the layer pickers (not normal, spec or tool maps). */
function groundTextures(): Promise<string[]> {
  textureList ??= (async () => {
    const out: string[] = [];
    for (const folder of ['materials/nature', 'materials/lostcoast/nature', 'materials/concrete']) {
      const r = await fetch(`/api/list?folder=${encodeURIComponent(folder)}&ext=.vtf`);
      if (!r.ok) continue;
      for (const f of (await r.json()) as string[]) {
        const n = f.replace(/^materials\//, '').replace(/\.vtf$/, '');
        if (!/(_normal|_spec|_bump|_ssbump|_height|_mask|_exp|_detail)/.test(n)) out.push(n);
      }
    }
    return out;
  })();
  return textureList;
}

/**
 * Dialog to make a MultiBlend material: a base texture and up to three more, each with its own size and
 * rotation. Saving writes content/materials/she/blend/<name>.vmt and selects it as the ground set.
 */
export function openBlendDialog(editor: Editor, tool: GroundTool, render: () => void, from: BlendDef | null): void {
  const layers: BlendLayer[] = from
    ? from.layers.map((l) => ({ ...l }))
    : [{ texture: 'nature/forest_grass_01', scale: 1, rotation: 0 }, { texture: 'nature/forest_dirt_02', scale: 1, rotation: 0 }];
  const backdrop = h('div.modal-backdrop');
  const dialog = h('div.modal');
  backdrop.append(dialog);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  const list = h('datalist', { id: 'she-blend-textures' });
  void groundTextures().then((ts) => list.append(...ts.map((t) => h('option', { value: t }))));
  const name = h('input', { type: 'text', value: from ? `${short(from.name)}_copy` : 'my_ground' }) as HTMLInputElement;
  const detail = h('input', { type: 'text', value: from?.detailtype ?? '', placeholder: 'e.g. grass01b (optional)' }) as HTMLInputElement;
  const body = h('div.blend-layers');

  const draw = () => {
    body.replaceChildren(...layers.map((l, i) => {
      const tex = h('input', { type: 'text', value: l.texture, list: 'she-blend-textures', size: 30 }) as HTMLInputElement;
      tex.addEventListener('change', () => (l.texture = tex.value.trim().toLowerCase()));
      const scale = h('input', { type: 'number', value: String(l.scale), step: '0.25', min: '0.25', title: 'Size' }) as HTMLInputElement;
      scale.addEventListener('change', () => (l.scale = Math.max(0.05, Number(scale.value) || 1)));
      const rot = h('input', { type: 'number', value: String(l.rotation), step: '15', title: 'Rotation (degrees)' }) as HTMLInputElement;
      rot.addEventListener('change', () => (l.rotation = Number(rot.value) || 0));
      const del = i >= 2 ? h('button', { title: 'Remove layer', onclick: () => { layers.splice(i, 1); draw(); } }, '✕') : null;
      return h('div.row', {}, h('label', {}, i ? `Layer ${i}` : 'Base'), tex, scale, rot, del);
    }));
    if (layers.length < 4) {
      body.append(h('button', { onclick: () => { layers.push({ texture: 'nature/gravelfloor002a', scale: 1, rotation: 0 }); draw(); } }, '+ Add layer'));
    }
  };
  draw();

  const save = async () => {
    const def: BlendDef = { name: safeBlendName(name.value), layers, spec: DEFAULT_SPEC, detailtype: detail.value.trim() || undefined };
    const r = await fetch('/api/blend', { method: 'POST', body: JSON.stringify(def) });
    const res = await r.json();
    if (!r.ok) return toast(editor.container, res.error ?? 'Could not save the blend');
    await editor.materials.reload(res.material);
    await multiblendSets(true);
    tool.set = res.material;
    tool.layer = 1;
    close();
    render();
    toast(editor.container, `Saved ${res.material.toLowerCase()}`);
  };

  dialog.append(
    h('div.modal-head', {}, h('b', {}, 'Blend material (MultiBlend)'), h('button', { onclick: close }, '✕')),
    h('div.hint', {}, 'The base shows wherever nothing is painted; layers 1–3 are painted or noise-filled on top. Size > 1 makes a texture larger.'),
    h('div.row', {}, h('label', {}, 'Name'), name),
    body, list,
    h('div.row', {}, h('label', {}, 'Detail sprites'), detail),
    h('div.row', {}, h('button.primary', { onclick: () => void save() }, 'Save blend')),
  );
  editor.container.append(backdrop);
}
