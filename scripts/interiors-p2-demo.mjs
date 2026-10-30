// Interior phase 2: hollow shells with capped wall tops, floors, window fills and porches, one row per style.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

const rows = await d.eval(async () => {
  const W = window.__editor, ed = W.editor;
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const { detailEntityNode } = await import('/src/gen/buildings.ts');
  const { interiorHouse } = await import('/src/gen/interiorHouse.ts');
  const { INTERIOR_STYLES } = await import('/src/gen/styles.ts');
  const { rectPoly } = await import('/src/gen/buildingPlan.ts');
  const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
  const { Vector2, Box2 } = await import('/node_modules/three/build/three.module.js');
  const Vector3 = ed.camera.position.constructor;
  const doc = VmfDocument.empty();
  const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
  createGroupEntity(doc, sun);
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-55');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '220');
  ed.loadDocument(doc, 'interiors_p2.vmf');
  const V = (x, y, z) => new Vector3(x, y, z);
  doc.addSolid(boxSolid(doc, V(-2304, -2048, -64), V(2304, 1792, 0), 'NATURE/BLENDDIRTGRASS01'));
  const rect = (x, y, w, h) => rectPoly(new Box2(new Vector2(x, y), new Vector2(x + w, y + h)));
  const ell = (x, y) => [new Vector2(x, y), new Vector2(x + 512, y), new Vector2(x + 512, y + 256), new Vector2(x + 256, y + 256), new Vector2(x + 256, y + 512), new Vector2(x, y + 512)];
  const names = Object.keys(INTERIOR_STYLES);
  const out = [];
  names.forEach((style, row) => {
    const y = 1152 - row * 768;
    const lots = [rect(-2048, y, 384, 256), rect(-1536, y, 512, 384), ell(-896, y), rect(-256, y, 640, 448), rect(512, y, 448, 320), rect(1088, y, 576, 384), rect(1792, y, 320, 320)];
    lots.forEach((fp, i) => {
      const h = interiorHouse(doc, fp, 0, { seed: 101 + row * 13 + i * 7, style, cutHeight: i === 6 ? 96 : 112 });
      for (const n of h.world) doc.addSolid(n);
      const det = detailEntityNode(doc, h.detail);
      if (det) doc.addEntity(det);
    });
    out.push([style, y]);
  });
  ed.changed();
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
  return out;
});
await d.settle(3000);
await d.view([0, -2500, 2700], [0, -250, 0]);
await d.settle(1200);
await d.shot('interiors-p2-overview');
// The RTS camera looks down at 65°.
const rts = (x, y, dist = 1100) => d.view([x, y - dist * Math.cos((65 * Math.PI) / 180), dist * Math.sin((65 * Math.PI) / 180)], [x, y, 0]);
for (const [style, y] of rows) {
  await rts(-1050, y + 220, 1350);
  await d.settle(1000);
  await d.shot(`interiors-p2-${style}`);
}
await d.view([-1000, rows[0][1] + 249, 1300], [-1000, rows[0][1] + 250, 0]);
await d.settle(1000);
await d.shot('interiors-p2-top');
await d.view([-1300, rows[1][1] - 260, 160], [-1250, rows[1][1] + 200, 40]);
await d.settle(1000);
await d.shot('interiors-p2-street');
await browser.close();
