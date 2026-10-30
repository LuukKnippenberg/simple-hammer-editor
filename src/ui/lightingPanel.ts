import type { Editor } from '../editor.ts';
import type { LightingPreview } from '../render/lightingPreview.ts';
import { h } from './dom.ts';

/** Lighting section: preview and shadow toggles. Sun, ambient and fog are edited in the Settings tab. */
export function mountLightingPanel(editor: Editor, preview: LightingPreview): HTMLElement {
  const body = h('div');
  const stats = h('p.hint');

  const render = () => {
    const previewBox = h('input', { type: 'checkbox', checked: preview.enabled }) as HTMLInputElement;
    previewBox.addEventListener('change', () => { preview.setEnabled(previewBox.checked); editor.emit('lighting'); });
    const shadowBox = h('input', { type: 'checkbox', checked: preview.shadows }) as HTMLInputElement;
    shadowBox.addEventListener('change', () => preview.setShadows(shadowBox.checked));
    body.replaceChildren(
      h('label.check', {}, previewBox, ' Lighting preview (L)'),
      h('label.check', {}, shadowBox, ' Sun shadows'),
    );
  };
  editor.on('frame', () => {
    stats.textContent = preview.enabled
      ? `${preview.stats.lights} light entities, ${preview.stats.active} active near the camera. Sun, sky light and fog are in the Settings tab.`
      : 'Approximates vrad: sun with shadows, sky ambient, fog, and the nearest 24 point and 8 spot lights.';
  });
  for (const ev of ['document', 'lighting']) editor.on(ev, render);
  render();
  return h('div.section', {}, h('h3', {}, 'Lighting'), body, stats);
}
