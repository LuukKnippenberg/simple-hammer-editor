// Phase "roads": the road tool used with the mouse, crossings, styles, and sketch roads.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

await d.eval(async () => {
  const W = window.__editor, ed = W.editor;
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const { buildingsFromSelection } = await import('/src/gen/buildingAction.ts');
  const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
  const Vector3 = ed.camera.position.constructor;
  const doc = VmfDocument.empty();
  const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
  createGroupEntity(doc, sun);
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-40');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '210');
  ed.loadDocument(doc, 'roads_demo.vmf');
  const V = (x, y, z) => new Vector3(x, y, z);
  doc.addSolid(boxSolid(doc, V(-2560, -2560, -64), V(2560, 2560, 0), 'NATURE/BLENDGRASSGRAVEL002B'));
  // Two blocks of buildings for the roads to run past.
  const blocks = [[V(-2304, 1216, 0), V(-1216, 2304, 64)], [V(1216, -2304, 0), V(2304, -1344, 64)]].map(([a, b]) => doc.addSolid(boxSolid(doc, a, b, 'TOOLS/TOOLSNODRAW')));
  ed.changed();
  ed.selection.set(blocks);
  buildingsFromSelection(ed, { seed: 5, minFloors: 3, maxFloors: 5, alleys: false, roofProps: true, architecture: 'tenement', street: false });
  ed.selection.clear();
  W.lighting.setEnabled(true);
  ed.emit('lighting');
});
await d.settle(1500);
await d.view([-2200, -3200, 3000], [0, -100, 0]);
await d.settle(600);

const road = async (style, pts) => {
  await d.eval((s) => window.__editor.editor.tools.tools.road.setStyle(s), style);
  for (const p of pts) await d.click(p);
  await d.key('Enter');
  await d.settle(300);
};
await d.key('7');
// A main road with a rounded bend, a tram street crossing it, a cobbled side street and a dirt track.
await road('asphalt', [[-2400, -800, 0], [0, -800, 0], [800, 0, 0], [800, 2400, 0]]);
await road('tram', [[-2400, 800, 0], [2400, 800, 0]]);
await road('cobble', [[-1000, -2400, 0], [-1000, -800, 0]]);
// Mid-draw: two points placed, the cursor showing the third.
await d.eval((s) => { const ed = window.__editor.editor; ed.selection.clear(); ed.tools.tools.road.setStyle(s); }, 'dirt');
await d.view([900, -1700, 1500], [1900, 300, 0]);
await d.settle(400);
await d.click([1600, -400, 0]);
await d.click([2400, 200, 0]);
const [hx, hy] = await d.project([2200, 1600, 0]);
await page.mouse.move(hx, hy, { steps: 4 });
await d.settle(400);
await d.shot('roads-drawing');
await d.key('Escape');
await d.view([-2200, -3200, 3000], [0, -100, 0]);
await d.settle(300);
await road('dirt', [[1600, -400, 0], [2400, 200, 0], [2200, 1600, 0]]);
await d.key('1');
await d.eval(() => window.__editor.editor.selection.clear());
await d.settle(800);
await d.shot('roads-overview');
await d.view([-1500, -1500, 650], [-900, -800, 0]);
await d.settle(700);
await d.shot('roads-junction');
await d.view([300, 250, 560], [800, 800, 0]);
await d.settle(700);
await d.shot('roads-crossing');
await d.view([-300, -1500, 300], [600, -400, 80]);
await d.settle(700);
await d.shot('roads-bend');
// Select the main road: its panel in the inspector.
await d.key('1');
await d.view([-2200, -3200, 3000], [0, -100, 0]);
await d.settle(500);
await d.click([-1800, -800, 4]);
await d.settle(500);
await d.shot('roads-panel');
const stats = await d.eval(async () => {
  const ed = window.__editor.editor;
  const roads = ed.doc.entities.filter((e) => e.get('she_road'));
  // A compilable copy: sky shell and spawn added the way the compile dialog's fixes do.
  const pre = await import('/src/edit/preflight.ts');
  for (const id of ['shell', 'spawn']) { const c = pre.runChecks(ed).find((c) => c.id === id); if (!c.ok) c.fix(); }
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { applyMapSettings } = await import('/src/lw/mapSettings.ts');
  const copy = VmfDocument.parse(ed.doc.serialize());
  applyMapSettings(copy);
  const r = await fetch('/api/autosave?name=she_roads_test.vmf', { method: 'POST', body: copy.serialize() });
  return { roads: roads.length, brushes: roads.reduce((n, e) => n + e.solids.length, 0), saved: r.ok };
});
console.log('  ', JSON.stringify(stats));
await browser.close();
