// Mission flow checks, stage actions and the play-through, on Sofia's flowchart.
import { withEditor } from '../browser.mjs';

await withEditor(async (d, page) => {
  await d.open('repo:sp_sofia.vmf');
  await page.click('.rail-item[aria-label^="Mission"]');
  await page.click('button:has-text("Open mission flow")');
  await d.settle(600);
  console.log('  status:', await page.textContent('.mission-flow .modal-head .hint'));
  await d.shot('mission-check-ok');

  // A typo in the capture target and an action on a unit maker that doesn't exist.
  await d.eval(() => {
    const g = window.__editor.editor.mission;
    g.stages[2].transitions[0].condition.target = 'largo_flg';
    g.stages[1].actions.push({ id: 'ax', target: 'rebel_reinforce2', input: 'Enable', param: '', delay: 0 });
  });
  await page.click('.mission-flow button:has-text("Check")');
  await d.settle(400);
  console.log('  issues:', JSON.stringify(await page.$$eval('.mf-issue', (els) => els.map((e) => e.textContent))));
  await d.shot('mission-check-issues');
  await d.eval(() => {
    const g = window.__editor.editor.mission;
    g.stages[2].transitions[0].condition.target = 'largo_flag';
    g.stages[1].actions.pop();
  });
  await page.click('.mission-flow button:has-text("Check")');
  await d.settle(300);

  // The assault stage's actions: the two Combine waves.
  await page.click('.mf-node[data-id="assault"] .mf-title');
  await d.settle(300);
  await page.$eval('.mf-side', (el) => { const h = [...el.querySelectorAll('h3')].find((x) => x.textContent.startsWith('Actions')); el.scrollTop = h.offsetTop - 60; });
  await d.settle(200);
  await d.shot('mission-flow-actions');

  // Play it through: the old town → the tram line → the Largo → Victory.
  await page.click('.mission-flow button:has-text("Play through")');
  await d.settle(400);
  await page.click('.mf-sim-msg button:has-text("Continue")');
  await page.click('.mf-sim-tr >> nth=0');
  await d.settle(200);
  await page.click('.mf-sim-tr >> nth=0');
  await d.settle(400);
  await d.shot('mission-sim-assault');
  await page.click('.mf-sim-tr >> nth=0');
  await d.settle(400);
  console.log('  path:', JSON.stringify(await page.$$eval('.mf-sim-log > div', (els) => els.map((e) => e.textContent))));
  await d.shot('mission-sim-victory');
});
