// Building generator phase 2: facade relief (base course, ledges, columns, quoins, stepped cornice, brackets).
import { launch, driver } from '../browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

/** The phase 1 demo blocks at a detail level, with a low sun for shadows. */
const build = (level) => d.eval(async (level) => {
  const W = window.__editor, ed = W.editor;
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const { buildingsFromSelection } = await import('/src/gen/buildingAction.ts');
  const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
  const Vector3 = ed.camera.position.constructor;
  const doc = VmfDocument.empty();
  const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
  createGroupEntity(doc, sun);
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-32');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '200');
  ed.loadDocument(doc, 'buildings_demo.vmf');
  const V = (x, y, z) => new Vector3(x, y, z);
  doc.addSolid(boxSolid(doc, V(-2048, -1536, -64), V(2048, 1536, 0), 'CONCRETE/CONCRETEFLOOR001A'));
  const blocks = [
    [V(-1792, -1280, 0), V(-512, 0, 64)], [V(-256, -1280, 0), V(768, -704, 64)], [V(-256, -448, 0), V(768, 0, 64)],
    [V(1024, -1280, 0), V(1792, 0, 64)], [V(-1792, 256, 0), V(-768, 1280, 64)],
  ];
  const sel = blocks.map(([a, b]) => doc.addSolid(boxSolid(doc, a, b, 'TOOLS/TOOLSNODRAW')));
  ed.changed();
  ed.selection.set(sel);
  buildingsFromSelection(ed, { seed: 11, minFloors: 3, maxFloors: 6, alleys: false, roofProps: true, detail: level });
  ed.selection.clear();
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
  return doc.entities.filter((e) => e.classname === 'func_detail').reduce((n, e) => n + e.solids.length, 0);
}, level);

const corner = [[-2250, -1850, 330], [-1450, -1050, 420]];
const facade = [[-1950, -1650, 160], [-1250, -1250, 450]];
for (const level of [0, 2, 3]) {
  console.log(`  level ${level}: ${await build(level)} detail brushes`);
  await d.settle(1500);
  await d.view(...corner);
  await d.settle(900);
  await d.shot(`buildings-p2-corner-level${level}`);
  if (level !== 0) {
    await d.view(...facade);
    await d.settle(900);
    await d.shot(`buildings-p2-facade-level${level}`);
  }
}
await build(2);
await d.settle(1500);
await d.view([-2700, -2500, 1500], [-700, -500, 100]);
await d.settle(900);
await d.shot('buildings-p2-overview');
await browser.close();
