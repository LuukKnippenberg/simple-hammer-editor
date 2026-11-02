// Interior phase 1: floor plans drawn as low walls with door and window gaps, floors coloured by room type.
import { launch, driver } from '../browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

await d.eval(async () => {
  const W = window.__editor, ed = W.editor;
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const { planInterior, wallBox, wallLength } = await import('/src/gen/interiorPlan.ts');
  const { rectPoly } = await import('/src/gen/buildingPlan.ts');
  const { Rng } = await import('/src/gen/rng.ts');
  const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
  const Vector3 = ed.camera.position.constructor;
  const { Vector2, Box2 } = await import('/node_modules/three/build/three.module.js');
  const doc = VmfDocument.empty();
  const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
  createGroupEntity(doc, sun);
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-50');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '210');
  ed.loadDocument(doc, 'interiors_p1.vmf');
  const V = (x, y, z) => new Vector3(x, y, z);
  doc.addSolid(boxSolid(doc, V(-2048, -1536, -64), V(2560, 1280, 0), 'NATURE/BLENDDIRTGRASS01'));
  const FLOORS = {
    hall: 'CONCRETE/CONCRETEFLOOR033A', living: 'WOOD/WOODFLOOR006A', kitchen: 'TILE/TILEFLOOR001A', bath: 'TILE/TILEFLOOR012A',
    bedroom: 'WOOD/WOODFLOOR002A', storage: 'CONCRETE/CONCRETEFLOOR001A', workshop: 'CONCRETE/CONCRETEFLOOR028A',
  };
  const rect = (w, h, x, y) => rectPoly(new Box2(new Vector2(x, y), new Vector2(x + w, y + h)));
  const ell = (x, y, w, h, ww, wh) => [new Vector2(x, y), new Vector2(x + w, y), new Vector2(x + w, y + h), new Vector2(x + ww, y + h), new Vector2(x + ww, y + h + wh), new Vector2(x, y + h + wh)];
  const houses = [
    [rect(256, 256, -1792, 512), 3, {}], [rect(384, 256, -1408, 512), 5, {}], [rect(512, 384, -896, 384), 7, {}],
    [rect(640, 448, -256, 320), 11, {}], [ell(512, 256, 512, 256, 256, 256), 13, {}], [rect(512, 384, 1280, 384), 17, { wideDoors: true }],
    [rect(512, 384, -1792, -1024), 19, { storeys: 2 }], [rect(640, 448, -1152, -1088), 23, { storeys: 2 }],
    [ell(-384, -1280, 640, 384, 256, 256), 29, { storeys: 2 }], [rect(384, 576, 512, -1280), 31, { storeys: 2 }],
    [rect(640, 448, 1152, -1088), 37, { use: 'workshop' }],
  ];
  for (const [fp, seed, opts] of houses) {
    const plan = planInterior(fp, new Rng(seed), opts);
    for (const r of plan.rooms) {
      if (r.storey !== 1) continue;
      doc.addSolid(boxSolid(doc, V(r.box.min.x, r.box.min.y, -8), V(r.box.max.x, r.box.max.y, 8), FLOORS[r.type]));
    }
    // Low walls: 40 high, 20 under windows, nothing in doors and gaps.
    for (const w of plan.walls) {
      const b = wallBox(w), ax = w.axis;
      const z0 = w.storey === 1 ? 8 : 72, base = w.storey === 1 ? 48 : 104;
      const mat = w.storey === 1 ? 'PLASTER/PLASTERWALL005A' : 'BUILDING_TEMPLATE/BUILDING_TEMPLATE002K';
      const piece = (from, to, top) => {
        if (to - from < 0.5) return;
        const p = b.clone(); p.min[ax] = b.min[ax] + from; p.max[ax] = b.min[ax] + to;
        doc.addSolid(boxSolid(doc, V(p.min.x, p.min.y, z0), V(p.max.x, p.max.y, top), mat));
      };
      let at = 0;
      for (const o of w.openings) {
        piece(at, o.from, base);
        if (o.kind === 'window') piece(o.from, o.to, z0 + 16);
        at = o.to;
      }
      piece(at, wallLength(w), base);
    }
    if (plan.stairs) {
      const s = plan.stairs;
      const ax = s.dir.x !== 0 ? 'x' : 'y', sign = s.dir.x + s.dir.y;
      for (let k = 0; k < s.steps; k++) {
        const b = s.box.clone();
        const start = sign > 0 ? s.box.min[ax] : s.box.max[ax];
        const a1 = start + sign * k * s.tread, a2 = start + sign * (k + 1) * s.tread;
        b.min[ax] = Math.min(a1, a2); b.max[ax] = Math.max(a1, a2);
        doc.addSolid(boxSolid(doc, V(b.min.x, b.min.y, 8), V(b.max.x, b.max.y, 8 + (k + 1) * 8), 'WOOD/WOODSTAIR002A'));
      }
    }
    if (plan.porch) doc.addSolid(boxSolid(doc, V(plan.porch.min.x, plan.porch.min.y, -8), V(plan.porch.max.x, plan.porch.max.y, 4), 'WOOD/WOODFLOOR007A'));
  }
  ed.changed();
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
});
await d.settle(2500);
await d.view([200, -700, 3400], [200, -250, 0]);
await d.settle(900);
await d.shot('interiors-p1-plans');
await d.view([-1150, -1700, 1150], [-1150, -820, 0]);
await d.settle(900);
await d.shot('interiors-p1-two-storey');
await d.view([500, -1700, 1150], [500, -820, 0]);
await d.settle(900);
await d.shot('interiors-p1-two-storey-2');
await d.view([-450, -100, 1150], [-450, 650, 0]);
await d.settle(900);
await d.shot('interiors-p1-one-storey');
await browser.close();
