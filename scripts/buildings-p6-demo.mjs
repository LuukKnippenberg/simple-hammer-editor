// Building generator phase 6: architectures (tenements, Soviet blocks, brick houses, sheds), colours, weathering, panel.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

const blocks = await d.eval(async () => {
  const W = window.__editor, ed = W.editor;
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const { buildingsFromSelection } = await import('/src/gen/buildingAction.ts');
  const { ARCHITECTURES } = await import('/src/gen/buildings.ts');
  const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
  const Vector3 = ed.camera.position.constructor;
  const doc = VmfDocument.empty();
  const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
  createGroupEntity(doc, sun);
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-38');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '210');
  ed.loadDocument(doc, 'architectures_demo.vmf');
  const V = (x, y, z) => new Vector3(x, y, z);
  doc.addSolid(boxSolid(doc, V(-3584, -1280, -64), V(3584, 1280, 0), 'CONCRETE/CONCRETEFLOOR001A'));
  const names = ['tenement', 'soviet', 'brick', 'sheds', 'mixed'];
  const out = [];
  names.forEach((name, i) => {
    const x0 = -3328 + i * 1408;
    const s = doc.addSolid(boxSolid(doc, V(x0, -512, 0), V(x0 + 1152, 512, 64), 'TOOLS/TOOLSNODRAW'));
    ed.changed();
    ed.selection.set([s]);
    const a = ARCHITECTURES[name];
    buildingsFromSelection(ed, { seed: 77, minFloors: a.floors[0], maxFloors: a.floors[1], alleys: false, roofProps: true, detail: 2, architecture: name });
    out.push([name, x0 + 576]);
  });
  ed.selection.clear();
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
  return out;
});
await d.settle(2500);
await d.view([-600, -4300, 2600], [-200, 0, 200]);
await d.settle(900);
await d.shot('buildings-p6-architectures');
for (const [name, x] of blocks.slice(0, 4)) {
  await d.view([x - 900, -1500, 900], [x, 0, 300]);
  await d.settle(900);
  await d.shot(`buildings-p6-${name}`);
}
// The Building panel with a block selected.
await d.eval(async () => {
  const W = window.__editor, ed = W.editor;
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const Vector3 = ed.camera.position.constructor;
  const s = ed.doc.addSolid(boxSolid(ed.doc, new Vector3(-1024, 768, 0), new Vector3(0, 1152, 64), 'TOOLS/TOOLSNODRAW'));
  ed.changed();
  ed.selection.set([s]);
  W.tabs.show('Selection');
});
await d.settle(600);
await page.evaluate(() => document.querySelector('.tab-body > div:not([hidden]) h3:nth-of-type(1)')?.closest('div')?.scrollTo?.(0, 0));
await page.locator('h3:text("Generate buildings")').scrollIntoViewIfNeeded();
await d.view([-600, -1200, 1300], [-500, 900, 0]);
await d.settle(600);
await d.shot('buildings-p6-panel');
await browser.close();
