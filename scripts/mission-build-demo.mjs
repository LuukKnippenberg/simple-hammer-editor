// Mission flow → entities: draw a reach area in the viewport, build the flowchart into Sofia, inspect the logic.
import { withEditor } from './browser.mjs';

await withEditor(async (d, page) => {
  await d.open('repo:sp_sofia.vmf');
  await page.click('.tabs button:text("Mission")');
  await page.click('button:has-text("Open mission flow")');
  await d.settle(500);

  // The tram line stage's "reach" transition: redraw its area over the Largo with the mouse.
  await page.click('.mf-node[data-id="tram"] .mf-title');
  await d.settle(200);
  await page.click('.mf-side .mf-transition >> nth=0 >> button:has-text("Redraw")');
  await d.settle(800);
  await d.eval(() => { const ed = window.__editor.editor; ed.topView.center.set(0, 1200); ed.topView.zoom = 2600; ed.topView.apply(); });
  await d.settle(600);
  const a = await d.project([-1536, 128, 128]);
  const b = await d.project([1408, 2688, 128]);
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 6 });
  await page.mouse.move(b[0], b[1], { steps: 6 });
  await d.shot('mission-draw-area');
  await page.mouse.up();
  await d.settle(500);
  console.log('  area', JSON.stringify(await d.eval(() => window.__editor.editor.mission.stages[1].transitions[0].condition)));

  // Build the flowchart into the map.
  await page.click('.mission-flow button:has-text("Build into map")');
  await d.settle(800);
  await d.shot('mission-built-toast');
  const stats = await d.eval(() => {
    const ed = window.__editor.editor;
    const mine = ed.doc.entities.filter((e) => e.get('she_mission') === '1');
    const byClass = {};
    for (const e of mine) byClass[e.classname] = (byClass[e.classname] ?? 0) + 1;
    return { entities: mine.length, byClass };
  });
  console.log('  built', JSON.stringify(stats));
  await page.click('.mission-flow .modal-head button:text("✕")');
  await d.settle(300);
  // The triggers in the viewport, and the logic graph.
  await page.click('#topbar button:text("Tool brushes")');
  await d.view([-3800, -4600, 3600], [0, 600, 0]);
  await d.settle(900);
  await d.shot('mission-built-triggers');
  await page.click('.tabs button:text("Logic")');
  await page.click('button:text("Open logic graph")');
  await d.settle(800);
  await d.shot('mission-built-logic');
  await page.click('.modal-backdrop:not([hidden]) .modal-head button:text("✕")');
  // Undo takes the whole build back.
  console.log('  undo:', await d.eval(() => { const ed = window.__editor.editor; ed.undo(); return ed.doc.entities.filter((e) => e.get('she_mission') === '1').length; }));
});
