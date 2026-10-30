// Building generator phase 1: footprints (courtyard rings, L shapes), cut and rounded corners, annexes, gate walls.
import { launch, driver } from './browser.mjs';

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
  const Vector3 = ed.camera.position.constructor;
  ed.loadDocument(VmfDocument.empty(), 'buildings_demo.vmf');
  const doc = ed.doc;
  const V = (x, y, z) => new Vector3(x, y, z);
  doc.addSolid(boxSolid(doc, V(-2048, -1536, -64), V(2048, 1536, 0), 'CONCRETE/CONCRETEFLOOR001A'));
  const blocks = [
    [V(-1792, -1280, 0), V(-512, 0, 64)], // courtyard ring
    [V(-256, -1280, 0), V(768, -704, 64)], // deep row: L shapes with yards
    [V(-256, -448, 0), V(768, 0, 64)],
    [V(1024, -1280, 0), V(1792, 0, 64)],
    [V(-1792, 256, 0), V(-768, 1280, 64)], // smaller courtyard ring
  ];
  const sel = blocks.map(([a, b]) => doc.addSolid(boxSolid(doc, a, b, 'TOOLS/TOOLSNODRAW')));
  ed.changed();
  ed.selection.set(sel);
  const n = buildingsFromSelection(ed, { seed: 11, minFloors: 3, maxFloors: 6, alleys: false, roofProps: true });
  ed.selection.clear();
  return { n, brushes: doc.allSolids().length };
});
console.log('  generated', info);
await d.settle(1500);

await d.view([-2700, -2500, 1500], [-700, -500, 100]);
await d.settle(800);
await d.shot('buildings-p1-overview');
await d.view([-1150, -1500, 2300], [-1150, -640, 0]);
await d.settle(800);
await d.shot('buildings-p1-courtyard');
await d.view([2350, 650, 380], [1600, -200, 330]);
await d.settle(800);
await d.shot('buildings-p1-round-corner');
await d.view([-2300, -1900, 700], [-1500, -1000, 300]);
await d.settle(800);
await d.shot('buildings-p1-cut-corner');
await browser.close();
