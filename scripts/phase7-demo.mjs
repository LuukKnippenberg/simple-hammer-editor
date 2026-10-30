// Phase 7 demo: entity I/O scripting. Inspect an existing mission's logic, then script a trigger in the arena.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const d = driver(page);

// --- An existing singleplayer mission ------------------------------------------------------------
await d.open('game0:sp_radio_tower.vmf');
await page.click('.tabs button:text("Logic")');
await page.waitForTimeout(300);
await page.click('button:text("Open logic graph")');
await page.waitForTimeout(600);
await d.shot('phase7-logic-graph');
await page.click('.modal.graph .modal-head button');

// Select the objective that wins the mission and show its outputs and incoming connections.
await d.eval(() => {
  const e = window.__editor.editor;
  const ent = e.doc.entities.find((x) => x.get('targetname') === 'rebuild_tower_objective');
  e.selection.set([], [ent]);
  const b = e.selection.bounds();
  e.frameBox(b.expandByScalar(900));
});
await d.settle(600);
await d.shot('phase7-objective-io');

// --- Scripting a trigger in the arena with the UI --------------------------------------------------
await d.open('repo:phase3_arena.vmf');
await d.view([-1250, -1350, 900], [0, -100, 0]);
// Block tool: a 384×384 trigger volume at the arena entrance.
await d.key('2');
await page.fill('.tool-options input[type=number]', '128');
await page.press('.tool-options input[type=number]', 'Enter');
await d.drag([-704, -704, 16], [-320, -320, 16]);
await page.keyboard.press('Control+t');
await d.settle(300);
// Name the trigger.
await page.fill('.tab-body .row:has(label:text-is("Name")) input', 'entrance_trigger');
await page.press('.tab-body .row:has(label:text-is("Name")) input', 'Enter');

// Place a message box and a mission objective with the Entity tool (via class search).
const place = async (cls, at) => {
  await page.click('.tabs button:text("Entities")');
  await page.fill('.tab-body input[placeholder="All entity classes…"]', cls);
  await page.click(`.ent-item[title="${cls}"]`);
  await d.click(at);
  await d.settle(200);
  await d.key('1');
  await d.key('Escape');
  await d.click([at[0], at[1], at[2] + 6]);
  await page.click('.tabs button:text("Selection")');
};
await place('wars_messagebox', [-512, 256, 16]);
await page.fill('.tab-body .row:has(label:text-is("Name")) input', 'welcome_msg');
await page.press('.tab-body .row:has(label:text-is("Name")) input', 'Enter');
await page.fill('.tab-body .row:has(label:text-is("Text")) input', 'Hold the centre against the Combine!');
await page.press('.tab-body .row:has(label:text-is("Text")) input', 'Enter');
await place('wars_mission_objective', [-256, 256, 16]);
await page.fill('.tab-body .row:has(label:text-is("Name")) input', 'hold_objective');
await page.press('.tab-body .row:has(label:text-is("Name")) input', 'Enter');

// Select the trigger and wire OnStartTouch → welcome_msg.Display and → hold_objective.SetVisible(1).
await d.eval(() => {
  const e = window.__editor.editor;
  e.selection.set([], [e.doc.entities.find((x) => x.get('targetname') === 'entrance_trigger')]);
});
await page.waitForTimeout(200);
const wire = async (target, input, param) => {
  await page.click('button:text("+ Add output")');
  const row = page.locator('.io-row').last();
  await row.locator('select').first().selectOption('OnStartTouch');
  await page.locator('.io-row').last().locator('input[placeholder="target"]').fill(target);
  await page.locator('.io-row').last().locator('input[placeholder="target"]').press('Enter');
  await page.waitForTimeout(150);
  await page.locator('.io-row').last().locator('select').nth(1).selectOption(input);
  if (param) {
    await page.locator('.io-row').last().locator('input[placeholder="param"]').fill(param);
    await page.locator('.io-row').last().locator('input[placeholder="param"]').press('Enter');
  }
};
// A typo first, to show validation.
await wire('welcom_msg', '', '');
await d.settle(200);
await d.shot('phase7-broken-target');
await page.locator('.io-row').last().locator('input[placeholder="target"]').fill('welcome_msg');
await page.locator('.io-row').last().locator('input[placeholder="target"]').press('Enter');
await page.waitForTimeout(150);
await page.locator('.io-row').last().locator('select').nth(1).selectOption('Display');
await wire('hold_objective', 'SetVisible', '1');
await page.locator('.io-row').last().locator('input[placeholder="once"], input[type=checkbox]').last().check();
await d.view([-1150, -1150, 760], [-450, -150, 40]);
await d.settle(400);
await d.shot('phase7-trigger-outputs');

await page.click('.tabs button:text("Logic")');
await page.click('button:text("Open logic graph")');
await page.waitForTimeout(400);
await d.shot('phase7-arena-graph');
await page.click('.modal.graph .modal-head button');
console.log('saved', await d.eval(() => window.__editor.editor.save('phase7_scripted_arena.vmf')));
await browser.close();
