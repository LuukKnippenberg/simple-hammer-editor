// Interior phase 4: two storeys: an upper floor over part of the house, stairs with an NPC clip ramp, a railing.
import { launch, driver } from '../browser.mjs';

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
  const { entityNode } = await import('/src/edit/actions.ts');
  const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
  const { Vector2, Box2 } = await import('/node_modules/three/build/three.module.js');
  const Vector3 = ed.camera.position.constructor;
  const doc = VmfDocument.empty();
  const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
  createGroupEntity(doc, sun);
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-30');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '220');
  ed.loadDocument(doc, 'interiors_p4.vmf');
  const V = (x, y, z) => new Vector3(x, y, z);
  doc.addSolid(boxSolid(doc, V(-2304, -2048, -64), V(2304, 1792, 0), 'NATURE/BLENDDIRTGRASS01'));
  const rect = (x, y, w, h) => rectPoly(new Box2(new Vector2(x, y), new Vector2(x + w, y + h)));
  const ell = (x, y) => [new Vector2(x, y), new Vector2(x + 512, y), new Vector2(x + 512, y + 256), new Vector2(x + 256, y + 256), new Vector2(x + 256, y + 512), new Vector2(x, y + 512)];
  const rows = [['farmhouse', 0.4], ['brick', 0.6], ['shack', 0.8]];
  const bigEll = (x, y) => [new Vector2(x, y), new Vector2(x + 640, y), new Vector2(x + 640, y + 384), new Vector2(x + 256, y + 384), new Vector2(x + 256, y + 640), new Vector2(x, y + 640)];
  const out = [];
  rows.forEach(([style, weathering], row) => {
    const y = 1024 - row * 1024;
    const lots = [rect(-2048, y, 512, 384), rect(-1408, y, 640, 448), bigEll(-640, y), rect(128, y, 384, 576), rect(640, y, 576, 448), rect(1344, y, 512, 448)];
    lots.forEach((fp, i) => {
      const h = interiorHouse(doc, fp, 0, { seed: 501 + row * 13 + i * 7, style, storeys: 2, weathering });
      for (const n of h.world) doc.addSolid(n);
      const det = detailEntityNode(doc, h.detail);
      if (det) doc.addEntity(det);
      for (const e of h.entities) doc.addEntity(entityNode(ed, e.classname, e.origin, e.keys));
      if (row === 0 && i === 1) out.push(['stairs', h.plan.stairs, h.plan.upperFloor]);
    });
    out.push([style, y]);
  });
  ed.changed();
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
  return out;
});
await d.settle(3000);
const [, st] = rows.find((r) => r[0] === 'stairs');
const styles = rows.filter((r) => r[0] !== 'stairs');
await d.view([-900, styles[0][1] - 560, 1150], [-900, styles[0][1] + 260, 0]);
await d.settle(1500);
await d.shot('interiors-p4-farmhouse');
await d.view([600, styles[1][1] - 560, 1150], [600, styles[1][1] + 260, 0]);
await d.settle(1500);
await d.shot('interiors-p4-brick');
await d.view([-900, styles[2][1] - 560, 1150], [-900, styles[2][1] + 260, 0]);
await d.settle(1500);
await d.shot('interiors-p4-shack');
// The flight from inside the open part, and the mezzanine from above.
const sc = { x: (st.box.min.x + st.box.max.x) / 2, y: (st.box.min.y + st.box.max.y) / 2 };
const back = { x: -st.dir.x, y: -st.dir.y };
await d.view([sc.x + back.x * 260 + back.y * 160, sc.y + back.y * 260 - back.x * 160, 230], [sc.x - back.x * 40, sc.y - back.y * 40, 70]);
await d.settle(1500);
await d.shot('interiors-p4-stairs');
await d.view([sc.x + back.x * 420, sc.y + back.y * 420 - 200, 620], [sc.x - back.x * 120, sc.y - back.y * 120, 60]);
await d.settle(1500);
await d.shot('interiors-p4-mezzanine');
await browser.close();
