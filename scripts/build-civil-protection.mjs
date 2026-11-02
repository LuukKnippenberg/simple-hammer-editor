// Builds the Combine tutorial "Civil Protection" with the editor (sketch → generate → set pieces, units,
// cinematics, MultiBlend ground, decals, mission flowchart) and saves it as maps/sp_tutorial_combine.vmf
// with its sketch and mission flowchart, taking screenshots along the way. Requires the dev server.
//   EDITOR_URL=http://localhost:5194/ node scripts/build-civil-protection.mjs [--shots: only the screenshots]
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

// 1. The layout as a sketch: surfaces, buildings, walls, POIs and the start marker.
await d.eval(async () => {
  const { buildCivilSketch } = await import('/src/examples/civilProtection.ts');
  window.__editor.editor.sketch = buildCivilSketch();
});
await page.click('#topbar button:has-text("Sketch")');
await page.waitForTimeout(800);
await page.click('.sketch-side .seg button:text-is("Surface")');
await page.waitForTimeout(300);
await d.shot('civil-01-sketch-surface');
await page.click('.sketch-side .seg button:text-is("Markers")');
await page.waitForTimeout(300);
await d.shot('civil-02-sketch-layout');

// 2. Generate the 3D map, then the set pieces, units, cinematics, decals and the mission.
await page.click('.sketch-side button:has-text("Generate 3D map")');
await d.settle(4000);
const report = await d.eval(async () => {
  const { decorateCivilProtection } = await import('/src/examples/civilProtection.ts');
  const e = window.__editor.editor;
  e.mapName = 'sp_tutorial_combine.vmf';
  return decorateCivilProtection(e);
});
console.log('decorated', JSON.stringify(report));

// 3. MultiBlend ground: the outpost yard (concrete, cracked concrete, dirt and mud) and the boulevard verges
// (grass, the same grass turned and enlarged, dirt and mud), each noise-filled so the tiling breaks up.
const BLENDS = [
  { name: 'kilo_yard', layers: [
    { texture: 'concrete/concretefloor027a', scale: 1, rotation: 0 },
    { texture: 'concrete/concretefloor019a', scale: 1.3, rotation: 37 },
    { texture: 'nature/dirtfloor003a', scale: 1.2, rotation: 15 },
    { texture: 'nature/mudfloor005a', scale: 1, rotation: 70 },
  ] },
  { name: 'boulevard_verge', layers: [
    { texture: 'nature/forest_grass_01', scale: 1, rotation: 0 },
    { texture: 'nature/forest_grass_01', scale: 1.7, rotation: 47 },
    { texture: 'nature/forest_dirt_02', scale: 1.25, rotation: 20 },
    { texture: 'nature/mudfloor005a', scale: 1, rotation: 80 },
  ] },
];
console.log('multiblend', JSON.stringify(await d.eval(async (defs) => {
  const ed = window.__editor.editor, tool = ed.tools.tools.ground;
  const { solidBounds } = await import('/src/edit/brushes.ts');
  const { X, Y } = await import('/src/examples/civilProtection.ts');
  const { loadTexture } = await import('/src/assets/textures.ts');
  const out = [];
  const mats = [];
  for (const def of defs) {
    const r = await fetch('/api/blend', { method: 'POST', headers: { 'X-SHE': '1' }, body: JSON.stringify({ ...def, spec: 'nature/forest_grass_10a_spec' }) });
    const { material } = await r.json();
    const info = await ed.materials.reload(material);
    const missing = [];
    for (const l of def.layers) if (!(await loadTexture(l.texture))) missing.push(l.texture);
    mats.push(material);
    out.push({ material, multiblend: !!info.multiblend, missing });
  }
  const disps = ed.doc.worldEntity.solids.filter((s) => s.isDisplacement);
  const inside = (s, [x0, y0, x1, y1]) => { const b = solidBounds(s); const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2; return cx > X(x0) && cx < X(x1) && cy > Y(y0) && cy < Y(y1); };
  const yard = disps.filter((s) => inside(s, [32, 23, 53, 32.9]));
  const verge = disps.filter((s) => !yard.includes(s) && inside(s, [53, 0, 60, 32.9]));
  tool.set = mats[0];
  ed.selection.set(yard);
  const n1 = tool.noiseFill([
    { layer: 1, coverage: 0.4, scale: 640, seed: 17 },
    { layer: 2, coverage: 0.22, scale: 420, seed: 29 },
    { layer: 3, coverage: 0.08, scale: 260, seed: 41 },
  ]);
  tool.set = mats[1];
  ed.selection.set(verge);
  const n2 = tool.noiseFill([
    { layer: 1, coverage: 0.45, scale: 700, seed: 11 },
    { layer: 2, coverage: 0.2, scale: 500, seed: 23 },
    { layer: 3, coverage: 0.08, scale: 300, seed: 37 },
  ]);
  ed.selection.clear();
  return { out, yard: yard.length, verge: verge.length, n1, n2 };
}, BLENDS)));

// Same fix the compile dialog offers: props whose model is physics-only become prop_dynamic.
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

// 4. The mission flowchart: check it against the map, then play it through, taking the first transition
// that doesn't lose (counted conditions and "all of" parts one event at a time).
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
console.log('saved', JSON.stringify(await d.eval(() => window.__editor.editor.save('sp_tutorial_combine.vmf'))));
}

// 5. Screenshots, from the saved map as it opens in the editor (so the panels show its mission and pieces).
await d.open('repo:sp_tutorial_combine.vmf');
const shot = async (name, pos, target, wait = 1000) => {
  await d.view(pos, target);
  await d.settle(wait);
  await d.shot(name);
};
await d.eval(() => { window.__editor.editor.gridHelper.visible = false; });
await d.key('t');
await d.eval(() => window.__editor.editor.frameBox(window.__editor.editor.world.bounds()));
await d.settle(2000);
await d.shot('civil-03-top-view');
await d.key('t');
await shot('civil-04-overview', [-4200, -5200, 4200], [600, 0, 0], 2000);
await shot('civil-05-plaza', [-1700, -3100, 1100], [-2500, -1300, 0]);
await shot('civil-06-housing-street', [-1000, -1330, 420], [800, -1420, 0]);
await shot('civil-07-checkpoint', [1216, -1500, 560], [1216, -380, 40]);
await shot('civil-08-outpost', [400, -700, 1500], [1700, 600, 0], 1500);
await shot('civil-09-canal-bridge', [1900, 700, 620], [1280, 1700, 0]);
await shot('civil-10-old-city', [1280, 900, 1400], [1280, 2700, 0], 1500);
await shot('civil-11-boulevard', [3100, -2900, 900], [3300, 0, 0], 1500);
await d.key('l');
await shot('civil-12-lit-overview', [-4200, -5200, 4200], [600, 0, 0], 2500);
await shot('civil-13-lit-outpost', [400, -700, 1500], [1700, 600, 0], 1500);
await d.key('l');

// The mission flowchart.
await d.eval(() => window.__editor.tabs.show('Mission'));
await d.settle(300);
await page.click('button:has-text("Open mission flow")');
await d.settle(600);
await page.click('.mission-flow button:has-text("Fit")');
await d.settle(400);
await d.shot('civil-14-mission-flow');
await page.click('.mf-node[data-id="armup"] .mf-title');
await d.settle(300);
await d.shot('civil-15-mission-allof');
await page.click('.mf-node[data-id="shift"] .mf-title');
await d.settle(300);
await page.evaluate(() => [...document.querySelectorAll('.mf-side h3')].find((x) => x.textContent.startsWith('Abilities'))?.scrollIntoView());
await d.shot('civil-16-mission-gates');
await page.click('.modal-backdrop:not([hidden]) .modal-head button:last-child');
await d.settle(300);

// Cinematics previews: the uprising shot, the flight paths, the Overwatch shot.
await d.eval(() => { const W = window.__editor; W.lighting.setEnabled(true); W.editor.emit('lighting'); W.tabs.show('Cinema'); });
await shot('civil-17-cine-paths', [-300, -1800, 2600], [2000, 900, 300], 2000);
for (const [name, file] of [['shot_uprising', 'civil-18-cine-uprising'], ['shot_overwatch', 'civil-19-cine-overwatch']]) {
  await d.eval(async (n) => {
    const { playShot } = await import('/src/render/cinemaPreview.ts');
    const ed = window.__editor.editor;
    ed.selection.clear();
    playShot(ed, ed.doc.entities.find((e) => e.get('targetname') === n));
  }, name);
  await page.waitForTimeout(6000);
  await d.shot(file);
  await page.keyboard.press('Escape');
  await d.settle(500);
}
await browser.close();
