// Building generator phase 4: corner towers with domes, bells, onions and spires.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

const towers = await d.eval(async () => {
  const W = window.__editor, ed = W.editor;
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { boxSolid, solidBounds } = await import('/src/edit/brushes.ts');
  const { buildingsFromSelection } = await import('/src/gen/buildingAction.ts');
  const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
  const Vector3 = ed.camera.position.constructor;
  const doc = VmfDocument.empty();
  const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
  createGroupEntity(doc, sun);
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-38');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '210');
  ed.loadDocument(doc, 'buildings_demo.vmf');
  const V = (x, y, z) => new Vector3(x, y, z);
  doc.addSolid(boxSolid(doc, V(-2560, -2048, -64), V(2560, 2048, 0), 'CONCRETE/CONCRETEFLOOR001A'));
  // Six blocks, corners mostly rounded so towers show up.
  const blocks = [
    [V(-2304, -1792, 0), V(-1024, -512, 64)], [V(-768, -1792, 0), V(512, -768, 64)], [V(768, -1792, 0), V(2048, -512, 64)],
    [V(-2304, -256, 0), V(-1024, 1024, 64)], [V(-768, -512, 0), V(512, 1024, 64)], [V(768, -256, 0), V(2048, 1024, 64)],
  ];
  const sel = blocks.map(([a, b]) => doc.addSolid(boxSolid(doc, a, b, 'TOOLS/TOOLSNODRAW')));
  ed.changed();
  ed.selection.set(sel);
  buildingsFromSelection(ed, { seed: 41, minFloors: 3, maxFloors: 6, alleys: false, roofProps: true, detail: 2, corners: 'mixed' });
  ed.selection.clear();
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
  // Finials: the thin tall boxes on top of each tower.
  const det = doc.entities.filter((e) => e.classname === 'func_detail').flatMap((e) => e.solids);
  return det.map((s) => solidBounds(s)).filter((b) => b.max.x - b.min.x <= 7 && b.max.y - b.min.y <= 7 && b.max.z - b.min.z >= 40)
    .map((b) => [Math.round((b.min.x + b.max.x) / 2), Math.round((b.min.y + b.max.y) / 2), Math.round(b.max.z)]);
});
console.log(`  ${towers.length} towers`, JSON.stringify(towers));
await d.settle(2000);
await d.view([-3400, -3200, 2100], [-300, -300, 200]);
await d.settle(900);
await d.shot('buildings-p4-overview');
// Close-ups of the first towers, from outside the block towards the tower.
let n = 0;
for (const [x, y, z] of towers.slice(0, 4)) {
  // From outside the district, looking back at the tower.
  const dx = x, dy = y + 384, len = Math.hypot(dx, dy) || 1;
  await d.view([x + (dx / len) * 1300, y + (dy / len) * 1300, z * 0.95], [x, y, z * 0.7]);
  await d.settle(900);
  await d.shot(`buildings-p4-tower${++n}`);
}
await browser.close();
