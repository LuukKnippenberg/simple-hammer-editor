import type { Editor } from '../editor.ts';
import { CELL, CELL_INFO, Cell, emptyLayout, generateMap, randomLayout, type Layout, type Theme } from '../gen/layout.ts';
import { ARCHITECTURES, type ArchitectureName } from '../gen/buildings.ts';
import { h, toast } from './dom.ts';

type Symmetry = 'none' | 'mirror' | 'rotate';

/** "Generate map" dialog: paint a coarse layout on a grid, then turn it into a full map. */
export function mountGeneratorDialog(editor: Editor): { open(): void; generate(): void; dialog: HTMLElement } {
  const backdrop = h('div.modal-backdrop', { hidden: true });
  const dialog = h('div.modal.wide');
  backdrop.append(dialog);
  document.body.append(backdrop);
  const close = () => (backdrop.hidden = true);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  let layout: Layout = emptyLayout(24, 24);
  let brush: Cell = Cell.Road;
  let brushSize = 1;
  let symmetry: Symmetry = 'rotate';
  const PX = 22;

  const canvas = h('canvas.layout-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const theme = h('select', {}, h('option', { value: 'rural' }, 'Rural (grass, trees)'), h('option', { value: 'city' }, 'City (concrete, buildings)')) as HTMLSelectElement;
  const size = h('select', {}, ...[16, 24, 32].map((n) => h('option', { value: String(n), selected: n === 24 }, `${n}×${n} cells (${(n * CELL).toLocaleString()} units)`))) as HTMLSelectElement;
  const seed = h('input', { type: 'number', value: '1337' }) as HTMLInputElement;
  const arch = h('select', { title: 'Kind of buildings on city blocks' }, ...Object.entries(ARCHITECTURES).map(([k, a]) => h('option', { value: k }, a.label))) as HTMLSelectElement;
  const high = h('select', {}, ...[128, 192, 256].map((n) => h('option', { value: String(n), selected: n === 192 }, `${n} units`))) as HTMLSelectElement;
  const sym = h('select', {}, h('option', { value: 'rotate' }, 'Rotational (2 players)'), h('option', { value: 'mirror' }, 'Mirror left/right'), h('option', { value: 'none' }, 'None')) as HTMLSelectElement;
  const brushSel = h('select', {}, ...[1, 2, 3].map((n) => h('option', { value: String(n) }, `${n}×${n}`))) as HTMLSelectElement;
  const palette = h('div.palette');

  const draw = () => {
    canvas.width = layout.w * PX;
    canvas.height = layout.h * PX;
    for (let y = 0; y < layout.h; y++) for (let x = 0; x < layout.w; x++) {
      ctx.fillStyle = CELL_INFO[layout.cells[y * layout.w + x]].color;
      // Row 0 is the map's south edge: draw it at the bottom so the canvas matches the top view.
      ctx.fillRect(x * PX, (layout.h - 1 - y) * PX, PX, PX);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i <= layout.w; i++) { ctx.beginPath(); ctx.moveTo(i * PX + 0.5, 0); ctx.lineTo(i * PX + 0.5, canvas.height); ctx.stroke(); }
    for (let i = 0; i <= layout.h; i++) { ctx.beginPath(); ctx.moveTo(0, i * PX + 0.5); ctx.lineTo(canvas.width, i * PX + 0.5); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    if (symmetry !== 'none') {
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      if (symmetry === 'mirror') { ctx.moveTo(canvas.width / 2, 0); ctx.lineTo(canvas.width / 2, canvas.height); }
      else { ctx.moveTo(0, canvas.height); ctx.lineTo(canvas.width, 0); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  const paint = (cx: number, cy: number, value: Cell) => {
    const set = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= layout.w || y >= layout.h) return;
      layout.cells[y * layout.w + x] = value;
      if (symmetry === 'mirror') layout.cells[y * layout.w + (layout.w - 1 - x)] = value;
      if (symmetry === 'rotate') layout.cells[(layout.h - 1 - y) * layout.w + (layout.w - 1 - x)] = value;
    };
    const r = brushSize - 1;
    for (let dy = 0; dy <= r; dy++) for (let dx = 0; dx <= r; dx++) set(cx + dx, cy + dy);
    draw();
  };

  let painting: Cell | null = null;
  const cellFrom = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * layout.w), layout.h - 1 - Math.floor(((e.clientY - r.top) / r.height) * layout.h)];
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    painting = e.button === 2 ? Cell.Ground : brush;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = cellFrom(e);
    paint(x, y, painting);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (painting === null) return;
    const [x, y] = cellFrom(e);
    paint(x, y, painting);
  });
  canvas.addEventListener('pointerup', () => (painting = null));

  const renderPalette = () => {
    palette.replaceChildren(...(Object.keys(CELL_INFO).map(Number) as Cell[]).map((c) =>
      h('button.pal' + (c === brush ? '.active' : '') as 'button', { onclick: () => { brush = c; renderPalette(); } },
        h('span.swatch', { style: { background: CELL_INFO[c].color } }), CELL_INFO[c].label)));
  };

  const random = () => {
    const n = parseInt(size.value, 10);
    layout = randomLayout(n, n, theme.value as Theme, parseInt(seed.value, 10) || 1);
    draw();
  };
  const pois = h('input', { type: 'number', value: '2', min: '0', max: '8', title: 'Points of interest in open ground, in mirrored pairs (one pair gets capture points)' }) as HTMLInputElement;
  const generate = () => {
    if (editor.dirty && !confirm('Replace the current map with the generated one? Unsaved changes are lost.')) return;
    const t0 = performance.now();
    const doc = generateMap(layout, { theme: theme.value as Theme, seed: parseInt(seed.value, 10) || 1, highGround: parseInt(high.value, 10), architecture: arch.value as ArchitectureName, pois: Math.max(0, Math.min(8, parseInt(pois.value, 10) || 0)) });
    editor.loadDocument(doc, `generated_${theme.value}_${seed.value}.vmf`, '');
    editor.dirty = true;
    editor.emit('change');
    close();
    toast(editor.container, `Generated ${doc.allSolids().length} brushes and ${doc.entities.length} entities in ${Math.round(performance.now() - t0)} ms`);
  };

  size.addEventListener('change', () => { const n = parseInt(size.value, 10); layout = emptyLayout(n, n); draw(); });
  sym.addEventListener('change', () => { symmetry = sym.value as Symmetry; draw(); });
  brushSel.addEventListener('change', () => (brushSize = parseInt(brushSel.value, 10)));

  dialog.append(
    h('div.modal-head', {}, h('b', {}, 'Generate a map from a layout'), h('button', { onclick: close }, '✕')),
    h('div.gen-body', {},
      h('div', {}, canvas, h('p.hint', {}, 'Left drag paints, right drag erases. Each cell is 256 units; north is up.')),
      h('div.gen-side', {},
        h('div.section', {}, h('h3', {}, 'Paint'), palette, h('div.row', {}, h('label', {}, 'Brush'), brushSel), h('div.row', {}, h('label', {}, 'Symmetry'), sym)),
        h('div.section', {}, h('h3', {}, 'Map'),
          h('div.row', {}, h('label', {}, 'Theme'), theme),
          h('div.row', {}, h('label', {}, 'Buildings'), arch),
          h('div.row', {}, h('label', {}, 'Size'), size),
          h('div.row', {}, h('label', {}, 'High ground'), high),
          h('div.row', {}, h('label', {}, 'Seed'), seed),
          h('div.row', {}, h('label', {}, 'POIs'), pois)),
        h('div.row', {}, h('button', { onclick: random }, '🎲 Random layout'), h('button', { onclick: () => { layout = emptyLayout(layout.w, layout.h); draw(); } }, 'Clear')),
        h('button.primary.big', { onclick: generate }, '⚙ Generate map'))),
  );
  renderPalette();
  random();

  return {
    open() { backdrop.hidden = false; draw(); },
    generate,
    dialog,
  };
}
