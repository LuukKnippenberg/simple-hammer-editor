import type { Editor } from '../editor.ts';
import type { BlockTool, KitTool } from '../edit/tools.ts';
import type { RoadTool } from '../edit/roadTool.ts';
import { ROAD_STYLES, type RoadStyle } from '../gen/roads.ts';
import { makeTerrain, type GroundTool } from '../edit/groundTool.ts';
import type { PowerlineTool } from '../edit/powerlineTool.ts';
import type { SoundTool, SoundToolMode } from '../edit/soundTool.ts';
import { auditionSoundscape, soundscapeSelect } from './soundUi.ts';
import { soundBrowser } from './soundBrowser.ts';
import { SOUND_PRESETS } from '../lw/soundPresets.ts';
import { POLE_TYPES, type PoleType } from '../gen/powerlines.ts';
import { GROUND_SETS, type GroundMode } from '../edit/terrain.ts';
import { materialThumbnail } from '../assets/thumbnails.ts';
import { h, toast } from './dom.ts';

const NAMES = { select: 'Select', block: 'Block', paint: 'Paint', entity: 'Entity', kit: 'Lambda Wars kit', decal: 'Decal', road: 'Road', ground: 'Ground', powerline: 'Powerline', sound: 'Sound', poi: 'Point of interest' } as const;
const HINTS = {
  select: 'Click to select · Shift adds · drag the gizmo · M move / R resize',
  block: 'Drag on a surface to draw a block',
  paint: 'Click a face · Shift: whole brush · Ctrl: pick material',
  entity: 'Click a surface to place',
  kit: 'Click a surface to place · settings in the Mission tab',
  decal: 'Click a wall or floor to place · pick decals in the Materials tab',
  road: 'Click points · snaps onto roads to join them · Enter or double-click builds · Backspace removes a point',
  ground: 'Drag on terrain to paint or sculpt',
  powerline: 'Click points along the route · Enter or double-click places poles and wires',
  sound: 'Click to place · turn on Audio in the top bar to hear the map',
  poi: 'Drag a rectangle (or click) to place · pick the type and settings in the POI tab',
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
    if (name === 'ground') {
      const tool = editor.tools.tools.ground as GroundTool;
      const modes: [GroundMode, string][] = [['paint', 'Paint'], ['erase', 'Erase'], ['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten']];
      const seg = h('div.seg', {}, ...modes.map(([m, l]) => {
        const b = h('button', { onclick: () => { tool.mode = m; render(); } }, l);
        b.classList.toggle('active', tool.mode === m);
        return b;
      }));
      const set = h('select', { title: 'Paint shows the second texture; Erase brings back the first' }, ...GROUND_SETS.map((g) => h('option', { value: g.material }, g.label))) as HTMLSelectElement;
      set.value = tool.set;
      set.addEventListener('change', () => { tool.set = set.value; set.blur(); });
      const radius = h('input', { type: 'range', min: 32, max: 512, step: 16, value: tool.radius }) as HTMLInputElement;
      radius.addEventListener('input', () => (tool.radius = Number(radius.value)));
      const strength = h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: tool.strength }) as HTMLInputElement;
      strength.addEventListener('input', () => (tool.strength = Number(strength.value)));
      const floors = [...editor.selection.solids].filter((s) => !s.entity && !s.isDisplacement);
      rows.push(seg,
        h('div.row', {}, h('label', {}, 'Ground'), set),
        h('div.row', {}, h('label', {}, 'Radius'), radius),
        h('div.row', {}, h('label', {}, 'Strength'), strength),
        h('button', {
          disabled: !floors.length,
          title: 'Replace the selected floor brushes with displacement terrain in this ground set',
          onclick: () => { const n = makeTerrain(editor, floors, tool.set); render(); toast(editor.container, `Made ${n} terrain patches`); },
        }, floors.length ? `Turn ${floors.length} selected floor${floors.length > 1 ? 's' : ''} into terrain` : 'Select a floor brush to turn it into terrain'));
    }
    if (name === 'powerline') {
      const tool = editor.tools.tools.powerline as PowerlineTool;
      const pole = h('select', {}, ...Object.entries(POLE_TYPES).map(([k, p]) => h('option', { value: k }, p.label))) as HTMLSelectElement;
      pole.value = tool.pole;
      pole.addEventListener('change', () => { tool.pole = pole.value as PoleType; pole.blur(); });
      const spacing = h('input', { type: 'number', value: String(tool.spacing), step: '64', min: '192' }) as HTMLInputElement;
      spacing.addEventListener('change', () => { tool.spacing = Math.max(192, Number(spacing.value) || 640); spacing.blur(); });
      const sag = h('input', { type: 'range', min: 0, max: 0.15, step: 0.01, value: tool.slack }) as HTMLInputElement;
      sag.addEventListener('input', () => (tool.slack = Number(sag.value)));
      const feeds = h('input', { type: 'checkbox', checked: tool.feeds }) as HTMLInputElement;
      feeds.addEventListener('change', () => (tool.feeds = feeds.checked));
      rows.push(h('div.row', {}, h('label', {}, 'Poles'), pole), h('div.row', {}, h('label', {}, 'Spacing'), spacing), h('div.row', {}, h('label', {}, 'Sag'), sag),
        h('div.row', {}, h('label', {}, 'House feeds'), feeds));
    }
    if (name === 'sound') {
      const tool = editor.tools.tools.sound as SoundTool;
      const modes: [SoundToolMode, string][] = [['zone', 'Soundscape zone'], ['sound', 'Local sound']];
      const seg = h('div.seg', {}, ...modes.map(([m, l]) => {
        const b = h('button', { onclick: () => { tool.mode = m; render(); } }, l);
        b.classList.toggle('active', tool.mode === m);
        return b;
      }));
      rows.push(seg);
      if (tool.mode === 'zone') {
        const sel = soundscapeSelect(tool.soundscape, (v) => (tool.soundscape = v));
        const radius = h('input', { type: 'number', value: String(tool.radius), step: '64', min: '64' }) as HTMLInputElement;
        radius.addEventListener('change', () => { tool.radius = Math.max(64, Number(radius.value) || 768); radius.blur(); });
        rows.push(
          h('div.row', {}, h('label', {}, 'Soundscape'), sel, h('button', { title: 'Listen for 15 seconds', onclick: () => void auditionSoundscape(sel.value) }, '▶')),
          h('div.row', {}, h('label', {}, 'Radius'), radius),
        );
      } else {
        const kind = h('select', {},
          h('option', { value: 'file' }, 'Sound file'),
          ...SOUND_PRESETS.map((p) => h('option', { value: p.id }, `${p.icon} ${p.label}`))) as HTMLSelectElement;
        kind.value = tool.local;
        kind.addEventListener('change', () => { tool.local = kind.value; kind.blur(); render(); });
        rows.push(h('div.row', {}, h('label', {}, 'Place'), kind));
        if (tool.local === 'file') {
          const radius = h('input', { type: 'number', value: String(tool.soundRadius), step: '64', min: '64' }) as HTMLInputElement;
          radius.addEventListener('change', () => { tool.soundRadius = Math.max(64, Number(radius.value) || 512); radius.blur(); });
          const vol = h('input', { type: 'range', min: 1, max: 10, step: 1, value: tool.volume }) as HTMLInputElement;
          vol.addEventListener('input', () => (tool.volume = Number(vol.value)));
          rows.push(h('div.row', {}, h('label', {}, 'Radius'), radius), h('div.row', {}, h('label', {}, 'Volume'), vol),
            soundBrowser(tool.sound, (p) => (tool.sound = p)));
        } else {
          const p = SOUND_PRESETS.find((x) => x.id === tool.local)!;
          rows.push(h('div.hint', {}, p.prop ? `Click the ground to place it with its own prop, or click a fitting prop to add it there.` : 'Click where the sound should be.'));
        }
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
  for (const ev of ['toolchange', 'material', 'entityclass', 'kit', 'decal', 'roadstyle', 'selection']) editor.on(ev, render);
  render();
}
