// POI phase 5, part 3: logging camp and Combine power node.
import { poiSession, makePoi, rtsView } from '../poi-common.mjs';

const { browser, d } = await poiSession('poi_p5c_demo.vmf', { ground: 'NATURE/BLENDGRASSDIRT01', size: 5120, terrain: true });
await makePoi(d, 'logging', [-2304, -512, -768, 768], { seed: 131 });
await makePoi(d, 'powernode', [-128, -448, 1024, 704], { seed: 132, params: { capture: true, units: 'combine', unitCount: 4 } });
await d.settle(2500);
await rtsView(d, [-1536, 128, 0], 1800);
await d.settle(900);
await d.shot('poi-p5-logging');
await rtsView(d, [448, 128, 0], 1500);
await d.settle(900);
await d.shot('poi-p5-powernode');
await d.view([-1900, -200, 300], [-1500, 300, 60]);
await d.settle(900);
await d.shot('poi-p5-logging-close');
await d.view([450, -600, 400], [450, 200, 100]);
await d.settle(900);
await d.shot('poi-p5-powernode-close');
await browser.close();
