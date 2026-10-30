// Phase 8 demo: Lambda Wars kits in the Mission tab, placed with real clicks, then saved for compiling.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase7_scripted_arena.vmf');
await d.view([-1500, -1600, 1500], [0, 0, 0]);

await page.click('.tabs button:text("Mission")');
await page.fill('.tab-body .row:has(label:text-is("Title")) input', 'Arena Holdout');
await page.press('.tab-body .row:has(label:text-is("Title")) input', 'Tab');
await page.fill('.tab-body .row:has(label:text-is("Description")) textarea', 'Hold the arena against zombies and a Combine counterattack.');
await page.press('.tab-body .row:has(label:text-is("Description")) textarea', 'Tab');

const kit = async (label, settings, points) => {
  await page.click(`.kits .kit:has-text("${label}")`);
  for (const [k, val] of Object.entries(settings)) {
    const row = page.locator(`.tab-body > div:not([hidden]) .row:has(label:text-is("${k}"))`);
    const sel = row.locator('select');
    if (await sel.count()) await sel.selectOption(String(val));
    else if (typeof val === 'boolean') await (val ? row.locator('input').check() : row.locator('input').uncheck());
    else { await row.locator('input').fill(String(val)); await row.locator('input').press('Tab'); }
  }
  for (const p of points) await d.click(p);
  await d.settle(150);
};

await kit('Mission player start', { Faction: 'rebels', 'Squad unit': 'rebel_ar2', 'Squad size': 6, 'Facing (°)': 45 }, [[-640, -640, 16]]);
await kit('Unit group', { Unit: 'zombie', Count: 6, Owner: '1', Name: 'arena_zombies' }, [[512, -512, 16], [-512, 512, 16]]);
await kit('Attack wave', { Name: 'combine_wave', Unit: 'combine', 'Total units': 8, 'Alive at once': 4, Owner: '3', 'Goal offset X': -900 }, [[768, 768, 16]]);
await kit('Mission message', { Text: 'Zombies in the arena. Clear them out, then hold the centre.', Show: 'start', 'Delay (s)': 2 }, [[-800, -400, 16]]);
await kit('Objective', { Description: 'Hold the centre point', 'Completing wins': true }, [[-800, -300, 16]]);
await page.click('button:text("Apply standard relations")');
await d.settle(300);
await d.key('Escape');
await d.view([-1500, -1600, 1500], [0, 0, 0]);
await d.settle(600);
await d.shot('phase8-kits-placed');

// Close-up of the wave with its route and the capture ring.
await d.view([-300, -200, 900], [500, 500, 0]);
await d.settle(400);
await d.shot('phase8-wave-and-capture-ring');

// Wire the trigger so it also starts the wave (scripting from phase 7 on top of kits).
await d.eval(() => {
  const e = window.__editor.editor;
  e.selection.set([], [e.doc.entities.find((x) => x.get('targetname') === 'entrance_trigger')]);
});
await page.click('.tabs button:text("Selection")');
await page.click('button:text("+ Add output")');
const row = page.locator('.io-row').last();
await row.locator('select').first().selectOption('OnStartTouch');
await row.locator('input[placeholder="target"]').fill('combine_wave');
await row.locator('input[placeholder="target"]').press('Enter');
await page.waitForTimeout(150);
await page.locator('.io-row').last().locator('select').nth(1).selectOption('Enable');
await page.locator('.io-row').last().locator('input[type=number]').fill('20');
await page.locator('.io-row').last().locator('input[type=number]').press('Enter');
await d.settle(300);
await page.click('.tabs button:text("Mission")');
await d.view([-1500, -1600, 1500], [0, 0, 0]);
await d.settle(300);
await d.shot('phase8-mission-summary');
console.log('saved', await d.eval(() => window.__editor.editor.save('sp_she_arena.vmf')));
await browser.close();
