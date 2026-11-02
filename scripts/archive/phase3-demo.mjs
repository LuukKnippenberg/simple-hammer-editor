// Phase 3 demo: builds a small arena from an empty map with real mouse and keyboard input,
// saving screenshots along the way. Requires the dev server (npm run dev).
import { launch, driver } from '../browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const d = driver(page);

await d.open('repo:hlw_City16.vmf');
page.on('dialog', (dlg) => dlg.accept());
await page.click('#topbar button:text("New")');
await d.view([-1500, -1750, 1450], [0, -100, 0]);

// Floor: block tool, 16 units high, concrete.
await d.eval(() => window.__editor.editor.setMaterial('STONE/STONEFLOOR006A'));
await d.key('2');
await page.fill('.tool-options input[type=number]', '16');
await page.press('.tool-options input[type=number]', 'Enter');
await page.click('#viewport canvas', { position: { x: 5, y: 5 }, button: 'right' });
await d.drag([-1024, -1024, 0], [1024, 1024, 0]);

// Walls: pick a brick texture in the Materials tab, then draw four walls on the floor.
await page.click('.tabs button:text("Materials")');
await page.fill('.tab-body input[placeholder^="Search materials"]', 'brickwall014a');
await page.waitForSelector('.mat-tile[title="brick/brickwall014a"]');
await page.click('.mat-tile[title="brick/brickwall014a"]');
await page.fill('.tool-options input[type=number]', '192');
await page.press('.tool-options input[type=number]', 'Enter');
await d.drag([-1024, -1024, 16], [1024, -960, 16]);
await d.drag([-1024, 960, 16], [1024, 1024, 16]);
await d.drag([-1024, -960, 16], [-960, 960, 16]);
// Last wall: screenshot while the drag is in progress to show the preview and its size.
await d.drag([960, -960, 16], [1024, 960, 16], { hold: () => d.shot('phase3-block-tool-drawing') });

// Cover blocks in the middle.
await d.eval(() => window.__editor.editor.setMaterial('WOOD/EP2_WOODWALL01'));
await page.fill('.tool-options input[type=number]', '96');
await page.press('.tool-options input[type=number]', 'Enter');
await d.drag([-320, -192, 16], [-192, 192, 16]);
await d.drag([192, -192, 16], [320, 192, 16]);
await d.drag([-96, -544, 16], [96, -416, 16]);
await d.settle(300);
await d.shot('phase3-blocks-created');

// Select tool: click the right cover block, drag the gizmo's X arrow, then resize it upwards.
await d.key('1');
await d.key('Escape');
await d.click([256, 0, 112]);
await d.settle(200);
const hx = await d.eval(() => window.__editor.gizmoHandle('x'));
const target = await d.project([256 + 320, 0, 112]);
const start = await d.project([256, 0, 112]);
await d.drag(hx, [hx[0] + (target[0] - start[0]), hx[1] + (target[1] - start[1])], { screen: true, steps: 20 });
await d.settle(200);
await d.shot('phase3-move-gizmo');

await d.key('r');
const hz = await d.eval(() => window.__editor.gizmoHandle('z'));
await d.drag(hz, [hz[0], hz[1] - 90], { screen: true, steps: 15 });
await d.settle(200);
await d.shot('phase3-resize-gizmo');
await d.key('m');

// Paint tool: pick a metal material and paint a wall face and a whole block (Shift).
await page.click('.tabs button:text("Materials")');
await page.fill('.tab-body input[placeholder^="Search materials"]', 'metalcombine001');
await page.waitForSelector('.mat-tile[title="metal/metalcombine001"]');
await page.click('.mat-tile[title="metal/metalcombine001"]');
await d.key('3');
await d.click([-256, -192, 64], { shift: true });
await d.click([0, 960, 100]);
await d.key('Escape');
await d.settle(300);
await d.shot('phase3-paint-materials');

// Entities: two player starts and a control point (which brings its capture area).
await page.click('.tabs button:text("Entities")');
await page.click('.ent-item:has-text("Player start")');
await d.click([-700, -700, 16]);
await d.click([700, 700, 16]);
await page.click('.ent-item:has-text("Control point")');
await d.click([0, 0, 16]);
await page.click('.ent-item:has-text("Scrap (small)")');
await d.click([-650, 600, 16]);
await d.click([650, -600, 16]);
// Select the control point to show its FGD-driven properties.
await d.key('1');
await d.key('Escape');
await d.click([0, 0, 60]);
await d.settle(300);
await d.shot('phase3-entities-inspector');

// Undo the last scrap marker and redo it, then save the arena for the compile phase.
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+y');
const saved = await d.eval(() => window.__editor.editor.save('phase3_arena.vmf'));
console.log('saved map', saved);

// Editing inside the big sample map stays real-time.
await d.open('repo:hlw_City16.vmf');
await d.view([-760, -980, 560], [0, 0, 60]);
await d.settle(500);
await d.key('Escape');
await d.click([-420, -150, 250]);
await d.settle(300);
// Lift the selected brush with the Z arrow: rebuilds happen live while dragging.
const hz2 = await d.eval(() => window.__editor.gizmoHandle('z'));
await d.drag(hz2, [hz2[0], hz2[1] - 120], { screen: true, steps: 20 });
await d.settle(300);
await d.shot('phase3-select-in-city16');

await browser.close();
