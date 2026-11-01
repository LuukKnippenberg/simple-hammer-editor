import type { Editor } from '../editor.ts';
import { KIND_LABEL } from '../edit/snapMoveTool.ts';
import { fmtVec } from '../edit/snapMove.ts';
import { h } from './dom.ts';

/**
 * The Selection panel's "Moving" section: shown while a snap move (V) is dragged, updated on every step without
 * re-rendering the inspector. Mount it once next to the inspector's own content.
 */
export function snapMoveSection(editor: Editor): HTMLElement {
  const grid = h('div.snap-moving-grid');
  const section = h('div.section.snap-moving', { hidden: true }, h('h3', {}, 'Moving'), grid,
    h('p.hint', {}, 'Release to drop. One undo step, like a gizmo drag. With several objects selected they move together, by the handle you grabbed.'));
  const mono = (t: string) => h('span.mono', {}, t);
  editor.on('snapmove', () => {
    const m = editor.tools.select.snapMove.info;
    section.hidden = !m;
    if (!m) return;
    grid.replaceChildren(
      h('span.k', {}, 'Holding'), h('span', {}, h('span.caps.from', {}, KIND_LABEL[m.holding]), ' ', mono(fmtVec(m.from))),
      h('span.k', {}, 'Onto'), h('span', {}, h('span.caps.to', {}, KIND_LABEL[m.onto]), ' ', mono(m.onto === 'grid' ? `${editor.grid} · ${fmtVec(m.at)}` : fmtVec(m.at)),
        m.target ? h('span.muted', {}, ` ${m.target}`) : null),
      h('span.k', {}, 'Moves by'), mono(fmtVec(m.delta)),
      h('span.k', {}, 'Ends at'), mono(`${fmtVec(m.endsAt)} · texture lock on`));
  });
  return section;
}
