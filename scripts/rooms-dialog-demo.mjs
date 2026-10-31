// Interior building dialog: opens it on an empty map, selects a room, changes a link, builds the station preset in
// front of the camera and shows the building's panel. Screenshots for the README.
//   EDITOR_URL=http://localhost:5194/ node scripts/rooms-dialog-demo.mjs [prefix]
import { launch, driver } from './browser.mjs';

const prefix = process.argv[2] ?? 'rooms-dialog';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('  [console]', m.text()); });
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');
await page.click('#topbar button:has-text("New")');
await d.eval(async () => {
  const ed = window.__editor.editor;
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const Vector3 = ed.camera.position.constructor;
  ed.doc.addSolid(boxSolid(ed.doc, new Vector3(-3072, -3072, -64), new Vector3(3072, 3072, 0), 'CONCRETE/CONCRETEFLOOR033A'));
  ed.selection.clear();
  ed.changed();
});
await d.view([0, -900, 2600], [0, 0, 0]);
await d.settle(800);

// The dialog with the station preset.
await page.click('button:has-text("Interior building…")');
await page.waitForTimeout(600);
await d.shot(`${prefix}-plan`);
// Select the customs room (cells 12–24 × 8–13 on a 26 × 26 grid) and open its link to the concourse.
const cell = async (cx, cy) => {
  const r = await page.locator('.modal.rooms canvas').boundingBox();
  const n = 26;
  return [r.x + ((cx + 0.5) / n) * r.width, r.y + ((n - cy - 0.5) / n) * r.height];
};
const [sx, sy] = await cell(17, 10);
await page.mouse.click(sx, sy);
await page.waitForTimeout(300);
const link = page.locator('.modal.rooms .sketch-side select').nth(1);
await link.selectOption('arches');
await page.waitForTimeout(300);
await d.shot(`${prefix}-room`);
// Build it in front of the camera, then look at it and its panel.
await page.click('button:has-text("Build interior building")');
await d.settle(2500);
await d.eval(() => { const W = window.__editor; if (!W.lighting.enabled) { W.lighting.setEnabled(true); W.editor.emit('lighting'); } W.lighting.refresh(); });
await d.settle(3000);
await d.view([1500, -2400, 3000], [0, 0, 0]);
await d.settle(1500);
await d.shot(`${prefix}-built`);
const report = await d.eval(async () => {
  const ed = window.__editor.editor;
  const { selectedRooms } = await import('/src/gen/rooms/action.ts');
  const { roomsOf } = await import('/src/gen/rooms/store.ts');
  const r = selectedRooms(ed);
  return { selected: r.length, links: r[0] ? roomsOf(r[0]).links : null, entities: ed.doc.entities.length };
});
console.log(JSON.stringify(report));
await browser.close();
