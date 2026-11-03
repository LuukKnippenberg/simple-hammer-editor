// Quad view (View › Quad) check: on/off and remembered after a reload, pane cycling, maximise and restore (Shift+Z),
// grid 1/16/512 with line thinning, moving and resizing in the Front and Side panes (heights change, one undo step
// each), the 2D gizmos (W arrows and centre square, Shift free; E ring with 15° steps; R handles, Alt from the
// centre; hold V snap move with the hidden axis kept), Block and Entity in 2D panes, and F centring the 2D panes.
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
  /** Drags between page points; `mods` are held throughout, `hold` runs before letting go, `path` bends the way. */
  const dragScreen = async (a, b, { mods = [], hold, path } = {}) => {
    await page.mouse.move(a[0], a[1]);
    await page.waitForTimeout(60);
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.down();
    for (let k = 1; k <= 12; k++) {
      const p = path ? path(k / 12) : [a[0] + ((b[0] - a[0]) * k) / 12, a[1] + ((b[1] - a[1]) * k) / 12];
      await page.mouse.move(p[0], p[1]);
      await page.waitForTimeout(16);
    }
    if (hold) await hold();
    await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
    await page.waitForTimeout(200);
  };
  const undo = () => d.eval(() => window.__editor.editor.undo());
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

  // Move (W): an arrow moves along its own axis only, the centre square along both; Shift moves freely.
  await d.key('w');
  await dragScreen(await at(2, 128 + 40 / 0.5, 64), await at(2, 128 + 40 / 0.5 + 64, 64 + 50));
  check('W: the Y arrow in Front moves along y only', await box(), [0, 64, 0, 128, 320, 128]);
  await undo();
  await dragScreen(await at(3, 64, 64 + 40 / 0.5), await at(3, 64 + 50, 64 + 40 / 0.5 + 64));
  check('W: the Z arrow in Side moves along z only', await box(), [0, 0, 64, 128, 256, 192]);
  await undo();
  check('one undo each', await box(), [0, 0, 0, 128, 256, 128]);
  await shot('gizmo-move-top');
  await dragScreen(await at(1, 64, 128), await at(1, 64 + 37, 128), { mods: ['Shift'] });
  check('W: Shift + centre square in Top moves freely', await box(), [37, 0, 0, 165, 256, 128]);
  await undo();
  check('the Shift-drag kept the selection', await d.eval(() => window.__editor.editor.selection.solids.size), 1);

  // Rotate (E): a quarter turn on the Top ring turns about z, on the Front ring about x; the angle shows by the ring.
  await d.key('e');
  const turn = async (i, cu, cv, rUnits, deg, opts = {}) => {
    const start = await at(i, cu + rUnits, cv);
    const pts = [];
    for (let k = 1; k <= 12; k++) {
      const a = ((deg * Math.PI) / 180) * (k / 12);
      pts.push(await at(i, cu + Math.cos(a) * rUnits, cv + Math.sin(a) * rUnits));
    }
    await dragScreen(start, pts.at(-1), { ...opts, path: (t) => pts[Math.round(t * 12) - 1] });
  };
  // Top: the selection is 128 × 256 at 0.5 px per unit, so the ring is 83.5 px (167 units) round its centre.
  let label = '';
  await turn(1, 64, 128, Math.hypot(128, 256) / 2 + 24, 90, { hold: async () => {
    label = await d.eval(() => document.querySelector('.quad-angle')?.textContent ?? '');
    await shot('gizmo-rotate-top');
  } });
  check('E: the angle shows by the ring while turning', label, '90°');
  check('E: a quarter turn in Top turns about z', await box(), [-64, 64, 0, 192, 192, 128]);
  await undo();
  check('one undo turns it back', await box(), [0, 0, 0, 128, 256, 128]);
  await turn(2, 128, 64, Math.hypot(256, 128) / 2 + 24, 90);
  check('E: a quarter turn in Front turns about x', await box(), [0, 64, -64, 128, 192, 192]);
  await undo();
  let turned = null;
  await turn(1, 64, 128, Math.hypot(128, 256) / 2 + 24, 20, { hold: async () => { turned = await d.eval(() => window.__editor.editor.tools.select.paneTurn); } });
  check('E: 20° of drag turns 15° (snapped)', turned, 15);
  await undo();
  await turn(1, 64, 128, Math.hypot(128, 256) / 2 + 24, 20, { mods: ['Shift'], hold: async () => { turned = await d.eval(() => Math.round(window.__editor.editor.tools.select.paneTurn)); } });
  check('E: Shift turns freely', turned, 20);
  await undo();
  check('back where it was', await box(), [0, 0, 0, 128, 256, 128]);
  // An entity turns by its angles key.
  await d.eval(async () => {
    const ed = window.__editor.editor, V = ed.camera.position.constructor;
    const { placeEntity } = await import('/src/edit/actions.ts');
    placeEntity(ed, 'info_target', new V(1024, 0, 0), {});
    ed.selection.set([], [ed.doc.entities.at(-1)]);
  });
  await look(1, 1024, 0, 0.5);
  await d.settle(200);
  await turn(1, 1024, 0, 104, 90);
  check('E: a quarter turn in Top sets the entity yaw', await d.eval(() => window.__editor.editor.doc.entities.at(-1).get('angles')), '0 90 0');
  await undo();
  await undo();
  await look(1, 0, 0, 0.5);
  await d.eval(() => { const ed = window.__editor.editor; ed.selection.set([ed.doc.allSolids()[0]], []); });
  await d.settle(200);

  // Resize (R): handles on the outline; in Side the top handle raises the block to 256.
  await d.key('r');
  await dragScreen(await at(3, 64, 128), await at(3, 64, 256));
  check('top handle in Side sets the height', await box(), [0, 0, 0, 128, 256, 256]);
  await d.eval(() => window.__editor.editor.undo());
  check('one undo puts the height back', await box(), [0, 0, 0, 128, 256, 128]);
  // The right handle in Front widens along y.
  await dragScreen(await at(2, 256, 64), await at(2, 384, 64));
  check('right handle in Front resizes along y', await box(), [0, 0, 0, 128, 384, 128]);
  await d.eval(() => window.__editor.editor.undo());
  // Alt resizes from the centre: the left side goes out as far as the right.
  await dragScreen(await at(2, 256, 64), await at(2, 320, 64), { mods: ['Alt'], hold: () => shot('gizmo-resize-front-alt') });
  check('R: Alt + right handle in Front resizes from the centre', await box(), [0, -64, 0, 128, 320, 128]);
  await undo();
  check('one undo puts the size back', await box(), [0, 0, 0, 128, 256, 128]);

  // Snap move (hold V) in Front: the block's top corner onto another block's corner; x (hidden in Front) stays.
  await d.eval(async () => {
    const ed = window.__editor.editor, V = ed.camera.position.constructor;
    const { boxSolid } = await import('/src/edit/brushes.ts');
    const other = ed.doc.addSolid(boxSolid(ed.doc, new V(512, 512, 0), new V(640, 768, 64), 'DEV/DEV_MEASUREGENERIC01'));
    ed.history.added('Add block', [other]);
    ed.changed();
    ed.selection.set([ed.doc.allSolids()[0]], []);
  });
  await d.key('w');
  await d.settle(200);
  await page.mouse.move(...(await at(2, 100, 100)));
  await page.keyboard.down('v');
  await page.waitForTimeout(150);
  await dragScreen(await at(2, 256, 128), await at(2, 512, 64), { hold: async () => {
    await page.waitForTimeout(150);
    await shot('gizmo-snap-move-front');
  } });
  await page.keyboard.up('v');
  await page.waitForTimeout(150);
  check('V in Front: corner onto corner, x kept', await box(), [0, 256, -64, 128, 512, 64]);
  await undo();
  check('one undo puts the snap move back', await box(), [0, 0, 0, 128, 256, 128]);
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
