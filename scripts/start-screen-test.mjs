// Start screen and recover, end to end: a cold start lands on the start screen; an example opens as a copy and the
// original stays as it was; an edit that was autosaved but not saved is offered back after a reload, and Discard,
// Compare › Keep both, Recover and (on opening the map directly) Open saved version each do what they say; a saved
// map newer than its autosave is not offered. Nothing is written to the game's mapsrc/. Waits for two real autosaves
// (a minute each). Removes the maps and autosaves it made. Exits non-zero when a check fails. Against a dev server:
//   SHE_PORT=5211 node scripts/start-screen-test.mjs [--shots <folder>]
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { baseUrl, launch, root } from './browser.mjs';

const EXAMPLE = 'sp_sofia';
const COPY = `${EXAMPLE}_copy`;
const AUTOSAVE_WAIT = 65_000;
const shotsArg = process.argv.indexOf('--shots');
const shotsDir = shotsArg > 0 ? process.argv[shotsArg + 1] : null;

let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
const hash = (file) => (existsSync(file) ? createHash('sha1').update(readFileSync(file)).digest('hex') : null);
const maps = join(root, 'maps');
const mtime = (file) => (existsSync(file) ? statSync(file).mtimeMs : 0);
/** Waits until `test()` holds (a file written by the dev server), at most `ms`. */
async function until(test, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (test()) return true;
  return false;
}
const autosaves = join(root, '.autosave');

/** Every file under the game installs' mapsrc/ folders with its size and time, to show nothing was written there. */
async function mapsrcState() {
  const cfg = await fetch(new URL('/api/config', baseUrl)).then((r) => r.json());
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else { const s = statSync(p); out.push(`${p}|${s.size}|${s.mtimeMs}`); }
    }
  };
  for (const i of cfg.installs) if (existsSync(join(i.dir, cfg.mod, 'mapsrc'))) walk(join(i.dir, cfg.mod, 'mapsrc'));
  return out.sort().join('\n');
}

function cleanUp() {
  for (const dir of [maps, autosaves]) {
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir)) if (n.toLowerCase().startsWith(COPY)) rmSync(join(dir, n));
  }
}

cleanUp();
const exampleHash = hash(join(maps, `${EXAMPLE}.vmf`));
const mapsrcBefore = await mapsrcState();
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => { failed++; console.log('FAIL [pageerror]', e.message); });
  page.on('dialog', (d) => d.accept());
  const ed = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name) => {
    if (!shotsDir) return;
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(shotsDir, `${name}.png`) });
    console.log(`     saved ${name}.png`);
  };
  const startScreen = async (url = baseUrl) => {
    await page.goto(url);
    await page.waitForSelector('.start-screen:not([hidden]) .recent-row', { timeout: 60000 });
    await page.waitForSelector('.setup-row.ok, .setup-row.bad');
    await page.waitForTimeout(300);
  };
  const loaded = (name) => page.waitForFunction((n) => window.__editor.editor.mapName === n && !window.__editor.editor.busy?.(), name, { timeout: 120000 });
  const banner = () => page.locator('.recover-banner', { hasText: COPY });

  // 1. Cold start: the start screen, no map loaded, Recent newest first, the setup checked.
  await startScreen();
  check('cold start shows the start screen', await page.isVisible('.start-screen'), true);
  check('no map was loaded', await ed(() => window.__editor.ready), false);
  const recent = await page.$$eval('.recent-row .recent-title b', (els) => els.map((e) => e.textContent));
  const listed = await fetch(new URL('/api/recent', baseUrl)).then((r) => r.json());
  check('Recent shows the listed maps', recent, listed.recent.map((m) => m.name.replace(/\.vmf$/i, '')));
  const times = listed.recent.map((m) => m.mtime);
  check('Recent is newest first', times, [...times].sort((a, b) => b - a));
  check('setup rows', await page.$$eval('.setup-row[data-setup]', (els) => els.length >= 3), true);
  await shot('start-screen');

  // 2. An example opens as a copy; saving the copy leaves the example as it was.
  await page.click('.start-example:has-text("Sofia")');
  await loaded(`${COPY}.vmf`);
  check('the start screen closes', await page.isVisible('.start-screen'), false);
  check('the example opens as a copy', await ed(() => window.__editor.editor.mapName), `${COPY}.vmf`);
  check('the page title names the copy', (await page.title()).startsWith(COPY), true);
  await page.keyboard.press('Control+s');
  check('the copy is saved in maps/', await until(() => existsSync(join(maps, `${COPY}.vmf`))), true);
  await page.waitForTimeout(500);
  check('the example file is untouched', hash(join(maps, `${EXAMPLE}.vmf`)), exampleHash);

  // 3. Edit (delete three entities, rename one) and wait for the autosave.
  const savedHash = hash(join(maps, `${COPY}.vmf`));
  const editAndAutosave = async () => {
    await ed(() => {
      const e = window.__editor.editor;
      for (const ent of e.doc.entities.filter((x) => x.classname !== 'worldspawn').slice(-3)) e.doc.removeEntity(ent);
      e.changed();
    });
    console.log('     waiting for the autosave…');
    await page.waitForFunction(() => window.__editor.editor.lastAutosave, null, { timeout: AUTOSAVE_WAIT + 30000 });
  };
  await editAndAutosave();
  const autosaveFile = join(autosaves, `${COPY}.autosave.vmf`);
  check('the autosave is written', existsSync(autosaveFile), true);

  // 4. Reload without saving: the start screen offers the work back. Discard hides it.
  await startScreen();
  check('the banner offers the work back', await banner().count(), 1);
  check('banner text', /has unsaved work from today \d\d:\d\d\./.test(await banner().textContent()), true);
  await shot('recover-banner');
  await banner().locator('button', { hasText: 'Discard' }).click();
  await page.waitForTimeout(500);
  check('Discard hides the banner', await banner().count(), 0);
  await ed(() => localStorage.removeItem('she.pref.recoverDismissed'));

  // 5. Compare › Keep both: the autosave is saved next to the map; the map stays as it was.
  await startScreen();
  await banner().locator('button', { hasText: 'Compare' }).click();
  await page.waitForSelector('.recover-card .recover-summary:not([hidden])');
  const sentence = await page.textContent('.recover-card p');
  check('the card says when it was saved and how much changed', /^sp_sofia_copy\.vmf was last saved today \d\d:\d\d\. An autosave from \d\d:\d\d has \d+ more changes?\.$/.test(sentence.trim()), true);
  console.log(`     ${sentence.trim()}  /  ${await page.textContent('.recover-summary')}`);
  check('the summary counts the deletions', (await page.textContent('.recover-summary')).includes('deleted 3'), true);
  await shot('recover-card');
  await page.click('.recover-card button:has-text("Keep both")');
  await loaded(`${COPY}_recovered.vmf`);
  check('Keep both writes <name>_recovered.vmf', hash(join(maps, `${COPY}_recovered.vmf`)), hash(autosaveFile));
  check('Keep both leaves the saved map', hash(join(maps, `${COPY}.vmf`)), savedHash);
  await ed(() => localStorage.removeItem('she.pref.recoverDismissed'));

  // 6. Recover: the autosave opens under the map's name, unsaved.
  await startScreen();
  const entities = (text) => text.match(/^\s*entity\s*$/gm).length;
  const savedEntities = entities(readFileSync(join(maps, `${COPY}.vmf`), 'latin1'));
  await banner().locator('button', { hasText: 'Recover' }).click();
  await loaded(`${COPY}.vmf`);
  await page.waitForTimeout(300);
  check('Recover opens the work under the map name, unsaved', await ed(() => [window.__editor.editor.mapName, window.__editor.editor.dirty]), [`${COPY}.vmf`, true]);
  check('Recover brings back the work (three entities fewer)', entities(await ed(() => window.__editor.editor.doc.serialize())), savedEntities - 3);
  check('the saved map is not overwritten by Recover', hash(join(maps, `${COPY}.vmf`)), savedHash);

  // 7. Opening the map directly shows the card; Open saved version keeps the file and stops asking.
  await page.goto(new URL(`?map=repo:${COPY}.vmf`, baseUrl).toString());
  await page.waitForSelector('.recover-card', { timeout: 120000 });
  check('a direct open shows the card', await page.isVisible('.recover-card'), true);
  await page.click('.recover-card button:has-text("Open saved version")');
  await page.waitForTimeout(300);
  check('Open saved version keeps the saved map open', await ed(() => [window.__editor.editor.mapName, window.__editor.editor.dirty]), [`${COPY}.vmf`, false]);
  await startScreen();
  check('after Open saved version the start screen stops asking', await banner().count(), 0);

  // 8. A map saved after its autosave is not offered.
  await ed(() => localStorage.removeItem('she.pref.recoverDismissed'));
  await page.goto(new URL(`?map=repo:${COPY}.vmf`, baseUrl).toString());
  await page.waitForSelector('.recover-card', { timeout: 120000 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+s');
  check('saving makes the file newer than the autosave', await until(() => mtime(join(maps, `${COPY}.vmf`)) > mtime(autosaveFile)), true);
  await page.waitForTimeout(500);
  await startScreen();
  check('an autosave older than the saved file is not offered', await banner().count(), 0);
} finally {
  await browser.close();
}
check('nothing was written to the game’s mapsrc/', (await mapsrcState()) === mapsrcBefore, true);
cleanUp();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
