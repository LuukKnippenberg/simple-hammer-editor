// Builds the Combine mission "Garden District" with the editor (sketch → generate → interior buildings, the church
// and garden, units, raids, cinematics, MultiBlend lawn, decals, mission flowchart) and saves it as
// maps/sp_garden_district.vmf with its sketch and mission flowchart, taking screenshots along the way.
//   EDITOR_URL=http://localhost:5194/ node scripts/build-garden-district.mjs [--shots: only the screenshots]
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('  [console]', m.text()); });
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
const shotsOnly = process.argv.includes('--shots');
if (!shotsOnly) {
await d.open('repo:phase3_arena.vmf');
await page.click('#topbar button:has-text("New")');
await page.dblclick('.newmap [data-template="empty"]');

// 1. The layout as a sketch.
await d.eval(async () => {
  const { buildGardenSketch } = await import('/src/examples/gardenDistrict.ts');
  window.__editor.editor.sketch = buildGardenSketch();
});
await page.click('#topbar button:has-text("Sketch")');
await page.waitForTimeout(800);
await page.click('.sketch-side .seg button:text-is("Surface")');
await page.waitForTimeout(300);
await d.shot('garden-01-sketch-surface');
await page.click('.sketch-side .seg button:text-is("Detail")');
await page.waitForTimeout(300);
await d.shot('garden-02-sketch-detail');

// 2. Generate the 3D map, then the set pieces, units, cinematics, decals and the mission.
await page.click('.sketch-side button:has-text("Generate 3D map")');
await d.settle(4000);
const report = await d.eval(async () => {
  const { decorateGardenDistrict } = await import('/src/examples/gardenDistrict.ts');
  const e = window.__editor.editor;
  e.mapName = 'sp_garden_district.vmf';
  return decorateGardenDistrict(e);
});
console.log('decorated', JSON.stringify(report));

// 3. MultiBlend lawn in the church garden: grass, the same grass turned and enlarged, worn dirt and mud.
console.log('multiblend', JSON.stringify(await d.eval(async () => {
  const ed = window.__editor.editor, tool = ed.tools.tools.ground;
  const { solidBounds } = await import('/src/edit/brushes.ts');
  const { X, Y, AREAS } = await import('/src/examples/gardenDistrict.ts');
  const def = { name: 'garden_lawn', layers: [
    { texture: 'nature/forest_grass_01', scale: 1, rotation: 0 },
    { texture: 'nature/forest_grass_01', scale: 1.7, rotation: 47 },
    { texture: 'nature/forest_dirt_02', scale: 1.25, rotation: 20 },
    { texture: 'nature/mudfloor005a', scale: 1, rotation: 80 },
  ] };
  const r = await fetch('/api/blend', { method: 'POST', body: JSON.stringify({ ...def, spec: 'nature/forest_grass_10a_spec' }) });
  const { material } = await r.json();
  const info = await ed.materials.reload(material);
  const [x0, y0, x1, y1] = AREAS.garden;
  const lawn = ed.doc.worldEntity.solids.filter((s) => {
    if (!s.isDisplacement) return false;
    const b = solidBounds(s), cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
    return cx > X(x0) && cx < X(x1 + 1) && cy > Y(y0) && cy < Y(y1 + 1);
  });
  tool.set = material;
  ed.selection.set(lawn);
  const n = lawn.length ? tool.noiseFill([
    { layer: 1, coverage: 0.45, scale: 600, seed: 13 },
    { layer: 2, coverage: 0.25, scale: 380, seed: 31 },
    { layer: 3, coverage: 0.08, scale: 240, seed: 47 },
  ]) : 0;
  ed.selection.clear();
  return { material, multiblend: !!info.multiblend, lawn: lawn.length, n };
})));

// Props whose model is physics-only become prop_dynamic, as the compile dialog offers.
console.log('converted to prop_dynamic', await d.eval(async () => {
  const { nonStaticProps, convertToDynamic } = await import('/src/edit/preflight.ts');
  const e = window.__editor.editor;
  const bad = await nonStaticProps(e);
  convertToDynamic(e, bad);
  return [...new Set(bad.map((x) => x.get('model')))];
}));
console.log('checks', JSON.stringify(await d.eval(async () => {
  const { runChecks } = await import('/src/edit/preflight.ts');
  return runChecks(window.__editor.editor).map((c) => `${c.ok ? 'ok' : c.severity}: ${c.label}`);
})));
await d.settle(3000);

// 4. The mission flowchart: check it against the map, then play it through (first transition that doesn't lose).
console.log('mission', JSON.stringify(await d.eval(async () => {
  const ed = window.__editor.editor;
  const { checkMission } = await import('/src/lw/missionCheck.ts');
  const { simStart, simWaiting, simTake, simNeeds } = await import('/src/lw/missionSim.ts');
  const issues = checkMission(ed.mission, ed.doc).map((i) => `${i.severity}: ${i.text}`);
  let st = simStart(ed.mission);
  for (let guard = 0; st.stage && guard < 200; guard++) {
    const t = simWaiting(ed.mission, st).find((x) => x.to !== 'defeat');
    if (!t) break;
    const parts = t.condition.kind === 'all' ? t.condition.conditions : [t.condition];
    parts.forEach((c, k) => { for (let i = 0; i < simNeeds(c); i++) st = simTake(ed.mission, st, t.id, t.condition.kind === 'all' ? k : undefined); });
  }
  const unvisited = ed.mission.stages.map((s) => s.id).filter((id) => !st.path.includes(id));
  return { issues, path: st.path, result: st.result, unvisited };
})));

const stats = await d.eval(() => {
  const e = window.__editor.editor;
  return { brushes: e.doc.allSolids().length, entities: e.doc.entities.length, ...e.decals.stats };
});
console.log('map', JSON.stringify(stats));
console.log('saved', JSON.stringify(await d.eval(() => window.__editor.editor.save('sp_garden_district.vmf'))));
}

// 5. Screenshots, from the saved map as it opens in the editor.
await d.open('repo:sp_garden_district.vmf');
const shot = async (name, pos, target, wait = 1000) => {
  await d.view(pos, target);
  await d.settle(wait);
  await d.shot(name);
};
// The RTS angle: pitch 65, looking north-west from the south-east of the target.
const rts = (name, x, y, h = 1600, wait = 1500) => shot(name, [x + 0.33 * h, y - 0.33 * h, h], [x, y, 0], wait);
await d.eval(() => { window.__editor.editor.gridHelper.visible = false; });
await d.key('t');
await d.eval(() => window.__editor.editor.frameBox(window.__editor.editor.world.bounds()));
await d.settle(2000);
await d.shot('garden-03-top-view');
await d.key('t');
await d.key('l');
await shot('garden-04-overview', [-1500, -6200, 5200], [600, 0, 0], 2500);
await rts('garden-05-square', -2700, -300, 2000, 2000);
await rts('garden-06-street', 600, -500, 1300);
await rts('garden-07-garden', 2900, -700, 1700);
await rts('garden-08-customs', -900, 800, 1500);
await rts('garden-09-station', 3000, 2500, 1700);
await rts('garden-10-market', 900, -700, 1400);
await rts('garden-11-park', -3000, -2700, 1600);
await d.key('l');
// The mission flowchart.
await d.eval(() => window.__editor.tabs.show('Mission'));
await d.settle(300);
await page.click('button:has-text("Open mission flow")');
await d.settle(600);
await page.click('.mission-flow button:has-text("Fit")');
await d.settle(400);
await d.shot('garden-12-mission-flow');
await browser.close();
