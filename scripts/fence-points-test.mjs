// Fence point pins and doorways (pathPins.ts, fencePath.ts, fenceDoors.ts): place A-B-C, drag a pin while placing,
// insert with +, Alt+click to remove, Shift+click a pin to branch, add a doorway from the Doorways list while placing,
// build (model fence, chain-link), switch it to brushes in the Tune step, then on the placed fence drag a corner (the
// doorway stays where it is along its stretch, one undo step), refused drags, drag a doorway's chip along the fence,
// Alt+click a chip, a + insert that hands the doorway to its half, the Points list, Tab and Delete, and Shift+click a
// placed pin to carry on placing. Exits non-zero when a check fails.
//   SHE_PORT=5204 node scripts/fence-points-test.mjs [--shots <dir>]
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = async (name) => {
    if (!shotsAt) return;
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shotsAt, `${name}.png`) });
    console.log(`  shot ${name}.png`);
  };
  await d.open('repo:phase3_arena.vmf');
  await page.click('#topbar button:has-text("New")');
  await page.dblclick('.newmap [data-template="empty"]');
  await d.settle();
  const top = async (cx, cy, zoom) => {
    await d.eval(([x, y, z]) => {
      const ed = window.__editor.editor;
      ed.selection.clear();
      ed.setView3dOrTop('top');
      ed.topView.center.set(x, y);
      ed.topView.zoom = z;
      ed.topView.apply();
    }, [cx, cy, zoom]);
    await d.settle(300);
  };
  await top(640, 384, 2600);

  const pins = '.path-pins:not([hidden]) .path-pin[data-pin]';
  const tip = '.path-pins:not([hidden]) .path-tip';
  const chips = '.fence-doors:not([hidden]) .fence-door';
  const names = () => page.$$eval(pins, (els) => els.map((e) => e.textContent));
  const pinBox = async (name) => {
    const b = await page.locator(pins, { hasText: new RegExp(`^${name}$`) }).boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const chipBox = async (k = 0) => {
    const b = await page.locator(chips).nth(k).boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const placing = () => d.eval(() => {
    const t = window.__editor.editor.tools.tools.fence;
    return { points: t.path.points.map((p) => [p.x, p.y]), links: t.path.links.map((l) => [l.from, l.to, ...(l.doors ?? []).map((x) => [x.at, x.width])]), from: t.from };
  });
  /** The fences in the map: spec, and how many props, func_detail brushes and clip brushes each made. */
  const fences = () => d.eval(async () => {
    const ed = window.__editor.editor;
    const { fenceOf, fenceMembers } = await import('/src/gen/fenceStore.ts');
    return ed.doc.entities.map((e) => fenceOf(e)).filter(Boolean).map((s) => {
      const m = fenceMembers(ed.doc, s.uid);
      return {
        uid: s.uid, mode: s.mode, model: s.model, style: s.style,
        points: s.points.map((p) => [p.x, p.y]), links: s.links.map((l) => [l.from, l.to, ...(l.doors ?? []).map((x) => [x.at, x.width, !!x.gate])]),
        props: m.props.length, brushes: m.detail?.solids.length ?? 0, clip: m.world.length, handle: !!m.handle,
      };
    });
  });
  const depth = () => d.eval(() => window.__editor.editor.history.depth);
  const mapText = () => d.eval(() => window.__editor.editor.doc.serialize());
  const tool = () => d.eval(() => window.__editor.editor.tools.current.name);
  const dragTo = async (from, to, { hold } = {}) => {
    const target = await d.project(to);
    await d.drag(from, target, { screen: true, steps: 10, hold });
    await d.settle(250);
  };
  const withKey = async (key, fn) => { await page.keyboard.down(key); await fn(); await page.keyboard.up(key); await d.settle(150); };
  const panel = '.gen-panel';

  // --- Placing ---------------------------------------------------------------------------------------------
  await d.eval(() => window.__editor.editor.tools.tools.generate.pick('fence'));
  await d.settle(200);
  check('Fence tool', await tool(), 'fence');
  await d.click([0, 0, 0]);
  await d.click([1024, 0, 0]);
  await d.click([1024, 768, 0]);
  check('A-B-C placed', await names(), ['A', 'B', 'C']);
  await dragTo(await pinBox('C'), [1152, 768, 0]);
  check('C dragged while placing', (await placing()).points[2], [1152, 768]);
  await page.locator('.path-pins:not([hidden]) .path-add[title*="between A and B"]').click();
  await d.settle(150);
  check('inserted with +', await names(), ['A', 'B', 'C', 'D']);
  check('inserted point', (await placing()).points[1], [512, 0]);
  await withKey('Alt', async () => page.mouse.click(...(await pinBox('B'))));
  check('Alt+click removes it', await names(), ['A', 'B', 'C']);
  // A doorway in the middle of A → B, from the panel's Doorways list.
  await page.locator(`${panel} [data-add-door="0"]`).click();
  await d.settle(200);
  check('doorway added while placing', (await placing()).links[0], [0, 1, [512, 96]]);
  check('its chip shows', await page.locator(chips).count(), 1);
  // Shift+click B, then click: a branch from B (a T).
  await withKey('Shift', async () => page.mouse.click(...(await pinBox('B'))));
  check('Shift+click B places from B', (await placing()).from, 1);
  await d.click([1024, -512, 0]);
  check('branch names', await names(), ['A', 'B', 'C1', 'C2']);
  check('the doorway stays on A → B', (await placing()).links[0], [0, 1, [512, 96]]);
  await page.mouse.move(10, 300);
  await d.settle(150);
  await shot('fence-placing');
  await d.key('Enter');
  await d.settle(400);
  let built = (await fences())[0];
  check('built: a model fence with its doorway', built && { mode: built.mode, model: built.model, links: built.links }, {
    mode: 'model', model: 'chainlink', links: [[0, 1, [512, 96, false]], [1, 2], [1, 3]],
  });
  check('props, clip and a handle, no brushes', built && [built.props > 6, built.clip > 6, built.handle, built.brushes], [true, true, true, 0]);
  check('Tune step keeps the pins', await names(), ['A', 'B', 'C1', 'C2']);
  check('and the chip', await page.locator(chips).count(), 1);
  // A gate on the doorway, from the list: rebuilt into the same generate.
  const stepsTune = await depth();
  await page.locator(`${panel} .door-row input[type=checkbox]`).check();
  await d.settle(300);
  check('gate on', (await fences())[0].links[0], [0, 1, [512, 96, true]]);
  check('one undo step with the generate', (await depth()) - stepsTune, 0);
  await shot('fence-model-tune-2d');
  // 3D of the model fence with its gate.
  await d.eval(() => window.__editor.editor.setView3dOrTop('3d'));
  await d.view([120, -620, 360], [560, 40, 40]);
  await d.settle(1200);
  await shot('fence-model-3d');
  await top(640, 0, 2600);

  // Brushes instead, in the Tune step: the same points and doorway, rebuilt in place.
  const madeBefore = await d.eval(() => window.__editor.editor.tools.tools.generate.session.made[0].id);
  await page.locator(`${panel} .row:has(label:text-is("Build")) select`).selectOption('brush');
  await d.settle(300);
  built = (await fences())[0];
  check('switched to brushes', built && [built.mode, built.props, built.brushes > 20, built.links[0]], ['brush', 0, true, [0, 1, [512, 96, true]]]);
  check('the same func_detail', await d.eval(() => window.__editor.editor.tools.tools.generate.session.made[0].id), madeBefore);
  await page.locator(`${panel} .row:has(label:text-is("Style")) select`).selectOption('boards');
  await d.settle(300);
  check('wooden boards', (await fences())[0].style, 'boards');
  await shot('fence-brush-tune-2d');
  await d.eval(() => window.__editor.editor.setView3dOrTop('3d'));
  await d.view([120, -620, 360], [560, 40, 40]);
  await d.settle(1200);
  await shot('fence-brush-3d');
  await top(640, 0, 2600);
  await page.mouse.move(10, 300);
  await d.key('Enter');
  await d.settle(300);
  check('done: Select tool', await tool(), 'select');

  // --- Placed fence, Select tool -------------------------------------------------------------------------------
  check('placed fence shows its pins', await names(), ['A', 'B', 'C1', 'C2']);
  const before = (await fences())[0];
  const steps = await depth();
  const mapBefore = await mapText();
  // Drag B east: the doorway stays 512 along A → B, the fence rebuilds once.
  await dragTo(await pinBox('B'), [1280, 0, 0], {
    hold: async () => {
      check('map unchanged while dragging', (await mapText()) === mapBefore, true);
      check('outline while dragging', await d.eval(() => window.__editor.editor.tools.select.pins.outline.geometry.getAttribute('position').count > 0), true);
      check('green note', await page.$eval(tip, (e) => e.className), 'path-tip fine');
      await shot('fence-drag-preview');
    },
  });
  check('B moved, doorway kept', (await fences())[0].links[0], [0, 1, [512, 96, true]]);
  check('B moved', (await fences())[0].points[1], [1280, 0]);
  check('one undo step per drag', (await depth()) - steps, 1);
  // Drag B back close to A: the doorway no longer fits where it was (amber) but is kept in the spec.
  await dragTo(await pinBox('B'), [320, 0, 0], {
    hold: async () => check('amber note', await page.$eval(tip, (e) => e.className), 'path-tip adjusted'),
  });
  check('stored doorway unchanged', (await fences())[0].links[0], [0, 1, [512, 96, true]]);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(250);
  check('undo puts B back one drag', (await fences())[0].points[1], [1280, 0]);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(250);
  check('and the first drag', (await fences())[0].points, before.points);
  // B dropped on A: refused, snaps back.
  const stepsRed = await depth();
  await dragTo(await pinBox('B'), [16, 0, 0], {
    hold: async () => check('red note', await page.$eval(tip, (e) => e.className), 'path-tip refused'),
  });
  check('refused drag snaps back', (await fences())[0].points, before.points);
  check('refused drag leaves no undo step', (await depth()) - stepsRed, 0);

  // The doorway's chip: drag it along A → B.
  check('chip on the placed fence', await page.locator(chips).count(), 1);
  const stepsChip = await depth();
  await dragTo(await chipBox(), [256, 40, 0]);
  check('chip drag moved the doorway', (await fences())[0].links[0], [0, 1, [256, 96, true]]);
  check('one undo step', (await depth()) - stepsChip, 1);
  // Alt+click removes it; undo brings it back.
  await withKey('Alt', async () => page.mouse.click(...(await chipBox())));
  check('Alt+click on the chip removes the doorway', (await fences())[0].links[0], [0, 1]);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(250);
  check('undo brings it back', (await fences())[0].links[0], [0, 1, [256, 96, true]]);
  // A + on A → B: the new point at 512 hands the doorway (at 256) to the first half; one at 128 would go second.
  await page.locator('.path-pins:not([hidden]) .path-add[title*="between A and B"]').click();
  await d.settle(300);
  check('+ insert: the doorway stays on the half it is on', (await fences())[0].links.slice(0, 2), [[0, 1, [256, 96, true]], [1, 2]]);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(250);

  // Selection panel: Points and Doorways lists.
  await d.eval(() => window.__editor.tabs.show('Selection'));
  await d.settle(200);
  check('a Points row per point', await page.locator('#sidebar .path-row').count(), 4);
  const bx = page.locator('#sidebar .path-row[data-point="B"] input').nth(0);
  await bx.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('1152');
  await page.keyboard.press('Enter');
  await d.settle(300);
  check('typed x moves B', (await fences())[0].points[1], [1152, 0]);
  await page.locator('#sidebar [data-add-door="1"]').click();
  await d.settle(300);
  check('+ Doorway on B → C1 from the Selection panel', (await fences())[0].links[1], [1, 2, [384, 96, false]]);
  const width = page.locator('#sidebar .door-row[data-door="1:0"] input[type=number]').nth(1);
  await width.fill('160');
  await width.press('Enter');
  await d.settle(300);
  check('typed width', (await fences())[0].links[1], [1, 2, [384, 160, false]]);
  check('two chips', await page.locator(chips).count(), 2);
  await d.eval(() => { document.activeElement?.blur(); window.__editor.editor.tools.select.pins.select(-1); });
  await d.key('Tab');
  await d.key('Tab');
  check('Tab picks the next pin', await d.eval(() => window.__editor.editor.tools.select.pins.selected), 1);
  await d.key('Tab');
  await d.key('Delete');
  await d.settle(300);
  check('Delete removes the picked point (C1)', await names(), ['A', 'B', 'C']);
  check('its doorway went with its stretch', (await fences())[0].links, [[0, 1, [256, 96, true]], [1, 2]]);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(300);
  check('undo brings C1 back', await names(), ['A', 'B', 'C1', 'C2']);

  // Shift+click a placed pin: back into placing from it; Enter rebuilds the same fence.
  await withKey('Shift', async () => page.mouse.click(...(await pinBox('A'))));
  check('Shift+click a placed pin: placing again', await tool(), 'fence');
  await d.click([-512, 0, 0]);
  check('a branch from A', await names(), ['A', 'B1', 'C1', 'C3', 'B2']);
  await page.mouse.move(10, 300);
  await d.key('Enter');
  await d.settle(300);
  await d.key('Enter');
  await d.settle(300);
  const all = await fences();
  check('the same fence, rebuilt', all.map((f) => f.uid), [before.uid]);
  check('with the branch and its doorways', all[0].links, [[0, 1, [256, 96, true]], [1, 2, [384, 160, false]], [1, 3], [0, 4]]);

  // The handle moves the whole fence (as the gizmo does when its drag ends), in one undo step.
  const pts = all[0].points;
  const stepsMove = await depth();
  await d.eval(async () => {
    const ed = window.__editor.editor;
    const { fenceHandleDragged } = await import('/src/gen/fenceAction.ts');
    const { translateSolid } = await import('/src/edit/brushes.ts');
    const handle = [...ed.selection.entities][0];
    const V = ed.scene.position.constructor;
    ed.history.group('Move fence', () => {
      const end = ed.history.begin('Move handle', [], [handle]);
      translateSolid(handle.solids[0], new V(128, 64, 0));
      handle.reload();
      end();
      fenceHandleDragged(ed, handle, 'translate');
    });
  });
  await d.settle(300);
  check('the handle moved every point', (await fences())[0].points, pts.map(([x, y]) => [x + 128, y + 64]));
  check('the doorways went along', (await fences())[0].links, all[0].links);
  check('as one undo step', (await depth()) - stepsMove, 1);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(300);
  check('undo puts it back', (await fences())[0].points, pts);
  // Delete with the handle selected (no pin picked): the whole fence goes, props, clip and all; undo brings it back.
  await d.eval(() => { const ed = window.__editor.editor; ed.tools.select.pins.select(-1); document.activeElement?.blur(); });
  const entitiesBefore = await d.eval(() => window.__editor.editor.doc.entities.length);
  await page.mouse.move(700, 880);
  await d.key('Delete');
  await d.settle(300);
  check('Delete removes the fence', [(await fences()).length, await d.eval(() => window.__editor.editor.doc.entities.filter((e) => e.get('she_fence_id')).length)], [0, 0]);
  await d.eval(() => window.__editor.editor.undo());
  await d.settle(300);
  check('undo brings it all back', [(await fences()).length, await d.eval(() => window.__editor.editor.doc.entities.length)], [1, entitiesBefore]);

  // A second fence, model mode, wasteland chain-link with a plain doorway (gap), for the review shots.
  await d.eval(() => window.__editor.editor.tools.tools.generate.pick('fence'));
  await d.settle(200);
  await page.locator(`${panel} .row:has(label:text-is("Build")) select`).selectOption('model');
  await page.locator(`${panel} .row:has(label:text-is("Model")) select`).selectOption('wasteland');
  await d.settle(150);
  await d.click([0, 896, 0]);
  await d.click([1024, 896, 0]);
  await d.click([1024, 1536, 0]);
  await page.locator(`${panel} [data-add-door="0"]`).click();
  await d.settle(150);
  await page.mouse.move(10, 300);
  await d.key('Enter');
  await d.settle(400);
  await d.key('Enter');
  await d.settle(300);
  const second = (await fences()).find((f) => f.uid !== before.uid);
  check('second fence: wasteland models with a doorway', second && [second.mode, second.model, second.links[0]], ['model', 'wasteland', [0, 1, [512, 96, false]]]);
  await top(512, 640, 3000);
  await d.eval(() => window.__editor.editor.selection.clear());
  await d.settle(300);
  await shot('fence-both-2d');
  await d.eval(() => window.__editor.editor.setView3dOrTop('3d'));
  await d.view([260, 420, 260], [620, 980, 40]);
  await d.settle(1500);
  await shot('fence-wasteland-3d');
  check('no page errors', errors, []);
});

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
