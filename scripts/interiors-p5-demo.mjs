// Interior phase 5: enterable houses from the Building panel next to solid ones, the village and slum
// architectures, the panel, and a generated rural map with hamlets of houses.
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
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-45');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '210');
  ed.loadDocument(doc, 'interiors_p5.vmf');
  const V = (x, y, z) => new Vector3(x, y, z);
  doc.addSolid(boxSolid(doc, V(-3072, -1536, -64), V(3072, 1536, 0), 'NATURE/BLENDDIRTGRASS01'));
  const runs = [
    ['village', undefined, -2944, 1792, 640],
    ['slum', undefined, -896, 1152, 896],
    ['sheds', 'some', 512, 1152, 1024],
    ['brick', 'some', 1920, 896, 1024],
  ];
  const out = [];
  runs.forEach(([name, interiors, x0, w, h], i) => {
    const s = doc.addSolid(boxSolid(doc, V(x0, -h / 2, 0), V(x0 + w, h / 2, 64), 'TOOLS/TOOLSNODRAW'));
    ed.changed();
    ed.selection.set([s]);
    const a = ARCHITECTURES[name];
    const n = buildingsFromSelection(ed, { seed: 41 + i * 3, minFloors: a.floors[0], maxFloors: Math.min(2, a.floors[1]), alleys: true, roofProps: true, detail: 2, architecture: name, interiors });
    out.push([name, x0 + w / 2, n]);
  });
  ed.selection.clear();
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
  return out;
});
console.log(JSON.stringify(blocks));
await d.settle(3000);
await d.view([-200, -3400, 3000], [-200, 0, 0]);
await d.settle(1200);
await d.shot('interiors-p5-overview');
const rts = (x, y, dist) => d.view([x, y - dist * Math.cos((65 * Math.PI) / 180), dist * Math.sin((65 * Math.PI) / 180)], [x, y, 0]);
for (const [name, x] of blocks) {
  await rts(x, 0, 1500);
  await d.settle(1200);
  await d.shot(`interiors-p5-${name}`);
}

// The Building panel with a block selected.
await d.eval(async () => {
  const W = window.__editor, ed = W.editor;
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const Vector3 = ed.camera.position.constructor;
  const s = ed.doc.addSolid(boxSolid(ed.doc, new Vector3(-1024, 1600, 0), new Vector3(0, 2000, 64), 'TOOLS/TOOLSNODRAW'));
  ed.changed();
  ed.selection.set([s]);
  W.tabs.show('Selection');
});
await d.settle(600);
await page.locator('h3:text("Generate buildings")').scrollIntoViewIfNeeded();
await page.locator('label:text("Wide doors")').scrollIntoViewIfNeeded();
await d.view([-600, 700, 1300], [-500, 1800, 0]);
await d.settle(600);
await d.shot('interiors-p5-panel');

// A generated rural map: hamlets of village houses between the woods.
await d.eval(async () => {
  const W = window.__editor, ed = W.editor;
  const { generateMap, randomLayout } = await import('/src/gen/layout.ts');
  const doc = generateMap(randomLayout(24, 24, 'rural', 7), { theme: 'rural', seed: 7, highGround: 192 });
  ed.loadDocument(doc, 'interiors_rural.vmf');
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
});
await d.settle(5000);
const houses = await d.eval(() => {
  const ed = window.__editor.editor;
  // The cage lamps mark the enterable houses.
  const lamps = ed.doc.entities.filter((e) => e.get('model')?.includes('cagelight')).map((e) => e.origin);
  return lamps.length ? [lamps.reduce((s, p) => s + p.x, 0) / lamps.length, lamps.reduce((s, p) => s + p.y, 0) / lamps.length, lamps.length] : null;
});
console.log('rural lamps', JSON.stringify(houses));
await d.view([2400, -2600, 6400], [2600, 2400, 0]);
await d.settle(1500);
await d.shot('interiors-p5-rural-map');
if (houses) {
  const lamp = await d.eval(() => {
    const ed = window.__editor.editor;
    const e = ed.doc.entities.find((x) => x.get('model')?.includes('cagelight'));
    return [e.origin.x, e.origin.y];
  });
  await rts(lamp[0], lamp[1], 1600);
  await d.settle(1500);
  await d.shot('interiors-p5-rural-hamlet');
}
await browser.close();
