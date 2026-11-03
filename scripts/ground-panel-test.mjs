// Ground tool panel (src/ui/groundPanel.ts): Texture and Shape mode groups with their hints, the blend card whose
// Change… opens the material blender, every two-texture set picked there and painted, layer tiles (Base = Erase),
// the brush sliders, noise fill for selected patches only (one undo step), and Turn into terrain for a floor.
// Exits non-zero when a check fails.
//   SHE_PORT=5200 node scripts/ground-panel-test.mjs [--shots <dir>]
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
  const panel = '.tool-options';
  const shot = async (name) => {
    if (!shotsAt) return;
    await page.waitForTimeout(500);
    const b = await page.locator(panel).boundingBox();
    // The panel plus a strip of the viewport beside it.
    await page.screenshot({ path: join(shotsAt, `${name}.png`), clip: { x: 0, y: b.y - 14, width: b.x + b.width + 260, height: b.height + 28 } });
    console.log(`  shot ${name}.png`);
  };
  const settle = (ms = 400) => page.waitForTimeout(ms);
  const hint = () => page.locator(`${panel} > .hint`).first().textContent();
  const tool = () => d.eval(() => { const t = window.__editor.editor.tools.tools.ground; return { set: t.set, layer: t.layer, mode: t.mode }; });
  const click = async (sel) => { await page.click(sel); await settle(250); };
  /** Picks a blend in the blender (opened with the card's Change…) and paints with it. */
  const pickInBlender = async (material, layer) => {
    await click(`${panel} .gp-change`);
    await page.waitForSelector('.blender .bl-item');
    await click(`.blender .bl-item[data-material="${material}"]`);
    if (layer !== undefined) await click(`.blender .bl-layer[data-layer="${layer}"] .bl-layer-name`);
    await click('.blender button:has-text("Paint with it")');
    await settle(600);
  };

  await d.open('repo:phase3_arena.vmf');
  await page.click('#topbar button:has-text("New")');
  await page.dblclick('.newmap [data-template="empty"]');
  await d.settle();
  await d.eval(async () => (await import('/src/ui/toolbar.ts')).setToolButtons(window.__editor.editor, 'ground'));
  await settle(800);

  // ---- 2. The blend card replaces the drop-down; Change… opens the blender on this blend ----
  check('no drop-down left in the panel', await page.locator(`${panel} select`).count(), 0);
  check('no Edit… / New blend… buttons', await page.locator(`${panel} button:text-matches("^(Edit…|New blend…)$")`).count(), 0);
  check('card shows the two-texture set', [await page.locator(`${panel} .gp-name b`).textContent(), await page.locator(`${panel} .gp-name span`).textContent()], ['Grass → dirt', 'Two-texture set · 2 textures']);
  await click(`${panel} .gp-change`);
  await page.waitForSelector('.blender .bl-item.on');
  check('Change… opens the blender with this blend selected', await page.locator('.blender .bl-item.on').getAttribute('data-material'), 'NATURE/BLENDGRASSDIRT01A');
  check('no asset finder bubble from the card', await page.locator('.ad-bubble').count(), 0);

  // ---- 3. Two-texture sets: a third, pick-only group ----
  const twoItems = await page.locator('.blender .bl-two .bl-item').evaluateAll((els) => els.map((e) => e.dataset.material));
  check('the blender lists all 8 two-texture sets', twoItems.length, 8);
  check('a two-texture set is pick-only', await d.eval(() => {
    const q = (s) => document.querySelector(s);
    return [q('.blender .bl-foot button:nth-last-child(3)')?.disabled, [...document.querySelectorAll('.blender .bl-layer button')].every((b) => b.disabled),
      !!q('.blender .bl-ro button'), [...document.querySelectorAll('.blender .bl-layer input')].every((i) => i.disabled), document.querySelectorAll('.blender [data-edge]').length];
  }), [true, true, false, true, 0]);
  await page.keyboard.press('Escape');
  await settle();
  // Each set picked in the blender and painted on one selected patch.
  const patch = await d.eval(async () => {
    const ed = window.__editor.editor;
    const { solidBounds } = await import('/src/edit/brushes.ts');
    const Vector3 = ed.camera.position.constructor;
    const near = ed.doc.allSolids().filter((s) => s.isDisplacement).map((s) => ({ s, b: solidBounds(s) }))
      .sort((a, b) => a.b.getCenter(new Vector3()).length() - b.b.getCenter(new Vector3()).length())[0];
    ed.selection.set([near.s], []);
    const c = near.b.getCenter(new Vector3());
    return { x: Math.round(c.x), y: Math.round(c.y), z: Math.round(near.b.max.z) };
  });
  await d.view([patch.x, patch.y - 600, patch.z + 800], [patch.x, patch.y, patch.z]);
  await d.settle(600);
  const painted = [];
  for (const material of twoItems) {
    await pickInBlender(material);
    // Erase first so each stroke has something to change, then paint.
    await d.eval(() => { const t = window.__editor.editor.tools.tools.ground; t.mode = 'paint'; });
    await d.drag([patch.x - 150, patch.y, patch.z], [patch.x + 150, patch.y, patch.z], { steps: 8 });
    await settle(300);
    painted.push(await d.eval(async (m) => {
      const ed = window.__editor.editor;
      const s = [...ed.selection.solids][0];
      const side = s.sides.find((x) => x.dispinfo);
      const { readDisp } = await import('/src/edit/terrain.ts');
      const alpha = readDisp(s).alphas.reduce((a, b) => a + b, 0);
      return side.material === m && ed.tools.tools.ground.set === m && alpha > 0;
    }, material));
  }
  check('all 8 two-texture sets can be picked and painted', painted, twoItems.map(() => true));
  await d.eval(() => window.__editor.editor.selection.clear());
  await settle();
  check('two-texture set: two tiles, First and Second', await page.locator(`${panel} .gp-tile .gp-k`).allTextContents(), ['First', 'Second']);
  await shot('two-texture-set');

  // ---- 4. Layer tiles of a four-layer blend ----
  await pickInBlender('BLENDS/FOREST_GRASS10', 2);
  check('Paint with it sets the blend and layer', await tool(), { set: 'BLENDS/FOREST_GRASS10', layer: 2, mode: 'paint' });
  check('card: Lambda Wars blend · 4 layers', await page.locator(`${panel} .gp-name span`).textContent(), 'Lambda Wars blend · 4 layers');
  check('four tiles with previews', [await page.locator(`${panel} .gp-tile`).count(), await page.locator(`${panel} .gp-tile img[src]`).count()], [4, 4]);
  check('tile labels', await page.locator(`${panel} .gp-tile .gp-k`).allTextContents(), ['Base', 'Layer 1', 'Layer 2', 'Layer 3']);
  check('Layer 2 is highlighted', await page.locator(`${panel} .gp-tile.on`).getAttribute('data-layer'), '2');
  await click(`${panel} .gp-tile[data-layer="3"]`);
  check('clicking Layer 3 paints layer 3', await tool(), { set: 'BLENDS/FOREST_GRASS10', layer: 3, mode: 'paint' });
  check('hint in Paint', await hint(), 'Drag on terrain to paint the selected layer.');
  await shot('painting');
  await click(`${panel} .gp-tile[data-layer="0"]`);
  check('clicking Base gives Erase', (await tool()).mode, 'erase');
  check('Erase: Base on, layers dimmed', [await page.locator(`${panel} .gp-tile.on`).getAttribute('data-layer'), await page.locator(`${panel} .gp-tile.dim`).count()], ['0', 3]);
  check('hint in Erase', await hint(), 'Drag to bring back the base.');
  await shot('erase');

  // ---- 1. Mode groups and hints ----
  check('mode groups', await page.locator(`${panel} .gp-l`).allTextContents(), ['Texture', 'Shape']);
  const hints = {};
  for (const m of ['raise', 'lower', 'smooth', 'flatten']) {
    await click(`${panel} button[data-mode="${m}"]`);
    hints[m] = [await hint(), await page.locator(`${panel} .gp-tile`).count()];
  }
  check('Shape modes: hints, and no layer tiles', hints, {
    raise: ['Drag to raise the ground.', 0], lower: ['Drag to lower the ground.', 0],
    smooth: ['Drag to even out bumps.', 0], flatten: ['Drag to level the ground to where you started.', 0],
  });
  await shot('shape-mode');
  await click(`${panel} button[data-mode="paint"]`);
  check('back to Paint keeps a painted layer', await tool(), { set: 'BLENDS/FOREST_GRASS10', layer: 3, mode: 'paint' });

  // ---- 5. Brush ----
  await page.locator(`${panel} input[aria-label="Radius"]`).fill('256');
  await page.locator(`${panel} input[aria-label="Strength"]`).fill('0.6');
  check('brush sliders set radius and strength', await d.eval(() => { const t = window.__editor.editor.tools.tools.ground; return [t.radius, t.strength]; }), [256, 0.6]);

  // ---- 6. Noise fill: only with patches selected ----
  check('nothing selected: a note, no noise fill', [await page.locator(`${panel} .gp-note`).count(), await page.locator(`${panel} button:has-text("Noise-fill")`).count()], [1, 0]);
  check('no "Noise-blend all terrain"', await page.locator(`${panel} button:has-text("all terrain")`).count(), 0);
  const ids = await d.eval(async () => {
    const ed = window.__editor.editor;
    const { solidBounds } = await import('/src/edit/brushes.ts');
    const Vector3 = ed.camera.position.constructor;
    const all = ed.doc.allSolids().filter((s) => s.isDisplacement);
    const near = all.map((s) => ({ s, d: solidBounds(s).getCenter(new Vector3()).length() })).sort((a, b) => a.d - b.d).slice(0, 3).map((n) => n.s);
    ed.selection.set(near, []);
    return near.map((s) => s.id);
  });
  await settle(500);
  check('hint names the selection', await hint(), 'Drag on terrain to paint the selected layer. Only the 3 selected patches change.');
  check('noise fill heading', await page.locator(`${panel} .gp-sh:has(h3:text-is("Noise fill")) span`).textContent(), '3 selected patches');
  check('one row per layer with a swatch', [await page.locator(`${panel} .gp-noise`).count(), await page.locator(`${panel} .gp-noise img`).count()], [3, 3]);
  await shot('terrain-selected');
  const snapshot = () => d.eval(() => {
    const out = {};
    for (const s of window.__editor.editor.doc.allSolids()) {
      if (!s.isDisplacement) continue;
      const side = s.sides.find((x) => x.dispinfo);
      out[s.id] = side.material + '|' + (side.dispinfo.child('multiblend')?.get('row4') ?? '');
    }
    return out;
  });
  const before = await snapshot();
  await click(`${panel} button:has-text("Noise-fill 3 selected patches")`);
  await settle(500);
  const after = await snapshot();
  const changed = Object.keys(after).filter((id) => after[id] !== before[id]).map(Number).sort((a, b) => a - b);
  check('only the 3 selected patches changed', changed, [...ids].sort((a, b) => a - b));
  check('they use the blend', ids.every((id) => after[id].startsWith('BLENDS/FOREST_GRASS10|')), true);
  check('one undo step', await d.eval(() => window.__editor.editor.history.undo()), 'Ground: noise blend');
  const undone = await snapshot();
  check('undo restores them', Object.keys(undone).every((id) => undone[id] === before[id]), true);
  check('the tool\'s noise fill does nothing without a selection', await d.eval(() => {
    const ed = window.__editor.editor;
    ed.selection.clear();
    return ed.tools.tools.ground.noiseFill(ed.tools.tools.ground.noise);
  }), 0);

  // A two-texture set gets no noise fill, even with patches selected.
  await pickInBlender('NATURE/BLENDSTONEDIRT001A');
  await d.eval((list) => {
    const ed = window.__editor.editor;
    ed.selection.set(ed.doc.allSolids().filter((s) => list.includes(s.id)), []);
  }, ids);
  await settle(400);
  check('two-texture set: no noise fill', await page.locator(`${panel} .gp-noise, ${panel} button:has-text("Noise-fill")`).count(), 0);

  // ---- 7. Turn a floor into terrain ----
  await d.eval(async () => {
    const ed = window.__editor.editor;
    const { boxSolid } = await import('/src/edit/brushes.ts');
    const Vector3 = ed.camera.position.constructor;
    const floor = ed.doc.addSolid(boxSolid(ed.doc, new Vector3(6000, 6000, 0), new Vector3(6512, 6512, 16), 'DEV/DEV_MEASUREGENERIC01'));
    ed.history.added('Add floor', [floor]);
    ed.selection.set([floor], []);
  });
  await settle(400);
  await shot('floor-selected');
  const count = () => d.eval(() => window.__editor.editor.doc.allSolids().filter((s) => s.isDisplacement).length);
  const n0 = await count();
  await click(`${panel} button:has-text("Turn 1 selected floor into terrain")`);
  check('Turn into terrain makes patches in this blend', await d.eval(() => {
    const ed = window.__editor.editor;
    return ed.doc.allSolids().filter((s) => s.isDisplacement && s.sides.some((x) => x.dispinfo && x.material === 'NATURE/BLENDSTONEDIRT001A')).length;
  }) >= 1 && (await count()) === n0 + 1, true);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
