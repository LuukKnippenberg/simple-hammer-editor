// POI phase 0: the POI tool and panel. Drag a rectangle, the result, and editing it afterwards.
import { poiSession, rtsView } from '../poi-common.mjs';

const { browser, page, d } = await poiSession('poi_p0_demo.vmf', { ground: 'NATURE/BLENDGRASSDIRT01', terrain: true });
await rtsView(d, [0, 0, 0], 2600);
await d.settle(600);
// Pick the lot in the POI tab, then drag with the tool.
await d.key('p');
await d.settle(300);
await page.locator('button.kit', { hasText: 'Paved lot' }).click();
await d.settle(200);
await d.drag([-640, -448, 20], [512, 448, 20], { hold: async () => { await d.settle(200); await d.shot('poi-p0-drag'); } });
await d.settle(1200);
await d.key('1');
await d.eval(() => window.__editor.editor.selection.clear());
await d.settle(800);
await d.shot('poi-p0-lot');
// Select it and turn on the capture point from the panel: rebuilt in place.
const res = await d.eval(async () => {
  const ed = window.__editor.editor;
  const { regeneratePoi } = await import('/src/gen/poi/action.ts');
  const detail = ed.doc.entities.find((e) => e.get('she_poi'));
  regeneratePoi(ed, detail, { params: { capture: true, scrap: 2, surface: 'asphalt' } });
  ed.selection.set([], [detail]);
  window.__editor.tabs.show('POI');
  return { ents: ed.doc.entities.filter((e) => e.get('she_poi_id')).length, terrain: ed.doc.allSolids().filter((s) => s.isDisplacement).length };
});
console.log('  ', JSON.stringify(res));
await d.settle(1200);
await d.shot('poi-p0-panel');
await browser.close();
