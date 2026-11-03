// Parks seen from above, to compare the path surfaces (z-fighting where path pieces overlapped): one on its own
// ground, one set into paving. Shots are named park-zf-<tag>-*.
//   node scripts/archive/park-zfighting-shots.mjs --tag after
import { makePoi, poiSession, rtsView } from '../poi-common.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const tag = arg('--tag') ?? 'after';
const { browser, d } = await poiSession('park_zfighting.vmf', { ground: 'STONE/STONEFLOOR006D', size: 5120 });

await makePoi(d, 'park', [-2048, -896, -256, 896], { seed: 3, params: { ground: 'own' } });
await makePoi(d, 'park', [256, -896, 2048, 896], { seed: 3, params: { ground: 'paving' } });
await d.settle(2500);
await rtsView(d, [0, 0, 0], 3600);
await d.settle(1500);
await d.shot(`park-zf-${tag}-both`);
// Closer: the ring round the pond and the spokes leaving it, on each park.
for (const [name, x] of [['own', -1152], ['paving', 1152]]) {
  await rtsView(d, [x, 0, 0], 1500);
  await d.settle(1500);
  await d.shot(`park-zf-${tag}-${name}`);
}
// Close up where a spoke leaves the ring (north side of the paved park).
await rtsView(d, [1152, 420, 0], 520);
await d.settle(1500);
await d.shot(`park-zf-${tag}-junction`);
await browser.close();
