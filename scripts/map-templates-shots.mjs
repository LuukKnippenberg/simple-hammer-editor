// Screenshots of the New-map templates: the dialog, then a 4-player annihilation, an overrun and a
// singleplayer map as loaded. Nothing is saved. Shots are named templates-*.
//   EDITOR_URL=http://localhost:5203/ node scripts/map-templates-shots.mjs
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

/** Opens New, picks a template and its options, takes the dialog shot if named, then creates the map. */
async function newMap(kind, { players, size, shot } = {}) {
  await page.click('#topbar button:has-text("New")');
  await page.click(`.newmap [data-template="${kind}"]`);
  if (players) await page.click(`.newmap .row:has(label:text-is("Players")) button:text-is("${players}")`);
  if (size) await page.click(`.newmap .row:has(label:text-is("Size")) button:text-is("${size}")`);
  await page.waitForTimeout(200);
  if (shot) await d.shot(shot);
  await page.click('.newmap button:has-text("Create map")');
  await d.settle(2500);
}

/** Top view framed on the playable area (the map boundary). */
async function topOverview() {
  await d.eval(() => {
    const e = window.__editor.editor;
    if (e.view !== 'top') e.setView3dOrTop('top');
    const b = e.doc.entities.find((x) => x.classname === 'func_map_boundary');
    const box = e.world.bounds().clone().makeEmpty();
    for (const s of b.solids) for (const side of s.sides) for (const p of side.node.get('plane').match(/\(([^)]+)\)/g)) {
      const [x, y, z] = p.slice(1, -1).trim().split(/\s+/).map(Number);
      box.expandByPoint({ x, y, z });
    }
    e.frameBox(box);
  });
  await d.settle(1200);
}

await newMap('annihilation', { players: 4, size: 'Medium', shot: 'templates-01-dialog' });
await topOverview();
await d.shot('templates-02-annihilation-4p-top');
await d.eval(() => window.__editor.editor.setView3dOrTop('3d'));
await d.view([0, -5600, 4600], [0, -300, 0]);
await d.settle(1500);
await d.shot('templates-03-annihilation-4p-3d');

await newMap('overrun', { players: 2, size: 'Medium' });
await topOverview();
await d.shot('templates-04-overrun-top');
await d.eval(() => window.__editor.editor.setView3dOrTop('3d'));

await newMap('mission', { size: 'Small' });
await d.view([0, -3900, 1500], [0, -900, 0]);
await d.settle(1500);
await d.shot('templates-05-singleplayer');
await d.eval(() => window.__editor.missionFlow.open());
await page.waitForTimeout(800);
await d.shot('templates-06-singleplayer-flow');

const info = await d.eval(() => {
  const e = window.__editor.editor;
  return { name: e.mapName, dirty: e.dirty, entities: e.doc.entities.length, mission: e.mission?.stages.map((s) => s.title) };
});
console.log('last map', info);
console.log(errors.length ? `console errors:\n  ${errors.join('\n  ')}` : 'no console errors');
await browser.close();
