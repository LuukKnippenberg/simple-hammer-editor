// Blending: a paved square with a park (fountain) set into it, a parking lot marked out on the paving, a market,
// lawn strips edged with stone, streets round it and city surroundings. Generates it through the sketch dialog,
// takes editor screenshots and saves maps/blend_demo.vmf.
//   EDITOR_URL=http://localhost:5194/ node scripts/blending-demo.mjs [prefix]
import { launch, driver } from './browser.mjs';

const prefix = process.argv[2] ?? 'blend';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');
await page.click('#topbar button:has-text("New")');
await page.dblclick('.newmap [data-template="empty"]');
await d.eval(async () => {
  const { emptySketch, Surface, Feature } = await import('/src/gen/sketch.ts');
  const W = 40, H = 32;
  const s = emptySketch(W, H, 'city');
  s.seed = 77; s.floors = [4, 5]; s.architecture = 'tenement'; s.streets = 'sofia'; s.yards = 'green'; s.blockSize = 10;
  const fill = (x0, y0, x1, y1, f) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) f(y * W + x, x, y); };
  // Blocks round the edge, streets inside them, the square in the middle.
  for (const [x0, y0, x1, y1] of [[0, 0, 39, 5], [0, 26, 39, 31], [0, 6, 5, 25], [34, 6, 39, 25]]) fill(x0, y0, x1, y1, (i) => (s.features[i] = Feature.Building));
  for (const [x0, y0, x1, y1] of [[6, 6, 33, 9], [6, 22, 33, 25], [6, 10, 9, 21], [30, 10, 33, 21]]) fill(x0, y0, x1, y1, (i) => (s.surface[i] = Surface.Road));
  // Lawn strips along the square's long sides, a dirt patch by the market.
  fill(11, 10, 28, 10, (i) => (s.surface[i] = Surface.Grass));
  fill(11, 21, 28, 21, (i) => (s.surface[i] = Surface.Grass));
  fill(25, 12, 28, 13, (i) => (s.surface[i] = Surface.Dirt));
  s.pois = [
    { type: 'park', x: 10, y: 12, w: 12, h: 9, seed: 5, params: { feature: 'fountain', trees: 40 } },
    { type: 'parking', x: 22, y: 14, w: 8, h: 7, seed: 6, params: { rows: 2 } },
    { type: 'market', x: 22, y: 11, w: 3, h: 3, seed: 7 },
  ];
  s.markers = [{ kind: 'mp_start', x: 8, y: 8 }, { kind: 'mp_start', x: 32, y: 24 }];
  s.surroundings = { style: 'city' };
  window.__editor.editor.sketch = s;
});
await page.click('#topbar button:has-text("Sketch")');
await page.waitForTimeout(800);
await page.click('.sketch-side .seg button:text-is("Surface")');
await page.waitForTimeout(300);
await d.shot(`${prefix}-01-sketch`);
await page.click('.sketch-side button:has-text("Generate 3D map")');
await d.settle(5000);
const info = await d.eval(async () => {
  const ed = window.__editor.editor;
  const { runChecks } = await import('/src/edit/preflight.ts');
  return {
    checks: runChecks(ed).filter((c) => !c.ok).map((c) => `${c.severity}: ${c.label}`),
    overlays: ed.doc.entities.filter((e) => e.classname === 'info_overlay').length,
    saved: await ed.save('blend_demo.vmf'),
  };
});
console.log(JSON.stringify(info));
await d.eval(() => { const W = window.__editor; W.lighting.setEnabled(true); W.editor.emit('lighting'); W.lighting.refresh(); });
await d.settle(3000);
const rts = (x, y, h) => d.view([x + 0.33 * h, y - 0.33 * h, h], [x, y, 0]);
for (const [name, go] of [
  ['02-square', () => rts(-100, -200, 2400)],
  ['03-park', () => rts(-500, -300, 1300)],
  ['04-parking', () => rts(800, -100, 1200)],
  ['05-lawn-edge', () => rts(200, -650, 900)],
]) {
  await go();
  await d.settle(1500);
  await d.shot(`${prefix}-${name}`);
}
await browser.close();
