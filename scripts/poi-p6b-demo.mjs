// POI phase 6, part 2: the rocky set (quarry, mine entrance, overlook, rocky pass, radio relay) and the canal.
import { poiSession, makePoi, rtsView } from './poi-common.mjs';

const { browser, d } = await poiSession('poi_p6b_demo.vmf', { ground: 'NATURE/BLENDROCKGRAVEL001A', size: 10240, terrain: true });
await makePoi(d, 'quarry', [-4864, 256, -2816, 2048], { seed: 151 });
await makePoi(d, 'mine', [-2560, 512, -1152, 1664], { seed: 152, params: { units: 'zombie', unitCount: 5 } });
await makePoi(d, 'overlook', [-896, 512, 384, 1792], { seed: 153 });
await makePoi(d, 'pass', [640, 256, 2176, 1792], { seed: 154 });
await makePoi(d, 'relay', [2432, 512, 3712, 1792], { seed: 155 });
await makePoi(d, 'canal', [-2560, -2304, -768, -1024], { seed: 156 });
await d.settle(3000);
const shots = [
  ['poi-p6-quarry', [-3840, 1152, 0], 2600],
  ['poi-p6-mine', [-1856, 1088, 0], 1800],
  ['poi-p6-overlook', [-256, 1152, 0], 1700],
  ['poi-p6-pass', [1408, 1024, 0], 2100],
  ['poi-p6-relay', [3072, 1152, 0], 1700],
  ['poi-p6-canal', [-1664, -1664, 0], 2000],
];
for (const [name, target, dist] of shots) {
  await rtsView(d, target, dist);
  await d.settle(1000);
  await d.shot(name);
}
await d.view([-1856, 100, 300], [-1856, 1300, 150]);
await d.settle(900);
await d.shot('poi-p6-mine-close');
await d.view([-2200, -2600, 300], [-1600, -1650, -60]);
await d.settle(900);
await d.shot('poi-p6-canal-close');
await browser.close();
