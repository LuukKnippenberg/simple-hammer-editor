// POI phase 7: the sketch's POI layer (drawn with the mouse) and the generated map, and Generate map with POIs.
import { launch, driver } from '../browser.mjs';
import { rtsView } from '../poi-common.mjs';

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
const N = 48;
await page.selectOption('.sketch-side .row:has(label:text-is("Size")) select', String(N));
await page.selectOption('.sketch-side .row:has(label:text-is("Theme")) select', 'city');
await page.waitForTimeout(300);
const box = await page.locator('.sketch-canvas').boundingBox();
const cell = (x, y) => [box.x + (x + 0.5) * (box.width / N), box.y + box.height - (y + 0.5) * (box.height / N)];
const rect = async (x0, y0, x1, y1) => d.drag(cell(x0, y0), cell(x1, y1), { screen: true, steps: 8 });
const btn = (text) => page.click(`.sketch-side button:has-text("${text}")`);
// Roads: a cross through the middle; buildings in the corners.
await page.click('.sketch-side .seg button:text-is("Surface")');
await btn('Rectangle');
await btn('Road');
await rect(0, 22, 47, 25);
await rect(22, 0, 25, 47);
await page.click('.sketch-side .seg button:text-is("Features")');
await btn('Building');
await rect(2, 28, 9, 34);
await rect(38, 13, 45, 19);
// POIs: a square by the crossing, a market, a parking lot, a playground.
await page.click('.sketch-side .seg button:text-is("POIs")');
await page.waitForTimeout(200);
const poi = async (type, x0, y0, x1, y1) => {
  await page.selectOption('.sketch-side .row:has(label:text-is("Type")) select', type);
  await page.waitForTimeout(100);
  await rect(x0, y0, x1, y1);
};
await poi('square', 27, 27, 37, 37);
await poi('market', 10, 10, 20, 19);
await poi('parking', 27, 3, 37, 11);
await poi('playground', 11, 28, 18, 34);
await d.shot('poi-p7-sketch');
await page.click('.sketch-side button:has-text("Generate 3D map")');
await d.settle(4000);
await d.eval(() => { const W = window.__editor; if (!W.lighting.enabled) { W.lighting.setEnabled(true); W.editor.emit('lighting'); } });
await d.settle(2500);
await rtsView(d, [0, 0, 0], 5200);
await d.settle(1500);
await d.shot('poi-p7-sketch-generated');
const n = await d.eval(() => window.__editor.editor.doc.entities.filter((e) => e.get('she_poi')).length);
console.log('  POIs in the generated map:', n);
// Generate map, city theme, with POIs.
await page.click('#topbar button:has-text("Generate map")');
await page.waitForTimeout(500);
await page.selectOption('.gen-side .row:has(label:text-is("Theme")) select', 'city');
await page.fill('.gen-side .row:has(label:text-is("POIs")) input', '4');
await page.click('.gen-side button:has-text("Random layout")');
await page.waitForTimeout(300);
await page.click('.gen-side button:has-text("Generate map")');
await d.settle(6000);
await rtsView(d, [0, 0, 0], 6500);
await d.settle(2000);
await d.shot('poi-p7-generate-map');
const m = await d.eval(() => window.__editor.editor.doc.entities.filter((e) => e.get('she_poi')).map((e) => e.get('she_poi').split('|')[0]));
console.log('  POIs from Generate map:', m.join(', '));
await browser.close();
