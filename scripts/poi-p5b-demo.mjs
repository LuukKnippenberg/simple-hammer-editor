// POI phase 5, part 2: farmstead, graveyard with chapel, lookout tower.
import { poiSession, makePoi, rtsView } from './poi-common.mjs';

const { browser, d } = await poiSession('poi_p5b_demo.vmf', { ground: 'NATURE/BLENDGRASSDIRT01', size: 7168, terrain: true });
await makePoi(d, 'farmstead', [-3456, 0, -1664, 1536], { seed: 121 });
await makePoi(d, 'graveyard', [-1280, 0, 256, 1408], { seed: 122, params: { units: 'zombie', unitCount: 6 } });
await makePoi(d, 'lookout', [704, 256, 1856, 1280], { seed: 123 });
await makePoi(d, 'lookout', [2176, 256, 3200, 1280], { seed: 124, params: { material: 'concrete', height: 192 } });
await d.settle(2500);
const shots = [
  ['poi-p5-farmstead', [-2560, 768, 0], 2100],
  ['poi-p5-graveyard', [-512, 704, 0], 1800],
  ['poi-p5-lookout', [1280, 768, 0], 1300],
  ['poi-p5-lookout-concrete', [2688, 768, 0], 1300],
];
for (const [name, target, dist] of shots) {
  await rtsView(d, target, dist);
  await d.settle(900);
  await d.shot(name);
}
await d.view([-2700, -200, 420], [-2500, 900, 80]);
await d.settle(900);
await d.shot('poi-p5-farmstead-close');
await d.view([-700, 0, 300], [-450, 800, 60]);
await d.settle(900);
await d.shot('poi-p5-graveyard-close');
await d.view([700, 200, 420], [1250, 760, 150]);
await d.settle(900);
await d.shot('poi-p5-lookout-close');
await browser.close();
