// Phase 4 demo: compile checks, one-click fixes, compile through the dialog. The in-game screenshot is
// taken separately (scripts/capture-window.ps1) once the game has loaded the map.
import { launch, driver } from '../browser.mjs';

const map = process.argv[2] ?? 'repo:phase3_arena.vmf';
const prefix = process.argv[3] ?? 'phase4';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const d = driver(page);

await d.open(map);
await page.click('#topbar button:has-text("Compile & test")');
await page.waitForTimeout(400);
await d.shot(`${prefix}-checks-before`);

const fixAll = page.locator('.checks button:text("Fix all")');
if (await fixAll.count()) await fixAll.click();
await page.waitForTimeout(400);
// Leave launching to the caller so the screenshot timing is under control.
await page.uncheck('.modal input[type=checkbox] >> nth=1');
await d.shot(`${prefix}-checks-fixed`);

await page.click('.modal button:text("Compile")');
await page.waitForFunction(() => {
  const s = document.querySelector('.compile-status')?.textContent ?? '';
  return s.startsWith('Compiled') || s.startsWith('Compile failed');
}, null, { timeout: 15 * 60 * 1000 });
console.log('status:', await page.textContent('.compile-status'));
await d.shot(`${prefix}-compiled`);

// Save the fixed-up map so the compiled version is the one in the repo.
await page.click('.modal-backdrop:not([hidden]) .modal-head button');
const saved = await d.eval(() => window.__editor.editor.save());
console.log('saved', saved);

// Show the sky shell and boundary that the fixes added.
await page.click('#topbar button:text("Tool brushes")');
await page.click('#topbar button:text("Sky brushes")');
await d.eval(() => {
  const e = window.__editor.editor;
  e.frameBox(e.world.bounds());
});
await d.settle(400);
await d.shot(`${prefix}-shell-and-boundary`);
await browser.close();
