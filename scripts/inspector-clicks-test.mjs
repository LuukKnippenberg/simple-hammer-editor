// Selection inspector regression check: type into a number field, then click another control straight away; both
// changes must land (the first change's redraw used to replace the control under the pointer, so the click was lost).
// Also: a block whose stored seed is negative keeps it through Regenerate, and a typed seed below 1 becomes 1.
// Exits non-zero when a check fails. Against a running dev server:
//   EDITOR_URL=http://localhost:5199/ node scripts/inspector-clicks-test.mjs
import { withEditor } from './browser.mjs';

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

  const sidebar = page.locator('#sidebar');
  const rowOf = (label) => sidebar.locator('.row:visible', { has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) });
  /** Clicks a number field and types over its value (no change event yet: that fires when it loses the focus). */
  const type = async (field, text) => {
    await field.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(text);
  };
  const stored = () => d.eval(async () => {
    const { selectedBlocks } = await import('/src/gen/buildingAction.ts');
    const { blockOf } = await import('/src/gen/buildingStore.ts');
    const o = blockOf(selectedBlocks(window.__editor.editor)[0]).options;
    return { minFloors: o.minFloors, maxFloors: o.maxFloors, towers: o.towers, alleys: o.alleys, courtyards: o.courtyards, cutHeight: o.cutHeight, seed: o.seed };
  });
  const press = async (label) => { await sidebar.locator('button', { hasText: new RegExp(`^${label}$`) }).click(); await d.settle(300); };

  // One block of buildings (seed 11), selected by its handle.
  await d.eval(async () => {
    const ed = window.__editor.editor;
    const { boxSolid } = await import('/src/edit/brushes.ts');
    const { buildingsFromSelection, selectedBlocks } = await import('/src/gen/buildingAction.ts');
    const { blockOf } = await import('/src/gen/buildingStore.ts');
    const Vector3 = ed.camera.position.constructor;
    const brush = ed.doc.addSolid(boxSolid(ed.doc, new Vector3(0, 0, 0), new Vector3(1024, 768, 64), 'DEV/DEV_MEASUREGENERIC01'));
    ed.history.added('Add block', [brush]);
    ed.selection.set([brush], []);
    buildingsFromSelection(ed, { minFloors: 3, maxFloors: 6, alleys: false, roofProps: true, towers: true, courtyards: true, seed: 11 });
    // Generating selects nothing; select the new block like a click on its wall does.
    const detail = ed.doc.entities.find((e) => blockOf(e));
    (await import('/src/gen/buildingAction.ts')).selectBlock(ed, detail);
    return selectedBlocks(ed).length;
  });
  await d.settle(300);
  check('generated block', await stored(), { minFloors: 3, maxFloors: 6, towers: true, alleys: false, courtyards: true, cutHeight: undefined, seed: 11 });

  // Floors (min), then straight to the Towers checkbox.
  const floors = rowOf('Floors').locator('input');
  await type(floors.nth(0), '4');
  await rowOf('Towers').locator('input').click();
  check('draft after Floors, Towers', { min: await floors.nth(0).inputValue(), towers: await rowOf('Towers').locator('input').isChecked() }, { min: '4', towers: false });
  // Floors (max), then straight into another number field.
  await type(floors.nth(1), '9');
  await type(rowOf('Cut height').locator('input'), '104');
  check('draft after Floors, Cut height', { max: await floors.nth(1).inputValue(), cutHeight: await rowOf('Cut height').locator('input').inputValue() }, { max: '9', cutHeight: '104' });
  // Cut height, then Alleys; Seed, then Courtyards.
  await type(rowOf('Cut height').locator('input'), '96');
  await rowOf('Alleys').locator('input').click();
  await type(rowOf('Seed').locator('input'), '12');
  await rowOf('Courtyards').locator('input').click();
  // Floors (min) above the max: the max follows, and the click still lands.
  await type(floors.nth(0), '10');
  await rowOf('Alleys').locator('input').click();
  check('max follows min', await floors.nth(1).inputValue(), '10');
  await press('Regenerate');
  check('stored after Regenerate', await stored(), { minFloors: 10, maxFloors: 10, towers: false, alleys: false, courtyards: false, cutHeight: 96, seed: 12 });

  // Changes that add rows or disable one still show: the Extras fold, and Street lamps off greys out Spacing.
  await sidebar.locator('button.gen-fold:visible').click();
  check('Extras folded open', await rowOf('Trees').count(), 1);
  await rowOf('Street lamps').locator('input').click();
  check('Street lamps off disables Spacing', await rowOf('Spacing').locator('select').isDisabled(), true);
  await rowOf('Street lamps').locator('input').click();
  await sidebar.locator('button.gen-fold:visible').click();
  check('Extras folded shut', await rowOf('Trees').count(), 0);

  // A stored negative seed (older maps) passes through untouched: opening the inspector and Regenerate keep it.
  await d.eval(async () => {
    const { regenerateBlock, selectedBlocks } = await import('/src/gen/buildingAction.ts');
    regenerateBlock(window.__editor.editor, selectedBlocks(window.__editor.editor)[0], { options: { seed: -42 } });
  });
  await d.settle(300);
  check('negative seed shown', await rowOf('Seed').locator('input').inputValue(), '-42');
  await press('Regenerate');
  check('negative seed after Regenerate', (await stored()).seed, -42);
  await type(floors.nth(0), '3');
  await press('Regenerate');
  check('negative seed after editing Floors and Regenerate', [(await stored()).minFloors, (await stored()).seed], [3, -42]);
  await press('Re-roll');
  const rerolled = (await stored()).seed;
  check('Re-roll gives a new seed of at least 0', rerolled >= 0 && rerolled !== -42, true);
  // A typed seed below 1 becomes 1.
  for (const typed of ['-5', '0']) {
    await type(rowOf('Seed').locator('input'), typed);
    await press('Regenerate');
    check(`typed seed ${typed}`, (await stored()).seed, 1);
  }
});

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
