import type { Editor } from '../editor.ts';
import type { BlockTool, KitTool, SelectTool } from '../edit/tools.ts';
import { GENERATE_TOOLS } from '../edit/generateTool.ts';
import { makeTerrain, type GroundTool } from '../edit/groundTool.ts';
import type { SoundTool, SoundToolMode } from '../edit/soundTool.ts';
import { auditionSoundscape, soundscapeSelect } from './soundUi.ts';
import { soundBrowser } from './soundBrowser.ts';
import { SOUND_PRESETS } from '../lw/soundPresets.ts';
import { cinemaToolOptions } from './cinemaPanel.ts';
import { GROUND_SETS, type GroundMode } from '../edit/terrain.ts';
import { materialThumbnail } from '../assets/thumbnails.ts';
import { multiblendRows, multiblendSets } from './blendUi.ts';
import { h, toast } from './dom.ts';
import { selectModeRows } from './partPanel.ts';
import { entityToolOptions } from './entityToolOptions.ts';
import { toolModelField } from './modelField.ts';
import { decalToolOptions } from './decalField.ts';
import { recentMaterials } from './recent.ts';

const NAMES = { select: 'Select', block: 'Block', paint: 'Paint', entity: 'Entity', kit: 'Lambda Wars kit', decal: 'Decal', road: 'Road', ground: 'Ground', powerline: 'Powerline', sound: 'Sound', poi: 'Point of interest', cinema: 'Cinema', stairs: 'Stairs', generate: 'Generate' } as const;
const HINTS = {
  select: 'Click to select · Shift adds · drag the gizmo · W move / E rotate / R resize',
  block: 'Drag on a surface to draw a block',
  paint: 'Click a face · Shift: whole brush · Ctrl: pick material',
  entity: 'Click a surface to place · Alt+click an entity to copy its class',
  kit: 'Click a surface to place · settings in the Mission tab',
  decal: 'Click a wall or floor to place · Tab next recent decal',
  road: 'Click points · snaps onto roads to join them · Enter or double-click builds · Backspace removes a point',
  ground: 'Drag on terrain to paint or sculpt · with terrain selected, only that changes',
  powerline: 'Click points along the route · Enter or double-click places poles and wires',
  sound: 'Click to place · turn on Audio in the top bar to hear the map',
  poi: 'Drag a rectangle (or click) to place · pick the type and settings in the POI tab',
  cinema: 'Click to place · a selected path end keeps extending its path · Esc starts a new path',
  stairs: 'Click A, then B, then set the height',
  generate: 'Drag a rectangle on the ground',
} as const;

/** The Paint tool's recent materials as swatches (a click uses one), and a button that browses them all in the asset finder. */
function recentMaterialRows(editor: Editor, browse: () => void): HTMLElement[] {
  const current = editor.currentMaterial.toLowerCase();
  const swatches = recentMaterials.items.slice(0, 12).map((m) => {
    const img = h('img', { alt: '' }) as HTMLImageElement;
    void materialThumbnail(m).then((u) => (u ? (img.src = u) : img.classList.add('missing')));
    return h(m.toLowerCase() === current ? 'button.mat-recent.on' : 'button.mat-recent', { title: m, 'aria-label': `Use ${m}`, onclick: () => { recentMaterials.push(m); editor.setMaterial(m); } }, img);
  });
  return [
    swatches.length ? h('div.mat-recents', { 'aria-label': 'Recent materials' }, ...swatches) : h('div.hint', {}, 'Materials you use show up here.'),
    h('button', { title: 'Open the asset finder on Materials (B)', onclick: browse }, '▤ Browse materials'),
  ];
}

/** Small panel in the viewport corner with the active tool's settings; `browse` opens the asset finder on Materials. */
export function mountToolOptions(editor: Editor, viewport: HTMLElement, browse: () => void): void {
  const box = h('div.overlay.tl.tool-options');
  viewport.append(box);
  const render = () => {
    const name = editor.tools.current.name;
    // Generators have their own panel (generatePanel.ts).
    box.hidden = GENERATE_TOOLS.has(name);
    if (box.hidden) return;
    const rows: (HTMLElement | string)[] = [h('b', {}, NAMES[name]), h('div.hint', {}, HINTS[name])];
    if (name === 'select') rows.push(...selectModeRows(editor, render));
    if (name === 'select' && (editor.tools.tools.select as SelectTool).mode === 'rotate') {
      const tool = editor.tools.tools.select as SelectTool;
      const step = h('input', { type: 'number', value: String(tool.rotateStep), step: '5', min: '1', max: '180', disabled: !tool.rotateSnap }) as HTMLInputElement;
      step.addEventListener('change', () => { tool.rotateStep = Math.max(1, Math.min(180, parseFloat(step.value) || 15)); step.blur(); });
      const snapBox = h('input', { type: 'checkbox', checked: tool.rotateSnap }) as HTMLInputElement;
      snapBox.addEventListener('change', () => { tool.rotateSnap = snapBox.checked; snapBox.blur(); render(); });
      rows.push(
        h('div.row', {}, h('label', {}, 'Step °'), step),
        h('label.check', { title: 'Hold Shift while dragging to rotate freely' }, snapBox, ' Snap rotation (Shift: free)'),
      );
    }
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
    if (name === 'paint') rows.push(...recentMaterialRows(editor, browse));
    if (name === 'decal') rows.push(...decalToolOptions(editor, render));
    if (name === 'ground') {
      const tool = editor.tools.tools.ground as GroundTool;
      const modes: [GroundMode, string][] = [['paint', 'Paint'], ['erase', 'Erase'], ['raise', 'Raise'], ['lower', 'Lower'], ['smooth', 'Smooth'], ['flatten', 'Flatten']];
      const seg = h('div.seg', {}, ...modes.map(([m, l]) => {
        const b = h('button', { onclick: () => { tool.mode = m; render(); } }, l);
        b.classList.toggle('active', tool.mode === m);
        return b;
      }));
      const blends = h('optgroup', { label: 'MultiBlend (up to 4 textures)' });
      const set = h('select', { title: 'Paint shows the second texture (or the MultiBlend layer); Erase brings back the first' },
        h('optgroup', { label: 'Two textures' }, ...GROUND_SETS.map((g) => h('option', { value: g.material }, g.label))), blends) as HTMLSelectElement;
      void multiblendSets().then((sets) => {
        blends.append(...sets.map((g) => h('option', { value: g.material }, g.label)));
        set.value = tool.set;
      });
      set.value = tool.set;
      set.addEventListener('change', () => {
        tool.set = set.value;
        set.blur();
        // The layer controls depend on the material's VMT.
        void editor.materials.ready(tool.set).then(render);
      });
      const radius = h('input', { type: 'range', min: 32, max: 512, step: 16, value: tool.radius }) as HTMLInputElement;
      radius.addEventListener('input', () => (tool.radius = Number(radius.value)));
      const strength = h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: tool.strength }) as HTMLInputElement;
      strength.addEventListener('input', () => (tool.strength = Number(strength.value)));
      const floors = [...editor.selection.solids].filter((s) => !s.entity && !s.isDisplacement);
      rows.push(seg,
        h('div.row', {}, h('label', {}, 'Ground'), set),
        h('div.row', {}, h('label', {}, 'Radius'), radius),
        h('div.row', {}, h('label', {}, 'Strength'), strength),
        ...multiblendRows(editor, tool, render),
        h('button', {
          disabled: !floors.length,
          title: 'Replace the selected floor brushes with displacement terrain in this ground set',
          onclick: () => { const n = makeTerrain(editor, floors, tool.set); render(); toast(editor.container, `Made ${n} terrain patches`); },
        }, floors.length ? `Turn ${floors.length} selected floor${floors.length > 1 ? 's' : ''} into terrain` : 'Select a floor brush to turn it into terrain'));
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
    if (name === 'cinema') rows.push(...cinemaToolOptions(editor, render));
    if (name === 'kit') {
      const kit = (editor.tools.tools.kit as KitTool).kit;
      rows.push(h('div', {}, kit.icon, ' ', kit.label));
    }
    if (name === 'entity') rows.push(...entityToolOptions(editor, render, () => toolModelField(editor)));
    box.classList.toggle('wide', name === 'entity' || name === 'decal');
    box.replaceChildren(...rows);
  };
  for (const ev of ['toolchange', 'material', 'entityclass', 'kit', 'decal', 'roadstyle', 'selection']) editor.on(ev, render);
  render();
}
