import type { Editor } from '../editor.ts';
import type { BlockTool, KitTool } from '../edit/tools.ts';
import { materialThumbnail } from '../assets/thumbnails.ts';
import { h } from './dom.ts';

const NAMES = { select: 'Select', block: 'Block', paint: 'Paint', entity: 'Entity', kit: 'Lambda Wars kit' } as const;
const HINTS = {
  select: 'Click to select · Shift adds · drag the gizmo · M move / R resize',
  block: 'Drag on a surface to draw a block',
  paint: 'Click a face · Shift: whole brush · Ctrl: pick material',
  entity: 'Click a surface to place',
  kit: 'Click a surface to place · settings in the Mission tab',
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
    }
    if (name === 'block' || name === 'paint') {
      const img = h('img') as HTMLImageElement;
      void materialThumbnail(editor.currentMaterial).then((u) => u && (img.src = u));
      rows.push(h('div.current-mat.small', {}, img, h('span', {}, editor.currentMaterial.toLowerCase())));
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
  for (const ev of ['toolchange', 'material', 'entityclass', 'kit']) editor.on(ev, render);
  render();
}
