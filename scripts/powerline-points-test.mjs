// Powerline point pins (pathPins.ts, powerlinePath.ts): place A-B-C, drag a pin while placing, insert with +,
// Alt+click to remove, Shift+click a pin to branch (a tee pole), finish; then on the placed line drag a corner (poles
// re-spaced, one undo step), amber and refused drags, a point dropped near a street snaps to its pavement, type in
// the Points list, Tab, Delete a point, Layers › Handles off, and Shift+click a placed pin to carry on placing.
// Exits non-zero when a check fails.
//   SHE_PORT=5209 node scripts/powerline-points-test.mjs [--shots <dir>]
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
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(shotsAt, `${name}.png`) });
    console.log(`  shot ${name}.png`);
  };
  await d.open('repo:phase3_arena.vmf');
  await page.click('#topbar button:has-text("New")');
  await page.dblclick('.newmap [data-template="empty"]');
  await d.settle();
  // A street along y = 1536 (its south pavement's pole line runs at y = 1376), and the Top view over both.
  await d.eval(async () => {
    const ed = window.__editor.editor;
    const { rebuildRoads } = await import('/src/gen/roadAction.ts');
    const { defaultRoad } = await import('/src/gen/roads.ts');
    const V = ed.scene.position.constructor;
    rebuildRoads(ed, 'Draw road', { add: defaultRoad('asphalt', [new V(-1024, 1536, 0), new V(4096, 1536, 0)]) });
    ed.selection.clear();
    ed.setView3dOrTop('top');
    ed.topView.center.set(1536, 640);
    ed.topView.zoom = 4200;
    ed.topView.apply();
  });
  await d.settle(300);

  const pins = '.path-pins:not([hidden]) .path-pin[data-pin]';
  const tip = '.path-pins:not([hidden]) .path-tip';
  /** Pin names in order, as the viewport shows them. */
  const names = () => page.$$eval(pins, (els) => els.map((e) => e.textContent));
  const pinBox = async (name) => {
    const el = page.locator(pins, { hasText: new RegExp(`^${name}$`) });
    const b = await el.boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const placing = () => d.eval(() => {
    const t = window.__editor.editor.tools.tools.powerline;
    return { points: t.path.points.map((p) => [p.x, p.y]), links: t.path.links.map((l) => [l.from, l.to]), from: t.from };
  });
  /** The selected powerline: its route, its poles (tee crossarms are poles too) and its rope keyframes. */
  const placed = () => d.eval(async () => {
    const ed = window.__editor.editor;
    const { powerlineOf } = await import('/src/gen/powerlines.ts');
    const { powerlinePath } = await import('/src/edit/powerlinePath.ts');
    const e = [...ed.selection.entities][0];
    const line = e && powerlineOf(ed.doc.entities, e);
    if (!line) return null;
    const path = powerlinePath(line.spec);
    return {
      points: path.points.map((p) => [p.x, p.y]), links: path.links.map((l) => [l.from, l.to]),
      poles: line.members.filter((m) => m.classname.startsWith('prop_') && !m.get('targetname').includes('_f')).length,
    };
  });
  const depth = () => d.eval(() => window.__editor.editor.history.depth);
  const tool = () => d.eval(() => window.__editor.editor.tools.current.name);
  /** Drags from a screen point to a world point; `hold` runs before letting go. */
  const dragTo = async (from, to, { hold } = {}) => {
    const target = await d.project(to);
    await d.drag(from, target, { screen: true, steps: 10, hold });
    await d.settle(200);
  };
  const withKey = async (key, fn) => { await page.keyboard.down(key); await fn(); await page.keyboard.up(key); await d.settle(150); };
  const toggleHandles = () => d.eval(() => [...document.querySelectorAll('#topbar button')].find((b) => b.textContent === 'Handles').click());

  // --- Placing ---------------------------------------------------------------------------------------------
  await d.eval(() => window.__editor.editor.tools.tools.generate.pick('powerline'));
  await d.settle(200);
  await d.click([0, 0, 0]);
  await d.click([1280, 0, 0]);
  await d.click([2560, 0, 0]);
  check('A-B-C placed', await names(), ['A', 'B', 'C']);
  // Drag C while placing; placing carries on from it.
  await dragTo(await pinBox('C'), [2560, 256, 0]);
  check('C dragged while placing', (await placing()).points[2], [2560, 256]);
  // Click the + between A and B: a point in the middle, the rest lettered again.
  await page.locator('.path-pins:not([hidden]) .path-add[title*="between A and B"]').click();
  await d.settle(150);
  check('inserted with +', await names(), ['A', 'B', 'C', 'D']);
  check('inserted point', (await placing()).points[1], [640, 0]);
  // Alt+click it: gone, its neighbours join up.
  const inserted = await pinBox('B');
  await withKey('Alt', () => page.mouse.click(...inserted));
  check('Alt+click removes it', await names(), ['A', 'B', 'C']);
  // Shift+click B's pin, then click: a branch from B (B becomes a tee pole).
  const b = await pinBox('B');
  await withKey('Shift', () => page.mouse.click(...b));
  check('Shift+click B places from B', (await placing()).from, 1);
  await d.click([1280, 1024, 0]);
  check('branch names', await names(), ['A', 'B', 'C1', 'C2']);
  check('branch links', (await placing()).links, [[0, 1], [1, 2], [1, 3]]);
  await page.mouse.move(...(await d.project([640, 1024, 0])));
  await d.settle(150);
  await shot('powerline-points-placing');
  await page.mouse.move(10, 300);
  await d.key('Enter');
  await d.settle(300);
  const built = await placed();
  // A–B 2 spans, B–C1 (1305 long) 2, B–C2 2: 7 poles, and the tee's crossarm.
  check('built with a tee pole', built && { links: built.links, poles: built.poles }, { links: [[0, 1], [1, 2], [1, 3]], poles: 8 });
  await d.key('Enter');
  await d.settle(300);
  check('done: Select tool', await tool(), 'select');

  // --- Placed powerline, Select tool -------------------------------------------------------------------------
  check('placed line shows its pins', await names(), ['A', 'B', 'C1', 'C2']);
  await shot('powerline-points-placed');
  const before = await placed();
  const steps = await depth();
  // Drag C1 a little: the poles move with it (green).
  await dragTo(await pinBox('C1'), [2688, 256, 0], {
    hold: async () => {
      check('live rebuild while dragging', (await placed()).points[2], [2688, 256]);
      check('green note', await page.$eval(tip, (e) => e.className), 'path-tip fine');
    },
  });
  // Drag the corner further out: B → C1 needs another pole (amber).
  await dragTo(await pinBox('C1'), [3328, 256, 0], {
    hold: async () => {
      check('amber note', await page.$eval(tip, (e) => e.className), 'path-tip adjusted');
      check('amber says what changed', await page.$eval(tip, (e) => e.firstElementChild.textContent), 'C1 1 pole added');
      check('poles re-spaced live', (await placed()).poles, 9);
      await shot('powerline-points-drag-amber');
    },
  });
  check('C1 moved', (await placed()).points[2], [3328, 256]);
  check('one undo step per drag', (await depth()) - steps, 2);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(200);
  check('undo puts C1 back one drag', (await placed()).points[2], [2688, 256]);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(200);
  check('and the first drag', await placed(), before);
  await d.eval(() => { const ed = window.__editor.editor; ed.redo(); ed.redo(); });
  await d.settle(200);
  check('redo', (await placed()).points[2], [3328, 256]);

  // C2 dropped on B: two poles in each other, refused (red), snaps back.
  const beforeRed = await placed();
  const stepsRed = await depth();
  await dragTo(await pinBox('C2'), [1296, 40, 0], {
    hold: async () => {
      check('red note', await page.$eval(tip, (e) => e.className), 'path-tip refused');
      check('red pin', await page.locator(pins, { hasText: /^C2$/ }).getAttribute('class'), 'path-pin sel branch bad');
      check('red reason', await page.$eval(tip, (e) => e.firstElementChild.textContent), 'C2 B → C2: the poles would stand in each other');
      await shot('powerline-points-drag-red');
    },
  });
  check('refused drag snaps back', await placed(), beforeRed);
  check('refused drag leaves no undo step', (await depth()) - stepsRed, 0);

  // C2 dropped near the street: it goes onto the pavement's pole line (y 1376), amber with the reason.
  await dragTo(await pinBox('C2'), [1296, 1330, 0], {
    hold: async () => {
      check('pavement note', await page.$eval(tip, (e) => e.firstElementChild.textContent.includes("asphalt road's pavement")), true);
      await shot('powerline-points-pavement-snap');
    },
  });
  check('C2 snapped to the pavement', (await placed()).points[3], [1296, 1376]);
  await d.eval(() => window.__editor.editor.tools.select.pins.select(-1));
  await d.settle(150);
  await shot('powerline-points-pavement-built');

  // Points list: type C1's x; Tab picks pins; Delete removes the picked point.
  await d.eval(() => window.__editor.tabs.show('Selection'));
  await d.settle(150);
  const row = (name) => page.locator(`#sidebar .path-row[data-point="${name}"]`);
  check('a Points row per point', await page.locator('#sidebar .path-row').count(), 4);
  const cx = row('C1').locator('input').nth(0);
  await cx.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('3456');
  await page.keyboard.press('Enter');
  await d.settle(200);
  check('typed x moves C1', (await placed()).points[2], [3456, 256]);
  check('spans list', await page.$$eval('#sidebar .power-span', (els) => els.map((e) => e.textContent)), ['A → B1280 u · 2 spans', 'B → C12191 u · 3 spans', 'B → C21376 u · 2 spans']);
  await d.eval(() => { document.activeElement?.blur(); window.__editor.editor.tools.select.pins.select(-1); });
  await d.key('Tab');
  await d.key('Tab');
  check('Tab picks the next pin', await d.eval(() => window.__editor.editor.tools.select.pins.selected), 1);
  check('the picked pin is white', await page.locator(pins, { hasText: /^B$/ }).getAttribute('class'), 'path-pin sel');
  check('its row is lit', await row('B').getAttribute('class'), 'path-row on');
  await shot('powerline-points-list');
  await d.key('Tab');
  await d.key('Delete');
  await d.settle(200);
  check('Delete removes the picked point', await names(), ['A', 'B', 'C']);
  check('no tee pole left', (await placed()).links, [[0, 1], [1, 2]]);
  const stepsDel = await depth();
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(200);
  check('undo brings C1 back', await names(), ['A', 'B', 'C1', 'C2']);
  check('in one step', stepsDel - (await depth()), 1);

  // Layers › Handles off hides the pins.
  await toggleHandles();
  await d.settle(150);
  check('handles off hides the pins', await page.locator('.path-pins:not([hidden])').count(), 0);
  await toggleHandles();
  await d.settle(150);
  check('handles on shows them again', await names(), ['A', 'B', 'C1', 'C2']);

  // Shift+click a placed pin: back into placing from it; Enter rebuilds the same line with the new point.
  const a = await pinBox('A');
  await withKey('Shift', () => page.mouse.click(...a));
  check('Shift+click a placed pin: placing again', await tool(), 'powerline');
  check('from A', (await placing()).from, 0);
  await d.click([-1280, 0, 0]);
  check('a branch from A', await names(), ['A', 'B1', 'C1', 'C3', 'B2']);
  await page.mouse.move(10, 300);
  await d.key('Enter');
  await d.settle(300);
  await d.key('Enter');
  await d.settle(300);
  check('the same line, rebuilt', await d.eval(async () => {
    const ed = window.__editor.editor;
    const { powerlineOf } = await import('/src/gen/powerlines.ts');
    const lines = new Set(ed.doc.entities.map((e) => powerlineOf(ed.doc.entities, e)?.name).filter(Boolean));
    return [...lines];
  }), ['power1']);
  check('with the branch', (await placed()).links, [[0, 1], [1, 2], [1, 3], [0, 4]]);

  // The tee poles in 3D: B1 (and A) carry a second crossarm, lower, turned along the branch.
  await d.eval(() => { const ed = window.__editor.editor; ed.tools.select.pins.select(-1); ed.setView3dOrTop('3d'); });
  await page.mouse.move(700, 880);
  await d.view([2200, -1100, 1100], [1100, 300, 300]);
  await d.settle(400);
  check('pins in 3D', await names(), ['A', 'B1', 'C1', 'C3', 'B2']);
  await shot('powerline-points-3d');
  await d.view([1650, -420, 560], [1280, 0, 400]);
  await d.settle(400);
  await shot('powerline-points-tee-3d');
});

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
