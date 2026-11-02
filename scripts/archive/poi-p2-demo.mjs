// POI phase 2: park and market, from the RTS camera.
import { poiSession, makePoi, rtsView } from '../poi-common.mjs';

const { browser, d } = await poiSession('poi_p2_demo.vmf', { ground: 'NATURE/BLENDGRASSDIRT01', size: 8192, terrain: true });
await makePoi(d, 'park', [-3712, 256, -1792, 2176], { seed: 41, params: { feature: 'pond' } });
await makePoi(d, 'park', [-1280, 256, 768, 2304], { seed: 42, params: { feature: 'bandstand', trees: 70 } });
await makePoi(d, 'market', [1280, 384, 2816, 1792], { seed: 51 });
await makePoi(d, 'market', [-3584, -2048, -1920, -512], { seed: 52, params: { hall: true } });
await makePoi(d, 'market', [-1280, -1920, 128, -640], { seed: 53, params: { abandoned: true, capture: true } });
await d.settle(2500);
const shots = [
  ['poi-p2-park-pond', [-2752, 1216, 0], 2300],
  ['poi-p2-park-bandstand', [-256, 1280, 0], 2300],
  ['poi-p2-market', [2048, 1088, 0], 1700],
  ['poi-p2-market-hall', [-2752, -1280, 0], 1800],
  ['poi-p2-market-abandoned', [-576, -1280, 0], 1600],
];
for (const [name, target, dist] of shots) {
  await rtsView(d, target, dist);
  await d.settle(900);
  await d.shot(name);
}
await d.view([1700, 600, 330], [2100, 1050, 60]);
await d.settle(900);
await d.shot('poi-p2-market-lane');
await d.view([-700, 300, 420], [-256, 1000, 60]);
await d.settle(900);
await d.shot('poi-p2-park-path');
await browser.close();
