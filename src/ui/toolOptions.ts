import type { Editor } from '../editor.ts';
import type { BlockTool, KitTool } from '../edit/tools.ts';
import type { RoadTool } from '../edit/roadTool.ts';
import { ROAD_STYLES, type RoadStyle } from '../gen/roads.ts';
import { materialThumbnail } from '../assets/thumbnails.ts';
import { h } from './dom.ts';

const NAMES = { select: 'Select', block: 'Block', paint: 'Paint', entity: 'Entity', kit: 'Lambda Wars kit', decal: 'Decal', road: 'Road' } as const;
const HINTS = {
  select: 'Click to select · Shift adds · drag the gizmo · M move / R resize',
  block: 'Drag on a surface to draw a block',
  paint: 'Click a face · Shift: whole brush · Ctrl: pick material',
  entity: 'Click a surface to place',
  kit: 'Click a surface to place · settings in the Mission tab',
  decal: 'Click a wall or floor to place · pick decals in the Materials tab',
  road: 'Click points · snaps onto roads to join them · Enter or double-click builds · Backspace removes a point',
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
    if (name === 'road') {
      const tool = editor.tools.tools.road as RoadTool;
      const style = h('select', {}, ...Object.entries(ROAD_STYLES).map(([k, s]) => h('option', { value: k }, s.label))) as HTMLSelectElement;
      style.value = tool.style;
      style.addEventListener('change', () => { tool.setStyle(style.value as RoadStyle); style.blur(); });
      const num = (value: number, set: (v: number) => void, step: number, min: number) => {
        const i = h('input', { type: 'number', value: String(value), step: String(step), min: String(min) }) as HTMLInputElement;
        i.addEventListener('change', () => { set(Math.max(min, parseFloat(i.value) || min)); i.blur(); });
        return i;
      };
      rows.push(
        h('div.row', {}, h('label', {}, 'Style'), style),
        h('div.row', {}, h('label', {}, 'Width'), num(tool.width, (v) => (tool.width = v), 32, 64)),
        h('div.row', {}, h('label', {}, 'Pavement'), num(tool.pavement, (v) => (tool.pavement = v), 16, 0)),
        h('div.row', {}, h('label', {}, 'Corners'), num(tool.radius, (v) => (tool.radius = v), 32, 0)),
      );
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
  for (const ev of ['toolchange', 'material', 'entityclass', 'kit', 'decal', 'roadstyle']) editor.on(ev, render);
  render();
}
