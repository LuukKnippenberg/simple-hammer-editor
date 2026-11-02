// Building generator phase 3: roofs (hip, mansard with dormers, gable, curved, flat), chimneys.
import { launch, driver } from '../browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

/** Demo blocks with a low sun; `roofs` picks one roof kind for all buildings or a mix. */
const build = (roofs, seed = 11) => d.eval(async ({ roofs, seed }) => {
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
  buildingsFromSelection(ed, { seed, minFloors: 3, maxFloors: 6, alleys: false, roofProps: true, detail: 2, roofs });
  ed.selection.clear();
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
  return doc.entities.filter((e) => e.classname === 'func_detail').reduce((n, e) => n + e.solids.length, 0);
}, { roofs, seed });

const shots = process.argv[2] ? [process.argv[2]] : ['mixed', 'mansard', 'hip', 'curved', 'gable'];
for (const roofs of shots) {
  console.log(`  ${roofs}: ${await build(roofs)} detail brushes`);
  await d.settle(1500);
  await d.view([-2700, -2500, 1500], [-700, -500, 100]);
  await d.settle(900);
  await d.shot(`buildings-p3-${roofs}`);
  if (roofs === 'mixed') {
    await d.view([-2300, -1800, 900], [-1300, -900, 450]);
    await d.settle(900);
    await d.shot('buildings-p3-mixed-close');
    await d.view([2400, 900, 700], [1450, -400, 450]);
    await d.settle(900);
    await d.shot('buildings-p3-mixed-east');
  }
}
await browser.close();
