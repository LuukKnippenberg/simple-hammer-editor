import type { Editor } from '../editor.ts';
import { SELECT_MODES, type Part } from '../edit/parts.ts';
import { materialThumbnail } from '../assets/thumbnails.ts';
import { h } from './dom.ts';

const MODE_HINTS = {
  object: '',
  face: 'Click a face · W moves its plane · X extrudes (drag, click to confirm, Alt extends the brush)',
  edge: 'Click an edge · W/E/R move, turn or scale it; the brush is rebuilt round its corners',
  vertex: 'Click a corner · W/E/R move, turn or scale; the brush is rebuilt round its corners',
} as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const NOUNS = { face: ['face', 'faces'], edge: ['edge', 'edges'], vertex: ['vertex', 'vertices'] } as const;

/** "2 faces of 1 brush". */
export function partSummary(parts: Part[]): string {
  if (!parts.length) return 'Nothing picked';
  const [one, many] = NOUNS[parts[0].kind];
  return `${plural(parts.length, one, many)} of ${plural(new Set(parts.map((p) => p.solid)).size, 'brush', 'brushes')}`;
}

/** Tool options of the Select tool: the selection mode, and extrude settings in face mode. */
export function selectModeRows(editor: Editor, render: () => void): HTMLElement[] {
  const tool = editor.tools.select;
  const mode = editor.selection.mode;
  const seg = h('div.seg', {}, ...SELECT_MODES.map((m) => {
    const b = h('button', { title: `${m.label} selection (Shift+${m.key})`, onclick: () => { tool.setSelectMode(m.mode); render(); } }, m.label);
    b.classList.toggle('active', mode === m.mode);
    return b;
  }));
  const rows: HTMLElement[] = [seg];
  if (mode !== 'object') rows.push(h('div.hint', {}, MODE_HINTS[mode]));
  if (mode === 'face') {
    const ex = tool.extruder;
    const dist = h('input', { type: 'number', value: String(ex.distance), step: String(editor.grid) }) as HTMLInputElement;
    dist.addEventListener('change', () => { ex.distance = parseFloat(dist.value) || 0; dist.blur(); });
    const extend = h('input', { type: 'checkbox', checked: ex.extend }) as HTMLInputElement;
    extend.addEventListener('change', () => { ex.extend = extend.checked; extend.blur(); });
    const faces = editor.selection.parts.length;
    rows.push(
      h('div.row', {},
        h('button', { disabled: !faces, title: 'Drag out the selected faces (X)', onclick: () => tool.startExtrude() }, 'Extrude (X)'),
        dist,
        h('button', { disabled: !faces, title: 'Extrude the selected faces by exactly this distance', onclick: () => ex.run(parseFloat(dist.value) || 0) }, 'By')),
      h('label.check', { title: 'Move the faces so the brush grows, instead of making a new brush (Alt flips it while dragging)' }, extend, ' Extend the brush instead'),
    );
  }
  return rows;
}

/** Inspector section for faces, edges or vertices: what is picked and the faces' materials. */
export function partInspector(editor: Editor): HTMLElement {
  const sel = editor.selection;
  const parts = sel.parts;
  const section = h('div.section', {}, h('h3', {}, 'Selection'), h('div', {}, partSummary(parts)),
    h('p.hint', {}, parts.length ? MODE_HINTS[sel.mode as keyof typeof MODE_HINTS] : `Click ${sel.mode === 'vertex' ? 'a corner' : `a ${sel.mode}`} of a brush. Shift adds, drag a box to pick many. Shift+1 goes back to objects.`));
  const faces = parts.filter((p) => p.kind === 'face');
  if (faces.length) {
    const mats = [...new Set(faces.map((p) => p.solid.sides[p.side]?.material).filter(Boolean))];
    for (const m of mats.slice(0, 6)) {
      const img = h('img') as HTMLImageElement;
      void materialThumbnail(m).then((u) => u && (img.src = u));
      section.append(h('div.current-mat.small', { title: 'Click to use this material', onclick: () => editor.setMaterial(m) }, img, h('span.mat-name', {}, m.toLowerCase())));
    }
    section.append(h('div.row', { style: { marginTop: '6px' } },
      h('button', { onclick: () => editor.tools.select.startExtrude() }, 'Extrude (X)'),
      h('button.primary', {
        title: 'Paint the selected faces with the current material',
        onclick: () => {
          const solids = [...new Set(faces.map((p) => p.solid))];
          const end = editor.history.begin('Paint', solids);
          for (const p of faces) p.solid.sides[p.side].material = editor.currentMaterial.toUpperCase();
          for (const s of solids) s.commit();
          end();
          editor.changed();
        },
      }, `Apply ${editor.currentMaterial.toLowerCase()}`)));
  }
  section.append(h('div.row', { style: { marginTop: '6px' } }, h('button', { onclick: () => editor.tools.select.setSelectMode('object') }, 'Back to objects (Shift+1)')));
  return section;
}
