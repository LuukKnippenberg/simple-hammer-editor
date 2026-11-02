// Building generator phase 5: oriels, balconies, shopfront awnings, entrance steps and basement vents.
import { launch, driver } from '../browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

const info = await d.eval(async () => {
  const W = window.__editor, ed = W.editor;
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { boxSolid } = await import('/src/edit/brushes.ts');
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
  const blocks = [
    [V(-2304, -1792, 0), V(-1024, -512, 64)], [V(-768, -1792, 0), V(512, -768, 64)], [V(768, -1792, 0), V(2048, -512, 64)],
    [V(-2304, -256, 0), V(-1024, 1024, 64)], [V(-768, -512, 0), V(512, 1024, 64)], [V(768, -256, 0), V(2048, 1024, 64)],
  ];
  const sel = blocks.map(([a, b]) => doc.addSolid(boxSolid(doc, a, b, 'TOOLS/TOOLSNODRAW')));
  ed.changed();
  ed.selection.set(sel);
  buildingsFromSelection(ed, { seed: 41, minFloors: 3, maxFloors: 6, alleys: false, roofProps: true, detail: 2 });
  ed.selection.clear();
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
  const count = (cls) => doc.entities.filter((e) => e.classname === cls).length;
  const awnings = doc.entities.filter((e) => /awning/.test(e.get('model') ?? ''));
  const a = awnings.find((e) => Math.abs(e.origin.x - 640) < 200) ?? awnings[0];
  // Oriels: tall detail brushes about 32 deep and two bays wide.
  const { solidBounds } = await import('/src/edit/brushes.ts');
  const oriels = doc.entities.filter((e) => e.classname === 'func_detail').flatMap((e) => e.solids).map((s) => solidBounds(s)).filter((b) => {
    const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y;
    return b.max.z - b.min.z > 250 && Math.min(sx, sy) <= 72 && Math.max(sx, sy) >= 96 && Math.max(sx, sy) <= 140 && b.min.z > 100;
  }).map((b) => [Math.round((b.min.x + b.max.x) / 2), Math.round((b.min.y + b.max.y) / 2), Math.round((b.min.z + b.max.z) / 2), b.max.x - b.min.x < b.max.y - b.min.y ? 'x' : 'y']);
  return { awnings: awnings.length, decals: count('infodecal'), oriels: oriels.length, oriel: oriels[0] ?? null, awning: a ? [a.origin.x, a.origin.y, a.origin.z, a.angles.y] : null };
});
console.log('  ', JSON.stringify(info));
await d.settle(2500);
// The north-south street between the middle and east blocks.
await d.view([640, 1500, 260], [640, -1800, 280]);
await d.settle(900);
await d.shot('buildings-p5-street-east');
if (info.oriel) {
  // Look along the wall at the oriel, from the street side (the thin axis points out of the wall).
  const [x, y, z, thin] = info.oriel;
  const side = thin === 'x' ? [Math.sign(x) * 230, 0] : [0, Math.sign(y + 384) * 230];
  const along = thin === 'x' ? [0, 420] : [420, 0];
  await d.view([x + side[0] + along[0], y + side[1] + along[1], z - 60], [x, y, z - 40]);
  await d.settle(900);
  await d.shot('buildings-p5-oriel');
}
if (info.awning) {
  // An awning seen from across the street.
  const [x, y, z, yaw] = info.awning;
  const r = (yaw * Math.PI) / 180;
  await d.view([x + Math.cos(r) * 220 - Math.sin(r) * 150, y + Math.sin(r) * 220 + Math.cos(r) * 150, z + 30], [x, y, z - 10]);
  await d.settle(900);
  await d.shot('buildings-p5-awning');
}
// The north-south street between the west and middle blocks.
await d.view([-900, -2300, 240], [-900, 1000, 330]);
await d.settle(900);
await d.shot('buildings-p5-street-north');
await d.view([-1700, -2600, 900], [-700, -1300, 300]);
await d.settle(900);
await d.shot('buildings-p5-corner');
await browser.close();
