// Phase 9 demo: lighting preview (sun shadows, ambient, light entities) and the sun controls.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);

// Same view of City16: editor lighting, then the preview.
await d.open('repo:hlw_City16.vmf');
const view = [[-760, -980, 560], [0, 0, 60]];
await d.view(...view);
await d.settle(500);
await d.shot('phase9-editor-lighting');
await d.key('l');
await d.settle(800);
await d.shot('phase9-preview-lighting');

// Late afternoon: lower the sun and turn it, with the sliders in the Map tab.
await page.click('.tabs button:text("Map")');
const setRange = async (label, value) => {
  const input = page.locator(`.tab-body > div:not([hidden]) .row:has(label:text-is("${label}")) input[type=range]`);
  await input.evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
};
await setRange('Sun height', 18);
await setRange('Sun direction', 300);
await d.settle(500);
await d.shot('phase9-low-sun');
await page.keyboard.press('Control+z');

// Night in the arena: dim sun and ambient, then light it with placed lights.
await d.open('repo:phase3_arena.vmf');
await d.key('l');
await page.click('.tabs button:text("Map")');
await setRange('Sun height', 8);
const setColor = async (label, color, bright) => {
  const row = page.locator(`.tab-body > div:not([hidden]) .row:has(label:text-is("${label}"))`);
  await row.locator('input[type=color]').evaluate((el, c) => {
    el.value = c;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, color);
  await row.locator('input[type=number]').fill(String(bright));
  await row.locator('input[type=number]').press('Enter');
};
await setColor('Sun colour', '#5a6a9a', 40);
await setColor('Ambient', '#202838', 20);
await d.view([-1100, -1150, 700], [-100, -100, 0]);
await page.click('.tabs button:text("Entities")');
const place = async (label, at, keys) => {
  await page.click(`.ent-item:has-text("${label}")`);
  await d.click(at);
  await d.settle(150);
  await d.eval((k) => {
    const e = window.__editor.editor;
    const ent = [...e.selection.entities][0];
    const end = e.history.begin('Edit light', [], [ent]);
    for (const [key, v] of Object.entries(k)) ent.set(key, v);
    end();
    e.changed();
  }, keys);
};
await place('Point light', [-512, -512, 16], { _light: '255 160 80 260', origin: '-512 -512 96' });
await place('Point light', [512, 512, 16], { _light: '255 160 80 260', origin: '512 512 96' });
await place('Point light', [-512, 512, 16], { _light: '120 200 255 220', origin: '-512 512 96' });
await place('Point light', [512, -512, 16], { _light: '120 200 255 220', origin: '512 -512 96' });
await place('Spot light', [0, -256, 16], { _light: '255 240 200 900', origin: '0 -700 300', angles: '0 90 0', pitch: '-35', _cone: '35', _inner_cone: '20' });
await d.key('1');
await d.key('Escape');
await d.settle(800);
await d.shot('phase9-night-lights');
await page.click('.tabs button:text("Map")');
await d.shot('phase9-lighting-panel');
await browser.close();
