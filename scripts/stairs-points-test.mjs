// Stairs point pins (pathPins.ts): place A-B-C with a branch, drag a pin while placing, insert with +, Alt+click
// to remove, finish; then on the placed stairs drag a pin (one undo step), type in the Points list, Tab, Delete a
// point, refused and adjusted drags, and Layers › Handles off. Exits non-zero when a check fails.
//   SHE_PORT=5200 node scripts/stairs-points-test.mjs [--shots <dir>]
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
  // Top view over the stairs-to-be, zoomed in so the pins stand apart.
  await d.eval(() => {
    const ed = window.__editor.editor;
    ed.setView3dOrTop('top');
    ed.topView.center.set(0, 256);
    ed.topView.zoom = 900;
    ed.topView.apply();
  });
  await d.settle(300);

  const pins = '.path-pins:not([hidden]) .path-pin[data-pin]';
  /** Pin names in order, as the viewport shows them. */
  const names = () => page.$$eval(pins, (els) => els.map((e) => e.textContent));
  const pinBox = async (name) => {
    const el = page.locator(pins, { hasText: new RegExp(`^${name}$`) });
    const b = await el.boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const stairs = () => d.eval(() => window.__editor.editor.tools.tools.stairs);
  const placing = () => d.eval(() => {
    const t = window.__editor.editor.tools.tools.stairs;
    return { nodes: t.nodes.map((n) => [n.x, n.y, n.z]), flights: t.flights.length, from: t.from, phase: t.phase };
  });
  const placed = () => d.eval(async () => {
    const { selectedStairs } = await import('/src/gen/stairsAction.ts');
    const { stairsOf } = await import('/src/gen/stairsStore.ts');
    const s = selectedStairs(window.__editor.editor)[0];
    const spec = s && stairsOf(s);
    return spec ? spec.nodes.map((n) => [n.x, n.y, n.z]) : null;
  });
  const depth = () => d.eval(() => window.__editor.editor.history.depth);
  /** Drags from a screen point to a world point; `hold` runs before letting go. */
  const dragTo = async (from, to, { shift = false, hold } = {}) => {
    const target = await d.project(to);
    if (shift) await page.keyboard.down('Shift');
    await d.drag(from, target, { screen: true, steps: 10, hold });
    if (shift) await page.keyboard.up('Shift');
    await d.settle(200);
  };
  const typeKeys = async (text) => { for (const k of text) await d.key(k); };
  // Clicked from the page: a Playwright click on the top bar (wider than the page) would scroll the page sideways.
  const toggleHandles = () => d.eval(() => [...document.querySelectorAll('#topbar button')].find((b) => b.textContent === 'Handles').click());

  // --- Placing ---------------------------------------------------------------------------------------------
  await d.eval(() => window.__editor.editor.tools.tools.generate.pick('stairs'));
  await d.settle(200);
  await d.click([0, 0, 0]);
  await d.click([0, 256, 0]);
  await typeKeys('128');
  await d.key('Enter');
  await d.click([256, 256, 0]);
  await typeKeys('64');
  await d.key('Enter');
  check('A-B-C placed', await names(), ['A', 'B', 'C']);
  // Shift+click B's pin: the next point branches from B.
  const [bx, by] = await pinBox('B');
  await page.keyboard.down('Shift');
  await page.mouse.click(bx, by);
  await page.keyboard.up('Shift');
  await d.settle(150);
  check('Shift+click B places from B', (await placing()).from, 1);
  await d.click([-256, 256, 0]);
  await typeKeys('32');
  await d.key('Enter');
  check('branch names', await names(), ['A', 'B', 'C1', 'C2']);
  await page.mouse.move(...(await d.project([-256, 512, 0])));
  await d.settle(150);
  await shot('stairs-points-placing');

  // Drag C1 along its flight while placing (Shift keeps its height); placing still carries on from C2.
  await dragTo(await pinBox('C1'), [384, 256, 0], { shift: true });
  const afterDrag = await placing();
  check('C1 dragged while placing', afterDrag.nodes[2], [384, 256, 192]);
  check('placing carries on from C2', afterDrag.from, 3);

  // Click the + between A and B: a point in the middle, the rest lettered again.
  const plus = page.locator('.path-pins:not([hidden]) .path-add[title*="between A and B"]');
  await plus.click();
  await d.settle(150);
  check('inserted with +', await names(), ['A', 'B', 'C', 'D1', 'D2']);
  check('inserted point', (await placing()).nodes[1], [0, 128, 64]);
  // Alt+click it: gone, its neighbours join up.
  const [ix, iy] = await pinBox('B');
  await page.keyboard.down('Alt');
  await page.mouse.click(ix, iy);
  await page.keyboard.up('Alt');
  await d.settle(150);
  check('Alt+click removes it', await names(), ['A', 'B', 'C1', 'C2']);
  check('flights after removing', (await placing()).flights, 3);
  await page.mouse.move(10, 10);
  await d.key('Enter');
  await d.settle(300);
  check('finished: Select tool', await d.eval(() => window.__editor.editor.tools.current.name), 'select');

  // --- Placed stairs, Select tool ----------------------------------------------------------------------------
  check('placed stairs show their pins', await names(), ['A', 'B', 'C1', 'C2']);
  const before = await placed();
  const steps = await depth();
  // Drag C2 out along its flight: live rebuild, one undo step, undo puts it back.
  await dragTo(await pinBox('C2'), [-384, 256, 0], {
    shift: true,
    hold: async () => {
      check('live rebuild while dragging', (await placed())[3], [-384, 256, 160]);
      check('green note', await page.$eval('.path-pins:not([hidden]) .path-tip', (e) => e.className), 'path-tip fine');
      await shot('stairs-points-drag-green');
    },
  });
  check('C2 moved', (await placed())[3], [-384, 256, 160]);
  check('one undo step for the drag', (await depth()) - steps, 1);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(200);
  check('undo puts C2 back', await placed(), before);
  await d.eval(() => window.__editor.editor.redo());
  await d.settle(200);

  // Dropped on the ground without Shift: C2 takes the ground's height (amber).
  await dragTo(await pinBox('C2'), [-448, 256, 0], {
    hold: async () => {
      check('amber note', await page.$eval('.path-pins:not([hidden]) .path-tip', (e) => e.className), 'path-tip adjusted');
      await shot('stairs-points-drag-amber');
    },
  });
  check('C2 took the ground height', (await placed())[3], [-448, 256, 0]);

  // Too steep: C1 (192 over B at 128) next to B is refused (red) and snaps back.
  const beforeRed = await placed();
  const stepsRed = await depth();
  await dragTo(await pinBox('C1'), [96, 256, 0], {
    shift: true,
    hold: async () => {
      check('red note', await page.$eval('.path-pins:not([hidden]) .path-tip', (e) => e.className), 'path-tip refused');
      check('red pin', await page.locator(pins, { hasText: /^C1$/ }).getAttribute('class'), 'path-pin sel bad');
      await shot('stairs-points-drag-red');
    },
  });
  check('refused drag snaps back', await placed(), beforeRed);
  check('refused drag leaves no undo step', (await depth()) - stepsRed, 0);

  // Points list: type C1's x; Tab picks pins; Delete removes the picked point.
  await d.eval(() => window.__editor.tabs.show('Selection'));
  await d.settle(150);
  const row = (name) => page.locator(`#sidebar .path-row[data-point="${name}"]`);
  check('a Points row per point', await page.locator('#sidebar .path-row').count(), 4);
  const cx = row('C1').locator('input').nth(0);
  await cx.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('448');
  await page.keyboard.press('Enter');
  await d.settle(200);
  check('typed x moves C1', (await placed())[2], [448, 256, 192]);
  await d.eval(() => { document.activeElement?.blur(); window.__editor.editor.tools.select.pins.select(-1); });
  await d.key('Tab');
  await d.key('Tab');
  check('Tab picks the next pin', await d.eval(() => window.__editor.editor.tools.select.pins.selected), 1);
  check('the picked pin is white', await page.locator(pins, { hasText: /^B$/ }).getAttribute('class'), 'path-pin sel');
  check('its row is lit', await row('B').getAttribute('class'), 'path-row on');
  await shot('stairs-points-list');
  await d.key('Tab');
  await d.key('Tab');
  await d.key('Delete');
  await d.settle(200);
  check('Delete removes the picked point', await names(), ['A', 'B', 'C']);
  check('the stairs are still there', (await placed())?.length, 3);

  // Layers › Handles off hides the pins.
  await toggleHandles();
  await d.settle(150);
  check('handles off hides the pins', await page.locator('.path-pins:not([hidden])').count(), 0);
  await shot('stairs-points-layers-off');
  await toggleHandles();
  await d.settle(150);
  check('handles on shows them again', await names(), ['A', 'B', 'C']);

  // Pins in the 3D view too.
  await d.eval(() => window.__editor.editor.setView3dOrTop('3d'));
  await d.view([600, -500, 700], [0, 200, 64]);
  await d.settle(200);
  check('pins in 3D', await names(), ['A', 'B', 'C']);
  await shot('stairs-points-3d');

  // Delete with no pin picked removes the whole stairs.
  await d.eval(() => window.__editor.editor.tools.select.pins.select(-1));
  await d.key('Delete');
  await d.settle(200);
  check('Delete without a picked pin removes the stairs', await d.eval(async () => {
    const { stairsOf } = await import('/src/gen/stairsStore.ts');
    return window.__editor.editor.doc.entities.filter((e) => stairsOf(e)).length;
  }), 0);
  void stairs;
});

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
