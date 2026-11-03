// Road point pins (pathPins.ts, roadPath.ts): place A-B-C, drag a pin while placing, insert with +, Alt+click to
// remove, branch with Shift+click (a second road, T junction), drag A onto another street (joins), build; in the Tune
// step the road keeps its pins (a drag joins the generate's undo step); then on the placed road drag a pin onto another
// road (an outline while dragging, the map untouched; joins) and undo it in one step, amber and red drags, type a corner
// radius in the Points list, Tab, branch and extend from its pins, Delete a point, and Layers › Handles off.
// Exits non-zero when a check fails.
//   SHE_PORT=5208 node scripts/road-points-test.mjs [--shots <dir>]
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { withEditor } from './browser.mjs';

const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });

let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

await withEditor(async (d, page) => {
  const shot = async (name) => {
    if (!shotsAt) return;
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(shotsAt, `${name}.png`) });
    console.log(`  shot ${name}.png`);
  };
  await d.open('repo:phase3_arena.vmf');
  await page.click('#topbar button:has-text("New")');
  await page.dblclick('.newmap [data-template="empty"]');
  await d.settle();
  // Market street along x through the origin, placed earlier.
  await d.eval(async () => {
    const { rebuildRoads } = await import('/src/gen/roadAction.ts');
    const { decodeRoad } = await import('/src/gen/roads.ts');
    const ed = window.__editor.editor;
    rebuildRoads(ed, 'Market street', { add: decodeRoad('asphalt|256|96|256|||-2048 0 0;2048 0 0') });
    ed.selection.clear();
    ed.setView3dOrTop('top');
    ed.topView.center.set(0, 640);
    ed.topView.zoom = 2200;
    ed.topView.apply();
  });
  await d.settle(300);

  const pins = '.path-pins:not([hidden]) .path-pin[data-pin]';
  const names = () => page.$$eval(pins, (els) => els.map((e) => e.textContent));
  const pinBox = async (name) => {
    const el = page.locator(pins, { hasText: new RegExp(`^${name}$`) });
    const b = await el.boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const placing = () => d.eval(() => {
    const t = window.__editor.editor.tools.tools.road;
    return { points: t.path.points.map((p) => [p.x, p.y]), links: t.path.links.length, from: t.from };
  });
  /** All roads' points, in document order. */
  const roads = () => d.eval(async () => {
    const { roadEntities } = await import('/src/gen/roadAction.ts');
    return roadEntities(window.__editor.editor.doc).map((r) => r.road.points.map((p) => [p.x, p.y]));
  });
  /** The selected road (the pins' target): its points and own corner radii. */
  const placed = () => d.eval(async () => {
    const { roadOf } = await import('/src/gen/roads.ts');
    const ed = window.__editor.editor;
    const e = [...ed.selection.entities][0];
    const r = e && roadOf(e);
    return r ? { points: r.points.map((p) => [p.x, p.y]), radii: r.radii ?? null } : null;
  });
  const depth = () => d.eval(() => window.__editor.editor.history.depth);
  /** The whole map as saved: unchanged while a pin is only being dragged. */
  const mapText = () => d.eval(() => window.__editor.editor.doc.serialize());
  /** Vertices of the drag preview outline of the shown pins (the Select tool's, else the Road tool's). */
  const outline = () => d.eval(() => {
    const t = window.__editor.editor.tools;
    return (t.current === t.select ? t.select : t.tools.road).pins.outline.geometry.getAttribute('position').count;
  });
  const tool = () => d.eval(() => window.__editor.editor.tools.current.name);
  const tip = () => page.$eval('.path-pins:not([hidden]) .path-tip', (e) => e.className);
  const dragTo = async (from, to, { hold } = {}) => {
    await d.drag(from, await d.project(to), { screen: true, steps: 10, hold });
    await d.settle(200);
  };
  const clickPin = async (name, mod) => {
    const [x, y] = await pinBox(name);
    if (mod) await page.keyboard.down(mod);
    await page.mouse.click(x, y);
    if (mod) await page.keyboard.up(mod);
    await d.settle(150);
  };
  const toggleHandles = () => d.eval(() => [...document.querySelectorAll('#topbar button')].find((b) => b.textContent === 'Handles').click());
  /** Market's kerb on the north side, over the spot a road comes in: open (surface) or not. */
  const kindAt = (x, y) => d.eval(async ([x, y]) => {
    const { roadEntities } = await import('/src/gen/roadAction.ts');
    const { roadGround } = await import('/src/gen/roads.ts');
    return roadGround(roadEntities(window.__editor.editor.doc).map((r) => r.road))(x, y)?.kind ?? null;
  }, [x, y]);
  /** The main road (the second road of the map) selected again, Select tool. */
  const selectMain = () => d.eval(async () => {
    const { roadEntities } = await import('/src/gen/roadAction.ts');
    const ed = window.__editor.editor;
    ed.selection.set([], [roadEntities(ed.doc)[1].entity]);
  }).then(() => d.settle(200));

  // --- Placing ---------------------------------------------------------------------------------------------
  await d.eval(() => window.__editor.editor.tools.tools.generate.pick('road'));
  await d.settle(200);
  await d.click([0, 1536, 0]);
  await d.click([0, 768, 0]);
  await d.click([768, 768, 0]);
  check('A-B-C placed', await names(), ['A', 'B', 'C']);
  check('height follows the ground', (await d.eval(() => window.__editor.editor.tools.tools.road.path.points.map((p) => p.z))), [0, 0, 0]);

  // Drag C while placing; placing carries on from C.
  await dragTo(await pinBox('C'), [1024, 768, 0]);
  check('C dragged while placing', (await placing()).points[2], [1024, 768]);
  check('placing carries on from C', (await placing()).from, 2);

  // The + between A and B inserts a point; Alt+click removes it again.
  await page.locator('.path-pins:not([hidden]) .path-add[title*="between A and B"]').click();
  await d.settle(150);
  check('inserted with +', await names(), ['A', 'B', 'C', 'D']);
  check('inserted point on the ground', (await placing()).points[1], [0, 1152]);
  await clickPin('B', 'Alt');
  check('Alt+click removes it', await names(), ['A', 'B', 'C']);

  // Shift+click B: the next click branches from B.
  await clickPin('B', 'Shift');
  check('Shift+click B places from B', (await placing()).from, 1);
  await d.click([-768, 768, 0]);
  check('branch names', await names(), ['A', 'B', 'C1', 'C2']);
  await page.mouse.move(...(await d.project([-768, 1280, 0])));
  await d.settle(150);
  await shot('road-points-placing');

  // Drag A onto Market street: it snaps onto the centre line, the pin rings blue (joins).
  await dragTo(await pinBox('A'), [0, 40, 0], {
    hold: async () => {
      check('joins note', await tip(), 'path-tip joins');
      check('joins ring', await page.locator(pins, { hasText: /^A$/ }).getAttribute('class'), 'path-pin sel join');
      await shot('road-points-join-ring');
    },
  });
  check('A snapped onto Market street', (await placing()).points[0], [0, 0]);

  // Enter builds: the main road and the branch as a second road from B (a T junction); Enter again: done.
  await page.mouse.move(10, 10);
  await d.key('Enter');
  await d.settle(300);
  const built = await roads();
  check('three roads: Market, main, branch', built.length, 3);
  check('main road A-B-C1', built[1], [[0, 0], [0, 768], [1024, 768]]);
  check('branch ends at C2', built[2][1], [-768, 768]);
  check('branch starts on the main road\'s arc', await d.eval(async () => {
    const { roadEntities } = await import('/src/gen/roadAction.ts');
    const { nearestOnLine, roadLine } = await import('/src/gen/roads.ts');
    const r = roadEntities(window.__editor.editor.doc);
    return nearestOnLine(roadLine(r[1].road), r[2].road.points[0]).d < 2;
  }), true);
  check('Market\'s kerb opens where the main road comes in', await kindAt(0, 132), 'surface');
  check('Market\'s far kerb stays', await kindAt(0, -132), 'kerb');
  // Tune step: the road just built keeps its pins; a drag previews, then rebuilds into the generate's one undo step.
  check('Tune step', await d.eval(() => window.__editor.editor.tools.tools.generate.session?.step), 'tune');
  check('Tune step keeps the pins', await names(), ['A', 'B', 'C']);
  const stepsTune = await depth();
  const mapTune = await mapText();
  await dragTo(await pinBox('C'), [1152, 768, 0], {
    hold: async () => {
      check('Tune drag: map unchanged while dragging', (await mapText()) === mapTune, true);
      check('Tune drag: outline while dragging', (await outline()) > 0, true);
      await shot('road-points-tune-drag');
    },
  });
  check('Tune drag moved C', (await roads())[1][2], [1152, 768]);
  check('Tune drag joins the generate\'s undo step', (await depth()) - stepsTune, 0);
  check('still in the Tune step', await d.eval(() => window.__editor.editor.tools.tools.generate.session?.step), 'tune');
  await page.mouse.move(10, 10);
  await d.key('Enter');
  await d.settle(300);
  check('finished: Select tool', await tool(), 'select');
  check('placed road shows its pins', await names(), ['A', 'B', 'C']);
  await d.eval(() => window.__editor.editor.setView3dOrTop('3d'));
  await d.view([-900, -300, 1300], [-200, 700, 0]);
  await d.settle(300);
  await shot('road-points-t-junction');
  await d.eval(() => {
    const ed = window.__editor.editor;
    ed.setView3dOrTop('top');
    ed.topView.center.set(0, 640);
    ed.topView.zoom = 2200;
    ed.topView.apply();
  });
  await d.settle(300);

  // --- Placed road, Select tool ------------------------------------------------------------------------------
  const before = await placed();
  const steps = await depth();
  // Drag C onto Market street: an outline while dragging (the map untouched), joins, one rebuild and one undo step
  // on release; undo puts it back.
  const mapBefore = await mapText();
  await dragTo(await pinBox('C'), [1024, 40, 0], {
    hold: async () => {
      check('map unchanged while dragging', (await mapText()) === mapBefore, true);
      check('no history step while dragging', (await depth()) - steps, 0);
      check('outline while dragging', (await outline()) > 0, true);
      check('joins while dragging', await tip(), 'path-tip joins');
      await shot('road-points-drag-preview');
    },
  });
  check('outline gone after release', await outline(), 0);
  check('C joined Market street', (await placed()).points[2], [1024, 0]);
  check('one undo step for the drag', (await depth()) - steps, 1);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(200);
  check('undo puts C back', await placed(), before);

  // C close to B: the corner at B shrinks (amber), still allowed; undone after.
  await dragTo(await pinBox('C'), [192, 768, 0], {
    hold: async () => {
      check('amber note', await tip(), 'path-tip adjusted');
      check('amber says the radius', await page.$eval('.path-pins:not([hidden]) .path-tip', (e) => e.textContent.includes('256 → 96')), true);
      await shot('road-points-drag-amber');
    },
  });
  check('amber drag applied', (await placed()).points[2], [192, 768]);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(200);

  // C back towards A: the road would fold over at B (red); letting go snaps back, no undo step.
  const stepsRed = await depth();
  await dragTo(await pinBox('C'), [128, 384, 0], {
    hold: async () => {
      check('red note', await tip(), 'path-tip refused');
      check('red pin', await page.locator(pins, { hasText: /^C$/ }).getAttribute('class'), 'path-pin sel bad');
      await shot('road-points-drag-red');
    },
  });
  check('refused drag snaps back', await placed(), before);
  check('refused drag leaves no undo step', (await depth()) - stepsRed, 0);

  // Points list: x, y and corner radius per point; type B's own corner radius.
  await d.eval(() => window.__editor.tabs.show('Selection'));
  await d.settle(150);
  const row = (name) => page.locator(`#sidebar .path-row[data-point="${name}"]`);
  check('a Points row per point', await page.locator('#sidebar .path-row').count(), 3);
  check('columns', await page.$$eval('#sidebar .path-cols span', (els) => els.map((e) => e.textContent).filter(Boolean)), ['x', 'y', 'corner radius']);
  const radius = row('B').locator('input').nth(2);
  await radius.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('64');
  await page.keyboard.press('Enter');
  await d.settle(200);
  check('typed corner radius is B\'s own', (await placed()).radii, [null, 64, null]);
  await d.eval(() => { document.activeElement?.blur(); window.__editor.editor.tools.select.pins.select(-1); });
  await d.key('Tab');
  await d.key('Tab');
  check('Tab picks the next pin', await d.eval(() => window.__editor.editor.tools.select.pins.selected), 1);
  check('the picked pin is white', await page.locator(pins, { hasText: /^B$/ }).getAttribute('class'), 'path-pin sel');
  check('its row is lit', await row('B').getAttribute('class'), 'path-row on');
  await shot('road-points-list');

  // Shift+click B on the placed road: a second road starts there, its A on the main road's centre line.
  await d.eval(() => window.__editor.editor.tools.select.pins.select(-1));
  await clickPin('B', 'Shift');
  check('Shift+click a corner: placing a new road', [await tool(), await names()], ['road', ['A']]);
  await d.click([-512, 1408, 0]);
  await page.mouse.move(10, 10);
  await d.key('Enter');
  await d.settle(300);
  await d.key('Enter');
  await d.settle(300);
  const withBranch = await roads();
  check('four roads after the branch', withBranch.length, 4);
  check('the new road starts on the main road', await d.eval(async () => {
    const { roadEntities } = await import('/src/gen/roadAction.ts');
    const { nearestOnLine, roadLine } = await import('/src/gen/roads.ts');
    const r = roadEntities(window.__editor.editor.doc);
    return nearestOnLine(roadLine(r[1].road), r[3].road.points[0]).d < 2;
  }), true);

  // Shift+click the end C: the same road goes on (D), Enter rebuilds it longer.
  await selectMain();
  await clickPin('C', 'Shift');
  check('Shift+click an end: placing on from it', [await tool(), (await placing()).from], ['road', 2]);
  await d.click([1536, 1280, 0]);
  await page.mouse.move(10, 10);
  await d.key('Enter');
  await d.settle(300);
  await d.key('Enter');
  await d.settle(300);
  check('extended, still four roads', (await roads()).length, 4);
  check('main road went on to D', (await roads())[1], [[0, 0], [0, 768], [1152, 768], [1536, 1280]]);

  // Delete with a pin picked removes that point; the branch from B stays joined to the road.
  await selectMain();
  await d.eval(() => window.__editor.editor.tools.select.pins.select(1));
  await d.key('Delete');
  await d.settle(200);
  check('Delete removes the picked point', await names(), ['A', 'B', 'C']);
  check('the road is still there', (await placed())?.points.length, 3);
  check('branches stay joined', await d.eval(async () => {
    const { roadEntities } = await import('/src/gen/roadAction.ts');
    const { nearestOnLine, roadLine } = await import('/src/gen/roads.ts');
    const r = roadEntities(window.__editor.editor.doc);
    return [2, 3].map((k) => Math.round(nearestOnLine(roadLine(r[1].road), r[k].road.points[0]).d));
  }), [0, 0]);

  // Layers › Handles off hides the pins.
  await toggleHandles();
  await d.settle(150);
  check('handles off hides the pins', await page.locator('.path-pins:not([hidden])').count(), 0);
  await toggleHandles();
  await d.settle(150);
  check('handles on shows them again', await names(), ['A', 'B', 'C']);
});

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
