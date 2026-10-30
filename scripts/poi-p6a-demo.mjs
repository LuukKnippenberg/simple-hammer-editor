// POI phase 6, part 1: water, and the coast (dock, beach front, shipwreck, lighthouse, coastal bunker) on terrain.
import { poiSession, makePoi, rtsView } from './poi-common.mjs';

const { browser, d } = await poiSession('poi_p6a_demo.vmf', { ground: 'NATURE/BLENDROCKSAND004A', size: 10240, terrain: true });
// A row of coast POIs along one shore (the sea at their back, +y), then a park with its pond.
await makePoi(d, 'dock', [-4864, -512, -3328, 1024], { seed: 141 });
await makePoi(d, 'beach', [-3200, -512, -1408, 1024], { seed: 142 });
await makePoi(d, 'shipwreck', [-1280, -512, 512, 1024], { seed: 143 });
await makePoi(d, 'lighthouse', [640, -512, 2176, 1024], { seed: 144 });
await makePoi(d, 'bunker', [2304, -512, 3968, 896], { seed: 145 });
await makePoi(d, 'park', [-1280, -3072, 512, -1280], { seed: 146, params: { feature: 'pond' } });
await d.settle(3000);
const shots = [
  ['poi-p6-dock', [-4096, 320, 0], 2100],
  ['poi-p6-beach', [-2304, 320, 0], 2200],
  ['poi-p6-shipwreck', [-384, 320, 0], 2300],
  ['poi-p6-lighthouse', [1408, 320, 0], 2300],
  ['poi-p6-bunker', [3136, 220, 0], 2100],
  ['poi-p6-pond', [-384, -2176, 0], 1500],
];
for (const [name, target, dist] of shots) {
  await rtsView(d, target, dist);
  await d.settle(1000);
  await d.shot(name);
}
await d.view([-4300, -300, 300], [-4096, 600, 0]);
await d.settle(900);
await d.shot('poi-p6-dock-close');
await d.view([-900, -350, 380], [-300, 400, 60]);
await d.settle(900);
await d.shot('poi-p6-shipwreck-close');
await browser.close();
