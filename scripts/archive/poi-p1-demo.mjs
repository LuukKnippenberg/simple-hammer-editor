// POI phase 1: square, parking lot and playground, from the RTS camera.
import { poiSession, makePoi, rtsView } from '../poi-common.mjs';

const { browser, d } = await poiSession('poi_p1_demo.vmf', { ground: 'CONCRETE/CONCRETEFLOOR001A', size: 8192 });
await makePoi(d, 'square', [-3584, 512, -2176, 1920], { seed: 11, params: { feature: 'statue', capture: false, trees: true } });
await makePoi(d, 'square', [-1536, 512, 0, 1920], { seed: 12, params: { feature: 'fountain', capture: false } });
await makePoi(d, 'square', [640, 512, 2048, 1920], { seed: 13, params: { feature: 'breencast', capture: false, combine: true } });
await makePoi(d, 'parking', [-3584, -1536, -2176, -384], { seed: 21, params: { capture: true } });
await makePoi(d, 'parking', [-1536, -1664, 0, -384], { seed: 22, params: { rows: 2, occupancy: 80, wrecks: 4 } });
await makePoi(d, 'playground', [640, -1408, 1664, -512], { seed: 31 });
await makePoi(d, 'playground', [2304, -1408, 3328, -512], { seed: 32, params: { abandoned: true, surface: 'rubber' } });
await d.settle(2500);
const shots = [
  ['poi-p1-square-statue', [-2880, 1216, 0], 1900],
  ['poi-p1-square-fountain', [-768, 1216, 0], 1900],
  ['poi-p1-square-combine', [1344, 1216, 0], 1900],
  ['poi-p1-parking', [-2880, -960, 0], 1700],
  ['poi-p1-parking-wrecks', [-768, -1024, 0], 1700],
  ['poi-p1-playground', [1152, -960, 0], 1400],
  ['poi-p1-playground-abandoned', [2816, -960, 0], 1400],
];
await d.view([1150, -1700, 420], [1150, -1000, 40]);
await d.settle(900);
await d.shot('poi-p1-playground-close');
for (const [name, target, dist] of shots) {
  await rtsView(d, target, dist);
  await d.settle(900);
  await d.shot(name);
}
await rtsView(d, [-200, 0, 0], 6200);
await d.settle(1200);
await d.shot('poi-p1-overview');
await browser.close();
