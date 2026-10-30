// Editor screenshots of the interiors test map at the RTS camera angle with the lighting preview on, from the
// same views as the map's scripted in-game screenshots (the views file interiors-demo.mjs writes with VIEWS_OUT),
// to compare the light blockers and closed-off ground rooms before and after.
//   EDITOR_URL=http://localhost:5199/ node scripts/interiors-sealing-shots.mjs <map.vmf> <prefix> <views.json>
import { readFileSync } from 'node:fs';
import { launch, driver } from './browser.mjs';

const [map = 'interiors_test.vmf', prefix = 'interiors-sealing', viewsFile] = process.argv.slice(2);
const views = viewsFile ? JSON.parse(readFileSync(viewsFile, 'utf8')) : [{ name: 'farmhouse-2f', x: -448, y: -1248, height: 700 }];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
const d = driver(page);
await d.open(`repo:${map}`);
await d.eval(() => {
  const W = window.__editor;
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); W.editor.emit('lighting'); }
  W.lighting.refresh();
});
await d.settle(4000);
for (const v of views) {
  const back = v.height / Math.tan((65 * Math.PI) / 180);
  await d.view([v.x, v.y - back, v.height], [v.x, v.y, 0]);
  await d.settle(1500);
  await d.shot(`${prefix}-${v.name}`);
  // Closed-off doorways also from close by on their open side, low enough to look under the upper floor.
  if (v.door) {
    const { x, y, nx, ny } = v.door;
    await d.view([x + nx * 260 - ny * 60, y + ny * 260 + nx * 60, 150], [x, y, 48]);
    await d.settle(1500);
    await d.shot(`${prefix}-${v.name}-close`);
  }
}
await browser.close();
