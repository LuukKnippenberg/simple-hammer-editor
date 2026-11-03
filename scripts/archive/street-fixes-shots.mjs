// Editor screenshots of the street fixes in Garden District: pavement slabs and setts gutters along the street, the
// round corners without bollards in the road, the car parks of their own asphalt up to the pavement, and the rail
// line out of the station.
//   node scripts/archive/street-fixes-shots.mjs
import { withEditor } from '../browser.mjs';

await withEditor(async (d) => {
  await d.open('repo:sp_garden_district.vmf');
  await d.eval(() => { window.__editor.editor.gridHelper.visible = false; });
  await d.key('l');
  const shot = async (name, pos, target, wait = 1500) => {
    await d.view(pos, target);
    await d.settle(wait);
    await d.shot(name);
  };
  // A crossing in the street grid (x 32–35 by y 24–27), close: slabs, gutters, the rounded kerbs and the bollards.
  await shot('fixes-01-corner', [700, -380, 520], [470, 60, 0]);
  await shot('fixes-02-crossing', [900, -700, 1300], [256, -64, 0]);
  // The car park on the square, up to the boulevard's pavement and the north street.
  await shot('fixes-03-parking', [-1200, 400, 1300], [-2000, 1100, 0]);
  // The car park under the newer block.
  await shot('fixes-04-carpark', [100, -1900, 1300], [-700, -1200, 0]);
  // The station's east end: the tracks through the opening and on east through the city.
  await shot('fixes-05-station-east', [3300, 1900, 1300], [4100, 2900, 0]);
  await shot('fixes-06-rail-line', [3000, 1300, 2600], [5200, 2900, 0]);
});
