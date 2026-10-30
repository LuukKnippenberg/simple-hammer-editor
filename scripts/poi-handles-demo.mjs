// POI handles: generates a playground on an empty map, selects it by clicking one of its props, then moves,
// resizes and turns it with the mouse and keyboard, and undoes the move. Screenshots poi-handles-*.png.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');
await page.click('#topbar button:has-text("New")');
await d.settle();

const state = () => d.eval(async () => {
  const ed = window.__editor.editor;
  const { poiOf } = await import('/src/gen/poi/registry.ts');
  const { poiMembers } = await import('/src/gen/poi/action.ts');
  const detail = ed.doc.entities.find((e) => poiOf(e));
  const spec = poiOf(detail).spec;
  const sel = [...ed.selection.entities].map((e) => e.classname);
  const panel = document.body.textContent ?? '';
  return { rect: spec.rect, z: spec.z, rotation: spec.rotation, selected: sel, panelShowsPoi: panel.includes('Regenerate'), parts: poiMembers(ed, spec.uid).entities.length };
});

await d.eval(async () => {
  const ed = window.__editor.editor;
  const { poiType } = await import('/src/gen/poi/registry.ts');
  const { generatePoi } = await import('/src/gen/poi/action.ts');
  generatePoi(ed, poiType('playground'), { x0: -512, y0: -384, x1: 512, y1: 384 }, 0, { seed: 7 });
  ed.selection.clear();
});
await d.view([-900, -1300, 1100], [0, 0, 0]);
await d.settle(1200);
await d.shot('poi-handles-1-handles');
console.log('generated', await state());

// Click one of the playground's props: the whole POI gets selected by its handle.
const prop = await d.eval(() => window.__editor.editor.doc.entities.find((e) => e.classname.startsWith('prop_') && e.get('she_poi_id')).origin.toArray());
await d.click(prop);
await d.settle(400);
await d.shot('poi-handles-2-selected');
console.log('clicked a prop', await state());

// Move: drag the gizmo's x arrow.
await d.key('m');
await d.settle(200);
let [hx, hy] = await d.eval(() => window.__editor.gizmoHandle('x'));
await d.drag([hx, hy], [hx + 220, hy], { screen: true, steps: 20 });
await d.settle(1000);
await d.shot('poi-handles-3-moved');
const moved = await state();
console.log('moved', moved);

// Resize: drag the gizmo's y handle outwards.
await d.key('r');
await d.settle(200);
[hx, hy] = await d.eval(() => window.__editor.gizmoHandle('y'));
await d.drag([hx, hy], [hx + 90, hy - 90], { screen: true, steps: 20 });
await d.settle(1000);
await d.shot('poi-handles-4-resized');
console.log('resized', await state());

// Turn a quarter turn.
await d.key(',');
await d.settle(1000);
await d.shot('poi-handles-5-turned');
console.log('turned', await state());

// Undo three times: turn, resize, move.
for (let i = 0; i < 3; i++) await d.key('Control+z');
await d.settle(800);
console.log('after 3 undos', await state());

// Duplicate with Ctrl+D, then delete the copy with Delete.
const count = () => d.eval(async () => {
  const { poiOf } = await import('/src/gen/poi/registry.ts');
  const ed = window.__editor.editor;
  return { pois: ed.doc.entities.filter((e) => poiOf(e)).length, handles: ed.doc.entities.filter((e) => e.classname === 'she_poi_handle').length, entities: ed.doc.entities.length };
});
await d.key('Control+d');
await d.settle(1000);
await d.view([-600, -1700, 1500], [700, 0, 0]);
await d.settle(800);
await d.shot('poi-handles-6-duplicated');
console.log('duplicated', await count());
await d.key('Delete');
await d.settle(600);
console.log('deleted the copy', await count());
await browser.close();
