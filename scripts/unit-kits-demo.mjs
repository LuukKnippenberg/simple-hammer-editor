// Unit kits: the searchable unit drop-down, the mixed start squad, and the new units in the viewport
// (run scripts/unit-kits-map.mjs first). EDITOR_URL picks the dev server.
import { withEditor } from './browser.mjs';

await withEditor(async (d, page) => {
  await d.open('repo:sp_unit_kits_test.vmf');

  // The viewport: player units in front, the enemy's across the field.
  await d.view([450, 1000, 800], [1150, 1950, 250]);
  await d.settle(2500);
  await d.shot('unit-kits-viewport');
  await d.view([1600, 3250, 650], [1100, 2350, 250]);
  await d.settle(1500);
  await d.shot('unit-kits-viewport-air');

  // Unit group kit: search, grouped by faction. The list is opened as a listbox for the screenshot.
  await page.click('.tabs button:text("Mission")');
  await page.click('.kits .kit:has-text("Unit group")');
  await d.settle(200);
  const picker = page.locator('.tab-body > div:not([hidden]) .row:has(label:text-is("Unit"))');
  await picker.locator('select').evaluate((s) => { s.size = 22; });
  await d.shot('unit-kits-dropdown');
  await picker.locator('input[type=search]').fill('police');
  await d.settle(200);
  await picker.locator('select').evaluate((s) => { s.size = 10; });
  await d.shot('unit-kits-dropdown-search');

  // Mission player start: mixed squad rows.
  await page.click('.kits .kit:has-text("Mission player start")');
  await d.settle(200);
  const squad = page.locator('.tab-body > div:not([hidden]) .row:has(label:text-is("Squad"))');
  await squad.locator('input[type=search]').first().fill('riot');
  await squad.locator('button:has-text("+ Add unit")').click();
  await squad.locator('input[type=search]').nth(1).fill('stalker');
  await d.settle(200);
  await d.shot('unit-kits-squad');
  console.log('squad setting:', await d.eval(() => window.__editor.editor.tools.tools.kit.params.sp_start.squad));
});
