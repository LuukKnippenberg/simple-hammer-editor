// Mission flow editor: Sofia's mission as stages and transitions; a transition connected by dragging its handle.
import { withEditor } from './browser.mjs';

await withEditor(async (d, page) => {
  await d.open('repo:sp_sofia.vmf');
  // Start from no flowchart (a saved one loads with the map).
  await d.eval(() => { const ed = window.__editor.editor; ed.mission = null; ed.emit('mission'); });
  await page.click('.rail-item[aria-label^="Mission"]');
  await d.settle(300);
  await d.shot('mission-tab-empty');
  await page.click('button:has-text("Create mission flow")');
  await d.settle(400);

  // Sofia's mission as a graph. The last transition is added without a target and connected by dragging.
  await d.eval(() => {
    const ed = window.__editor.editor;
    const g = ed.mission;
    const t = (id, condition, to, completes = true) => ({ id, condition, to, completes });
    g.stages = [
      {
        id: 'oldtown', title: 'The old town', x: 40, y: 60,
        messages: ['Sofia, old town. The Combine garrison holds the Largo, but the alleys between us are crawling with the dead. Push north through the courtyards to the tram line.'],
        objectives: [{ id: 'o1', text: 'Fight through the old town to the tram line' }],
        transitions: [
          t('t1', { kind: 'reach', area: [-4064, -1024, 4064, -512], z: 128, owner: '2' }, 'tram'),
          t('t2', { kind: 'destroy_faction', owner: '2' }, 'defeat', false),
        ],
      },
      {
        id: 'tram', title: 'The tram line', x: 360, y: 40,
        messages: ['The tram line. The Largo is just north and the Combine are dug in around the Party House. Reinforcements are coming up the line from the east.'],
        objectives: [{ id: 'o2', text: 'Take the Largo' }],
        transitions: [
          t('t3', { kind: 'reach', area: [-1536, 128, 1408, 2688], z: 128, owner: '2' }, 'assault'),
          t('t4', { kind: 'destroy_faction', owner: '2' }, 'defeat', false),
        ],
      },
      {
        id: 'assault', title: 'Assault on the Largo', x: 680, y: 60,
        messages: ['They have seen us! Combine reinforcements from the Party House and the cathedral.', 'Capture the flag in the middle of the Largo.'],
        objectives: [{ id: 'o3', text: 'Capture the flag at the Largo' }, { id: 'o4', text: 'Hold out against the counter-attack' }],
        transitions: [
          t('t5', { kind: 'capture', target: 'largo_flag', owner: '2' }, 'victory'),
          t('t6', { kind: 'destroy_faction', owner: '2' }, 'oldtown', false),
        ],
      },
    ];
    g.start = 'oldtown';
    ed.emit('mission');
    window.__editor.missionFlow.close();
    window.__editor.missionFlow.open();
  });
  await d.settle(600);
  // Drag the assault stage's "you are destroyed" handle from the old town onto Defeat.
  const handle = page.locator('.mf-node[data-id="assault"] .mf-tr').nth(1).locator('.mf-handle');
  const hb = await handle.boundingBox();
  const defeat = await page.locator('.mf-node[data-id="defeat"]').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(defeat.x + 40, defeat.y + 12, { steps: 12 });
  await d.shot('mission-flow-connecting');
  await page.mouse.up();
  await d.settle(300);
  console.log('  assault t6 →', await d.eval(() => window.__editor.editor.mission.stages[2].transitions[1].to));
  await d.shot('mission-flow');
  // Edit the assault stage in the side panel.
  await page.click('.mf-node[data-id="assault"] .mf-title');
  await d.settle(300);
  await d.shot('mission-flow-stage');
  // Save the flowchart next to the map.
  console.log('  saved', await d.eval(async () => (await fetch('/api/mission?name=sp_sofia.mission.json', { method: 'POST', headers: { 'X-SHE': '1' }, body: JSON.stringify(window.__editor.editor.mission, null, 1) })).ok));
  await page.click('.mission-flow .modal-head button:text("✕")');
  await d.settle(300);
  await d.shot('mission-tab-flow');
});
