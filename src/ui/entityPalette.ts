import type { Editor } from '../editor.ts';
import { fgdClasses } from '../assets/fgd.ts';
import { h } from './dom.ts';

/** The entities a Lambda Wars map needs most, with a short explanation each. */
const FEATURED: { cls: string; label: string; hint: string }[] = [
  { cls: 'info_start_wars', label: 'Player start', hint: 'Base location of one player. Place one per player slot.' },
  { cls: 'control_point', label: 'Control point', hint: 'Capturable flag; a capture area trigger is added around it.' },
  { cls: 'scrap_marker', label: 'Scrap (large)', hint: 'Resource node rebels harvest.' },
  { cls: 'scrap_marker_small', label: 'Scrap (small)', hint: 'Small resource node.' },
  { cls: 'info_player_wars', label: 'Spectator spawn', hint: 'Where the player camera spawns.' },
  { cls: 'prop_static', label: 'Static prop', hint: 'Decoration model (set the model below).' },
  { cls: 'prop_dynamic', label: 'Dynamic prop', hint: 'Model that can animate or be toggled.' },
  { cls: 'light_environment', label: 'Sun light', hint: 'One per map: sun and ambient light.' },
  { cls: 'env_fog_controller', label: 'Fog', hint: 'Map fog colour and distances.' },
  { cls: 'light', label: 'Point light', hint: 'Local light source.' },
  { cls: 'light_spot', label: 'Spot light', hint: 'Cone light; aim it with the angles.' },
  { cls: 'light_deferred', label: 'Dynamic light', hint: 'Lambda Wars deferred light (radius, colour, optional shadows).' },
];

/** Picks the class the Entity tool places, plus the model for props. */
export function mountEntityPalette(editor: Editor, useTool: () => void): HTMLElement {
  const list = h('div');
  const search = h('input', { placeholder: 'All entity classes…', style: { width: '100%' } }) as HTMLInputElement;
  const results = h('div');
  const model = h('input', { value: editor.entityModel, style: { width: '100%' } }) as HTMLInputElement;
  const models = h('datalist', { id: 'model-list' });
  model.setAttribute('list', 'model-list');
  model.addEventListener('change', () => {
    editor.entityModel = model.value.trim();
    editor.emit('entityclass');
  });

  const choose = (cls: string) => {
    editor.entityClass = cls;
    useTool();
    editor.emit('entityclass');
    render();
  };
  const item = (cls: string, label: string, hint: string) =>
    h('div.ent-item' + (editor.entityClass === cls ? '.active' : '') as 'div', { onclick: () => choose(cls), title: cls },
      h('b', {}, label), h('span.muted', {}, ` ${cls}`), hint ? h('div.hint', {}, hint) : null);

  const render = () => {
    list.replaceChildren(...FEATURED.map((f) => item(f.cls, f.label, f.hint)));
    const q = search.value.trim().toLowerCase();
    const matches = q ? fgdClasses().filter((c) => !/solid/i.test(c.type) && c.name.toLowerCase().includes(q)).slice(0, 40) : [];
    results.replaceChildren(...matches.map((c) => item(c.name, c.name, c.description.slice(0, 80))));
    // Suggest the models already used in this map.
    const used = new Set<string>();
    for (const e of editor.doc.entities) {
      const m = e.get('model');
      if (m?.endsWith('.mdl')) used.add(m);
    }
    models.replaceChildren(...[...used].sort().map((m) => h('option', { value: m })));
  };
  search.addEventListener('input', render);
  editor.on('document', render);
  editor.on('fgd', render);
  render();
  return h('div', {},
    h('div.section', {}, h('h3', {}, 'Place entity (tool 4)'), list),
    h('div.section', {}, h('h3', {}, 'Prop model'), model, models),
    h('div.section', {}, h('h3', {}, 'Search classes'), search, results));
}
