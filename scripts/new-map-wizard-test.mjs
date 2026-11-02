// New map wizard check (research/npx-handoff.md, F2): walks the four steps and creates maps. Checks that switching
// mode keeps the player count valid, the preview markers follow the player count, the prefix can't be typed away,
// the name checks update on each keystroke, Create waits for them, the created map is the one the old dialog made
// (tests/newMap.same-output.hashes.json) and "Sketch it" lands in the sketch dialog. Empty places ground, sky and
// sun with every start; generating the sketch keeps each mode's pieces (Overrun's waves and manager too). Exits
// non-zero when a check fails.
// Against a running dev server:
//   SHE_PORT=5212 node scripts/new-map-wizard-test.mjs
// SHOTS=<folder> also saves 1600×900 screenshots of each step and of the preview for 2 and 8 players.
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, withEditor } from './browser.mjs';

const HASHES = JSON.parse(readFileSync(join(root, 'tests', 'newMap.same-output.hashes.json'), 'utf8'));
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

await withEditor(async (d, page) => {
  await d.open();
  const dialog = page.locator('.newmap');
  const shot = async (name) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`) }); };
  const openWizard = async () => {
    await page.click('#topbar button:has-text("New")');
    await dialog.waitFor({ state: 'visible' });
    // The names in maps/ arrive a moment later.
    await page.waitForTimeout(400);
  };
  const card = (step, title) => dialog.locator(`.np-step:has(h3:text-is("${step}")) .np-card:has(b:text-is("${title}"))`);
  const startCard = (title) => dialog.locator('.np-card[data-start]', { has: page.locator(`b:text-is("${title}")`) });
  const players = () => dialog.locator('.row:has(label:text-is("Players")) .np-seg button');
  const activePlayers = async () => (await players().count()) ? dialog.locator('.row:has(label:text-is("Players")) .np-seg button.active').textContent() : null;
  const starts = () => dialog.locator('.np-preview .np-start').evaluateAll((els) => els.map((el) => `${el.getAttribute('x')},${el.getAttribute('y')}`));
  const checks = () => dialog.locator('.np-check').evaluateAll((els) => els.map((el) => el.classList.contains('ok')));
  const createDisabled = () => dialog.locator('button:text-is("Create map")').isDisabled();
  const name = dialog.locator('.np-input');

  await openWizard();
  await shot('1-wizard-default');

  // Step 1: mode and players. The preview follows the player count.
  check('Annihilation is the default mode', await dialog.locator('.np-card.active[data-template]').getAttribute('data-template'), 'annihilation');
  const two = await starts();
  check('2 players: 2 starts in the preview', two.length, 2);
  await shot('preview-2-players');
  await players().filter({ hasText: /^8$/ }).click();
  const eight = await starts();
  check('8 players: 8 starts in the preview', eight.length, 8);
  check('the 2-player starts moved', eight.slice(0, 2).join() !== two.join(), true);
  check('what gets placed follows', await dialog.locator('.np-places li').first().textContent(), '8 player starts in two teams, placed symmetrically');
  await shot('preview-8-players');
  await card('Mode', 'Overrun').click();
  check('Overrun after 8 players: 4 (the closest it offers)', await activePlayers(), '4');
  check('Overrun offers 1 to 4', await players().allTextContents(), ['1', '2', '3', '4']);
  check('Overrun shows the wave type', await dialog.locator('.row:has(label:text-is("Waves")) select').count(), 1);
  check('Overrun: 4 starts in the preview', (await starts()).length, 4);
  check('Overrun: the prefix chip is or_', await dialog.locator('.np-prefix').textContent(), 'or_');
  await shot('step-1-mode-overrun');
  await card('Mode', 'Singleplayer mission').click();
  check('Mission: no player count', await activePlayers(), null);
  check('Mission: the faction choice', await dialog.locator('.row:has(label:text-is("Faction")) button').allTextContents(), ['Rebels', 'Combine']);
  check('Mission: 1 start in the preview', (await starts()).length, 1);
  await card('Mode', 'Annihilation').click();
  check('back to Annihilation: 8 players again', await activePlayers(), '8');
  check('the checklist sentence names the mode', await dialog.locator('.np-sentence').textContent(), 'The map checklist then tracks what Annihilation needs, so nothing has to be remembered.');

  // Step 2: size and ground.
  await card('Size and look', 'Large').click();
  check('Large is picked', await dialog.locator('.np-step:has(h3:text-is("Size and look")) .np-card.active b').textContent(), 'Large 8192 u');
  await dialog.locator('.row:has(label:text-is("Ground")) select').selectOption({ label: 'Rubble → dirt' });
  await shot('step-2-size-large');

  // Step 3: start from. Empty ground places only the basics.
  await startCard('Empty ground').click();
  check('Empty ground: no markers in the preview', (await starts()).length, 0);
  check('Empty ground: only the basics', await dialog.locator('.np-places li').allTextContents(), ['Ground, sky shell, sun, fog and map boundary']);
  await shot('step-3-start-empty-ground');
  await startCard('Template layout').click();
  check('Template layout: the starts are back', (await starts()).length, 8);

  // Step 4: the name. The checks follow each keystroke; the prefix stays the chip's.
  await name.fill('');
  check('an empty name fails "lowercase, no spaces"', await checks(), [true, false, true]);
  check('Create is disabled while a check fails', await createDisabled(), true);
  await name.pressSequentially('hlw_Can');
  check('a typed prefix goes back into the chip', await name.inputValue(), 'Can');
  check('uppercase fails on the keystroke', await checks(), [true, false, true]);
  await name.press('Home');
  await name.press('Backspace');
  await name.press('Backspace');
  check('Backspace at the start leaves the chip alone', await dialog.locator('.np-prefix').textContent(), 'hlw_');
  await name.press('Shift+End');
  await name.pressSequentially('can');
  check('lowercase passes on the keystroke', await checks(), [true, true, true]);
  await name.pressSequentially(' 2');
  check('a space fails', await checks(), [true, false, true]);
  await name.fill('city16');
  check('a name maps/ has fails "no map with this name yet"', await checks(), [true, true, false]);
  check('Create is disabled for a taken name', await createDisabled(), true);
  await name.fill('');
  const perKey = [];
  for (const key of 'canals_8p') {
    await name.press(key);
    perKey.push((await checks()).every(Boolean));
  }
  check('typing canals_8p: every keystroke passes', perKey, [...'canals_8p'].map(() => true));
  check('the path shows the prefix', await dialog.locator('.np-path').textContent(), '→ maps/hlw_canals_8p.vmf');
  check('Create is enabled when every check passes', await createDisabled(), false);
  await shot('step-4-name');

  // Create: the map the old dialog made with the same options.
  await dialog.locator('button:text-is("Create map")').click();
  await d.settle();
  check('the wizard closed', await dialog.isVisible(), false);
  const created = await d.eval(async () => {
    const { editor } = window.__editor;
    const text = `${editor.doc.serialize()}\n${JSON.stringify(editor.mission)}`;
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return { name: editor.mapName, hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') };
  });
  check('the map is named from the chip and the field', created.name, 'hlw_canals_8p.vmf');
  check('same map as the old dialog (annihilation/8/large/rubble)', created.hash, HASHES['annihilation/8/large/NATURE/BLENDRUBBLEDIRT001A']);
  await shot('created-annihilation-8p');

  // Sketch it: the map is created, then the sketch dialog opens on it with the template's markers.
  await openWizard();
  await card('Mode', 'Annihilation').click();
  await players().filter({ hasText: /^2$/ }).click();
  await card('Size and look', 'Small').click();
  await startCard('Sketch it').click();
  await name.fill('sketched_2p');
  await shot('step-3-start-sketch');
  await dialog.locator('button:text-is("Create map")').click();
  await page.waitForTimeout(600);
  check('Sketch it lands in the sketch dialog', await page.locator('.modal.sketch').isVisible(), true);
  const sketch = await d.eval(() => {
    const { editor } = window.__editor;
    return { name: editor.mapName, cells: editor.sketch?.w, starts: editor.sketch?.markers.filter((m) => m.kind === 'mp_start').length };
  });
  check('on the new map, a sketch its size with its starts', sketch, { name: 'hlw_sketched_2p.vmf', cells: 32, starts: 2 });
  await shot('sketch-dialog-after-sketch-it');
  const classes = (...names) => d.eval((names) => {
    const ents = window.__editor.editor.doc.entities;
    return Object.fromEntries(names.map((cls) => [cls, ents.filter((e) => e.classname === cls).length]));
  }, names);
  const generate = async () => {
    await page.locator('.modal.sketch button:has-text("Generate 3D map")').click();
    await d.settle();
  };
  await generate();
  check('generating the Annihilation sketch keeps its starts and points', await classes('info_start_wars', 'control_point'), { info_start_wars: 2, control_point: 5 });

  // Empty: ground, sky and sun with every start, at the chosen size and ground.
  for (const start of ['Template layout', 'Sketch it']) {
    await openWizard();
    await card('Mode', 'Empty').click();
    await card('Size and look', 'Small').click();
    await dialog.locator('.row:has(label:text-is("Ground")) select').selectOption({ label: 'Rubble → dirt' });
    await startCard(start).click();
    check(`Empty + ${start}: the preview draws the boundary`, await dialog.locator('.np-preview .np-boundary').count(), 1);
    check(`Empty + ${start}: what gets placed`, await dialog.locator('.np-places li').allTextContents(), ['Ground, sky shell, sun, fog and map boundary']);
    await name.fill(start === 'Sketch it' ? 'empty_sketched' : 'empty_template');
    await dialog.locator('button:text-is("Create map")').click();
    await d.settle();
    if (start === 'Sketch it') {
      check('Empty + Sketch it lands in the sketch dialog', await page.locator('.modal.sketch').isVisible(), true);
      await page.locator('.modal.sketch .modal-head button:text-is("✕")').click();
    }
    const empty = await d.eval(() => {
      const { editor } = window.__editor;
      const ground = editor.doc.worldEntity.solids.filter((s) => s.isDisplacement);
      return { sky: editor.doc.world.get('skyname'), ground: ground.length > 0, blend: ground.every((s) => s.sides.some((side) => side.material === 'NATURE/BLENDRUBBLEDIRT001A')) };
    });
    check(`Empty + ${start}: ground of the chosen blend and a sky`, empty, { sky: 'sky_day01_01', ground: true, blend: true });
    check(`Empty + ${start}: sun, fog and boundary`, await classes('light_environment', 'env_fog_controller', 'func_map_boundary'), { light_environment: 1, env_fog_controller: 1, func_map_boundary: 1 });
  }
  await shot('created-empty');

  // Overrun with Sketch it: generating the sketch keeps the wave spawns and the manager with its wave type.
  await openWizard();
  await card('Mode', 'Overrun').click();
  await players().filter({ hasText: /^2$/ }).click();
  await card('Size and look', 'Small').click();
  await dialog.locator('.row:has(label:text-is("Waves")) select').selectOption({ label: 'Zombies' });
  await startCard('Sketch it').click();
  await name.fill('sketched_waves');
  await dialog.locator('button:text-is("Create map")').click();
  await page.waitForTimeout(600);
  check('Overrun + Sketch it: wave and manager markers', await d.eval(() => window.__editor.editor.sketch.markers.filter((m) => m.kind === 'wave_spawn' || m.kind === 'overrun_manager').length), 9);
  await shot('sketch-dialog-overrun');
  await generate();
  check('Overrun + Sketch it, generated: starts, wave spawns and manager', await classes('info_start_wars', 'overrun_wave_spawnpoint', 'overrun_manager'), { info_start_wars: 2, overrun_wave_spawnpoint: 8, overrun_manager: 1 });
  check('the manager keeps the chosen wave type', await d.eval(() => window.__editor.editor.doc.entities.find((e) => e.classname === 'overrun_manager')?.get('wavetype')), 'zombie');
  check('the generated map keeps its name', await d.eval(() => window.__editor.editor.mapName), 'or_sketched_waves.vmf');

  // Mission with Sketch it keeps the player start and faction.
  await openWizard();
  await card('Mode', 'Singleplayer mission').click();
  await dialog.locator('.row:has(label:text-is("Faction")) button:text-is("Combine")').click();
  await startCard('Sketch it').click();
  await name.fill('sketched_mission');
  await dialog.locator('button:text-is("Create map")').click();
  await page.waitForTimeout(600);
  await generate();
  check('Mission + Sketch it, generated: player camera and faction setup', await classes('info_player_wars', 'wars_player_setup'), { info_player_wars: 1, wars_player_setup: 1 });
});

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
