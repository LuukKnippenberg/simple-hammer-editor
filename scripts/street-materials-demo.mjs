// Street materials: a small street grid in the "Old town" look (setts, square slabs, stone kerbs, cobbled gutters,
// rounded corners), and a boulevard through it in the "Boulevard" look set per road in the road panel. Generates
// it through the sketch dialog, takes editor screenshots and saves maps/street_demo.vmf.
//   node scripts/street-materials-demo.mjs [prefix]
import { withEditor } from './browser.mjs';

const prefix = process.argv[2] ?? 'street';

await withEditor(async (d, page) => {
  await d.open('repo:phase3_arena.vmf');
  await page.click('#topbar button:has-text("New")');
  await page.dblclick('.newmap [data-template="empty"]');
  await d.eval(async () => {
    const { emptySketch, Surface, Feature } = await import('/src/gen/sketch.ts');
    const { STREET_PRESETS } = await import('/src/gen/streetMaterials.ts');
    const W = 36, H = 28;
    const s = emptySketch(W, H, 'city');
    s.seed = 91; s.floors = [4, 5]; s.architecture = 'tenement'; s.yards = 'green'; s.blockSize = 10;
    const fill = (x0, y0, x1, y1, f) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) f(y * W + x, x, y); };
    fill(0, 0, W - 1, H - 1, (i) => (s.features[i] = Feature.Building));
    // Streets 4 cells wide every 12 cells, both ways.
    for (const c of [10, 22]) {
      fill(c, 0, c + 3, H - 1, (i) => { s.surface[i] = Surface.Road; s.features[i] = Feature.None; });
      fill(0, c - 4, W - 1, c - 1, (i) => { s.surface[i] = Surface.Road; s.features[i] = Feature.None; });
    }
    s.streetMaterials = { ...STREET_PRESETS.find((p) => p.id === 'old_town').materials };
    s.markers = [{ kind: 'mp_start', x: 12, y: 8 }, { kind: 'mp_start', x: 24, y: 20 }];
    s.surroundings = { style: 'city' };
    window.__editor.editor.sketch = s;
  });
  await page.click('#topbar button:has-text("Sketch")');
  await page.waitForTimeout(800);
  // The sketch dialog's Map section with the street look.
  await page.evaluate(() => [...document.querySelectorAll('.sketch-side label')].find((l) => l.textContent === 'Street look')?.scrollIntoView());
  await page.waitForTimeout(300);
  await d.shot(`${prefix}-01-sketch-options`);
  await page.click('.sketch-side button:has-text("Generate 3D map")');
  await d.settle(5000);
  // One street in the boulevard look, through the road panel's code (the Road panel: carriageway, pavement, kerb,
  // gutter, round kerbs).
  const info = await d.eval(async () => {
    const ed = window.__editor.editor;
    const { roadOf } = await import('/src/gen/roads.ts');
    const { rebuildRoads } = await import('/src/gen/roadAction.ts');
    const { STREET_PRESETS } = await import('/src/gen/streetMaterials.ts');
    const roads = ed.doc.entities.filter((e) => roadOf(e));
    // The longest east–west street.
    const ew = roads.map((e) => ({ e, r: roadOf(e) })).filter(({ r }) => Math.abs(r.points[0].y - r.points[r.points.length - 1].y) < 1)
      .sort((a, b) => Math.abs(b.r.points[1].x - b.r.points[0].x) - Math.abs(a.r.points[1].x - a.r.points[0].x))[0];
    if (ew) rebuildRoads(ed, 'Boulevard look', { replace: [ew.e, { ...ew.r, materials: { ...STREET_PRESETS.find((p) => p.id === 'boulevard').materials } }] });
    const { runChecks } = await import('/src/edit/preflight.ts');
    const after = ed.doc.entities.filter((e) => roadOf(e));
    const boulevard = after.find((e) => roadOf(e).materials?.pavement === 'large_slabs');
    if (boulevard) ed.selection.set([], [boulevard]);
    ed.changed();
    return { roads: after.length, checks: runChecks(ed).filter((c) => !c.ok).map((c) => c.label), y: ew?.r.points[0].y, saved: await ed.save('street_demo.vmf') };
  });
  console.log(JSON.stringify(info));
  await d.eval(() => { const W = window.__editor; W.lighting.setEnabled(true); W.editor.emit('lighting'); W.lighting.refresh(); });
  await d.settle(3000);
  const rts = (x, y, h) => d.view([x + 0.33 * h, y - 0.33 * h, h], [x, y, 0]);
  await rts(0, info.y ?? 0, 1300);
  await d.settle(1500);
  await d.shot(`${prefix}-02-road-panel`);
  await d.eval(() => window.__editor.editor.selection.clear());
  for (const [name, x, y, h] of [['03-crossing', -832, -768, 1100], ['04-corner', -620, -560, 560], ['05-boulevard', 704, -768, 1100], ['06-overview', 0, 0, 3200]]) {
    await rts(x, y, h);
    await d.settle(1500);
    await d.shot(`${prefix}-${name}`);
  }
});
