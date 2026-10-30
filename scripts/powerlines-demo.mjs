// Powerlines: drawn along a street past houses (with house feeds) and across terrain over a hill.
import { launch, driver } from './browser.mjs';

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
  const { buildingsFromSelection } = await import('/src/gen/buildingAction.ts');
  const { makeTerrain } = await import('/src/edit/groundTool.ts');
  const { dab, readDisp } = await import('/src/edit/terrain.ts');
  const { rebuildRoads, blendRoadIntoGround } = await import('/src/gen/roadAction.ts');
  const { defaultRoad } = await import('/src/gen/roads.ts');
  const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
  const Vector3 = ed.camera.position.constructor;
  const V = (x, y, z) => new Vector3(x, y, z);
  const doc = VmfDocument.empty();
  const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
  createGroupEntity(doc, sun);
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-30');
  writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '230');
  ed.loadDocument(doc, 'powerlines_demo.vmf');
  const floor = doc.addSolid(boxSolid(doc, V(-2560, -2560, -64), V(2560, 2560, 0), 'CONCRETE/CONCRETEFLOOR001A'));
  ed.changed();
  makeTerrain(ed, [floor], 'NATURE/BLENDGRASSDIRT01A');
  // A hill for the field line to climb.
  const disps = ed.doc.allSolids().filter((s) => s.isDisplacement).map(readDisp);
  for (let k = 0; k < 8; k++) dab(disps, V(1400, 1300, 0), { mode: 'raise', radius: 700, strength: 0.6 });
  for (let k = 0; k < 4; k++) dab(disps, V(1400, 1300, 0), { mode: 'smooth', radius: 800, strength: 1 });
  for (const dd of disps) dd.solid.reload();
  ed.changed();
  // A village street: a cobbled street between two rows of brick houses.
  const rows = [[V(-2304, -1408, 0), V(64, -704, 64)], [V(-2304, -192, 0), V(64, 512, 64)]].map(([a, b]) => ed.doc.addSolid(boxSolid(ed.doc, a, b, 'TOOLS/TOOLSNODRAW')));
  ed.changed();
  ed.selection.set(rows);
  buildingsFromSelection(ed, { seed: 9, minFloors: 2, maxFloors: 3, alleys: true, roofProps: false, architecture: 'brick', street: false });
  ed.selection.clear();
  const road = { ...defaultRoad('cobble', [V(-2500, -448, 0), V(400, -448, 0), V(1100, 200, 0)]) };
  rebuildRoads(ed, 'Road', { add: road });
  blendRoadIntoGround(ed, road);
  W.lighting.setEnabled(true);
  ed.emit('lighting');
});
await d.settle(1500);
await d.view([-2900, -2700, 1300], [-700, -400, 200]);
await d.settle(600);
await d.key('9');
const line = async (pts, opts) => {
  await d.eval((o) => Object.assign(window.__editor.editor.tools.tools.powerline, o), opts);
  for (const p of pts) await d.click(p);
  await d.key('Enter');
  await d.settle(500);
};
// Along the street, on the pavement side, feeding the houses.
await line([[-2300, -600, 0], [300, -600, 0]], { pole: 'wooden', spacing: 512, slack: 0.05, feeds: true });
// Across the fields and over the hill.
await d.view([-600, -1600, 1500], [1200, 900, 300]);
await d.settle(400);
await line([[500, -900, 0], [1400, 300, 0], [1500, 2300, 0]], { pole: 'wide', spacing: 768, slack: 0.03, feeds: false });
await d.key('1');
await d.eval(() => window.__editor.editor.selection.clear());
await d.settle(800);
await d.view([-2600, -3000, 2000], [0, 0, 200]);
await d.settle(800);
await d.shot('powerlines-overview');
await d.view([-2200, -500, 300], [-600, -650, 420]);
await d.settle(800);
await d.shot('powerlines-street');
await d.view([-1500, -1100, 650], [-900, -600, 380]);
await d.settle(800);
await d.shot('powerlines-feeds');
await d.view([300, -1400, 500], [1400, 900, 500]);
await d.settle(800);
await d.shot('powerlines-hill');
// Select a pole: the Powerline panel.
await d.view([-2600, -3000, 2000], [0, 0, 200]);
await d.settle(400);
await d.click([-2300, -600, 240]);
await d.settle(400);
await d.shot('powerlines-panel');
console.log('  ', JSON.stringify(await d.eval(async () => {
  const ed = window.__editor.editor;
  const count = (c) => ed.doc.entities.filter((e) => e.classname === c).length;
  const pre = await import('/src/edit/preflight.ts');
  for (const id of ['shell', 'spawn']) { const c = pre.runChecks(ed).find((c) => c.id === id); if (!c.ok) c.fix(); }
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { applyMapSettings } = await import('/src/lw/mapSettings.ts');
  const copy = VmfDocument.parse(ed.doc.serialize());
  applyMapSettings(copy);
  const r = await fetch('/api/autosave?name=she_power_test.vmf', { method: 'POST', body: copy.serialize() });
  return { poles: ed.doc.entities.filter((e) => /utilitypole0/.test(e.get('model') ?? '')).length, ropes: count('move_rope') + count('keyframe_rope'), saved: r.ok };
})));
await browser.close();
