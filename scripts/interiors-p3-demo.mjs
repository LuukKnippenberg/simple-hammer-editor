// Interior phase 3: furniture, wall lamps with lights, and grime.
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
  const { entityNode } = await import('/src/edit/actions.ts');
  const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
  const { Vector2, Box2 } = await import('/node_modules/three/build/three.module.js');
  const Vector3 = ed.camera.position.constructor;
  const doc = VmfDocument.empty();
  const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
  createGroupEntity(doc, sun);
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-30');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '220');
  ed.loadDocument(doc, 'interiors_p3.vmf');
  const V = (x, y, z) => new Vector3(x, y, z);
  doc.addSolid(boxSolid(doc, V(-2304, -2048, -64), V(2304, 1792, 0), 'NATURE/BLENDDIRTGRASS01'));
  const rect = (x, y, w, h) => rectPoly(new Box2(new Vector2(x, y), new Vector2(x + w, y + h)));
  const ell = (x, y) => [new Vector2(x, y), new Vector2(x + 512, y), new Vector2(x + 512, y + 256), new Vector2(x + 256, y + 256), new Vector2(x + 256, y + 512), new Vector2(x, y + 512)];
  const rows = [['farmhouse', 'full', 0.5], ['shack', 'sparse', 0.8], ['brick', 'full', 1], ['outbuilding', 'full', 0.3]];
  const out = [];
  let ents = 0;
  rows.forEach(([style, furnish, weathering], row) => {
    const y = 1152 - row * 768;
    const lots = [rect(-2048, y, 384, 256), rect(-1536, y, 512, 384), ell(-896, y), rect(-256, y, 640, 448), rect(512, y, 448, 320), rect(1088, y, 576, 384)];
    lots.forEach((fp, i) => {
      const h = interiorHouse(doc, fp, 0, { seed: 301 + row * 13 + i * 7, style, furnish: i === 5 ? 'none' : furnish, weathering });
      for (const n of h.world) doc.addSolid(n);
      const det = detailEntityNode(doc, h.detail);
      if (det) doc.addEntity(det);
      for (const e of h.entities) { doc.addEntity(entityNode(ed, e.classname, e.origin, e.keys)); ents++; }
    });
    out.push([style, y]);
  });
  console.log('entities', ents);
  ed.changed();
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
  return out;
});
await d.settle(3000);
await d.view([-900, rows[0][1] - 520, 1050], [-900, rows[0][1] + 200, 0]);
await d.settle(1500);
await d.shot('interiors-p3-farmhouse');
await d.view([-1300, rows[0][1] - 40, 420], [-1300, rows[0][1] + 190, 0]);
await d.settle(1500);
await d.shot('interiors-p3-rooms');
await d.view([-900, rows[1][1] - 520, 1050], [-900, rows[1][1] + 200, 0]);
await d.settle(1500);
await d.shot('interiors-p3-shack-sparse');
await d.view([100, rows[2][1] - 300, 700], [100, rows[2][1] + 220, 0]);
await d.settle(1500);
await d.shot('interiors-p3-brick-grime');
await d.view([700, rows[3][1] - 520, 1050], [700, rows[3][1] + 200, 0]);
await d.settle(1500);
await d.shot('interiors-p3-workshops');
await browser.close();
