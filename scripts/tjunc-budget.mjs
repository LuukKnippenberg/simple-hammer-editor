// How full a map is by vbsp's t-junction count (see server/budget.ts), and what each kind of generated geometry
// costs: the map is prepared as for compiling (map settings, mission flowchart, handles stripped), then vbsp runs
// on it and on variants without the buildings, the roads or the POIs, or with every block regenerated another
// way. Variants run side by side (vbsp alone takes a few minutes on a big map).
//   node --experimental-transform-types scripts/tjunc-budget.mjs <name> [--variants a,b,...] [--jobs 4]
// Variants: base, regen (every block rebuilt as it is: should match base), no-buildings, no-roads, no-pois,
// no-interiors, detail-brush (blocks' detail brushes in func_brushes), high, medium, filler (every block at
// that quality), detail0..detail3.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../server/config.ts';
import { editorContent, runModDir, stageContent } from '../server/compile.ts';
import { vbspBudget, writeVariant } from '../server/budget.ts';
import { VmfDocument } from '../src/vmf/map.ts';
import { applyMapSettings } from '../src/lw/mapSettings.ts';
import { buildMissionInto } from '../src/lw/missionBuild.ts';
import { logicAnchor } from '../src/lw/missionAction.ts';
import { stripHandles } from '../src/gen/handle.ts';
import { BLOCK_KEY, blockIntoDoc, blockMembers, blockOf } from '../src/gen/buildingStore.ts';
import { POI_ID_KEY, POI_KEY, POI_WORLD_KEY } from '../src/gen/poi/spec.ts';
import { idTest } from '../src/gen/buildingStore.ts';
import { entity } from '../src/gen/layout.ts';

const args = process.argv.slice(2);
const name = args[0];
if (!name) throw new Error('usage: tjunc-budget.mjs <name> [--variants a,b,...] [--jobs 4]');
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const root = join(import.meta.dirname, '..');
const cfg = loadConfig(root);
const mod = runModDir(cfg);
if (!mod || !cfg.sdkBinDir) throw new Error('No game folder or SDK tools configured (editor.config.json)');

// The map as it would be compiled.
const doc0 = VmfDocument.parse(readFileSync(join(root, 'maps', `${name}.vmf`), 'latin1'));
applyMapSettings(doc0);
stripHandles(doc0);
const missionFile = join(root, 'maps', `${name}.mission.json`);
if (existsSync(missionFile)) buildMissionInto(doc0, JSON.parse(readFileSync(missionFile, 'utf8')), logicAnchor(doc0));
const source = doc0.serialize();

const removeAll = (doc, list) => { for (const x of list) (x.node && x.sides ? doc.removeSolid(x) : doc.removeEntity(x)); };
const blocks = (doc) => doc.entities.filter((e) => e.classname === 'func_detail' && e.get(BLOCK_KEY));
/** Every block rebuilt from its stored spec, with `patch` over its options. */
const regenerate = (patch) => (doc) => {
  for (const detail of blocks(doc)) {
    const spec = blockOf(detail);
    const m = blockMembers(doc, spec.uid);
    removeAll(doc, [m.detail, ...m.entities].filter(Boolean));
    for (const s of m.world) doc.removeSolid(s);
    const b = blockIntoDoc(doc, { ...spec, options: { ...spec.options, ...patch } }, (c, o, k) => entity(doc, c, o, k));
    for (const n of b.world) doc.addSolid(n);
    for (const n of b.entities) if (!/_handle$/i.test(n.get('classname') ?? '')) doc.addEntity(n);
  }
};
const VARIANTS = {
  base: () => {},
  regen: regenerate({}),
  'no-buildings': (doc) => {
    for (const detail of blocks(doc)) {
      const m = blockMembers(doc, blockOf(detail).uid);
      for (const s of m.world) doc.removeSolid(s);
      removeAll(doc, [m.detail, ...m.entities].filter(Boolean));
    }
  },
  'no-roads': (doc) => removeAll(doc, doc.entities.filter((e) => e.classname === 'func_detail' && e.get('she_road'))),
  'no-pois': (doc) => {
    for (const e of doc.entities.filter((q) => q.classname === 'func_detail' && q.get(POI_KEY))) {
      const has = idTest(e.get(POI_WORLD_KEY));
      for (const s of doc.worldEntity.solids.filter((s) => has(Number(s.node.get('id'))))) doc.removeSolid(s);
      const uid = e.get(POI_ID_KEY);
      removeAll(doc, [e, ...doc.entities.filter((q) => q !== e && uid && q.get(POI_ID_KEY) === uid)]);
    }
  },
  'no-interiors': regenerate({ interiors: 'none' }),
  // Without what lies beyond the playable area, the edging along lawns and areas, or the drawn street shapes.
  'no-surroundings': (doc) => removeAll(doc, doc.entities.filter((e) => e.get('targetname') === 'surroundings' || /combineinnerwall|tree_pine0|deciduous_01a/.test(e.get('model') ?? ''))),
  'no-edging': (doc) => removeAll(doc, doc.entities.filter((e) => e.classname === 'func_detail' && !e.get('she_road') && !e.get(POI_KEY) && !e.get('she_buildings') && !e.get('she_rooms') && e.solids.some((q) => q.sides.some((x) => x.material === 'STONE/STONEWALL017A')))),
  'no-curves': (doc) => removeAll(doc, doc.entities.filter((e) => { const r = e.get('she_road'); return r && r.split('|')[6].split(';').length > 2; })),
  // Each block's detail brushes (bands, cornices, columns, roofs...) as a func_brush instead of func_detail.
  'detail-brush': (doc) => {
    for (const e of blocks(doc)) {
      e.set('classname', 'func_brush');
      for (const [k, v] of Object.entries({ Solidity: '0', spawnflags: '2', vrad_brush_cast_shadows: '1', rendermode: '0', StartDisabled: '0' })) e.set(k, v);
    }
  },
  high: regenerate({ quality: 'high' }),
  medium: regenerate({ quality: 'medium' }),
  filler: regenerate({ quality: 'filler' }),
  detail0: regenerate({ detail: 0 }),
  detail1: regenerate({ detail: 1 }),
  detail2: regenerate({ detail: 2 }),
  detail3: regenerate({ detail: 3 }),
};
const wanted = opt('--variants', 'base,regen,no-buildings,no-roads,no-pois,no-interiors,detail0').split(',');
for (const v of wanted) if (!VARIANTS[v]) throw new Error(`unknown variant ${v}; known: ${Object.keys(VARIANTS).join(', ')}`);

const work = join(root, '.compile', 'budget');
const paths = {};
for (const v of wanted) {
  const doc = VmfDocument.parse(source);
  VARIANTS[v](doc);
  paths[v] = { path: writeVariant(work, v, name, doc.serialize()), brushes: doc.allSolids().length };
}
console.log(`${name}: ${wanted.length} variant(s), vbsp in ${work}`);

// Editor materials once for all runs, removed again at the end.
const staged = stageContent(cfg, editorContent(cfg, source), mod, () => {});
const results = {};
try {
  const jobs = Math.max(1, Number(opt('--jobs', 4)));
  const queue = [...wanted];
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (let v = queue.shift(); v; v = queue.shift()) {
      results[v] = await vbspBudget(cfg, mod, paths[v].path, join(work, v));
      const t = results[v].tjunctions;
      console.log(`  ${v.padEnd(13)} ${t ? `${t.overflow ? '>' : ' '}${t.indices}` : '?'} (${results[v].seconds}s)`);
    }
  }));
} finally {
  for (const f of staged) rmSync(f, { force: true, recursive: true });
}

// The table: t-junction indices against the limit, the change from base, and the other counts that matter.
const base = results.base?.tjunctions?.indices;
const row = (cells) => cells.map((c, i) => String(c).padStart(i ? 12 : 14)).join('');
console.log(row(['variant', 'tjunc', '% of max', 'vs base', 'brushes', 'vertexes', 'faces']));
for (const v of wanted) {
  const r = results[v], t = r.tjunctions, l = r.limits;
  console.log(row([
    v, t ? `${t.overflow ? '>' : ''}${t.indices}` : 'failed', t ? `${((t.indices / t.max) * 100).toFixed(1)}%` : '',
    t && base !== undefined && !t.overflow && !results.base.tjunctions.overflow ? t.indices - base : '',
    l.brushes ? l.brushes[0] : paths[v].brushes, l.vertexes?.[0] ?? '', l.faces?.[0] ?? '',
  ]));
}
