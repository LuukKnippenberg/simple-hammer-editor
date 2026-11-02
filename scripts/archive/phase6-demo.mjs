// Phase 6 demo: top view, hover, box selection, hide, copy/paste at the cursor, outliner, shortcut overlay.
import { launch, driver } from '../browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const d = driver(page);
await d.open('repo:hlw_City16.vmf');

// Top view of the whole map, hovering a building.
await d.key('t');
await d.eval(() => window.__editor.editor.frameBox(window.__editor.editor.world.bounds()));
await d.settle(600);
const [hx, hy] = await d.project([-1700, 1120, 300]);
await page.mouse.move(hx, hy);
await page.waitForTimeout(300);
await d.shot('phase6-top-view-hover');

// Box selection in the top view around the central plaza.
const a = await d.project([-900, -900, 0]), b = await d.project([900, 900, 0]);
await d.drag(a, b, { screen: true, steps: 15, hold: () => d.shot('phase6-box-select-dragging') });
await d.settle(300);
await d.shot('phase6-box-selected');

// Hide the selection (editor only) and show the plaza without it in 3D.
await d.key('h');
await d.key('t');
await d.view([-760, -980, 560], [0, 0, 60]);
await d.settle(500);
await d.shot('phase6-hidden-selection');
await d.key('u');

// Copy a building block and paste it at the cursor.
await d.click([-420, -150, 250]);
await page.keyboard.press('Control+c');
const [px, py] = await d.project([350, -700, 80]);
await page.mouse.move(px, py);
await page.waitForTimeout(250);
await page.keyboard.press('Control+v');
await d.settle(300);
await d.shot('phase6-copy-paste-at-cursor');

// Outliner with a search, and the shortcut overlay.
await page.click('.tabs button:text("Map")');
await page.fill('.outliner >> xpath=preceding-sibling::input', 'control');
await page.waitForTimeout(200);
await page.click('.out-ent >> nth=1');
await d.settle(500);
await page.click('.tabs button:text("Map")');
await page.waitForTimeout(200);
await d.shot('phase6-outliner');
await page.keyboard.press('Shift+?');
await page.waitForTimeout(300);
await d.shot('phase6-shortcuts');
await browser.close();
