// History panel, rail undo/redo and the save reminder (NPX F9, F10). Makes five edits (one of them a POI generator
// run), jumps around in Map › History and compares the serialized map with the one recorded after each step, checks
// that the rail buttons enable and disable, that a new edit drops the grey steps, and that the status bar's save pill
// shows up after a shortened threshold and saves when clicked.
// Exits non-zero when a check fails. Against a running dev server:
//   SHE_PORT=5214 node scripts/history-test.mjs
// SHOTS_DIR=<folder> also saves screenshots of the rail, the History panel with grey steps, and the pill.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { root, withEditor } from './browser.mjs';

const MAP = 'zz_history_test.vmf';
const shotsDir = process.env.SHOTS_DIR;
let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

await withEditor(async (d, page) => {
  await d.open();
  await d.eval(async (name) => {
    const { VmfDocument } = await import('/src/vmf/map.ts');
    window.__editor.editor.loadDocument(VmfDocument.empty(), name);
    window.__editor.tabs.show('Map');
  }, MAP);
  await d.settle(200);

  const rail = (label) => page.locator(`#toolbar button[aria-label^="${label}"]`);
  const railState = async () => ({ undo: !(await rail('Undo').isDisabled()), redo: !(await rail('Redo').isDisabled()) });
  const steps = page.locator('.hist-list .hist-step');
  const rows = () => steps.evaluateAll((els) => els.map((el) => `${el.classList.contains('cur') ? '>' : el.classList.contains('fut') ? '~' : ' '}${el.querySelector('.hist-label').textContent}`));
  const serialized = () => d.eval(() => window.__editor.editor.doc.serialize());
  const jump = async (position) => { await steps.nth(position).click(); await d.settle(150); };

  check('fresh map: rail buttons', await railState(), { undo: false, redo: false });
  check('fresh map: history', await rows(), [`>Opened ${MAP}`]);

  // Five edits, the map serialized after each.
  const snapshots = [await serialized()];
  const edits = [
    async () => {
      const { boxSolid } = await import('/src/edit/brushes.ts');
      const ed = window.__editor.editor, V = ed.camera.position.constructor;
      const s = ed.doc.addSolid(boxSolid(ed.doc, new V(0, 0, 0), new V(256, 256, 64), 'DEV/DEV_MEASUREGENERIC01B'));
      ed.history.added('Add brush', [s]);
      window.__first = s;
    },
    async () => {
      const { POI_TYPES, newSpec } = await import('/src/gen/poi/registry.ts');
      await import('/src/gen/poi/catalogue.ts');
      const { applyPoi } = await import('/src/gen/poi/action.ts');
      const type = POI_TYPES[0], [w, h] = type.defaultSize;
      applyPoi(window.__editor.editor, newSpec(type, { x0: 1024, y0: -512, x1: 1024 + w, y1: -512 + h }, 64, { seed: 3 }), `Generate ${type.label.toLowerCase()}`);
    },
    async () => {
      const { translateSolid } = await import('/src/edit/brushes.ts');
      const ed = window.__editor.editor, s = window.__first;
      const end = ed.history.begin('Move', [s]);
      translateSolid(s, new (ed.camera.position.constructor)(128, 0, 0));
      s.reload();
      end();
    },
    async () => {
      const { boxSolid } = await import('/src/edit/brushes.ts');
      const ed = window.__editor.editor, V = ed.camera.position.constructor;
      ed.history.added('Add brush', [ed.doc.addSolid(boxSolid(ed.doc, new V(0, 512, 0), new V(128, 640, 64), 'DEV/DEV_MEASUREGENERIC01B'))]);
    },
    async () => window.__editor.editor.history.remove('Delete', [window.__first]),
  ];
  for (const edit of edits) {
    await d.eval(edit);
    await d.eval(() => window.__editor.editor.changed());
    await d.settle(100);
    snapshots.push(await serialized());
  }
  const poiLabel = await d.eval(async () => `Generate ${(await import('/src/gen/poi/registry.ts')).POI_TYPES[0].label.toLowerCase()}`);
  check('every edit changed the map', new Set(snapshots).size, 6);
  check('five steps, the generator run as one', await rows(), [` Opened ${MAP}`, ' Add brush', ` ${poiLabel}`, ' Move', ' Add brush', '>Delete']);
  check('after edits: rail buttons', await railState(), { undo: true, redo: false });

  // Jump back and forth in the list.
  for (const position of [2, 0, 4, 1, 5, 3]) {
    await jump(position);
    check(`jump to step ${position}: map restored`, (await serialized()) === snapshots[position], true);
  }
  check('at step 3: grey steps after it', await rows(), [` Opened ${MAP}`, ' Add brush', ` ${poiLabel}`, '>Move', '~Add brush', '~Delete']);
  check('at step 3: rail buttons', await railState(), { undo: true, redo: true });
  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true });
    await page.locator('.section.hist').scrollIntoViewIfNeeded();
    await page.locator('#sidebar').screenshot({ path: join(shotsDir, 'history-panel-grey-steps.png') });
    await page.screenshot({ path: join(shotsDir, 'history-full-1600.png') });
  }
  await jump(0);
  check('at the start: rail buttons', await railState(), { undo: false, redo: true });
  if (shotsDir) await page.locator('#toolbar').screenshot({ path: join(shotsDir, 'rail-undo-disabled.png') });

  // The rail buttons step one at a time.
  await rail('Redo').click();
  await rail('Redo').click();
  await d.settle(100);
  check('two redos on the rail', (await serialized()) === snapshots[2], true);
  await rail('Undo').click();
  await d.settle(100);
  check('one undo on the rail', (await serialized()) === snapshots[1], true);
  if (shotsDir) await page.locator('#toolbar').screenshot({ path: join(shotsDir, 'rail-undo-redo.png') });

  // A new edit drops the grey steps.
  await d.eval(edits[3]);
  await d.eval(() => window.__editor.editor.changed());
  await d.settle(100);
  check('new edit drops the grey steps', await rows(), [` Opened ${MAP}`, ' Add brush', '>Add brush']);
  check('new edit: rail buttons', await railState(), { undo: true, redo: false });

  // Save reminder: not before the threshold, then after a shortened one.
  const pill = page.locator('#statusbar .save-pill');
  check('no pill before the threshold', await pill.isVisible(), false);
  await d.eval(() => (window.__editor.editor.unsaved.reminderMs = 1500));
  await page.waitForTimeout(2000);
  check('pill after a 1.5 s threshold', await pill.isVisible(), true);
  check('pill text', await pill.textContent(), 'unsaved for 0 min · Save');
  // As the board shows it: 25 minutes unsaved.
  await d.eval(() => (window.__editor.editor.unsaved.since = Date.now() - 25 * 60_000));
  await page.waitForTimeout(400);
  check('pill text after 25 min', await pill.textContent(), 'unsaved for 25 min · Save');
  if (shotsDir) {
    await page.locator('#statusbar').screenshot({ path: join(shotsDir, 'save-pill-statusbar.png') });
    await page.screenshot({ path: join(shotsDir, 'save-pill-full-1600.png') });
  }
  await pill.click();
  await page.waitForFunction(() => !window.__editor.editor.dirty, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  check('clicking the pill saves', await d.eval(() => window.__editor.editor.dirty), false);
  check('saved file exists', existsSync(join(root, 'maps', MAP)), true);
  check('pill hidden after saving', await pill.isVisible(), false);
});

rmSync(join(root, 'maps', MAP), { force: true });
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
