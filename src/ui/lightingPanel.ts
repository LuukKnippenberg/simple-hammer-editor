import type { Editor } from '../editor.ts';
import type { LightingPreview } from '../render/lightingPreview.ts';
import type { MapEntity } from '../vmf/map.ts';
import { recordKit } from '../lw/kits.ts';
import { entityNode } from '../edit/actions.ts';
import { Vector3 } from 'three';
import { h } from './dom.ts';

const hex = (rgb: string) => '#' + rgb.trim().split(/\s+/).slice(0, 3).map((x) => Math.max(0, Math.min(255, Number(x) || 0)).toString(16).padStart(2, '0')).join('');
const rgbOf = (hx: string) => [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16)).join(' ');

/** Lighting section: preview and shadow toggles, plus live sun and ambient controls on light_environment. */
export function mountLightingPanel(editor: Editor, preview: LightingPreview): HTMLElement {
  const body = h('div');
  const stats = h('p.hint');

  /** Live edit of an entity key; the first change opens an undo step that `commit` closes. */
  const liveEdit = (e: MapEntity) => {
    let end: (() => void) | null = null;
    return {
      set(key: string, value: string) {
        end ??= editor.history.begin('Edit sun', [], [e]);
        e.set(key, value);
        editor.dirty = true;
        editor.applyEnvironment();
        preview.refresh();
      },
      commit() {
        end?.();
        end = null;
        editor.emit('change');
      },
    };
  };

  const addSun = () => recordKit(editor, 'Add sun', () => {
    editor.doc.addEntity(entityNode(editor, 'light_environment', new Vector3(0, 0, 512), {
      pitch: '-50', angles: '0 45 0', _light: '255 238 214 450', _ambient: '170 185 210 140',
      _lightHDR: '-1 -1 -1 1', _ambientHDR: '-1 -1 -1 1', _lightscaleHDR: '1', _AmbientScaleHDR: '1',
    }));
  });

  const render = () => {
    const sun = editor.doc.entities.find((e) => e.classname === 'light_environment');
    const previewBox = h('input', { type: 'checkbox', checked: preview.enabled }) as HTMLInputElement;
    previewBox.addEventListener('change', () => { preview.setEnabled(previewBox.checked); editor.emit('lighting'); });
    const shadowBox = h('input', { type: 'checkbox', checked: preview.shadows }) as HTMLInputElement;
    shadowBox.addEventListener('change', () => preview.setShadows(shadowBox.checked));
    const toggles = [
      h('label.check', {}, previewBox, ' Lighting preview (L)'),
      h('label.check', {}, shadowBox, ' Sun shadows'),
    ];
    if (!sun) {
      body.replaceChildren(...toggles, h('p.hint', {}, 'No light_environment in this map.'), h('button', { onclick: addSun }, 'Add sun'));
      return;
    }
    const ed = liveEdit(sun);
    const slider = (label: string, min: number, max: number, value: number, apply: (v: number) => void) => {
      const out = h('span.muted', { style: { width: '38px', textAlign: 'right' } }, String(Math.round(value)));
      const input = h('input', { type: 'range', min, max, step: 1, value }) as HTMLInputElement;
      input.addEventListener('input', () => { out.textContent = input.value; apply(parseFloat(input.value)); });
      input.addEventListener('change', () => ed.commit());
      return h('div.row', {}, h('label', {}, label), input, out);
    };
    const color = (label: string, key: string, fallback: string) => {
      const parts = (sun.get(key) ?? fallback).trim().split(/\s+/);
      const pick = h('input', { type: 'color', value: hex(parts.join(' ')) }) as HTMLInputElement;
      const bright = h('input', { type: 'number', value: parts[3] ?? '200', min: 0, step: 10 }) as HTMLInputElement;
      const apply = () => ed.set(key, `${rgbOf(pick.value)} ${bright.value || '200'}`);
      pick.addEventListener('input', apply);
      pick.addEventListener('change', () => ed.commit());
      bright.addEventListener('change', () => { apply(); ed.commit(); });
      return h('div.row', {}, h('label', {}, label), pick, bright);
    };
    const pitch = parseFloat(sun.get('pitch') ?? String(sun.angles.x)) || -45;
    body.replaceChildren(...toggles,
      slider('Sun height', 5, 89, -pitch, (v) => ed.set('pitch', String(-v))),
      slider('Sun direction', 0, 359, sun.angles.y, (v) => { const a = sun.angles; ed.set('angles', `${a.x} ${v} ${a.z}`); }),
      color('Sun colour', '_light', '255 255 255 200'),
      color('Ambient', '_ambient', '150 160 180 100'),
    );
  };
  editor.on('frame', () => {
    stats.textContent = preview.enabled
      ? `${preview.stats.lights} light entities, ${preview.stats.active} active near the camera.`
      : 'Approximates vrad: sun with shadows, sky ambient, and the nearest 24 point and 8 spot lights.';
  });
  for (const ev of ['document', 'lighting']) editor.on(ev, render);
  render();
  return h('div.section', {}, h('h3', {}, 'Lighting'), body, stats);
}
