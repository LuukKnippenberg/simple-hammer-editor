// Builds the "City 17 district" test map (sketch → generate) and saves it as maps/c17_district.vmf,
// with screenshots. Requires the dev server.
import { withEditor } from './browser.mjs';

await withEditor(async (d, page) => {
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('  [console]', m.text()); });
  await d.open('repo:phase3_arena.vmf');
  await page.click('#topbar button:has-text("New")');
  await page.dblclick('.newmap [data-template="empty"]');

  await d.eval(async () => {
    const { buildDistrictSketch } = await import('/src/examples/district.ts');
    window.__editor.editor.sketch = buildDistrictSketch();
  });
  await page.click('#topbar button:has-text("Sketch")');
  await page.waitForTimeout(600);
  await d.shot('district-01-sketch');
  await page.click('.sketch-side button:has-text("Generate 3D map")');
  await d.settle(3000);
  console.log('converted to prop_dynamic', await d.eval(async () => {
    const { nonStaticProps, convertToDynamic } = await import('/src/edit/preflight.ts');
    const e = window.__editor.editor;
    e.mapName = 'c17_district.vmf';
    const bad = await nonStaticProps(e);
    convertToDynamic(e, bad);
    return [...new Set(bad.map((x) => x.get('model')))];
  }));
  await d.settle(3000);
  const stats = await d.eval(() => {
    const e = window.__editor.editor;
    const cls = (c) => e.doc.entities.filter((x) => x.classname === c).length;
    return {
      brushes: e.doc.allSolids().length, world: e.doc.worldEntity.solids.length, entities: e.doc.entities.length,
      props: cls('prop_static') + cls('prop_dynamic'), decals: cls('infodecal'), cables: cls('move_rope'),
    };
  });
  console.log('map', stats);
  console.log('saved', await d.eval(() => window.__editor.editor.save('c17_district.vmf')));

  const shot = async (name, pos, target, wait = 900) => {
    await d.view(pos, target);
    await d.settle(wait);
    await d.shot(name);
  };
  await d.key('l');
  await shot('district-02-overview', [-3600, -4200, 3200], [0, 0, 0], 2000);
  await shot('district-03-rts-view', [-1200, -2300, 1700], [-600, -800, 0], 1200);
  // Streets run along x and y = -1280, 0 (through the square) and 1280; first-floor height.
  await shot('district-04-street', [-1280, -2450, 230], [-1280, 600, 380], 1200);
  await shot('district-05-square', [-1300, -1300, 700], [200, 200, 150], 1200);
  await shot('district-06-crossing', [-2450, 1280, 260], [600, 1280, 380], 1200);
  await shot('district-07-rooftops', [600, -1700, 1200], [1900, -400, 500], 1200);
});
