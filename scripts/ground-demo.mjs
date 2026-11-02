// Ground painting: turn a floor into terrain, paint dirt paths, raise and smooth a hill, blend roads in.
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
  const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
  const Vector3 = ed.camera.position.constructor;
  const doc = VmfDocument.empty();
  const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
  createGroupEntity(doc, sun);
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-35');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '210');
  ed.loadDocument(doc, 'ground_demo.vmf');
  const floor = doc.addSolid(boxSolid(doc, new Vector3(-2048, -2048, -64), new Vector3(2048, 2048, 0), 'CONCRETE/CONCRETEFLOOR001A'));
  ed.changed();
  ed.selection.set([floor]);
  W.lighting.setEnabled(true);
  ed.emit('lighting');
});
await d.settle(800);
await d.view([-2300, -3300, 2600], [0, -200, 0]);
await d.key('8');
await d.settle(300);
await page.click('.tool-options button:has-text("into terrain")');
await d.settle(1000);
const setMode = (mode, radius, strength) => d.eval(([m, r, s]) => {
  const ed = window.__editor.editor, t = ed.tools.tools.ground;
  t.mode = m; t.radius = r; t.strength = s;
  ed.emit('toolchange');
}, [mode, radius, strength]);

// A hill in the north-east, smoothed.
await setMode('raise', 448, 0.6);
for (let k = 0; k < 6; k++) await d.drag([900, 900, 0], [1100, 1000, 0], { steps: 8 });
await setMode('smooth', 512, 0.8);
await d.drag([700, 700, 0], [1300, 1300, 0], { steps: 16 });
// Dirt paths worn across the grass.
await setMode('paint', 112, 0.5);
await d.drag([-1800, -400, 0], [-200, 200, 0], { steps: 30 });
await d.drag([-200, 200, 0], [800, 1000, 120], { steps: 30 });
await d.drag([-1400, -1600, 0], [-1000, -300, 0], { steps: 20 });
await d.settle(600);
await d.shot('ground-painted');

// A road across, a dirt track, then blend both into the ground.
await d.key('7');
await d.eval(() => window.__editor.editor.tools.tools.road.setStyle('asphalt'));
for (const p of [[-2000, -1300, 0], [-200, -1300, 0], [600, -500, 0], [600, -2000, 0]]) await d.click(p);
await d.key('Enter');
await d.settle(400);
await d.eval(() => window.__editor.editor.tools.tools.road.setStyle('dirt'));
for (const p of [[600, -1100, 0], [1500, -700, 0], [1900, 300, 0]]) await d.click(p);
await d.key('Enter');
await d.settle(400);
await d.key('1');
const blended = await d.eval(async () => {
  const ed = window.__editor.editor;
  const { roadEntities, blendRoadIntoGround } = await import('/src/gen/roadAction.ts');
  return roadEntities(ed.doc).map((r) => blendRoadIntoGround(ed, r.road));
});
console.log('  blended patches per road', JSON.stringify(blended));
await d.eval(() => window.__editor.editor.selection.clear());
await d.settle(800);
await d.shot('ground-overview');
await d.view([-900, -2300, 650], [-500, -1300, 0]);
await d.settle(700);
await d.shot('ground-road-verge');
await d.view([700, -1700, 500], [1500, -700, 0]);
await d.settle(700);
await d.shot('ground-dirt-track');
await d.view([-300, -600, 900], [900, 900, 200]);
await d.settle(700);
await d.key('8');
await setMode('paint', 160, 0.4);
const [hx, hy] = await d.project([400, 500, 60]);
await page.mouse.move(hx, hy, { steps: 3 });
await d.settle(400);
await d.shot('ground-hill-tool');
// A compilable copy for the vbsp check.
console.log('  ', JSON.stringify(await d.eval(async () => {
  const ed = window.__editor.editor;
  const pre = await import('/src/edit/preflight.ts');
  for (const id of ['shell', 'spawn']) { const c = pre.runChecks(ed).find((c) => c.id === id); if (!c.ok) c.fix(); }
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { applyMapSettings } = await import('/src/lw/mapSettings.ts');
  const copy = VmfDocument.parse(ed.doc.serialize());
  applyMapSettings(copy);
  const r = await fetch('/api/autosave?name=she_ground_test.vmf', { method: 'POST', headers: { 'X-SHE': '1' }, body: copy.serialize() });
  return { patches: ed.doc.worldEntity.solids.filter((s) => s.isDisplacement).length, saved: r.ok };
})));
await browser.close();
