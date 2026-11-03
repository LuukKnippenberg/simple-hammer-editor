// Material blender (src/ui/blender.ts): New blend → Save writes the VMT, each Edge in the VMT, Paint with it, editing a
// blend updates the patches painted with it, Rename re-points them (undo in one step), Delete with a replacement,
// Duplicate of a Lambda Wars blend, and the texture browser hiding textures with alpha. Test blends are named bt_*
// and removed at the end. Exits non-zero when a check fails.
//   SHE_PORT=5200 node scripts/blender-test.mjs [--shots <dir>]
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
  const shot = async (name, clip) => {
    if (!shotsAt) return;
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shotsAt, `${name}.png`), clip });
    console.log(`  shot ${name}.png`);
  };
  const box = async (sel) => page.locator(sel).first().boundingBox();
  /** The VMT on disk (null when there is none). */
  const vmt = (name) => d.eval(async (n) => {
    const r = await fetch(`/api/file?path=materials/she/blend/${n}.vmt`, { cache: 'no-store' });
    return r.ok ? r.text() : null;
  }, name);
  const blend = '.blender';
  const settle = (ms = 400) => page.waitForTimeout(ms);
  /** Materials of the patches painted with the editor's blends, counted. */
  const patchMaterials = () => d.eval(() => {
    const out = {};
    for (const s of window.__editor.editor.doc.allSolids()) {
      const side = s.sides.find((x) => x.dispinfo);
      if (side && side.material.startsWith('SHE/')) out[side.material] = (out[side.material] ?? 0) + 1;
    }
    return out;
  });
  const cleanup = () => d.eval(async () => {
    const r = await fetch('/api/list?folder=materials/she/blend&ext=.vmt');
    for (const f of await r.json()) {
      const name = f.split('/').pop().replace(/\.vmt$/, '');
      if (name.startsWith('bt_')) await fetch('/api/blend/delete', { method: 'POST', headers: { 'X-SHE': '1' }, body: JSON.stringify({ name }) });
    }
  });

  await d.open('repo:phase3_arena.vmf');
  await cleanup();
  await page.click('#topbar button:has-text("New")');
  await page.dblclick('.newmap [data-template="empty"]');
  await d.settle();

  // ---- New blend → Save writes the VMT ----
  await d.eval(async () => (await import('/src/ui/toolbar.ts')).setToolButtons(window.__editor.editor, 'ground'));
  await settle();
  await page.click('.tool-options button:has-text("New blend…")');
  await page.waitForSelector(`${blend} .bl-layer`);
  await settle(1200);
  check('new blend opens with Base + Layer 1', await page.locator(`${blend} .bl-layer`).count(), 2);
  check('new blend shows the unsaved dot', await page.locator(`${blend} .bl-item.on .bl-dot`).count(), 1);
  await shot('blender-new-unsaved');
  await page.fill(`${blend} .bl-name`, 'bt_canal');
  await page.keyboard.press('Tab');
  await page.click(`${blend} .bl-foot button:text-is("Save")`);
  await settle(800);
  let text = await vmt('bt_canal');
  check('Save writes materials/she/blend/bt_canal.vmt', !!text, true);
  check('the new blend has no unsaved dot', await page.locator(`${blend} .bl-item.on .bl-dot`).count(), 0);
  check('only shader and compile keys', [...(text ?? '').matchAll(/"([$%][a-z0-9_]+)"/g)].map((m) => m[1].replace(/\d$/, '')).filter((k, i, a) => a.indexOf(k) === i),
    ['%keywords', '$basetexture', '$spectexture', '$scale', '$rotation', '%tooltexture', '$fow']);

  // ---- each Edge in the VMT ----
  const edgeVmts = {};
  const layerCard = (i) => `${blend} .bl-layer[data-layer="${i}"]`;
  for (const [edge, spec] of [['crisp', null], ['medium', 'nature/forest_grass_10b_spec'], ['soft', 'nature/forest_grass_10a_spec']]) {
    await page.click(`${layerCard(1)} button[data-edge="${edge}"]`);
    await page.click(`${blend} .bl-foot button:text-is("Save")`);
    await settle(600);
    text = await vmt('bt_canal');
    edgeVmts[edge] = text;
    check(`Edge ${edge}: $spectexture of layer 1`, (text.match(/"\$spectexture" "([^"]+)"/) ?? [])[1] ?? null, spec);
    check(`Edge ${edge}: the base keeps forest_grass_10a_spec`, (text.match(/"\$spectexture4" "([^"]+)"/) ?? [])[1], 'nature/forest_grass_10a_spec');
  }
  for (const [edge, t] of Object.entries(edgeVmts)) console.log(`--- VMT with Layer 1 ${edge} ---\n${t}`);

  // A third layer for the preview shots, Medium by default.
  await page.click(`${blend} button:has-text("+ Add layer")`);
  await page.click(`${blend} .bl-foot button:text-is("Save")`);
  await settle(600);
  check('added layer 2 is Medium', ((await vmt('bt_canal')).match(/"\$spectexture2" "([^"]+)"/) ?? [])[1], 'nature/forest_grass_10b_spec');

  // ---- preview modes ----
  const view = await box(`${blend} .bl-view`);
  await page.click(`${layerCard(1)} .bl-layer-name`);
  for (const mode of ['sample', 'noise', 'split']) {
    await page.click(`${blend} .bl-modes button[data-mode="${mode}"]`);
    await settle(500);
    await shot(`preview-${mode}`, view);
  }
  await page.click(`${blend} .bl-modes button[data-mode="paint"]`);
  const at = (fx, fy) => [view.x + view.width * fx, view.y + view.height * fy];
  const stroke = async (from, to, button = 'left') => {
    await page.mouse.move(...at(...from));
    await page.mouse.down({ button });
    for (let k = 1; k <= 10; k++) await page.mouse.move(...at(from[0] + ((to[0] - from[0]) * k) / 10, from[1] + ((to[1] - from[1]) * k) / 10));
    await page.mouse.up({ button });
  };
  await stroke([0.15, 0.4], [0.85, 0.5]);
  await stroke([0.2, 0.42], [0.8, 0.52]);
  await page.click(`${layerCard(2)} .bl-layer-name`);
  await page.click(`${blend} .bl-modes button[data-mode="paint"]`);
  await stroke([0.3, 0.75], [0.7, 0.7]);
  await stroke([0.4, 0.5], [0.5, 0.5], 'right');
  const painted = await d.eval(() => [...document.querySelector('.bl-tag').textContent.matchAll(/brush (\d+)/g)].map((m) => m[1]));
  check('paint mode tag shows the brush', painted, ['128']);
  await shot('preview-paint', view);
  await page.click(`${blend} .bl-light`);
  await settle(300);
  await shot('preview-unlit', view);
  await page.click(`${blend} .bl-light`);
  await page.click(`${blend} .bl-modes button[data-mode="sample"]`);
  await settle(300);
  await shot('blender-library');
  await shot('blender-layers', await box(`${blend} .bl-layers`));
  await shot('blender-footer', await box(`${blend} .bl-foot`));

  // ---- Paint with it ----
  await page.click(`${layerCard(1)} .bl-layer-name`);
  await page.click(`${blend} button:has-text("Paint with it")`);
  await settle(600);
  check('Paint with it closes the blender', await page.locator(blend).count(), 0);
  check('… with the Ground tool on this blend and layer', await d.eval(() => {
    const ed = window.__editor.editor, t = ed.tools.tools.ground;
    return [ed.tools.current.name, t.set, t.layer, t.mode];
  }), ['ground', 'SHE/BLEND/BT_CANAL', 1, 'paint']);
  // The empty map's ground is terrain: select the four patches nearest the middle (strokes then stay on them) and paint.
  const z = await d.eval(async () => {
    const ed = window.__editor.editor;
    const { solidBounds } = await import('/src/edit/brushes.ts');
    const Vector3 = ed.camera.position.constructor;
    const near = ed.doc.allSolids().filter((s) => s.isDisplacement)
      .map((s) => ({ s, b: solidBounds(s) }))
      .sort((a, b) => a.b.getCenter(new Vector3()).length() - b.b.getCenter(new Vector3()).length()).slice(0, 4);
    ed.selection.set(near.map((n) => n.s), []);
    return Math.round(near[0].b.max.z);
  });
  await d.view([0, -700, z + 900], [0, 0, z]);
  await d.settle(800);
  await d.drag([-300, -200, z], [300, 200, z], { steps: 16 });
  await d.drag([-300, 200, z], [300, -200, z], { steps: 16 });
  await d.settle(600);
  const weights = () => d.eval(async () => {
    const { readDisp } = await import('/src/edit/terrain.ts');
    let sum = 0;
    for (const s of window.__editor.editor.selection.solids) {
      const disp = readDisp(s);
      for (let i = 0; disp && i < disp.blend.length; i += 4) sum += disp.blend[i];
    }
    return Math.round(sum);
  });
  check('the stroke painted layer 1 on the terrain', (await weights()) > 5, true);
  check('the painted patches use bt_canal', await patchMaterials(), { 'SHE/BLEND/BT_CANAL': 4 });
  if (shotsAt) await page.screenshot({ path: join(shotsAt, 'map-painted.png') });

  // ---- Edit its blend → a painted patch updates (and the texture browser hides alpha) ----
  await d.eval(() => {
    const ed = window.__editor.editor;
    const patch = ed.doc.allSolids().find((s) => s.sides.some((x) => x.dispinfo && x.material === 'SHE/BLEND/BT_CANAL'));
    ed.selection.set([patch], []);
    window.__editor.tabs.show('Selection');
  });
  await settle(400);
  await page.click('#sidebar button:has-text("Edit its blend")');
  await page.waitForSelector(`${blend} .bl-layer`);
  await settle(800);
  check('Edit its blend opens on the patch’s blend', await page.inputValue(`${blend} .bl-name`), 'bt_canal');
  await page.click(`${layerCard(1)} button:has-text("Change…")`);
  await page.waitForSelector('.blend-tex-picker .ptile');
  const textures = await d.eval(async () => (await (await fetch('/api/groundtextures')).json()));
  check('ground textures leave out alpha (leaves01, treeline001a)', ['nature/leaves01', 'nature/treeline001a'].filter((t) => textures.includes(t)), []);
  check('… but keep ordinary ground', ['nature/mud01', 'nature/forest_grass_01'].every((t) => textures.includes(t)), true);
  await page.fill('.blend-tex-picker input.picker-search', 'leaves');
  await settle(400);
  check('searching leaves finds nothing', await page.locator('.blend-tex-picker .picker-grid p.hint').textContent(), 'Nothing matches.');
  await page.fill('.blend-tex-picker input.picker-search', 'mud');
  await settle(800);
  await shot('texture-browser');
  await page.dblclick('.blend-tex-picker .ptile[data-id="nature/mud01"]');
  await settle(400);
  check('layer 1 texture changed', await page.locator(`${layerCard(1)} .bl-tex`).textContent(), 'nature/mud01');
  const materialBefore = await d.eval(() => window.__editor.editor.materials.get('SHE/BLEND/BT_CANAL').material.uuid);
  await page.click(`${blend} .bl-foot button:text-is("Save")`);
  await settle(1200);
  check('Save says the patches updated', /4 patches updated/.test(await page.locator(`${blend} .bl-msg`).textContent()), true);
  check('the patches’ material shows the new layer at once', await d.eval(() => {
    const info = window.__editor.editor.materials.get('SHE/BLEND/BT_CANAL');
    return [info.multiblend?.layers[1].texture, info.material.uuid];
  }), ['nature/mud01', materialBefore]);

  // ---- Rename re-points the patches; one undo step restores them (and the file) ----
  await page.fill(`${blend} .bl-name`, 'bt_canal_mud');
  await page.keyboard.press('Tab');
  await page.click(`${blend} .bl-foot button:text-is("Save")`);
  await settle(1200);
  check('rename: the file moved', [!!(await vmt('bt_canal')), !!(await vmt('bt_canal_mud'))], [false, true]);
  check('rename: patches re-pointed', await patchMaterials(), { 'SHE/BLEND/BT_CANAL_MUD': 4 });
  await page.keyboard.press('Escape');
  await settle(300);
  const undone = await d.eval(() => window.__editor.editor.history.undo());
  await settle(1000);
  check('one undo step', undone, 'Rename blend bt_canal → bt_canal_mud');
  check('undo: patches back on bt_canal', await patchMaterials(), { 'SHE/BLEND/BT_CANAL': 4 });
  check('undo: the file is back', [!!(await vmt('bt_canal')), !!(await vmt('bt_canal_mud'))], [true, false]);
  await d.eval(() => window.__editor.editor.history.redo());
  await settle(1000);
  check('redo: renamed again', [await patchMaterials(), !!(await vmt('bt_canal_mud'))], [{ 'SHE/BLEND/BT_CANAL_MUD': 4 }, true]);

  // ---- Duplicate of a Lambda Wars blend ----
  await d.eval(async () => (await import('/src/ui/blender.ts')).openBlender(window.__editor.editor, { material: 'BLENDS/GHETTO_GRASS01' }));
  await page.waitForSelector(`${blend} .bl-ro`);
  await settle(800);
  check('a game blend is read-only', await page.locator(`${blend} .bl-foot button:text-is("Save as new")`).isDisabled(), true);
  await shot('blender-readonly');
  await page.click(`${blend} .bl-ro button:has-text("Duplicate")`);
  await settle(500);
  check('Duplicate makes an editable copy', [await page.inputValue(`${blend} .bl-name`), await page.locator(`${blend} .bl-ro`).count()], ['ghetto_grass01_copy', 0]);
  await page.fill(`${blend} .bl-name`, 'bt_ghetto');
  await page.keyboard.press('Tab');
  await page.click(`${blend} .bl-foot button:text-is("Save")`);
  await settle(800);
  text = await vmt('bt_ghetto');
  check('the copy is saved with the game blend’s four textures', [...(text ?? '').matchAll(/"\$basetexture\d?" "([^"]+)"/g)].map((m) => m[1]),
    ['nature/forest_grass_01', 'nature/gravelfloor003a', 'nature/mudfloor005a', 'concrete/concretefloor036a']);

  // ---- Delete with a replacement ----
  await page.click(`${blend} .bl-item[data-material="SHE/BLEND/BT_CANAL_MUD"]`);
  await settle(500);
  await page.click(`${blend} .bl-del`);
  await page.selectOption(`${blend} .bl-delete select`, 'SHE/BLEND/BT_GHETTO');
  await shot('delete-replacement');
  await page.click(`${blend} .bl-delete button:has-text("Delete and replace")`);
  await settle(1000);
  check('delete: file gone, patches on the replacement', [!!(await vmt('bt_canal_mud')), await patchMaterials()], [false, { 'SHE/BLEND/BT_GHETTO': 4 }]);
  await page.keyboard.press('Escape');
  check('delete: one undo step', await d.eval(() => window.__editor.editor.history.undo()), 'Delete blend bt_canal_mud');
  await settle(1000);
  check('undo: file and patches back', [!!(await vmt('bt_canal_mud')), await patchMaterials()], [true, { 'SHE/BLEND/BT_CANAL_MUD': 4 }]);

  await cleanup();
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
