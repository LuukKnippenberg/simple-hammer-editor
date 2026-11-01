// Phase 10 demo: draw a map in 2D with height levels (cliffs, ramps), surfaces, features and markers,
// with real mouse input, then generate the 3D map from it.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');
await page.click('#topbar button:has-text("New")');
await page.dblclick('.newmap [data-template="empty"]');
await page.click('#topbar button:has-text("Sketch")');
await page.waitForTimeout(500);

const N = 32;
await page.selectOption('.sketch-side .row:has(label:text-is("Size")) select', String(N));
await page.selectOption('.sketch-side .row:has(label:text-is("Theme")) select', 'rural');
await page.waitForTimeout(300);
const box = await page.locator('.sketch-canvas').boundingBox();
const cell = (x, y) => [box.x + (x + 0.5) * (box.width / N), box.y + box.height - (y + 0.5) * (box.height / N)];
const btn = (text) => page.click(`.sketch-side button:has-text("${text}")`);
const rect = async (x0, y0, x1, y1) => d.drag(cell(x0, y0), cell(x1, y1), { screen: true, steps: 8 });
const stroke = async (pts) => {
  await page.mouse.move(...cell(...pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...cell(...p), { steps: 6 });
  await page.mouse.up();
};

// Height: a plateau (level 1) across the north, a hill (level 2) on it, and ramps up.
await btn('Rectangle');
await btn('Level 1');
await rect(0, 18, 31, 31);
await btn('Level 2');
await rect(20, 24, 29, 30);
await btn('Ramp');
await rect(8, 17, 10, 18);
await rect(22, 23, 23, 24);
await d.shot('phase10-sketch-height');

// Surfaces: a dirt road from the south up the ramp and along the plateau.
await page.click('.sketch-side .seg button:text-is("Surface")');
await btn('Brush');
await page.click('.sketch-side .row:has(label:text-is("Brush size")) button:text-is("2")');
await btn('Road');
await stroke([[9, 0], [9, 10], [9, 17], [9, 22], [16, 22], [22, 22], [22, 26]]);
await stroke([[0, 6], [9, 6], [20, 6], [31, 6]]);

// Features: a village, a wall, trees, and debris.
await page.click('.sketch-side .seg button:text-is("Features")');
await btn('Rectangle');
await btn('Building');
await rect(12, 8, 15, 11);
await rect(3, 9, 6, 12);
await rect(12, 1, 15, 3);
await rect(2, 21, 5, 24);
await btn('Wall');
await rect(17, 9, 17, 14);
await btn('Trees');
await btn('Brush');
await page.click('.sketch-side .row:has(label:text-is("Brush size")) button:text-is("3")');
await stroke([[24, 2], [28, 4], [27, 10], [23, 12]]);
await stroke([[2, 27], [6, 29], [12, 28], [16, 30]]);
await btn('Debris');
await page.click('.sketch-side .row:has(label:text-is("Brush size")) button:text-is("1")');
await stroke([[10, 4], [11, 5], [12, 4]]);

// Markers: mission start, zombies, a Combine squad on the hill and a capture point.
await page.click('.sketch-side .seg button:text-is("Markers")');
const mark = async (label, x, y) => { await btn(label); await page.mouse.click(...cell(x, y)); };
await mark('Mission start', 9, 2);
await mark('Zombies', 14, 6);
await mark('Zombies', 4, 15);
await mark('Combine squad', 25, 27);
await mark('Capture point', 24, 27);
await d.shot('phase10-sketch-complete');

await page.click('.sketch-side button:has-text("Generate 3D map")');
await d.settle(2500);
await d.view([-2600, -3000, 2500], [0, 200, 0]);
await d.settle(1500);
await d.shot('phase10-generated-overview');
await d.view([-700, -400, 900], [400, 900, 150]);
await d.settle(800);
await d.shot('phase10-generated-cliff-ramp');
await d.key('l');
await d.view([-2600, -3000, 2500], [0, 200, 0]);
await d.settle(1200);
await d.shot('phase10-generated-lit');
console.log('saved', await d.eval(() => window.__editor.editor.save('phase10_sketch.vmf')));
await browser.close();
