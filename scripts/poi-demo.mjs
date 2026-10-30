// POI phase 7: builds maps/poi_showcase.vmf (every POI type in a grid on terrain, default settings, capture
// points on) and maps/poi_test.vmf (a playable two-player map from *Generate map* with four POIs between
// the bases), and takes the overview screenshots.
//   node scripts/poi-demo.mjs [--only showcase|test] [--types a,b,c]
import { poiSession, rtsView } from './poi-common.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const only = arg('--only');
const types = arg('--types')?.split(',') ?? null;
const { browser, d } = await poiSession('poi_showcase.vmf', { ground: 'NATURE/BLENDGRASSDIRT01', size: 512 });

if (only !== 'test') {
  const r = await d.eval(async (only) => {
    const ed = window.__editor.editor;
    const { POI_TYPES, generatePoi } = await import('/src/gen/poi/action.ts');
    const { terrainPatch } = await import('/src/gen/layout.ts');
    const doc = ed.doc;
    for (const s of [...doc.worldEntity.solids]) doc.removeSolid(s);
    const types = POI_TYPES.filter((t) => !only || only.includes(t.id));
    // Rows of POIs at their default size, 512 apart, on flat displacement terrain (coast POIs lower it
    // under their sea).
    const cols = Math.ceil(Math.sqrt(types.length * 1.4));
    const cellW = Math.max(...types.map((t) => t.defaultSize[0])) + 512, cellD = Math.max(...types.map((t) => t.defaultSize[1])) + 512;
    const W = cols * cellW, D = Math.ceil(types.length / cols) * cellD;
    const x0 = -Math.round(W / 2 / 1024) * 1024, y0 = -Math.round(D / 2 / 1024) * 1024;
    for (let x = x0 - 1024; x < x0 + W + 1024; x += 1024) for (let y = y0 - 1024; y < y0 + D + 1024; y += 1024) {
      // No detail sprites: on a map this size grass would pass vbsp's 64K detail prop limit.
      doc.addSolid(terrainPatch(doc, x, y, 1024, 'NATURE/BLENDGRASSDIRT01_NOPROP', () => 0, () => 0, 4));
    }
    ed.changed();
    const placed = [];
    types.forEach((t, i) => {
      const cx = x0 + (i % cols) * cellW + cellW / 2, cy = y0 + Math.floor(i / cols) * cellD + cellD / 2;
      const [w, h] = t.defaultSize;
      generatePoi(ed, t, { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 }, 0, { seed: 100 + i, params: { capture: true } });
      placed.push([t.id, Math.round(cx), Math.round(cy)]);
    });
    ed.selection.clear();
    const pre = await import('/src/edit/preflight.ts');
    for (const id of ['shell', 'spawn']) { const c = pre.runChecks(ed).find((c) => c.id === id); if (c && !c.ok) c.fix(); }
    const bad = await pre.nonStaticProps(ed);
    const res = await fetch('/api/map/save?name=poi_showcase.vmf', { method: 'POST', body: ed.doc.serialize() });
    return { placed, nonStatic: bad.map((e) => e.get('model')), saved: res.ok, entities: doc.entities.length, brushes: doc.allSolids().length, size: [W, D] };
  }, types);
  console.log('showcase:', JSON.stringify({ ...r, placed: r.placed.length }));
  await d.settle(3000);
  await rtsView(d, [0, 0, 0], Math.max(...r.size) * 0.9);
  await d.settle(2000);
  await d.shot('poi-p7-showcase');
}

if (only !== 'showcase') {
  const r = await d.eval(async () => {
    const W = window.__editor, ed = W.editor;
    const { generateMap, randomLayout } = await import('/src/gen/layout.ts');
    const doc = generateMap(randomLayout(28, 28, 'rural', 11), { theme: 'rural', seed: 11, highGround: 160, pois: 4 });
    ed.loadDocument(doc, 'poi_test.vmf', '');
    const pre = await import('/src/edit/preflight.ts');
    // The generator's own rocks include models vbsp won't take as static props: the compile dialog's fix.
    const bad = await pre.nonStaticProps(ed);
    pre.convertToDynamic(ed, bad);
    const res = await fetch('/api/map/save?name=poi_test.vmf', { method: 'POST', body: ed.doc.serialize() });
    const pois = ed.doc.entities.filter((e) => e.get('she_poi')).map((e) => e.get('she_poi').split('|')[0]);
    if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
    return { pois, nonStatic: bad.map((e) => e.get('model')), saved: res.ok, entities: ed.doc.entities.length, brushes: ed.doc.allSolids().length };
  });
  console.log('test map:', JSON.stringify(r));
  await d.settle(4000);
  await rtsView(d, [0, 0, 0], 7600);
  await d.settle(2000);
  await d.shot('poi-p7-test-map');
}
await browser.close();
