// Drag and drop from the asset dock (src/edit/assetDrop.ts), driven with real pointer events from the dock's tiles:
// a model onto the floor (prop_static, snapped), an unsafe model (→ prop_dynamic), Alt (prop_dynamic), a model onto a
// selected prop (swap), a material onto a face (Shift: whole brush), a decal onto a wall (Alt: info_overlay), a model
// onto the Model field and a decal onto the Texture field, a sound (refused), Esc and letting go off the view
// (cancel). Every drop is one undo step and leaves the active tool, the gizmo and snap move alone.
// Exits non-zero when a check fails. Against a running dev server:
//   SHE_PORT=5206 node scripts/asset-drop-test.mjs [--shots <dir>]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { withEditor } from './browser.mjs';

const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

const STATIC = 'models/props_c17/oildrum001_static.mdl';
const PHYSICS = 'models/props_c17/oildrum001.mdl';
const CRATE = 'models/props_junk/wood_crate001a_static.mdl';
const MATERIAL = 'BRICK/BRICKWALL001A';
const DECAL = 'decals/decal_posters001a';
const DECAL2 = 'decals/decal_posters002a';

let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

await withEditor(async (d, page) => {
  await d.open('repo:phase3_arena.vmf');
  await page.click('#topbar button:has-text("New")');
  await page.dblclick('.newmap [data-template="empty"]');
  await d.settle();
  await d.eval(() => window.__editor.tabs.show('Selection'));

  // A wall to put decals on, and the dock open.
  const ground = await d.eval(async () => {
    const ed = window.__editor.editor;
    window.__editor.assetDock.setSize('open');
    const { boxSolid } = await import('/src/edit/brushes.ts');
    const Vector3 = ed.camera.position.constructor;
    const down = ed.raycaster(ed.ndcFromEvent({ clientX: 0, clientY: 0 }));
    down.ray.set(new Vector3(0, 0, 1000), new Vector3(0, 0, -1));
    const hit = ed.world.raycast(down);
    const z = hit ? Math.round(hit.point.z) : 0;
    const wall = ed.doc.addSolid(boxSolid(ed.doc, new Vector3(256, -128, z), new Vector3(288, 128, z + 192), 'DEV/DEV_MEASUREGENERIC01'));
    ed.history.added('Add wall', [wall]);
    ed.changed();
    window.__wall = wall;
    return z;
  });
  console.log(`ground at z ${ground}`);
  await d.view([-700, -500, ground + 600], [80, 0, ground]);
  await d.settle(400);

  const state = () => d.eval(() => {
    const ed = window.__editor.editor;
    return { ents: ed.doc.entities.length, steps: ed.history.position, tool: ed.tools.current.name, solids: ed.doc.allSolids().length };
  });
  const card = () => d.eval(() => {
    const c = document.querySelector('.asset-drag-card');
    return c && !c.hidden ? { text: c.textContent, bad: c.classList.contains('bad'), cancel: c.classList.contains('cancel') } : null;
  });
  const last = () => d.eval(() => {
    const e = window.__editor.editor.doc.entities.at(-1);
    return { cls: e.classname, model: e.get('model'), texture: e.get('texture') ?? e.get('material'), origin: e.get('origin') };
  });
  const undo = async () => { await d.eval(() => window.__editor.editor.undo()); await d.settle(200); };
  const shot = async (name) => {
    if (!shots) return;
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(shots, `${name}.png`) });
    console.log(`  saved ${name}.png`);
  };
  /** The dock tile of an asset: its tab, searched by its path; chips that hide it (an unsafe model) are turned off. */
  const showTile = async (kind, id) => {
    const key = id.toLowerCase();
    await d.eval(([k, q]) => { const a = window.__editor.assetDock; a.show(k); a.search(q); }, [kind, key]);
    await d.eval(() => window.__editor.assetDock.rendered());
    const tile = page.locator(`#assetdock [data-id="${key}"]`);
    if (!(await tile.count())) {
      for (const c of await page.locator('#assetdock .ad-chips .fchip.on').all()) {
        await c.click();
        await d.eval(() => window.__editor.assetDock.rendered());
      }
    }
    return tile.first();
  };
  /** Drags the asset's dock tile to a world point (or screen point); `hold` runs before letting go, keys are held throughout. */
  const drag = async (kind, id, to, { screen = false, hold, keys = [] } = {}) => {
    const box = await (await showTile(kind, id)).boundingBox();
    const [x0, y0] = [box.x + box.width / 2, box.y + box.height / 2];
    const [x1, y1] = screen ? to : await d.project(to);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (const k of keys) await page.keyboard.down(k);
    for (let i = 1; i <= 16; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / 16, y0 + ((y1 - y0) * i) / 16);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(250);
    const seen = await card();
    if (hold) await hold();
    await page.mouse.up();
    for (const k of keys) await page.keyboard.up(k);
    await d.settle(300);
    return seen;
  };

  // A plain click on a tile is the dock's click (the Entity tool with that model), not a drag.
  await (await showTile('model', STATIC)).click();
  check('a click reaches the tile', await d.eval(() => [window.__editor.editor.tools.current.name, window.__editor.editor.entityModel]), ['entity', STATIC]);
  check('a click starts no drag', await card(), null);
  // The click moved the sidebar to Entities; the field drops below need the Selection panel.
  await d.eval(() => window.__editor.tabs.show('Selection'));

  // 1. Model onto the floor, with the Block tool active: prop_static on the grid, no block drawn.
  await d.eval(() => window.__editor.editor.tools.set('block'));
  // Close up first, to see the ghost is the real model.
  await d.view([-120, -60, ground + 110], [32, 64, ground + 20]);
  await d.settle(300);
  await drag('model', STATIC, [32, 64, ground], { hold: () => shot('00-model-ghost-close') });
  await undo();
  await d.view([-700, -500, ground + 600], [80, 0, ground]);
  await d.settle(300);
  let before = await state();
  let seen = await drag('model', STATIC, [37, 70, ground], { hold: () => shot('01-model-ghost') });
  check('model card', /^oildrum001_static · prop_static at −?\d+ −?\d+ −?\d+ · Alt: prop_dynamic$/.test(seen?.text ?? ''), true);
  let after = await state();
  check('model: one entity, one step, no block', [after.ents - before.ents, after.steps - before.steps, after.solids - before.solids, after.tool], [1, 1, 0, 'block']);
  check('model placed', await last(), { cls: 'prop_static', model: STATIC, texture: undefined, origin: `32 64 ${ground}` });
  await shot('02-model-dropped');
  check('the drag swallowed the click (still the Block tool)', (await state()).tool, 'block');
  await undo();
  check('model undone', (await state()).ents, before.ents);
  await d.eval(() => window.__editor.editor.tools.set('select'));

  // 2. A model vbsp deletes as prop_static: prop_dynamic, said on the card and in a toast.
  before = await state();
  seen = await drag('model', PHYSICS, [0, -96, ground], { hold: () => shot('03-unsafe-model-card') });
  check('unsafe card', /prop_dynamic at .* · vbsp would delete it as prop_static \(physics data\)$/.test(seen?.text ?? ''), true);
  check('unsafe placed as prop_dynamic', (await last()).cls, 'prop_dynamic');
  check('unsafe toast', /^Placed as prop_dynamic/.test(await d.eval(() => document.querySelector('.toast')?.textContent ?? '')), true);
  check('unsafe: one step', (await state()).steps - before.steps, 1);
  await undo();
  check('unsafe undone', (await state()).ents, before.ents);

  // 3. Alt: prop_dynamic. Shift: not snapped.
  seen = await drag('model', STATIC, [-80, 40, ground], { keys: ['Alt'] });
  check('Alt card', /prop_dynamic at .* · Alt: prop_dynamic$/.test(seen?.text ?? ''), true);
  check('Alt placed prop_dynamic', (await last()).cls, 'prop_dynamic');
  await undo();
  seen = await drag('model', STATIC, [-75, 41, ground], { keys: ['Shift'] });
  check('Shift card says not snapped', /not snapped/.test(seen?.text ?? ''), true);
  check('Shift: off the grid', (await last()).origin !== `-80 48 ${ground}`, true);
  await undo();

  // 4. A model onto a selected prop swaps it; snap move (V) and the gizmo stay out of it.
  await drag('model', STATIC, [-160, -160, ground]);
  const prop = await d.eval(() => window.__editor.editor.doc.entities.length - 1);
  check('the dropped prop is selected', await d.eval((i) => window.__editor.editor.selection.entities.has(window.__editor.editor.doc.entities[i]), prop), true);
  before = await state();
  seen = await drag('model', CRATE, [-160, -160, ground + 20], {
    hold: async () => {
      await page.keyboard.down('v');
      await page.waitForTimeout(100);
      check('V during a drag: no snap move', await d.eval(() => window.__editor.editor.tools.select.snapMove.held), false);
      await page.keyboard.up('v');
      await shot('04-swap-selected-prop');
    },
  });
  check('swap card', /swap the model of this prop_static$/.test(seen?.text ?? ''), true);
  check('swapped', await d.eval((i) => { const e = window.__editor.editor.doc.entities[i]; return [e.classname, e.get('model'), e.get('origin')]; }, prop), ['prop_static', CRATE, `-160 -160 ${ground}`]);
  check('swap: one step', (await state()).steps - before.steps, 1);
  await undo();
  check('swap undone', await d.eval((i) => window.__editor.editor.doc.entities[i].get('model'), prop), STATIC);

  // 5. Material onto a face; Shift paints the whole brush.
  const wallFaces = () => d.eval(() => window.__wall.sides.map((s) => s.material));
  const faces0 = await wallFaces();
  before = await state();
  seen = await drag('material', MATERIAL, [256, 0, ground + 96], { hold: () => shot('05-material-face') });
  check('material card', seen?.text, 'brickwall001a · paint this face · Shift: whole brush');
  const faces1 = await wallFaces();
  check('one face painted', faces1.filter((m, i) => m !== faces0[i]), [MATERIAL]);
  check('material: one step', (await state()).steps - before.steps, 1);
  await undo();
  check('material undone', await wallFaces(), faces0);
  seen = await drag('material', MATERIAL, [256, 0, ground + 96], { keys: ['Shift'], hold: () => shot('06-material-brush') });
  check('Shift card', seen?.text, 'brickwall001a · paint all 6 faces of this brush');
  check('whole brush painted', (await wallFaces()).every((m) => m === MATERIAL), true);
  await undo();
  check('brush paint undone', await wallFaces(), faces0);

  // 6. Decal onto the wall; Alt makes an overlay.
  before = await state();
  seen = await drag('decal', DECAL, [256, 40, ground + 96], { hold: () => shot('07-decal-ghost') });
  check('decal card', seen?.text, 'decal_posters001a · infodecal on this face · Alt: info_overlay');
  check('decal placed', [(await last()).cls, (await last()).texture], ['infodecal', DECAL]);
  check('decal: one step', (await state()).steps - before.steps, 1);
  await undo();
  check('decal undone', (await state()).ents, before.ents);
  seen = await drag('decal', DECAL, [256, 40, ground + 96], { keys: ['Alt'], hold: () => shot('08-overlay-ghost') });
  check('overlay card', /^decal_posters001a · info_overlay \d+ u wide$/.test(seen?.text ?? ''), true);
  check('overlay placed', (await last()).cls, 'info_overlay');
  await undo();

  // 7. Field drops: a model onto the Model field, an unsafe one onto it (prop_dynamic), a decal onto the Texture field.
  await d.eval((i) => { const ed = window.__editor.editor; ed.selection.set([], [ed.doc.entities[i]]); }, prop);
  await d.settle(300);
  const fieldAt = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  before = await state();
  seen = await drag('model', CRATE, await fieldAt('#sidebar .mf[data-drop="model"]'), { screen: true, hold: () => shot('09-model-field') });
  check('model field card', seen?.text, 'wood_crate001a_static · set the model of this prop_static');
  check('model field set', await d.eval((i) => window.__editor.editor.doc.entities[i].get('model'), prop), CRATE);
  check('model field: one step', (await state()).steps - before.steps, 1);
  await undo();
  check('model field undone', await d.eval((i) => window.__editor.editor.doc.entities[i].get('model'), prop), STATIC);
  await d.settle(300);
  seen = await drag('model', PHYSICS, await fieldAt('#sidebar .mf[data-drop="model"]'), { screen: true });
  check('unsafe model field card', seen?.text, 'oildrum001 · set the model of this prop_static · becomes prop_dynamic');
  check('unsafe model field', await d.eval((i) => { const e = window.__editor.editor.doc.entities[i]; return [e.classname, e.get('model')]; }, prop), ['prop_dynamic', PHYSICS]);
  await undo();
  check('unsafe model field undone in one step', await d.eval((i) => { const e = window.__editor.editor.doc.entities[i]; return [e.classname, e.get('model')]; }, prop), ['prop_static', STATIC]);

  await drag('decal', DECAL, [256, 40, ground + 96]);
  await d.settle(300);
  before = await state();
  seen = await drag('decal', DECAL2, await fieldAt('#sidebar .mf[data-drop="decal"]'), { screen: true, hold: () => shot('10-texture-field') });
  check('texture field card', seen?.text, 'decal_posters002a · set the texture of this infodecal');
  check('texture field set', (await last()).texture, DECAL2);
  check('texture field: one step', (await state()).steps - before.steps, 1);
  await undo();
  check('texture field undone', (await last()).texture, DECAL);
  seen = await drag('model', CRATE, await fieldAt('#sidebar .mf[data-drop="decal"]'), { screen: true, hold: () => shot('11-wrong-field') });
  check('wrong field is red', [seen?.bad, seen?.text], [true, 'wood_crate001a_static · this field takes a decal']);
  check('wrong field: nothing changed', (await state()).steps, before.steps);

  // 8. Sound: refused with the reason. Esc and letting go off the view cancel.
  before = await state();
  seen = await drag('sound', 'ambient/water/drip1.wav', [0, 0, ground], { hold: () => shot('12-sound-refused') });
  check('sound card is red', [seen?.bad, seen?.text], [true, 'drip1 · sounds can’t be dropped into the view yet: use the Sound tool']);
  seen = await drag('model', STATIC, [0, 0, ground], { hold: () => page.keyboard.press('Escape') });
  check('Esc: card gone', await card(), null);
  // Out over the view and back onto the tile (the dock).
  const tileBox = await (await showTile('model', STATIC)).boundingBox();
  const tile = [tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2];
  let back = null;
  await drag('model', STATIC, [0, 0, ground], { hold: async () => {
    await page.mouse.move(tile[0] + 30, tile[1] - 30, { steps: 8 });
    await page.mouse.move(tile[0], tile[1], { steps: 4 });
    await page.waitForTimeout(250);
    back = await card();
    await shot('13-cancel-off-view');
  } });
  check('back on the dock: cancel card', [back?.cancel, back?.text], [true, 'oildrum001_static · let go to cancel']);
  const end = await state();
  check('sound, Esc, cancel: nothing changed', [end.ents - before.ents, end.steps - before.steps], [0, 0]);
  check('Esc during the drag left the selection', await d.eval(() => window.__editor.editor.selection.entities.size), 1);
  check('drags never clicked a tile (still the Select tool)', (await state()).tool, 'select');
  check('no marquee left', await d.eval(() => !!document.querySelector('.marquee')), false);

  // 9. The quad view: drops go into the Camera pane only, aimed through it though the quad view last saw the mouse
  //    (no button held) over another pane. The 2D panes refuse them.
  await d.eval(() => window.__editor.editor.setLayout('quad'));
  await d.settle(400);
  const paneAt = (i, p) => d.eval(([i, p]) => {
    const ed = window.__editor.editor;
    return ed.quad.project(i, new ed.camera.position.constructor(...p));
  }, [i, p]);
  const hoverPane = async (i) => {
    const r = await d.eval((i) => { const q = window.__editor.editor.quad.clientRect(i); return [q.left + q.width / 2, q.top + q.height / 2]; }, i);
    await page.mouse.move(r[0], r[1]);
    await page.waitForTimeout(100);
  };
  // The wall right of the pane's centre, clear of the tool options in its top left corner.
  await d.eval(() => window.__editor.setView([-40, -40, 140], [256, 140, 96]));
  await hoverPane(1);
  check('quad: the Top pane takes input before the drag', await d.eval(() => window.__editor.editor.quad.kindOf()), 'top');
  before = await state();
  seen = await drag('decal', DECAL, await paneAt(0, [256, -60, ground + 60]), { screen: true, hold: () => shot('14-quad-decal-camera-pane') });
  check('quad Camera pane: decal card', seen?.text, 'decal_posters001a · infodecal on this face · Alt: info_overlay');
  check('quad Camera pane: decal placed', [(await last()).cls, (await state()).steps - before.steps], ['infodecal', 1]);
  await undo();
  await hoverPane(0);
  before = await state();
  seen = await drag('decal', DECAL, await paneAt(1, [-205, 125, ground]), { screen: true, hold: () => shot('15-quad-top-pane-refused') });
  check('quad Top pane: refused', [seen?.bad, seen?.text], [true, 'decal_posters001a · drop it in the Camera pane (3D)']);
  seen = await drag('model', STATIC, await paneAt(2, [0, 0, ground + 64]), { screen: true });
  check('quad Front pane: refused', [seen?.bad, seen?.text], [true, 'oildrum001_static · drop it in the Camera pane (3D)']);
  const after2d = await state();
  check('quad 2D panes: nothing placed', [after2d.ents - before.ents, after2d.steps - before.steps], [0, 0]);
  await d.eval(() => window.__editor.editor.setLayout('3d'));
});

if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
