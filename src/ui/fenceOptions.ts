import type { Editor } from '../editor.ts';
import { DOOR_WIDTH, FENCE_MATERIALS, FENCE_MODELS, FENCE_STYLES, MIN_DOOR, type FenceDoor, type FenceLink, type FenceMode, type FenceModelId, type FenceSpec, type FenceStyleId } from '../gen/fences.ts';
import type { PathTarget } from '../edit/pathPins.ts';
import type { PathPins } from '../edit/pathPins.ts';
import { pathLabels } from '../edit/pathPoints.ts';
import { setDoors, type FenceDoors } from '../edit/fenceDoors.ts';
import { num, row, select, toggle } from './form.ts';
import { pathPointsSection, pointAxis } from './pathPointsList.ts';
import { h } from './dom.ts';

type FenceSettings = Omit<FenceSpec, 'uid' | 'points' | 'links'>;

/**
 * A fence's option sheet (the Generate panel and the Selection panel): models or brushes, the model or the style,
 * and for brushes height, post spacing and panel material; the NPC clip. Every change calls back with a patch; the
 * caller rebuilds.
 */
export function fenceSheet(s: FenceSettings, set: (patch: Partial<FenceSpec>) => void): HTMLElement[] {
  const rows = [
    row('Build', select([['model', 'Models (prop_static)'], ['brush', 'Brushes (func_detail)']], s.mode, (v) => set({ mode: v as FenceMode }),
      'Models: fence props from the game, end to end. Brushes: posts and panels or rails you can texture.')),
  ];
  if (s.mode === 'model') {
    rows.push(row('Model', select(Object.entries(FENCE_MODELS).map(([key, m]) => [key, m.label, m.pieces.map((p) => p.model).join(', ')]), s.model, (v) => set({ model: v as FenceModelId }))));
  } else {
    const style = FENCE_STYLES[s.style];
    rows.push(
      row('Style', select(Object.entries(FENCE_STYLES).map(([key, st]) => [key, st.label]), s.style, (v) => set({ style: v as FenceStyleId }))),
      row('Height', num(s.height, (v) => set({ height: v }), { step: 8, min: 32, max: 512 })),
      row('Post spacing', num(s.spacing, (v) => set({ spacing: v }), { step: 16, min: 32, max: 1024 })),
      row('Material', select([['', `Style's own (${style.material.toLowerCase()})`], ...FENCE_MATERIALS.map(([m, label]): [string, string] => [m, `${label} · ${m.toLowerCase()}`])],
        s.material ?? '', (v) => set({ material: v || undefined }), 'Panels (rails for the rail style)')),
    );
  }
  rows.push(row('NPC clip', toggle(s.clip, (v) => set({ clip: v }), 'A strip of NPC clip along the fence (not across doorways): units never slip through gaps')));
  return rows;
}

/**
 * The Points section of a fence: x and y (the height follows the ground). Typed numbers move points through the pins.
 */
export function fencePointsSection(editor: Editor, key: string, pins?: PathPins): HTMLElement {
  return pathPointsSection(editor, key, [pointAxis('x', 'x', editor.grid), pointAxis('y', 'y', editor.grid)],
    'Points stand on the ground. Typing a number moves the point; Tab picks the next pin, Delete removes it, Shift+click a pin branches.', pins);
}

/**
 * The Doorways section: every stretch with its doorways (where along it, how wide, with a gate) and a button to add
 * one in its middle. Changes go through the pins' target (`target`), one undo step each; `doors` is the viewport's
 * chips (the picked one is lit here).
 */
export function fenceDoorwaysSection(target: PathTarget | null, doors: FenceDoors | null): HTMLElement {
  const section = h('div.section.fence-doorways', {}, h('h3', {}, 'Doorways'),
    h('p.hint', {}, 'An opening at a distance along its stretch (from its first point); it stays there when points move. Drag its chip in the viewport to slide it, Alt+click the chip to remove it. A gate adds gate posts, and an open gate on chain-link models.'));
  if (!target) return section;
  const path = target.path();
  const names = pathLabels(path);
  (path.links as FenceLink[]).forEach((l, k) => {
    const a = path.points[l.from], b = path.points[l.to];
    const length = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
    const list = l.doors ?? [];
    const change = (next: FenceDoor[], label: string) => setDoors(target, k, next, label);
    section.append(h('div.stretch', {},
      h('span', {}, `${names[l.from]} → ${names[l.to]} · ${length} u`),
      h('button', { title: `Add a doorway in the middle of ${names[l.from]} → ${names[l.to]}`, 'data-add-door': String(k),
        onclick: () => change([...list, { at: Math.round(length / 2), width: Math.min(DOOR_WIDTH, Math.max(MIN_DOOR, length - 16)) }], 'Add doorway') }, '+ Doorway')));
    list.forEach((d, i) => {
      const set = (patch: Partial<FenceDoor>, label: string) => change(list.map((x, j) => (j === i ? { ...x, ...patch } : x)), label);
      const on = doors?.picked?.link === k && doors.picked.door === i;
      section.append(h(`div.door-row${on ? '.on' : ''}`, { 'data-door': `${k}:${i}` },
        num(Math.round(d.at), (v) => set({ at: v }, 'Move doorway'), { step: 16, min: 0, max: length, title: 'Middle of the opening: units from the stretch\'s first point' }),
        num(d.width, (v) => set({ width: v }, 'Doorway width'), { step: 16, min: MIN_DOOR, max: 1024, title: 'Width of the opening' }),
        h('label', { title: 'Gate posts (and an open gate on chain-link models)' }, toggle(!!d.gate, (v) => set({ gate: v || undefined }, v ? 'Add gate' : 'Remove gate')), ' gate'),
        h('button', { title: 'Remove this doorway', onclick: () => change(list.filter((_, j) => j !== i), 'Remove doorway') }, '✕')));
    });
  });
  return section;
}
