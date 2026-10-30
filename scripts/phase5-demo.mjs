// Phase 5 demo: layout painter → generated maps (rural and city), and the building generator.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

// --- Layout painter (rural) -------------------------------------------------------------------
await page.click('#topbar button:has-text("Generate map")');
await page.waitForTimeout(300);
const canvas = await page.locator('.layout-canvas').boundingBox();
const cell = (x, y) => [canvas.x + (x + 0.5) * (canvas.width / 24), canvas.y + canvas.height - (y + 0.5) * (canvas.height / 24)];
// Paint an extra road across the south-west with real mouse drags (rotational symmetry mirrors it).
await page.click('.palette .pal:has-text("Road")');
await d.drag(cell(6, 9), cell(11, 9), { screen: true, steps: 10 });
await page.click('.palette .pal:has-text("High ground")');
await page.selectOption('.gen-side select >> nth=0', '2');
await d.drag(cell(15, 3), cell(17, 3), { screen: true, steps: 6 });
await d.shot('phase5-layout-painter');
await page.click('.modal button:has-text("Generate map")');
await d.settle(1500);
await d.view([-4700, -4900, 5200], [0, 0, 0]);
await d.settle(800);
await d.shot('phase5-rural-overview');
await d.view([-3250, -3350, 1100], [-2300, -2200, 0]);
await d.settle(600);
await d.shot('phase5-rural-base-closeup');

// --- City theme ---------------------------------------------------------------------------------
await page.click('#topbar button:has-text("Generate map")');
await page.selectOption('.gen-side select >> nth=2', 'city');
await page.fill('.gen-side input[type=number]', '42');
await page.click('.modal button:has-text("Random layout")');
await page.waitForTimeout(200);
await d.shot('phase5-city-layout');
await page.click('.modal button:has-text("Generate map")');
await d.settle(2500);
await d.view([-4700, -4900, 5200], [0, 0, 0]);
await d.settle(1000);
await d.shot('phase5-city-overview');
// Close-up on the largest generated building block.
const target = await d.eval(() => {
  const e = window.__editor.editor;
  let best = null;
  for (const s of e.doc.worldEntity.solids) {
    if (!s.sides.some((x) => x.material.startsWith('BUILDING_TEMPLATE'))) continue;
    const b = e.world.solidBounds(s);
    const h = b.max.z - b.min.z;
    if (!best || h > best.h) best = { h, c: b.getCenter(b.min.clone()).toArray() };
  }
  return best?.c;
});
if (target) {
  await d.view([target[0] - 1100, target[1] - 1250, 1250], [target[0], target[1], 150]);
  await d.settle(800);
  await d.shot('phase5-city-buildings');
}
console.log('city save', await d.eval(() => window.__editor.editor.save('phase5_city.vmf')));

// --- Building generator on a hand-drawn block -----------------------------------------------------
await page.click('#topbar button:text("New")');
await d.view([-1300, -1500, 1250], [0, 0, 0]);
await d.eval(() => window.__editor.editor.setMaterial('CONCRETE/CONCRETEFLOOR028C'));
await d.key('2');
await page.fill('.tool-options input[type=number]', '16');
await page.press('.tool-options input[type=number]', 'Enter');
await d.drag([-1024, -1024, 0], [1024, 1024, 0]);
await page.fill('.tool-options input[type=number]', '64');
await page.press('.tool-options input[type=number]', 'Enter');
await d.eval(() => window.__editor.editor.setMaterial('BRICK/BRICKWALL014A'));
await d.drag([-512, -384, 16], [640, 384, 16]);
await d.key('1');
await d.key('Escape');
await d.click([64, 0, 80]);
await d.settle(300);
await d.shot('phase5-block-selected');
await page.selectOption('.tab-body .section:has-text("Generate buildings") select', '');
await page.click('button:has-text("Generate buildings")');
await d.settle(1200);
await d.key('Escape');
await d.settle(300);
await d.shot('phase5-buildings-generated');
await d.view([-900, -1050, 420], [0, 0, 260]);
await d.settle(600);
await d.shot('phase5-buildings-closeup');
await page.keyboard.press('Control+z');
await d.settle(300);
const afterUndo = await d.eval(() => window.__editor.editor.doc.allSolids().length);
console.log('brushes after one undo (floor + block):', afterUndo);
await browser.close();
