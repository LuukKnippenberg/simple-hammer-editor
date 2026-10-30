// POI phase 4, part 3: rail yard and gas station.
import { poiSession, makePoi, rtsView } from './poi-common.mjs';

const { browser, d } = await poiSession('poi_p4c_demo.vmf', { ground: 'NATURE/BLENDGRASSDIRT01', size: 6144, terrain: true });
await makePoi(d, 'railyard', [-2944, 0, -640, 1280], { seed: 101 });
await makePoi(d, 'gasstation', [-256, 128, 1024, 1152], { seed: 102 });
await makePoi(d, 'railyard', [-3072, -2176, 0, -768], { seed: 103, params: { tracks: 3, canopy: false, wrecks: 2, cars: 80 } });
await d.settle(2500);
const shots = [
  ['poi-p4-railyard', [-1792, 640, 0], 2300],
  ['poi-p4-gasstation', [384, 640, 0], 1500],
  ['poi-p4-railyard-wrecks', [-1536, -1472, 0], 2600],
];
for (const [name, target, dist] of shots) {
  await rtsView(d, target, dist);
  await d.settle(900);
  await d.shot(name);
}
await d.view([-2300, -150, 330], [-1800, 600, 60]);
await d.settle(900);
await d.shot('poi-p4-railyard-close');
await d.view([500, -150, 360], [300, 600, 100]);
await d.settle(900);
await d.shot('poi-p4-gasstation-close');
await browser.close();
