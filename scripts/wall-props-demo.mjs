// Street-wall props of the City 17 district (cable brackets, dishes, gas meters, drainpipes) seen from the
// street, so placements can be compared before and after a generator change. Requires the dev server and
// maps/c17_district.vmf (scripts/build-district.mjs).
// Usage: node scripts/wall-props-demo.mjs <name prefix>
import { launch, driver } from './browser.mjs';

const prefix = process.argv[2] ?? 'wall-props';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:c17_district.vmf');
await d.key('l');

// Facades seen from the street: a wall point, the wall's outward normal, a height and the camera distance.
const views = [
  { at: [-2432, -1960], out: [-1, 0], z: 330, dist: 420 },
  { at: [640, -2432], out: [0, -1], z: 500, dist: 420 },
  { at: [-1408, -2170], out: [1, 0], z: 380, dist: 230 },
  { at: [1408, -1960], out: [-1, 0], z: 400, dist: 300 },
];
for (const [i, v] of views.entries()) {
  const side = [-v.out[1], v.out[0]];
  const pos = [v.at[0] + v.out[0] * v.dist + side[0] * 140, v.at[1] + v.out[1] * v.dist + side[1] * 140, v.z + 60];
  await d.view(pos, [v.at[0], v.at[1], v.z]);
  await d.settle(1500);
  await d.shot(`${prefix}${i + 1}`);
}
await browser.close();
