// Map checklist (F4) check in the browser: a new Annihilation map shows its count on the top-bar chip, a Fix in the
// popover raises it as one undo step, Ctrl+Z lowers it again, Change mode switches the list, and the compile dialog
// lists the same items. Exits non-zero when a check fails. Against a running dev server:
//   SHE_PORT=5213 node scripts/checklist-test.mjs [--shots <folder>]
// With --shots it also saves 1600×900 screenshots of the chip and the popover in every mode.
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

/** The chip refreshes this long after an edit (REFRESH_DELAY_MS in checklist.ts, plus margin). */
const REFRESH_WAIT_MS = 600;

await withEditor(async (d, page) => {
  await d.open();
  const chip = page.locator('#topbar .cl-chip');
  const pop = page.locator('.cl-pop');
  // The text as written (innerText would carry the caps styling).
  const chipState = () => chip.evaluate((el) => ({ text: [...el.children].map((c) => c.textContent).join(' '), ready: el.classList.contains('ready') }));
  /** The chip's count as the model computes it for the mode on show. */
  const modelCount = () => d.eval(async () => {
    const { currentChecklist } = await import('/src/ui/checklist.ts');
    const list = currentChecklist(window.__editor.editor);
    return `${list.ready}/${list.total} ready`;
  });
  const shot = async (name) => {
    if (!shotsAt) return;
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(shotsAt, `${name}.png`) });
    console.log(`saved ${name}.png`);
  };
  const openPopover = async () => { if (!(await pop.isVisible())) await chip.click(); await pop.waitFor({ state: 'visible' }); };
  const closePopover = async () => { if (await pop.isVisible()) await page.keyboard.press('Escape'); };

  /** New map from the dialog's template card (double-click creates it). */
  const newMap = async (kind) => {
    await closePopover();
    await page.click('#topbar button:has-text("New")');
    await page.dblclick(`.newmap [data-template="${kind}"]`);
    await d.settle(REFRESH_WAIT_MS);
    await d.eval(() => { window.__editor.editor.dirty = false; });
  };

  // A new Annihilation map: six of seven (the path check isn't run yet), green.
  await newMap('annihilation');
  const fresh = await chipState();
  check('new annihilation map: chip', fresh, { text: 'Annihilation 6/7 ready ▾', ready: true });
  check('chip count equals the model', fresh.text.endsWith(`${await modelCount()} ▾`), true);
  await shot('chip-green-annihilation');

  // Delete the map boundary: the chip drops to five and turns amber, without a reload.
  await d.eval(async () => {
    const ed = window.__editor.editor;
    const { deleteSelection } = await import('/src/edit/actions.ts');
    ed.selection.set([], ed.doc.entities.filter((e) => e.classname === 'func_map_boundary'));
    deleteSelection(ed);
  });
  await page.waitForTimeout(REFRESH_WAIT_MS);
  check('boundary deleted: chip', await chipState(), { text: 'Annihilation 5/7 ready ▾', ready: false });
  await shot('chip-amber-annihilation');

  // Fix it from the popover: one undo step, the count goes back up.
  await openPopover();
  const boundaryRow = pop.locator('.cl-row', { hasText: 'Map boundary' });
  check('popover: boundary row', await boundaryRow.locator('.cl-icon').innerText(), '✕');
  check('popover rows', await pop.locator('.cl-row b').allInnerTexts(), ['Player starts 2/2', 'Resources', 'Sky shell', 'Sun light', 'Name', 'Map boundary', 'Units can reach every base']);
  await shot('popover-annihilation-amber');
  const depth = await d.eval(() => window.__editor.editor.history.depth);
  await boundaryRow.locator('button', { hasText: 'Fix' }).click();
  await page.waitForTimeout(150);
  check('fix: one undo step', await d.eval(() => [window.__editor.editor.history.depth, window.__editor.editor.history.undoLabel]), [depth + 1, 'Add boundary']);
  check('fix: chip', await chipState(), { text: 'Annihilation 6/7 ready ▴', ready: true });
  check('fix: row is ready', await boundaryRow.locator('.cl-icon').innerText(), '✓');
  await shot('popover-annihilation-green');

  // Undo with Ctrl+Z: the count goes down again.
  await closePopover();
  await page.locator('#viewport').focus().catch(() => {});
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(REFRESH_WAIT_MS);
  check('undo: chip', await chipState(), { text: 'Annihilation 5/7 ready ▾', ready: false });
  check('undo: chip count equals the model', (await chipState()).text.endsWith(`${await modelCount()} ▾`), true);

  // The compile dialog lists the same items, in the same mode.
  const popoverRows = async () => { await openPopover(); const rows = await pop.locator('.cl-row b').allInnerTexts(); await closePopover(); return rows; };
  const dialogRows = async () => {
    await page.click('#topbar button:has-text("Compile & test")');
    const modal = page.locator('.modal:visible');
    await modal.locator('.cl-also').waitFor();
    const rows = await modal.locator('.checks > .cl-row').evaluateAll((els) => {
      const also = els[0].parentElement.querySelector('.cl-also');
      return els.filter((el) => also.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING).map((el) => el.querySelector('b').textContent);
    });
    return { rows, modal };
  };
  const listed = await popoverRows();
  const dialog = await dialogRows();
  check('compile dialog: same items as the chip', dialog.rows, listed);
  check('compile dialog: extras', await dialog.modal.locator('.cl-also ~ .cl-row b').allInnerTexts(), ['Map has geometry', 'Camera spawn (info_player_start)', 'Static props use static models']);
  await shot('compile-dialog-annihilation');
  await dialog.modal.locator('.modal-head button').click();

  // Change mode switches the list (the map itself is unchanged) and the compile dialog follows.
  await openPopover();
  await pop.locator('button.cl-link', { hasText: 'Change mode' }).click();
  await pop.locator('.cl-picker button', { hasText: 'Overrun' }).click();
  await page.waitForTimeout(150);
  check('change mode: chip', (await chipState()).text, 'Overrun 3/6 ready ▴');
  check('change mode: rows', await pop.locator('.cl-row b').allInnerTexts(), ['Player starts', 'Wave spawns', 'Overrun manager', 'Sky shell', 'Sun light', 'Map boundary']);
  await closePopover();
  const overrunRows = await popoverRows();
  check('change mode: compile dialog follows', (await dialogRows()).rows, overrunRows);
  await page.locator('.modal:visible .modal-head button').click();

  // Every mode's popover on a new map of that mode; a new map reads its own mode again.
  for (const [kind, text, rows] of [
    ['overrun', 'Overrun 6/6 ready ▴', 6],
    ['mission', 'Mission 6/7 ready ▴', 7],
    ['empty', 'Empty 1/4 ready ▴', 4],
  ]) {
    await newMap(kind);
    await openPopover();
    check(`new ${kind} map: chip`, (await chipState()).text, text);
    check(`new ${kind} map: rows`, await pop.locator('.cl-row').count(), rows);
    await shot(`popover-${kind}`);
  }
  // Empty's Pick a mode is a to-do: counted, never ready, with the other lists as buttons.
  const pickRow = pop.locator('.cl-row', { hasText: 'Pick a mode' });
  check('pick a mode: to-do', [await pickRow.getAttribute('class'), await pickRow.locator('.cl-icon').innerText()], ['cl-row warning', '!']);
  await pickRow.locator('button', { hasText: 'Mission' }).click();
  await page.waitForTimeout(150);
  check('pick a mode: chip', (await chipState()).text, 'Mission 1/7 ready ▴');
  await shot('popover-empty-picked-mission');
  await closePopover();

  // Sky, sun and boundary in place but no mode picked: 3/4, amber, the bar not full.
  await newMap('annihilation');
  await openPopover();
  await pop.locator('button.cl-link', { hasText: 'Change mode' }).click();
  await pop.locator('.cl-picker button', { hasText: 'Empty' }).click();
  await page.waitForTimeout(150);
  check('empty with the basics: chip', await chipState(), { text: 'Empty 3/4 ready ▴', ready: false });
  check('empty with the basics: popover not ready', await pop.evaluate((el) => [el.classList.contains('ready'), el.querySelector('.cl-bar > div').style.width]), [false, '75%']);
  await shot('popover-empty-with-basics');
  await closePopover();
});

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
