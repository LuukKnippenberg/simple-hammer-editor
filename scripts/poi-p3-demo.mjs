// POI phase 3: football pitch (with bleachers, track, floodlights) and basketball courts.
import { poiSession, makePoi, rtsView } from './poi-common.mjs';

const { browser, d } = await poiSession('poi_p3_demo.vmf', { ground: 'NATURE/BLENDGRASSDIRT01', size: 8192, terrain: true });
await makePoi(d, 'football', [-3712, 256, -1792, 1856], { seed: 61, params: { stands: 'both' } });
await makePoi(d, 'football', [-1280, 0, 1280, 2304], { seed: 62, params: { track: true, stands: 'one' } });
await makePoi(d, 'basketball', [1792, 640, 2688, 1280], { seed: 71 });
await makePoi(d, 'basketball', [1792, -512, 2688, 128], { seed: 72, params: { abandoned: true } });
await d.settle(2500);
const shots = [
  ['poi-p3-football', [-2752, 1056, 0], 2300],
  ['poi-p3-football-track', [0, 1152, 0], 2700],
  ['poi-p3-basketball', [2240, 960, 0], 1100],
  ['poi-p3-basketball-abandoned', [2240, -192, 0], 1100],
];
for (const [name, target, dist] of shots) {
  await rtsView(d, target, dist);
  await d.settle(900);
  await d.shot(name);
}
await d.view([-3300, 700, 260], [-2750, 1300, 40]);
await d.settle(900);
await d.shot('poi-p3-goal');
await d.view([-2300, 900, 200], [-2750, 1560, 40]);
await d.settle(900);
await d.shot('poi-p3-bleachers');
await d.view([1900, 500, 260], [2240, 960, 100]);
await d.settle(900);
await d.shot('poi-p3-hoop');
await browser.close();
