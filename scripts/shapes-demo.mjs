// Free shapes: a district of blocks with a diagonal avenue, a curved street and a round paved square with a round
// lawn in it, all drawn with the sketch's Shapes layer (clicks and a drag on the canvas), then generated. Takes
// screenshots and saves maps/shapes_demo.vmf.
//   node scripts/shapes-demo.mjs [prefix]
import { withEditor } from './browser.mjs';

const prefix = process.argv[2] ?? 'shapes';

await withEditor(async (d, page) => {
  await d.open('repo:phase3_arena.vmf');
  await page.click('#topbar button:has-text("New")');
  await page.dblclick('.newmap [data-template="empty"]');
  const W = 40, H = 32;
  await d.eval(async ([W, H]) => {
    const { emptySketch, Surface, Feature } = await import('/src/gen/sketch.ts');
    const { STREET_PRESETS } = await import('/src/gen/streetMaterials.ts');
    const s = emptySketch(W, H, 'city');
    s.seed = 57; s.floors = [4, 5]; s.architecture = 'tenement'; s.yards = 'green'; s.blockSize = 10; s.buildingDetail = 'auto';
    const fill = (x0, y0, x1, y1, f) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) f(y * W + x, x, y); };
    // Blocks everywhere but a ring road round the edge and one straight street; the shapes cut the rest.
    fill(0, 0, W - 1, H - 1, (i) => (s.features[i] = Feature.Building));
    for (const [x0, y0, x1, y1] of [[0, 0, W - 1, 2], [0, H - 3, W - 1, H - 1], [0, 0, 2, H - 1], [W - 3, 0, W - 1, H - 1], [27, 0, 29, H - 1]]) {
      fill(x0, y0, x1, y1, (i) => { s.surface[i] = Surface.Road; s.features[i] = Feature.None; });
    }
    s.streetMaterials = { ...STREET_PRESETS.find((p) => p.id === 'old_town').materials };
    s.markers = [{ kind: 'mp_start', x: 6, y: 6 }, { kind: 'mp_start', x: 34, y: 26 }];
    s.surroundings = { style: 'city' };
    window.__editor.editor.sketch = s;
  }, [W, H]);
  await page.click('#topbar button:has-text("Sketch")');
  await page.waitForTimeout(800);
  await page.click('.sketch-side .seg button:text-is("Shapes")');
  await page.waitForTimeout(300);
  const canvas = page.locator('.sketch-canvas');
  const at = async (fx, fy) => {
    const r = await canvas.boundingBox();
    return [r.x + (fx / W) * r.width, r.y + ((H - fy) / H) * r.height];
  };
  const click = async (fx, fy, opts = {}) => { const [x, y] = await at(fx, fy); await page.mouse.click(x, y, opts); await page.waitForTimeout(80); };
  // A round paved square in the middle, a round lawn inside it.
  const drag = async (a, b) => {
    const [ax, ay] = await at(...a), [bx, by] = await at(...b);
    await page.mouse.move(ax, ay); await page.mouse.down();
    await page.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 4 }); await page.mouse.move(bx, by, { steps: 4 });
    await page.mouse.up(); await page.waitForTimeout(150);
  };
  await page.click('.sketch-side .seg button:text-is("Round area")');
  await page.click('.sketch-side .pal:has-text("Paving")');
  await drag([9, 10], [21, 22]);
  await page.click('.sketch-side .pal:has-text("Grass")');
  await drag([12.5, 13.5], [17.5, 18.5]);
  // A diagonal avenue from the south-west corner to the square, and on to the north.
  await page.click('.sketch-side .seg button:text-is("Street")');
  await page.waitForTimeout(150);
  for (const [x, y] of [[1.5, 1.5], [10, 10]]) await click(x, y);
  await page.keyboard.press('Enter');
  for (const [x, y] of [[20, 22], [24, 30.5]]) await click(x, y);
  await page.keyboard.press('Enter');
  // A curved street from the west round to the straight street (its bends rounded by the radius).
  for (const [x, y] of [[1.5, 25], [8, 27], [15, 27], [21, 24], [28.5, 17]]) await click(x, y);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await d.shot(`${prefix}-01-sketch`);
  const count = await d.eval(() => window.__editor.editor.sketch?.shapes?.length ?? 0);
  await page.click('.sketch-side button:has-text("Generate 3D map")');
  await d.settle(6000);
  const info = await d.eval(async () => {
    const ed = window.__editor.editor;
    const { runChecks } = await import('/src/edit/preflight.ts');
    return { shapes: ed.sketch?.shapes?.length, checks: runChecks(ed).filter((c) => !c.ok).map((c) => c.label), saved: await ed.save('shapes_demo.vmf') };
  });
  console.log(JSON.stringify({ drawn: count, ...info }));
  await d.eval(() => { const W = window.__editor; W.lighting.setEnabled(true); W.editor.emit('lighting'); W.lighting.refresh(); });
  await d.settle(3000);
  await d.key('t');
  await d.eval(() => window.__editor.editor.frameBox(window.__editor.editor.world.bounds()));
  await d.settle(2000);
  await d.shot(`${prefix}-02-top`);
  await d.key('t');
  const rts = (x, y, h) => d.view([x + 0.33 * h, y - 0.33 * h, h], [x, y, 0]);
  for (const [name, x, y, h] of [['03-square', -640, 0, 1800], ['04-avenue', -1824, -1312, 1300], ['05-curve', -900, 1408, 1300], ['06-diagonal', 256, 1250, 1300], ['07-overview', 0, 0, 3600]]) {
    await rts(x, y, h);
    await d.settle(1500);
    await d.shot(`${prefix}-${name}`);
  }
});
