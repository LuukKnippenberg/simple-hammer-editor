import type { Editor } from '../editor.ts';
import type { BlockTool, KitTool } from '../edit/tools.ts';
import { materialThumbnail } from '../assets/thumbnails.ts';
import { h } from './dom.ts';

const NAMES = { select: 'Select', block: 'Block', paint: 'Paint', entity: 'Entity', kit: 'Lambda Wars kit', decal: 'Decal' } as const;
const HINTS = {
  select: 'Click to select · Shift adds · drag the gizmo · M move / R resize',
  block: 'Drag on a surface to draw a block',
  paint: 'Click a face · Shift: whole brush · Ctrl: pick material',
  entity: 'Click a surface to place',
  kit: 'Click a surface to place · settings in the Mission tab',
  decal: 'Click a wall or floor to place · pick decals in the Materials tab',
} as const;

/** Small panel in the viewport corner with the active tool's settings. */
export function mountToolOptions(editor: Editor, viewport: HTMLElement): void {
  const box = h('div.overlay.tl.tool-options');
  viewport.append(box);
  const render = () => {
    const name = editor.tools.current.name;
    const rows: (HTMLElement | string)[] = [h('b', {}, NAMES[name]), h('div.hint', {}, HINTS[name])];
    if (name === 'block') {
      const tool = editor.tools.tools.block as BlockTool;
      const height = h('input', { type: 'number', value: String(tool.height), step: '16', min: '1' }) as HTMLInputElement;
      height.addEventListener('change', () => {
        tool.height = Math.max(1, parseFloat(height.value) || 128);
        // Hand the keyboard back to the viewport so tool shortcuts keep working.
        height.blur();
      });
      rows.push(h('div.row', {}, h('label', {}, 'Height'), height));
      const shape = h('select', {}, ...[['box', 'Box'], ['cylinder', 'Cylinder'], ['cone', 'Cone / spire'], ['dome', 'Dome']].map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
      shape.value = tool.shape;
      shape.addEventListener('change', () => { tool.shape = shape.value as BlockTool['shape']; shape.blur(); render(); });
      rows.push(h('div.row', {}, h('label', {}, 'Shape'), shape));
      if (tool.shape !== 'box') {
        const sides = h('input', { type: 'number', value: String(tool.sides), min: '4', max: '32', step: '2' }) as HTMLInputElement;
        sides.addEventListener('change', () => { tool.sides = Math.max(4, Math.min(32, parseInt(sides.value, 10) || 12)); sides.blur(); });
        rows.push(h('div.row', {}, h('label', {}, 'Sides'), sides));
      }
    }
    if (name === 'block' || name === 'paint') {
      const img = h('img') as HTMLImageElement;
      void materialThumbnail(editor.currentMaterial).then((u) => u && (img.src = u));
      rows.push(h('div.current-mat.small', {}, img, h('span', {}, editor.currentMaterial.toLowerCase())));
    }
    if (name === 'decal') {
      const d = editor.decal;
      const img = h('img') as HTMLImageElement;
      void materialThumbnail(d.material).then((u) => u && (img.src = u));
      const mode = h('select', {}, h('option', { value: 'decal' }, 'Decal (infodecal)'), h('option', { value: 'overlay' }, 'Overlay (sized, rotated)')) as HTMLSelectElement;
      mode.value = d.mode;
      mode.addEventListener('change', () => { d.mode = mode.value as 'decal' | 'overlay'; mode.blur(); render(); });
      rows.push(h('div.current-mat.small', {}, img, h('span', {}, d.material)), h('div.row', {}, h('label', {}, 'Type'), mode));
      if (d.mode === 'overlay') {
        const size = h('input', { type: 'number', value: String(d.size), step: '16', min: '8' }) as HTMLInputElement;
        size.addEventListener('change', () => { d.size = Math.max(8, parseFloat(size.value) || 128); size.blur(); });
        const rot = h('input', { type: 'number', value: String(d.rotation), step: '15' }) as HTMLInputElement;
        rot.addEventListener('change', () => { d.rotation = parseFloat(rot.value) || 0; rot.blur(); });
        rows.push(h('div.row', {}, h('label', {}, 'Size'), size), h('div.row', {}, h('label', {}, 'Rotate'), rot));
      }
    }
    if (name === 'kit') {
      const kit = (editor.tools.tools.kit as KitTool).kit;
      rows.push(h('div', {}, kit.icon, ' ', kit.label));
    }
    if (name === 'entity') {
      rows.push(h('div', {}, h('span.muted', {}, 'Class '), editor.entityClass));
      if (editor.entityClass.startsWith('prop_')) rows.push(h('div', {}, h('span.muted', {}, 'Model '), editor.entityModel));
    }
    box.replaceChildren(...rows);
  };
  for (const ev of ['toolchange', 'material', 'entityclass', 'kit', 'decal']) editor.on(ev, render);
  render();
}
