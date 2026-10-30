// POI phase 4, part 2: junkyard, construction site and tank farm.
import { poiSession, makePoi, rtsView } from './poi-common.mjs';

const { browser, d } = await poiSession('poi_p4b_demo.vmf', { ground: 'NATURE/BLENDGRASSDIRT01', size: 6656, terrain: true });
await makePoi(d, 'junkyard', [-3072, 256, -1664, 1408], { seed: 91, params: { capture: true } });
await makePoi(d, 'construction', [-1280, 128, 256, 1408], { seed: 92 });
await makePoi(d, 'tankfarm', [640, 128, 2176, 1536], { seed: 93 });
await d.settle(2500);
const shots = [
  ['poi-p4-junkyard', [-2368, 832, 0], 1700],
  ['poi-p4-construction', [-512, 768, 0], 1800],
  ['poi-p4-tankfarm', [1408, 832, 0], 1900],
];
for (const [name, target, dist] of shots) {
  await rtsView(d, target, dist);
  await d.settle(900);
  await d.shot(name);
}
await d.view([-2900, 150, 300], [-2368, 700, 60]);
await d.settle(900);
await d.shot('poi-p4-junkyard-close');
await d.view([-1100, -100, 420], [-450, 650, 120]);
await d.settle(900);
await d.shot('poi-p4-construction-close');
await browser.close();
