// Captures editor screenshots for the docs with the system Edge/Chrome (no browser download needed).
//
//   node scripts/screenshot.mjs shots.json
//
// shots.json: [{ "name": "phase0-overview", "map": "repo:hlw_City16.vmf",
//               "view": { "pos": [x,y,z], "target": [x,y,z] }, "eval": "optional JS run before capture",
//               "after": "optional JS run after capture",
//               "width": 1600, "height": 900 }]
// The dev server must be running (npm run dev).
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });

const shots = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const base = process.env.EDITOR_URL ?? 'http://localhost:5190/';

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = candidates.find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});

for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.width ?? 1600, height: shot.height ?? 900 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [console] ${m.text()}`); });
  const url = new URL(base);
  if (shot.map) url.searchParams.set('map', shot.map);
  for (const [k, v] of Object.entries(shot.query ?? {})) url.searchParams.set(k, v);
  await page.goto(url.toString());
  await page.waitForFunction(() => window.__editor?.ready, null, { timeout: 120000 });
  if (shot.view) await page.evaluate((v) => window.__editor.setView(v.pos, v.target), shot.view);
  if (shot.eval) await page.evaluate(shot.eval);
  // Let textures/models stream in and a few frames settle.
  await page.waitForFunction(() => !window.__editor.busy?.(), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(shot.wait ?? 1500);
  const file = join(outDir, `${shot.name}.png`);
  await page.screenshot({ path: file });
  const fps = await page.evaluate(() => window.__editor.editor.frame);
  console.log(`saved ${file}  (fps ${fps.fps}, draw calls ${fps.drawCalls}, tris ${fps.triangles})`);
  if (shot.after) await page.evaluate(shot.after);
  await page.close();
}
await browser.close();
