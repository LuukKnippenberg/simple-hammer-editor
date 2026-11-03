// Captures editor screenshots for the docs with the system Edge/Chrome (no browser download needed).
//
//   node scripts/screenshot.mjs scripts/archive/shots/phase0.json
//
// shots.json: [{ "name": "phase0-overview", "map": "repo:hlw_City16.vmf",
//               "view": { "pos": [x,y,z], "target": [x,y,z] }, "eval": "optional JS run before capture",
//               "after": "optional JS run after capture",
//               "width": 1600, "height": 900 }]
// The dev server must be running (npm run dev).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseUrl, launch, shotsDir } from './browser.mjs';

const shots = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const browser = await launch();

for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.width ?? 1600, height: shot.height ?? 900 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [console] ${m.text()}`); });
  const url = new URL(baseUrl);
  if (shot.map) url.searchParams.set('map', shot.map);
  for (const [k, v] of Object.entries(shot.query ?? {})) url.searchParams.set(k, v);
  await page.goto(url.toString());
  await page.waitForFunction(() => window.__editor?.ready, null, { timeout: 120000 });
  if (shot.view) await page.evaluate((v) => window.__editor.setView(v.pos, v.target), shot.view);
  if (shot.eval) await page.evaluate(shot.eval);
  // Let textures/models stream in and a few frames settle.
  await page.waitForFunction(() => !window.__editor.busy?.(), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(shot.wait ?? 1500);
  const file = join(shotsDir, `${shot.name}.png`);
  await page.screenshot({ path: file });
  const fps = await page.evaluate(() => window.__editor.editor.frame);
  console.log(`saved ${file}  (fps ${fps.fps}, draw calls ${fps.drawCalls}, tris ${fps.triangles})`);
  if (shot.after) await page.evaluate(shot.after);
  await page.close();
}
await browser.close();
