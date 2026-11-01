// Generate menu: opens the menu, places a building block by dragging in the top view, tunes it, then places a
// single Building and a Simple interior building, and fills a selected block brush from the Selection tab's
// Generate box. Screenshots docs/screenshots/generate-*.png. Run against a dev server: EDITOR_URL=http://localhost:5204/
import { poiSession, rtsView } from './poi-common.mjs';
import { join } from 'node:path';
import { shotsDir } from './browser.mjs';

const { browser, page, d } = await poiSession('generate_scratch.vmf');
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

const state = () => d.eval(async () => {
  const ed = window.__editor.editor;
  const { blockOf } = await import('/src/gen/buildingStore.ts');
  const t = ed.tools.tools.generate;
  return {
    tool: ed.tools.current.name, session: t.session ? `${t.session.id}/${t.session.step}: ${t.session.summary}` : null,
    blocks: ed.doc.entities.filter((e) => blockOf(e)).map((e) => `${blockOf(e).options.layout}:${blockOf(e).rect.x1 - blockOf(e).rect.x0}`),
    undo: ed.history.undoLabel, depth: ed.history.depth, status: ed.status,
  };
});
const top = (cx, cy, zoom) => d.eval(([cx, cy, zoom]) => {
  const ed = window.__editor.editor;
  ed.setView3dOrTop('top');
  ed.topView.center.set(cx, cy);
  ed.topView.zoom = zoom;
  ed.topView.apply();
}, [cx, cy, zoom]);
const to3d = () => d.eval(() => window.__editor.editor.setView3dOrTop('3d'));
const railClip = async (name) => {
  const r = await page.evaluate(() => { const b = document.querySelector('#toolbar').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  await page.screenshot({ path: join(shotsDir, `${name}.png`), clip: { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 520) } });
  console.log(`saved ${name}.png`);
};

await rtsView(d, [0, 0, 0], 2600);
await d.settle(600);
await railClip('generate-5-rail-idle');

// 1. The menu, Building block hovered.
await d.key('g');
await page.hover('.gen-item[data-gen="block"]');
await d.shot('generate-1-menu');

// 2. Pick Building block, drag its footprint in the top view (the shot while the mouse is held).
await d.key('2');
await top(0, 0, 1100);
await d.settle(400);
await railClip('generate-5-rail-active');
await d.drag([-768, -512, 0], [768, 512, 0], { steps: 16, hold: async () => { await d.shot('generate-2-place'); console.log('placing', await state()); } });
await d.settle(1500);
console.log('placed', await state());

// 3. Tune: change the architecture (it rebuilds in place, still one undo step), then look at it in 3D.
await page.selectOption('.gen-panel select[title^="Kind of buildings"]', 'tenement');
await d.settle(1500);
console.log('tuned', await state());
await to3d();
await rtsView(d, [0, 0, 0], 2600);
await d.settle(1200);
await d.shot('generate-3-tune');

// Esc steps back to Place; Enter is only Done in Tune, so finish with the menu's Done instead: re-select it first.
await d.key('Escape');
console.log('after Esc', await state());
await d.key('Escape');
console.log('after 2nd Esc (menu)', await state(), await page.evaluate(() => !document.querySelector('.gen-menu').hidden));
await d.key('Escape');

// 4. A single Building and a Simple interior building next to the block.
await top(0, 0, 1800);
await d.settle(300);
await d.key('g');
await d.key('1');
await d.drag([1088, -384, 0], [1600, 128, 0], { steps: 10 });
await d.settle(1200);
console.log('building', await state());
await d.key('Enter');
await d.key('g');
await d.key('3');
await d.drag([1088, 384, 0], [1536, 768, 0], { steps: 10 });
await d.settle(1500);
console.log('house', await state());
await to3d();
await rtsView(d, [1300, 150, 0], 2300);
await d.settle(1500);
await d.shot('generate-4-building-and-house');
await d.key('Enter');
console.log('done', await state());

// 6. A block brush selected: the Selection tab's Generate box; then fill it with a building block from the menu.
await d.eval(async () => {
  const ed = window.__editor.editor;
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const Vector3 = ed.camera.position.constructor;
  const s = ed.doc.addSolid(boxSolid(ed.doc, new Vector3(-1792, -768, 0), new Vector3(-1088, 256, 64), 'DEV/DEV_MEASUREGENERIC01'));
  ed.history.added('Add block', [s]);
  ed.changed();
  ed.selection.set([s]);
  window.__editor.tabs.show('Selection');
});
await rtsView(d, [-1400, -250, 0], 1800);
await d.settle(800);
await d.shot('generate-6-selection-box');
await page.click('#sidebar .gen-box button');
await d.key('2');
await d.settle(1500);
console.log('filled', await state());
await d.shot('generate-7-filled-tune');
await d.key('Enter');

// Undo takes back the whole fill in one step (the brush comes back).
await d.eval(() => window.__editor.editor.undo());
await d.settle(600);
console.log('undone', await state(), await d.eval(() => window.__editor.editor.selection.solids.size));

// Point of interest straight from P: pick a type in the panel, drag it, turn it in Tune (rebuilt in place), done.
await top(-1500, 1300, 1400);
await d.settle(300);
await d.key('p');
await page.selectOption('.gen-panel select[title^="What to build"]', 'city:playground');
await d.drag([-1900, 1000, 0], [-1100, 1600, 0], { steps: 10 });
await d.settle(1500);
console.log('poi', await state());
await page.click('.gen-panel .seg button:has-text("90°")');
await d.settle(1200);
console.log('poi turned', await state());
await to3d();
await rtsView(d, [-1500, 1300, 0], 1800);
await d.settle(1200);
await d.shot('generate-8-poi-tune');
await d.key('Enter');

// A road from 7: two points, Enter builds it, a wider road rebuilds in place, Delete takes it back.
await top(0, 1600, 1400);
await d.settle(300);
await d.key('7');
await d.click([-1024, 1280, 0]);
await d.click([1024, 1280, 0]);
await d.key('Enter');
await d.settle(800);
console.log('road', await state());
await page.fill('.gen-panel .row:has(label:text-is("Width")) input', '384');
await page.press('.gen-panel .row:has(label:text-is("Width")) input', 'Enter');
await d.settle(800);
console.log('road wider', await state());
await page.click('.gen-panel button:has-text("Delete")');
await d.settle(600);
console.log('road deleted', await state());
await d.key('Escape');
await d.key('Escape');

// A powerline from 9, its poles changed in Tune; and 4 opens the room designer.
await d.key('9');
await d.click([-1024, 1900, 0]);
await d.click([1024, 1900, 0]);
await d.key('Enter');
await d.settle(800);
console.log('powerline', await state());
await page.selectOption('.gen-panel .row:has(label:text-is("Poles")) select', { index: 1 });
await d.settle(800);
console.log('powerline poles', await state());
await d.key('Enter');
await d.key('g');
await d.key('4');
await d.settle(500);
console.log('designer open', await page.evaluate(() => !document.querySelector('.modal.rooms')?.parentElement?.hidden), await state());
await d.key('Escape');

console.log(errors.length ? `console errors:\n  ${errors.join('\n  ')}` : 'no console errors');
await browser.close();
