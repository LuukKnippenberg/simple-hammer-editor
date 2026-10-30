// Builds a map with every POI type in a grid (default size, default settings, capture points on) and saves
// it to maps/<name>.vmf for compile-map.mjs.   node scripts/poi-showcase.mjs [name] [--types a,b,c]
import { poiSession } from './poi-common.mjs';

const name = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'poi_showcase';
const ti = process.argv.indexOf('--types');
const only = ti >= 0 ? process.argv[ti + 1].split(',') : null;
const { browser, d } = await poiSession(`${name}.vmf`, { ground: 'NATURE/BLENDGRASSDIRT01', size: 512, terrain: false });
const r = await d.eval(async ([name, only]) => {
  const ed = window.__editor.editor;
  const { POI_TYPES, generatePoi } = await import('/src/gen/poi/action.ts');
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const Vector3 = ed.camera.position.constructor;
  const doc = ed.doc;
  for (const s of [...doc.worldEntity.solids]) doc.removeSolid(s);
  const types = POI_TYPES.filter((t) => !only || only.includes(t.id));
  // Rows of POIs at their default size with 512 between them.
  const cols = Math.ceil(Math.sqrt(types.length));
  const cellW = Math.max(...types.map((t) => t.defaultSize[0])) + 512, cellD = Math.max(...types.map((t) => t.defaultSize[1])) + 512;
  const W = cols * cellW, D = Math.ceil(types.length / cols) * cellD;
  const x0 = -Math.round(W / 2 / 64) * 64, y0 = -Math.round(D / 2 / 64) * 64;
  // Ground in 1024 tiles (vbsp splits big faces anyway; smaller brushes keep the BSP sane).
  for (let x = x0 - 512; x < x0 + W + 512; x += 1024) for (let y = y0 - 512; y < y0 + D + 512; y += 1024) {
    doc.addSolid(boxSolid(doc, new Vector3(x, y, -64), new Vector3(x + 1024, y + 1024, 0), 'NATURE/BLENDGRASSDIRT01'));
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
  const res = await fetch(`/api/map/save?name=${name}.vmf`, { method: 'POST', body: ed.doc.serialize() });
  return { placed, nonStatic: bad.map((e) => e.get('model')), saved: res.ok, entities: doc.entities.length, brushes: doc.allSolids().length };
}, [name, only]);
console.log(JSON.stringify(r, null, 1));
await browser.close();
