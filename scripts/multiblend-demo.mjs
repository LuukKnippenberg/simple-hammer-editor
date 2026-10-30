// MultiBlend ground: a mine entrance on a grass field with a dirt yard, first with plain tiled textures, then
// with the field and the yard turned into MultiBlend terrain (noise-filled layers, grass painted onto the yard
// edges). Saves maps/multiblend_before.vmf and maps/multiblend_after.vmf and screenshots of both.
//   EDITOR_URL=http://localhost:5198/ node scripts/multiblend-demo.mjs
import { poiSession, makePoi } from './poi-common.mjs';

const GRASS_BLEND = {
  name: 'yard_grass',
  layers: [
    { texture: 'nature/forest_grass_01', scale: 1, rotation: 0 },
    // The same grass turned and enlarged: breaks up the tile grid without changing the colour.
    { texture: 'nature/forest_grass_01', scale: 1.7, rotation: 47 },
    { texture: 'nature/grass01', scale: 1.3, rotation: 20 },
    { texture: 'nature/forest_dirt_02', scale: 1.25, rotation: 70 },
  ],
  detailtype: 'grass01b',
};
const DIRT_BLEND = {
  name: 'yard_dirt',
  layers: [
    { texture: 'nature/dirtfloor003a', scale: 1, rotation: 0 },
    { texture: 'nature/dirtfloor_mine001a', scale: 1.25, rotation: 40 },
    { texture: 'nature/mudfloor005a', scale: 1, rotation: 80 },
    { texture: 'nature/forest_grass_01', scale: 1, rotation: 20 },
  ],
};
const YARD = [-704, -576, 704, 576];

const FIELD = 'NATURE/FOREST_GRASS_01';
const { browser, d } = await poiSession('multiblend_before.vmf', { size: 4096, ground: FIELD });
await makePoi(d, 'mine', YARD);
await d.settle(1500);

/** The game's RTS camera (spawn angles 65/135) looking at the yard, placed with info_player_start. */
const finish = (name) => d.eval(async (name) => {
  const ed = window.__editor.editor;
  const { runChecks } = await import('/src/edit/preflight.ts');
  for (const c of runChecks(ed)) if (!c.ok && c.fix && c.id !== 'spawn') c.fix();
  const spawn = ed.doc.entities.find((e) => e.classname === 'info_player_start');
  const Vector3 = ed.camera.position.constructor;
  const pos = new Vector3(520, -620, 64);
  if (spawn) spawn.origin = pos;
  else {
    const { KVNode, KVPair } = await import('/src/vmf/keyvalues.ts');
    const n = new KVNode('entity');
    n.items.push(new KVPair('id', String(ed.doc.nextId())), new KVPair('classname', 'info_player_start'), new KVPair('angles', '0 135 0'), new KVPair('origin', '520 -620 64'));
    ed.doc.addEntity(n);
  }
  ed.changed();
  const text = ed.doc.serialize();
  const r = await fetch(`/api/map/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: text });
  return r.ok ? `${name}: ${text.length} bytes` : `save failed ${r.status}`;
}, name);

const views = async (tag) => {
  // No grid through the ground, no text highlighted by the brush strokes.
  await d.eval(() => { window.__editor.editor.gridHelper.visible = false; window.getSelection()?.removeAllRanges(); });
  await d.view([0, -2500, 1500], [0, 150, 0]);
  await d.settle(1200);
  await d.shot(`multiblend-${tag}`);
  await d.view([-200, -1300, 420], [-150, -200, 0]);
  await d.settle(1200);
  await d.shot(`multiblend-${tag}-close`);
};

await d.key('8');
await d.settle(300);
await views('before');
console.log(await finish('multiblend_before.vmf'));

// Blend materials, made the way the dialog does (POST /api/blend), then loaded into the editor.
const mats = await d.eval(async (defs) => {
  const ed = window.__editor.editor;
  const out = [];
  for (const def of defs) {
    const r = await fetch('/api/blend', { method: 'POST', body: JSON.stringify({ ...def, spec: 'nature/forest_grass_10a_spec' }) });
    const { material } = await r.json();
    const info = await ed.materials.reload(material);
    const { loadTexture } = await import('/src/assets/textures.ts');
    const missing = [];
    for (const l of def.layers) if (!(await loadTexture(l.texture))) missing.push(l.texture);
    out.push({ material, multiblend: !!info.multiblend, missing });
  }
  return out;
}, [GRASS_BLEND, DIRT_BLEND]);
console.log(JSON.stringify(mats));
const [grass, dirt] = mats.map((m) => m.material);

// The field and the yard pads become MultiBlend terrain, then each gets its own noise.
const made = await d.eval(async ([grass, dirt, fieldMat]) => {
  const ed = window.__editor.editor, tool = ed.tools.tools.ground;
  const { makeTerrain } = await import('/src/edit/groundTool.ts');
  const { solidBounds } = await import('/src/edit/brushes.ts');
  const solids = ed.doc.allSolids().filter((s) => !s.isDisplacement);
  const top = (s, m) => s.sides.some((x) => x.material.toUpperCase() === m);
  const field = solids.filter((s) => top(s, fieldMat));
  // The yard pads (and the tunnel floor) are func_detail pieces with the dirt on top at z = 2.
  const pads = solids.filter((s) => top(s, 'NATURE/DIRTFLOOR003A') && solidBounds(s).max.z <= 4);
  const nField = makeTerrain(ed, field, grass);
  const fieldDisps = ed.doc.worldEntity.solids.filter((s) => s.isDisplacement);
  const nPads = makeTerrain(ed, pads, dirt);
  const padDisps = ed.doc.worldEntity.solids.filter((s) => s.isDisplacement && !fieldDisps.includes(s));

  tool.set = grass;
  ed.selection.set(fieldDisps);
  tool.noiseFill([
    { layer: 1, coverage: 0.45, scale: 700, seed: 11 },
    { layer: 2, coverage: 0.22, scale: 520, seed: 23 },
    { layer: 3, coverage: 0.1, scale: 300, seed: 37 },
  ]);
  tool.set = dirt;
  ed.selection.set(padDisps);
  tool.noiseFill([
    { layer: 1, coverage: 0.35, scale: 520, seed: 5 },
    { layer: 2, coverage: 0.14, scale: 300, seed: 9 },
    { layer: 3, coverage: 0.04, scale: 200, seed: 3 },
  ]);
  // The yard stays selected, so the edge strokes below don't spill onto the field.
  return { nField, nPads, field: field.length, pads: pads.length };
}, [grass, dirt, FIELD]);
console.log(JSON.stringify(made));
await d.settle(1500);

// Grass creeping in along the yard's open edges: real brush strokes with the ground tool, layer 3.
await d.eval(() => {
  const ed = window.__editor.editor, t = ed.tools.tools.ground;
  t.mode = 'paint'; t.layer = 3; t.radius = 112; t.strength = 0.45;
  ed.emit('toolchange');
});
const [x0, y0, x1] = YARD;
await d.drag([x0 + 20, y0 + 40, 2], [x1 - 20, y0 + 40, 2], { steps: 40 });
await d.drag([x0 + 30, y0 + 40, 2], [x0 + 30, 380, 2], { steps: 30 });
await d.drag([x1 - 30, y0 + 40, 2], [x1 - 30, 380, 2], { steps: 30 });
await d.eval(() => window.__editor.editor.selection.clear());
await d.settle(1500);

await views('after');
console.log(await finish('multiblend_after.vmf'));
await browser.close();
