// Phase 11 demo: decals (infodecal) and overlays (info_overlay): rendering existing ones and placing new ones.
import { launch, driver } from '../browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);

// City16's existing 120 decals and 21 overlays, off and on.
await d.open('repo:hlw_City16.vmf');
await d.view([380, -3150, 330], [700, -3330, 80]);
await d.settle(1500);
await page.click('#topbar button:text("Decals")');
await d.settle(300);
await d.shot('phase11-city16-decals-off');
await page.click('#topbar button:text("Decals")');
await d.settle(600);
await d.shot('phase11-city16-decals-on');
console.log('city16', await d.eval(() => window.__editor.editor.decals.stats));

// Place decals in the arena with the decal tool.
await d.open('repo:phase3_arena.vmf');
await d.view([-300, -420, 260], [-250, 400, 80]);
await d.settle(500);
await page.click('.tabs button:text("Materials")');
await page.click('.tab-body .seg button:text("Decals")');
const pickDecal = async (name) => {
  await page.fill('.tab-body input[placeholder^="Search materials"]', name);
  await page.waitForTimeout(250);
  await page.click(`.mat-tile[title="decals/${name}"]`);
};
// Posters and propaganda on the north wall (infodecal).
await pickDecal('decal_posters001a');
await d.click([-450, 960, 110]);
await pickDecal('combinepropaganda01a');
await d.click([-150, 960, 120]);
await pickDecal('decal_posters002a');
await d.click([150, 960, 100]);
// Ground decals.
await pickDecal('decal_crater001a');
await d.click([-300, 300, 16]);
await pickDecal('bloodstain_002');
await d.click([-80, 420, 16]);
await pickDecal('trashdecal01a');
await d.click([120, 260, 16]);
// A large rotated graffiti overlay on the cover block.
await pickDecal('decalgraffiti001a');
await page.selectOption('.tool-options select', 'overlay');
await page.fill('.tool-options .row:has(label:text-is("Size")) input', '220');
await page.press('.tool-options .row:has(label:text-is("Size")) input', 'Enter');
await page.fill('.tool-options .row:has(label:text-is("Rotate")) input', '-12');
await page.press('.tool-options .row:has(label:text-is("Rotate")) input', 'Enter');
await d.click([450, 960, 100]);
// A second, larger overlay across the cover block's top: clipped to the faces it covers.
await page.fill('.tool-options .row:has(label:text-is("Size")) input', '320');
await page.press('.tool-options .row:has(label:text-is("Size")) input', 'Enter');
await d.click([-256, 0, 112]);
await d.settle(800);
await d.key('Escape');
await d.shot('phase11-arena-decals');

await d.view([-80, 280, 330], [-260, 20, 100]);
await d.settle(400);
await d.shot('phase11-overlay-closeup');
const counts = await d.eval(() => ({ ...window.__editor.editor.decals.stats, overlaySides: window.__editor.editor.doc.entities.find((e) => e.classname === 'info_overlay')?.get('sides') }));
console.log('arena', counts);
console.log('saved', await d.eval(() => window.__editor.editor.save('phase11_decals.vmf')));
await browser.close();
