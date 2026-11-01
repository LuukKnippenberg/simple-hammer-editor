// Builds the "Sofia: Battle for the Largo" singleplayer map with the editor (sketch → generate → decorate)
// and saves it as maps/sp_sofia.vmf, taking screenshots along the way. Requires the dev server.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('  [console]', m.text()); });
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');
await page.click('#topbar button:has-text("New")');
await page.dblclick('.newmap [data-template="empty"]');

// 1. The layout as a sketch: height levels, surfaces, features and markers.
await d.eval(async () => {
  const { buildSofiaSketch } = await import('/src/examples/sofia.ts');
  window.__editor.editor.sketch = buildSofiaSketch();
});
await page.click('#topbar button:has-text("Sketch")');
await page.waitForTimeout(600);
await page.click('.sketch-side .seg button:text-is("Height")');
await page.waitForTimeout(300);
await d.shot('sofia-01-sketch-height');
await page.click('.sketch-side .seg button:text-is("Markers")');
await page.waitForTimeout(300);
await d.shot('sofia-02-sketch-layout');

// 2. Generate the 3D map, then add landmarks, props, decals and the mission logic.
await page.click('.sketch-side button:has-text("Generate 3D map")');
await d.settle(2500);
const report = await d.eval(async () => {
  const { decorateSofia } = await import('/src/examples/sofia.ts');
  const e = window.__editor.editor;
  e.mapName = 'sp_sofia.vmf';
  return decorateSofia(e);
});
console.log('decorated', report);
// Same fix the compile dialog offers: props whose model is physics-only become prop_dynamic.
console.log('converted to prop_dynamic', await d.eval(async () => {
  const { nonStaticProps, convertToDynamic } = await import('/src/edit/preflight.ts');
  const e = window.__editor.editor;
  const bad = await nonStaticProps(e);
  convertToDynamic(e, bad);
  return [...new Set(bad.map((x) => x.get('model')))];
}));
await d.settle(3000);
const stats = await d.eval(() => {
  const e = window.__editor.editor;
  return { brushes: e.doc.allSolids().length, entities: e.doc.entities.length, ...e.decals.stats };
});
console.log('map', stats);
console.log('saved', await d.eval(() => window.__editor.editor.save('sp_sofia.vmf')));

// 3. Screenshots of the result.
const shot = async (name, pos, target, wait = 900) => {
  await d.view(pos, target);
  await d.settle(wait);
  await d.shot(name);
};
await d.key('t');
await d.eval(() => window.__editor.editor.frameBox(window.__editor.editor.world.bounds()));
await d.settle(1500);
await d.shot('sofia-03-top-view');
await d.key('t');
await shot('sofia-04-overview', [-3400, -5600, 3600], [0, 200, 0], 1500);
await shot('sofia-05-old-town-alleys', [-1500, -4200, 700], [-500, -2600, 0]);
await shot('sofia-06-courtyard', [-2900, -3700, 650], [-3500, -3200, 0]);
await shot('sofia-07-tram-line', [-3600, -900, 520], [-600, -720, 160]);
await shot('sofia-08-largo', [-64, -900, 900], [-64, 1800, 300]);
await shot('sofia-09-party-house', [-900, 1600, 700], [0, 3300, 600]);
await shot('sofia-10-cathedral', [1500, 300, 1900], [3200, 2240, 800]);
await shot('sofia-11-corner-tower', [-2500, -1150, 520], [-1728, -128, 700]);
await d.key('l');
await shot('sofia-12-lit-overview', [-3400, -5600, 3600], [0, 200, 0], 1500);
await shot('sofia-13-lit-largo', [-64, -900, 900], [-64, 1800, 300], 1200);
await d.key('l');
await page.click('.rail-item[aria-label^="Logic"]');
await page.click('button:text("Open logic graph")');
await page.waitForTimeout(600);
await d.shot('sofia-14-logic-graph');
await page.click('.modal-backdrop:not([hidden]) .modal-head button');
await page.click('.rail-item[aria-label^="Mission"]');
await d.shot('sofia-15-mission-summary');

// 4. Compile through the compile dialog (checks, then vbsp/vvis/vrad and the navmesh).
await page.click('#topbar button:has-text("Compile & test")');
await page.waitForTimeout(1500);
await page.uncheck('.modal input[type=checkbox] >> nth=1');
await d.shot('sofia-16-compile-checks');
await page.click('.modal button:text("Compile")');
await page.waitForFunction(() => {
  const s = document.querySelector('.compile-status')?.textContent ?? '';
  return s.startsWith('Compiled') || s.startsWith('Compile failed');
}, null, { timeout: 15 * 60 * 1000 });
console.log('compile:', await page.textContent('.compile-status'));
await d.shot('sofia-17-compiled');
await browser.close();
