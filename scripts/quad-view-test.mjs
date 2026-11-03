// Quad view (View › Quad) check: on/off and remembered after a reload, pane cycling, maximise and restore (Shift+Z),
// grid 1/16/512 with line thinning, moving and resizing in the Front and Side panes (heights change, one undo step
// each), Block and Entity in 2D panes, and F centring the 2D panes on the selection.
// Exits non-zero when a check fails. Against a running dev server:
//   SHE_PORT=5201 node scripts/quad-view-test.mjs [--shots <dir>]
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { withEditor } from './browser.mjs';

const shotsArg = process.argv.indexOf('--shots');
const shots = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

await withEditor(async (d, page) => {
  const shot = async (name) => {
    if (!shots) return;
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(shots, `${name}.png`) });
    console.log(`     saved ${name}.png`);
  };
  const layout = () => d.eval(() => window.__editor.editor.layout);
  const pickLayout = (mode) => d.eval((m) => document.querySelector(`#topbar [data-layout="${m}"]`).click(), mode);
  const quad = (fn, arg) => d.eval(fn, arg);
  /** Page position of (u, v) in pane i, from the pane's own pan and zoom. */
  const at = (i, u, v) => quad(([i, u, v]) => {
    const q = window.__editor.editor.quad, r = q.clientRect(i), w = q.view(i);
    return [r.left + r.width / 2 + (u - w.cu) * w.ppu, r.top + r.height / 2 - (v - w.cv) * w.ppu];
  }, [i, u, v]);
  /** Points pane i at (cu, cv) with `ppu` screen pixels per unit. */
  const look = (i, cu, cv, ppu) => quad(([i, cu, cv, ppu]) => {
    const q = window.__editor.editor.quad;
    Object.assign(q.view(i), { cu, cv, ppu });
    q.layout();
  }, [i, cu, cv, ppu]);
  const dragScreen = async (a, b) => {
    await page.mouse.move(a[0], a[1]);
    await page.waitForTimeout(60);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) {
      await page.mouse.move(a[0] + ((b[0] - a[0]) * k) / 10, a[1] + ((b[1] - a[1]) * k) / 10);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  const box = () => d.eval(() => {
    const b = window.__editor.editor.selection.bounds();
    return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
  });

  // An empty map; quad is off until chosen.
  await d.open('repo:phase3_arena.vmf');
  await d.eval(() => localStorage.removeItem('she.pref.quad'));
  await d.eval(() => window.__editor.editor.loadDocument(window.__editor.editor.doc.constructor.empty(), 'quad-test.vmf'));
  await d.settle(300);
  check('quad off by default', await layout(), '3d');

  // On, remembered after a reload; 3D turns it off, also remembered.
  await pickLayout('quad');
  await d.settle(300);
  check('View › Quad turns it on', await layout(), 'quad');
  check('four panes: Camera, Top, Front, Side', await quad(() => window.__editor.editor.quad.panes.map((p) => p.kind)), ['camera', 'top', 'front', 'side']);
  await page.reload();
  await page.waitForFunction(() => window.__editor?.ready, null, { timeout: 120000 });
  await d.settle(300);
  check('quad remembered after a reload', await layout(), 'quad');
  await pickLayout('3d');
  check('View › 3D turns it off', await layout(), '3d');
  await d.key('t');
  check('T still switches 3D to Top', await layout(), 'top');
  await d.key('t');
  await page.reload();
  await page.waitForFunction(() => window.__editor?.ready, null, { timeout: 120000 });
  await d.settle(300);
  check('off remembered after a reload', await layout(), '3d');
  await pickLayout('quad');
  await d.eval(() => window.__editor.editor.loadDocument(window.__editor.editor.doc.constructor.empty(), 'quad-test.vmf'));
  await d.settle(300);
  await d.key('t');
  check('T does nothing in quad', await layout(), 'quad');

  // Pane cycling: clicking a pane's name steps Camera, Top, Front, Side.
  const nameBtn = (i) => page.locator('.quad-pane .quad-name').nth(i);
  const kinds = [];
  for (let k = 0; k < 4; k++) {
    await nameBtn(3).click();
    kinds.push(await quad(() => window.__editor.editor.quad.panes[3].kind));
  }
  check('pane name cycles Camera, Top, Front, Side', kinds, ['camera', 'top', 'front', 'side']);

  // Maximise the pane under the mouse with Shift+Z, and back.
  const r2 = await quad(() => { const r = window.__editor.editor.quad.clientRect(2); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(r2[0], r2[1]);
  await page.waitForTimeout(80);
  await d.key('Shift+Z');
  check('Shift+Z maximises the pane under the mouse', await quad(() => {
    const q = window.__editor.editor.quad;
    return [q.max, q.shown(), q.panes[2].rect.w === window.__editor.editor.container.clientWidth];
  }), [2, [2], true]);
  await shot('quad-maximised-front');
  await d.key('Shift+Z');
  check('Shift+Z again restores four panes', await quad(() => window.__editor.editor.quad.shown()), [0, 1, 2, 3]);

  // Block in the Front pane (Y/Z): the drag sets y and z, x is 0 to the tool's height (no block made yet).
  await look(2, 0, 0, 0.5);
  await look(3, 0, 0, 0.5);
  await look(1, 0, 0, 0.5);
  await d.key('2');
  await dragScreen(await at(2, 0, 0), await at(2, 256, 128));
  check('Block drawn in Front', await box(), [0, 0, 0, 128, 256, 128]);
  // A second block in Side (X/Z) takes y from the last block.
  await dragScreen(await at(3, 512, 0), await at(3, 768, 64));
  check('Block drawn in Side takes depth from the last block', await box(), [512, 0, 0, 768, 256, 64]);
  await d.eval(() => window.__editor.editor.undo());

  // Entity in the Side pane: x and z from the cursor (snapped), y from the plane through 0.
  await d.eval(() => { window.__editor.editor.entityClass = 'info_target'; });
  await d.key('4');
  const before = await d.eval(() => window.__editor.editor.doc.entities.length);
  const ep = await at(3, -200, 300);
  await page.mouse.move(ep[0], ep[1]);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  check('Entity placed in Side', await d.eval(() => {
    const e = window.__editor.editor.doc.entities.at(-1);
    return [window.__editor.editor.doc.entities.length, e.classname, e.origin.toArray()];
  }), [before + 1, 'info_target', [-192, 0, 304]]);
  await d.eval(() => window.__editor.editor.undo());

  // Select the first block (click in Top), then move it up 64 in Front: one undo step.
  await d.key('1');
  await d.eval(() => { const ed = window.__editor.editor; ed.selection.set([ed.doc.allSolids()[0]], []); });
  await d.settle(200);
  await dragScreen(await at(2, 128, 64), await at(2, 128 + 64, 64 + 64));
  check('drag in Front moves along y and z', await box(), [0, 64, 64, 128, 320, 192]);
  await shot('quad-moved-in-front');
  await d.eval(() => window.__editor.editor.undo());
  check('one undo puts it back', await box(), [0, 0, 0, 128, 256, 128]);

  // Resize in Side: the top handle (middle of the top edge) raises the block to 256.
  await dragScreen(await at(3, 64, 128), await at(3, 64, 256));
  check('top handle in Side sets the height', await box(), [0, 0, 0, 128, 256, 256]);
  await d.eval(() => window.__editor.editor.undo());
  check('one undo puts the height back', await box(), [0, 0, 0, 128, 256, 128]);
  // The right handle in Front widens along y.
  await dragScreen(await at(2, 256, 64), await at(2, 384, 64));
  check('right handle in Front resizes along y', await box(), [0, 0, 0, 128, 384, 128]);
  await d.eval(() => window.__editor.editor.undo());

  // Grid 1, 16 and 512 from the status bar, with line thinning at a far zoom.
  await look(1, 0, 0, 0.05);
  const pickGrid = async (n) => {
    await page.locator('.grid-pick button', { hasText: new RegExp(`^${n}$`) }).click();
    await d.settle(150);
    return d.eval(() => [window.__editor.editor.grid, document.querySelector('.grid-note').textContent]);
  };
  await page.mouse.move(...(await at(1, 0, 0)));
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  check('grid 1 thins to every 128 at 5%', await pickGrid(1), [1, 'snaps to 1, lines every 128 at this zoom']);
  await shot('quad-grid-1');
  check('grid 16 thins to every 128 at 5%', await pickGrid(16), [16, 'snaps to 16, lines every 128 at this zoom']);
  await shot('quad-grid-16');
  check('grid 512 needs no thinning', await pickGrid(512), [512, 'lines every 512']);
  await shot('quad-grid-512');
  await d.key('[');
  check('[ steps down from 512', await d.eval(() => window.__editor.editor.grid), 256);
  await pickGrid(16);

  // F centres every 2D pane on the selection, each at its own zoom.
  await look(1, 3000, 3000, 0.3);
  await look(2, -3000, 500, 0.7);
  await look(3, 4000, -100, 0.2);
  await page.mouse.move(...(await at(1, 3000, 3000)));
  await d.key('f');
  check('F centres the 2D panes', await quad(() => window.__editor.editor.quad.panes.slice(1).map((p, k) => {
    const v = window.__editor.editor.quad.view(k + 1);
    return [p.kind, v.cu, v.cv, v.ppu];
  })), [['top', 64, 128, 0.3], ['front', 128, 64, 0.7], ['side', 64, 64, 0.2]]);

  // The whole view for review, with the camera marker in the 2D panes.
  await look(1, -100, -100, 0.4);
  await look(2, -100, 64, 0.4);
  await look(3, -100, 64, 0.4);
  await d.eval(() => { const ed = window.__editor.editor; const V = ed.camera.position.constructor; ed.setView(new V(-400, -500, 300), new V(64, 128, 64)); });
  await shot('quad-view');

  // Back to 3D: single view as before.
  await pickLayout('3d');
  check('3D after quad: one view, quad chrome hidden', await d.eval(() => [window.__editor.editor.layout, document.querySelector('.quad').hidden]), ['3d', true]);
});

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
