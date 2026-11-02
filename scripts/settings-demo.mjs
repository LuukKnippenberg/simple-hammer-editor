// Map settings demo: the Settings tab on Sofia (with fog in the lighting preview) and on a new map.
import { baseUrl, withEditor } from './browser.mjs';

await withEditor(async (d, page) => {
  await page.goto(baseUrl + '?map=repo%3Asp_sofia.vmf');
  await page.evaluate(() => localStorage.setItem('she.settings.open', JSON.stringify(['sun', 'fog', 'exposure'])));
  await d.open('repo:sp_sofia.vmf');
  await page.click('.rail-item[aria-label^="Settings"]');
  await d.key('l');
  await d.view([2400, -1700, 2500], [3700, 1300, 0]);
  await d.settle(1500);
  await d.shot('settings-sofia');

  // A new map: collapse sun and fog, open colour correction.
  await page.click('#topbar button:text("New")');
  await page.dblclick('.newmap [data-template="empty"]');
  for (const title of ['Sun & ambient light', 'Fog', 'Colour correction']) await page.click(`.set-head:has(b:text-is("${title}"))`);
  await d.settle(500);
  await d.shot('settings-new-map');
});
