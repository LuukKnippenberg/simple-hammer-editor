// Interior buildings: builds every preset on a flat map in the editor and takes screenshots from above and from
// the RTS camera's angle (pitch 65, looking north-west). Saves maps/rooms_demo.vmf.
//   EDITOR_URL=http://localhost:5194/ node scripts/rooms-demo.mjs [prefix]
import { launch, driver } from './browser.mjs';

const prefix = process.argv[2] ?? 'rooms';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('  [console]', m.text()); });
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

const report = await d.eval(async () => {
  const W = window.__editor, ed = W.editor;
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
  const { addRoomBuilding } = await import('/src/gen/rooms/build.ts');
  const { presetSpec } = await import('/src/gen/rooms/presets.ts');
  const Vector3 = ed.camera.position.constructor;
  const doc = VmfDocument.empty();
  const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
  createGroupEntity(doc, sun);
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-52');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '215');
  ed.loadDocument(doc, 'rooms_demo.vmf');
  doc.addSolid(boxSolid(doc, new Vector3(-3072, -2048, -64), new Vector3(4096, 2560, 0), 'CONCRETE/CONCRETEFLOOR033A'));
  const out = {};
  for (const [id, x, y] of [['station', -2816, -1792], ['customs', 768, -1792], ['rations', 768, 512]]) {
    const r = addRoomBuilding(doc, presetSpec(id, x, y, 0, id, 11));
    out[id] = { issues: r.layout.issues, counts: r.counts };
  }
  ed.changed();
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
  return out;
});
console.log(JSON.stringify(report));
await d.settle(3000);
// From above, then the RTS angle over each part of the station (the camera looks north-west from the south-east).
const rts = (x, y, h = 1400) => d.view([x + 0.3 * h, y - 0.3 * h, h], [x, y, 0]);
const spots = [
  ['top', () => d.view([-1200, -500, 5200], [-1200, -480, 0])],
  ['station', () => rts(-1300, -300, 3000)],
  ['hall', () => rts(-1300, -1300)],
  ['concourse', () => rts(-2100, 0)],
  ['customs', () => rts(-500, -400)],
  ['north', () => rts(-1700, 900)],
  ['others', () => rts(1500, 400, 2600)],
];
for (const [name, go] of spots) {
  await go();
  await d.settle(1200);
  await d.shot(`${prefix}-${name}`);
}
console.log('saved', JSON.stringify(await d.eval(() => window.__editor.editor.save('rooms_demo.vmf'))));
await browser.close();
