// POI phase 4, part 1: Combine checkpoint, rebel barricade and ration distribution.
import { poiSession, makePoi, rtsView } from './poi-common.mjs';

const { browser, d } = await poiSession('poi_p4a_demo.vmf', { ground: 'CONCRETE/CONCRETEFLOOR033A', size: 6144 });
// The checkpoint and the barricade span a street running north-south (rotated 0: their width runs along x).
await makePoi(d, 'checkpoint', [-2752, 896, -1216, 1536], { seed: 81 });
await makePoi(d, 'barricade', [-704, 1024, 448, 1536], { seed: 82 });
await makePoi(d, 'rations', [1088, 640, 2112, 1664], { seed: 83 });
await makePoi(d, 'checkpoint', [-2752, -1536, -1216, -896], { seed: 84, params: { surface: 'concrete', capture: true, units: 'metropolice', unitCount: 6 } });
await makePoi(d, 'barricade', [-704, -1536, 448, -1024], { seed: 85, params: { surface: 'rubble', capture: true, units: 'rebel' } });
await d.settle(2500);
const shots = [
  ['poi-p4-checkpoint', [-1984, 1216, 0], 1500],
  ['poi-p4-barricade', [-128, 1280, 0], 1300],
  ['poi-p4-rations', [1600, 1152, 0], 1500],
  ['poi-p4-checkpoint-units', [-1984, -1216, 0], 1500],
  ['poi-p4-barricade-rubble', [-128, -1280, 0], 1300],
];
for (const [name, target, dist] of shots) {
  await rtsView(d, target, dist);
  await d.settle(900);
  await d.shot(name);
}
await d.view([-1984, 500, 260], [-1984, 1250, 80]);
await d.settle(900);
await d.shot('poi-p4-checkpoint-close');
await d.view([-128, 700, 240], [-128, 1300, 40]);
await d.settle(900);
await d.shot('poi-p4-barricade-close');
await browser.close();
