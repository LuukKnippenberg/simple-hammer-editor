// Objectives panel in the viewport (M): step through the tutorial mission, retarget an objective by clicking a
// unit, quick-add a next objective by drawing an area, then open the flow designer on the new stage.
// Nothing is saved: the map and its mission file stay as they are.
import { withEditor } from '../browser.mjs';

await withEditor(async (d, page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) { errors.push(m.text()); console.log('  [console]', m.text()); } });
  // Missing game assets (textures, models) 404 while the map streams in; listed, not counted as errors.
  page.on('response', (r) => { if (r.status() >= 400) console.log('  [http]', r.status(), decodeURIComponent(r.url()).slice(0, 140)); });
  await d.open('repo:sp_tutorial_combine.vmf');
  await page.click('.rail-item[aria-label^="Mission"]');
  await d.settle(300);

  // 1. Open the panel from the keyboard: objective 1, its area framed and drawn.
  await page.locator('body').focus();
  await d.key('m');
  await d.settle(800);
  console.log('  open', await d.eval(() => window.__editor.missionView.open));
  await d.shot('missionvp-1-objective');

  // 2. Step on to the third objective (destroy the litterer): a target marker somewhere else.
  await d.key('PageDown');
  await d.key('PageDown');
  await d.settle(800);
  console.log('  current', await page.locator('.mvp-item.current').innerText());
  await d.shot('missionvp-2-stepped');

  // 3. Retarget it: Pick target, hover another citizen nearby (outlined), click it; the condition follows.
  // (Every unit in this map is named already; an unnamed one would be given a unique name.)
  const spot = await d.eval(() => {
    const ed = window.__editor.editor;
    const ref = ed.doc.entities.find((e) => e.get('targetname') === 'litterer').origin;
    const r = ed.renderer.domElement.getBoundingClientRect();
    // The nearest citizen the camera sees (not behind a wall, not under the panel).
    const seen = ed.doc.entities.filter((e) => e.classname === 'unit_citizen' && e.get('targetname') !== 'litterer' && e.origin)
      .sort((a, b) => a.origin.distanceTo(ref) - b.origin.distanceTo(ref))
      .map((e) => ({ e, c: ed.entities.entityBounds(e).getCenter(e.origin.clone()) }))
      .find(({ e, c }) => {
        const [x, y] = window.__editor.project([c.x, c.y, c.z]);
        if (x < r.left + 60 || x > r.right - 380 || y < r.top + 60 || y > r.bottom - 60) return false;
        const ray = ed.raycaster(ed.ndcFromEvent({ clientX: x, clientY: y }));
        const en = ed.entities.raycast(ray), b = ed.world.raycast(ray);
        return en?.entity === e && (!b || en.distance < b.distance);
      });
    return [seen.c.x, seen.c.y, seen.c.z];
  });
  await page.click('.mission-vp button:has-text("Pick target")');
  await d.settle(300);
  const [hx, hy] = await d.project(spot);
  await page.mouse.move(hx - 3, hy);
  await page.mouse.move(hx, hy, { steps: 4 });
  await d.settle(400);
  await d.shot('missionvp-3-picking');
  await page.mouse.down();
  await page.mouse.up();
  await d.settle(800);
  console.log('  retargeted to', await d.eval(() => window.__editor.editor.mission.stages.find((s) => s.id === 'litterer').transitions[0].condition.target));
  await d.shot('missionvp-3b-retargeted');

  // 4. "+ Next objective here": a reach area drawn on the ground in the top view.
  await page.selectOption('.mission-vp .mvp-add select', 'reach');
  await page.click('.mission-vp button:has-text("Next objective here")');
  await d.settle(500);
  const area = await d.eval(() => {
    const ed = window.__editor.editor;
    const o = ed.doc.entities.find((e) => e.get('targetname') === 'litterer').origin;
    return [o.x + 300, o.y + 250, o.z];
  });
  await d.drag(area, [area[0] + 420, area[1] + 320, area[2]], { steps: 16 });
  await d.settle(900);
  const added = await d.eval(() => {
    const g = window.__editor.editor.mission;
    const lit = g.stages.find((s) => s.id === 'litterer');
    const s = g.stages.find((x) => x.id === lit.transitions[0].to);
    return { id: s.id, title: s.title, to: s.transitions.map((t) => t.to), area: s.transitions[0].condition.area };
  });
  console.log('  added', JSON.stringify(added));
  await page.fill('.mission-vp .mvp-obj input', 'Check the alley behind the market');
  await page.keyboard.press('Enter');
  await d.settle(500);
  await d.shot('missionvp-4-added');

  // 5. The flow designer shows the new stage between "Civic litter" and "The runner".
  await page.click('.mission-vp button:has-text("Flow")');
  await d.settle(800);
  await page.click(`.mf-node[data-id="${added.id}"] .mf-title`);
  await d.settle(500);
  await d.shot('missionvp-5-flow');
  console.log('  dirty', await d.eval(() => window.__editor.editor.dirty), '· errors', errors.length);
});
