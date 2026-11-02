// Surroundings: a small street-grid map with a different style beyond each edge (city south and west, hills east,
// a Combine wall north). Generates it through the sketch dialog, takes editor screenshots and saves
// maps/surround_demo.vmf.
//   node scripts/surroundings-demo.mjs [prefix]
import { withEditor } from './browser.mjs';

const prefix = process.argv[2] ?? 'surround';

await withEditor(async (d, page) => {
  await d.open('repo:phase3_arena.vmf');
  await page.click('#topbar button:has-text("New")');
  await page.dblclick('.newmap [data-template="empty"]');
  await d.eval(async () => {
    const { emptySketch, streetGrid, SOFIA_GRID } = await import('/src/gen/sketch.ts');
    const s = emptySketch(40, 32, 'city');
    s.seed = 41;
    streetGrid(s, { ...SOFIA_GRID, block: 9, seed: 41 });
    s.blockSize = 11; s.yards = 'green'; s.openYards = 0.3; s.streets = 'sofia'; s.buildingDetail = 'auto'; s.floors = [4, 5];
    s.markers = [{ kind: 'mp_start', x: 6, y: 6 }, { kind: 'mp_start', x: 34, y: 26 }];
    s.surroundings = { style: 'city', sides: { e: 'hills', n: 'wall' } };
    window.__editor.editor.sketch = s;
  });
  await page.click('#topbar button:has-text("Sketch")');
  await page.waitForTimeout(800);
  await d.shot(`${prefix}-01-sketch`);
  await page.click('.sketch-side button:has-text("Generate 3D map")');
  await d.settle(5000);
  const info = await d.eval(async () => {
    const ed = window.__editor.editor;
    const { runChecks } = await import('/src/edit/preflight.ts');
    const around = ed.doc.entities.find((e) => e.get('targetname') === 'surroundings');
    return {
      checks: runChecks(ed).map((c) => `${c.ok ? 'ok' : c.severity}: ${c.label}`),
      brushes: ed.doc.allSolids().length, surroundings: around?.solids.length ?? 0,
      walls: ed.doc.entities.filter((e) => /combineinnerwall/.test(e.get('model') ?? '')).length,
      trees: ed.doc.entities.filter((e) => /tree_pine|deciduous_01a/.test(e.get('model') ?? '')).length,
      saved: await ed.save('surround_demo.vmf'),
    };
  });
  console.log(JSON.stringify(info));
  await d.eval(() => { const W = window.__editor; W.lighting.setEnabled(true); W.editor.emit('lighting'); W.lighting.refresh(); });
  await d.settle(3000);
  const rts = (x, y, h) => d.view([x + 0.33 * h, y - 0.33 * h, h], [x, y, 0]);
  for (const [name, go] of [
    ['02-overview', () => d.view([1500, -7800, 6400], [0, 0, 0])],
    ['03-north-wall', () => rts(-600, 2500, 2000)],
    ['04-east-hills', () => rts(3300, 600, 2200)],
    ['05-south-city', () => rts(400, -2300, 1500)],
    ['06-corner', () => rts(-2800, 2400, 1700)],
  ]) {
    await go();
    await d.settle(1500);
    await d.shot(`${prefix}-${name}`);
  }
});
