// POI phase 5, part 1: rebel camp, thumper site and crash site, on terrain.
import { poiSession, makePoi, rtsView } from './poi-common.mjs';

const { browser, d } = await poiSession('poi_p5a_demo.vmf', { ground: 'NATURE/BLENDGRASSDIRT01', size: 6144, terrain: true });
await makePoi(d, 'rebelcamp', [-2944, 128, -1536, 1280], { seed: 111, params: { units: 'rebel', unitCount: 4 } });
await makePoi(d, 'thumper', [-1152, 0, 128, 1280], { seed: 112, params: { units: 'antlion', unitCount: 4 } });
await makePoi(d, 'crashsite', [640, 128, 2048, 1280], { seed: 113, params: { capture: true } });
await d.settle(2500);
const shots = [
  ['poi-p5-rebelcamp', [-2240, 704, 0], 1700],
  ['poi-p5-thumper', [-512, 640, 0], 1700],
  ['poi-p5-crashsite', [1344, 704, 0], 1700],
];
for (const [name, target, dist] of shots) {
  await rtsView(d, target, dist);
  await d.settle(900);
  await d.shot(name);
}
await d.view([-2700, 500, 330], [-2300, 900, 40]);
await d.settle(900);
await d.shot('poi-p5-rebelcamp-close');
await d.view([-900, 100, 400], [-512, 640, 150]);
await d.settle(900);
await d.shot('poi-p5-thumper-close');
await d.view([800, 300, 340], [1250, 800, 60]);
await d.settle(900);
await d.shot('poi-p5-crashsite-close');
await browser.close();
