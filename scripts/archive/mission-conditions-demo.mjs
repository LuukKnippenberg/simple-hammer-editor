// Mission flow with game-event conditions: the flowchart of sp_mission_events, the editors for an "all of"
// transition, ability gates and message speakers, and a play-through counting events.
//   node scripts/archive/mission-conditions-demo.mjs
import { withEditor } from '../browser.mjs';

await withEditor(async (d, page) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await d.open('repo:sp_mission_events.vmf');
  await page.click('.rail-item[aria-label^="Mission"]');
  await page.click('button:has-text("Open mission flow")');
  await d.settle(500);
  await page.click('.mission-flow button:has-text("Fit")');
  await d.settle(300);
  await d.shot('mission-conditions-flow');

  // The "all of" transition and its parts.
  await page.click('.mf-node[data-id="c"] .mf-title');
  await d.settle(300);
  await page.evaluate(() => document.querySelector('.mf-side h3:last-of-type')?.scrollIntoView());
  await d.shot('mission-conditions-allof');
  // Ability gates and speakers.
  await page.click('.mf-node[data-id="d"] .mf-title');
  await d.settle(300);
  await page.evaluate(() => [...document.querySelectorAll('.mf-side h3')].find((x) => x.textContent.startsWith('Abilities'))?.scrollIntoView());
  await d.shot('mission-conditions-gates');

  // Play-through: the barricades count to three, the all-of needs both parts.
  await page.click('.mission-flow button:has-text("Play through")');
  await d.settle(200);
  const take = async (text) => { await page.click(`.mf-side button.mf-sim-tr:has-text("${text}")`); await d.settle(150); };
  await page.click('.mf-sim-msg button:has-text("Continue")').catch(() => {});
  await take('Garrison');
  await take('Barricade');
  await take('Barricade');
  await d.shot('mission-conditions-sim-count');
  await take('Barricade');
  await take('Unlock AR2');
  await d.shot('mission-conditions-sim-allof');
  await take('Unlock Shotgun');
  await take('Unlock AR2');
  console.log('  stage after all-of:', await page.evaluate(() => document.querySelector('.mf-sim-stage')?.textContent));
});
