// Builds the interior houses test map (maps/interiors_test.vmf): a row per interior style with one- and
// two-storey houses, furnished and bare, an L and a house with wide doors, a village block with some
// interiors, two player starts and rebel squads next to the houses. Requires the dev server.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');

const info = await d.eval(async () => {
  const W = window.__editor, ed = W.editor;
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { boxFaces, solidNode } = await import('/src/edit/brushes.ts');
  const { detailEntityNode, generateBuildings } = await import('/src/gen/buildings.ts');
  const { interiorHouse } = await import('/src/gen/interiorHouse.ts');
  const { INTERIOR_STYLES } = await import('/src/gen/styles.ts');
  const { rectPoly } = await import('/src/gen/buildingPlan.ts');
  const { addEnvironment, entity, finishDoc } = await import('/src/gen/layout.ts');
  const { cameraSpawnFor, spread, UNITS } = await import('/src/lw/kits.ts');
  const { Vector2, Box2, Vector3, Box3 } = await import('/node_modules/three/build/three.module.js');
  const doc = VmfDocument.empty();
  doc.world.set('skyname', 'sky_day01_01');
  const solids = [], ents = [];
  const Wd = 6144, Ht = 4096;
  solids.push(solidNode(doc, boxFaces(new Vector3(0, 0, -64), new Vector3(Wd, Ht, 0), { top: 'NATURE/DIRTFLOOR003A', bottom: 'TOOLS/TOOLSNODRAW', sides: 'TOOLS/TOOLSNODRAW' })));
  const rect = (x, y, w, h) => rectPoly(new Box2(new Vector2(x, y), new Vector2(x + w, y + h)));
  const ell = (x, y) => [new Vector2(x, y), new Vector2(x + 512, y), new Vector2(x + 512, y + 256), new Vector2(x + 256, y + 256), new Vector2(x + 256, y + 512), new Vector2(x, y + 512)];
  const houses = [], plans = [];
  const add = (fp, opts) => {
    const h = interiorHouse(doc, fp, 0, opts);
    solids.push(...h.world);
    const det = detailEntityNode(doc, h.detail);
    if (det) ents.push(det);
    for (const e of h.entities) ents.push(entity(doc, e.classname, e.origin, e.keys));
    houses.push({ box: new Box2().setFromPoints(h.plan.footprint), storeys: h.plan.storeys, stairs: h.plan.stairs ? { foot: h.plan.stairs.foot, head: h.plan.stairs.head } : null, entrances: h.plan.entrances.map((e) => e.centre.clone().addScaledVector(e.out, 64)), rooms: h.plan.rooms.map((r) => ({ c: r.box.getCenter(new Vector2()), storey: r.storey, sealed: !!r.sealed })), ...opts });
    plans.push(h.plan);
    return h;
  };
  // One row per style: furnished one-storey, bare one-storey, two storeys, an L, and (first row) wide doors.
  let twoStorey, theEll, firstHouse;
  Object.keys(INTERIOR_STYLES).forEach((style, r) => {
    const y = 576 + r * 704;
    const one = add(rect(1024, y, 512, 384), { seed: 11 + r, style, furnish: 'full' });
    if (r === 0) firstHouse = one;
    add(rect(1728, y, 384, 256), { seed: 21 + r, style, furnish: 'none', lights: false });
    const two = add(rect(2304, y, 640, 448), { seed: 31 + r, style, storeys: 2, furnish: 'full' });
    const l = add(ell(3136, y - 64), { seed: 41 + r, style, furnish: 'full', weathering: 1 });
    if (r === 0) { twoStorey = two; theEll = l; }
    add(rect(3840, y, 512, 448), r === 0 ? { seed: 51, style, furnish: 'sparse', wideDoors: true } : { seed: 51 + r, style, storeys: 2, furnish: 'sparse', cutHeight: 96 + 8 * r });
  });
  // A village block with some interiors next to solid houses.
  const village = generateBuildings(doc, new Box3(new Vector3(4608, 576, 0), new Vector3(5248, 3200, 0)), { seed: 77, minFloors: 1, maxFloors: 2, alleys: true, roofProps: true, architecture: 'village', detail: 2 });
  solids.push(...village.solids);
  const vd = detailEntityNode(doc, village.detail);
  if (vd) ents.push(vd);
  for (const e of village.entities) ents.push(entity(doc, e.classname, e.origin, e.keys));

  // Two player starts with their camera spawns, and squads to order into the houses.
  for (const [i, at] of [[0, new Vector3(448, 448, 0)], [1, new Vector3(5696, 3648, 0)]]) {
    ents.push(entity(doc, 'info_start_wars', new Vector3(at.x, at.y, 8), { angles: `0 ${i ? 225 : 45} 0` }));
    // Player 0's camera starts over the first row's two-storey house.
    ents.push(entity(doc, 'info_player_wars', cameraSpawnFor(i ? at : new Vector3(2624, 700, 0)), { angles: '65 135 0', ownernumber: String(2 + i) }));
  }
  const unit = (id, p, owner, name) => {
    const u = UNITS.find((x) => x.id === id);
    ents.push(entity(doc, u.cls, p, { targetname: name, ownernumber: owner, angles: '0 90 0', ...(u.unittype ? { unittype: u.unittype } : {}) }));
  };
  for (const p of spread(new Vector3(640, 640, 0), 6, 56)) unit('rebel', p, '2', 'squad_start');
  // In front of the first row's two-storey house and next to the L.
  for (const p of spread(new Vector3(2624, 400, 0), 4, 56)) unit('rebel', p, '2', 'squad_stairs');
  for (const p of spread(new Vector3(3392, 360, 0), 3, 56)) unit('rebel_sg', p, '2', 'squad_ell');
  for (const p of spread(new Vector3(5696, 3400, 0), 4, 56)) unit('combine', p, '3', 'combine_squad');
  // Antlions (the medium hull) next to the first farmhouse.
  for (const p of spread(new Vector3(1280, 360, 0), 3, 72)) ents.push(entity(doc, 'unit_antlion', p, { targetname: 'squad_antlion', ownernumber: '2', angles: '0 90 0' }));

  // The in-game check: at map start the squads are ordered upstairs and into the L's farthest room;
  // triggers there echo a marker into the console log (-condebug) when a unit arrives.
  const goals = [];
  if (twoStorey?.plan.stairs) {
    const up = twoStorey.plan.upperFloor, head = twoStorey.plan.stairs.head;
    goals.push({ name: 'upstairs', unit: 'squad_stairs', at: new Vector3(head.x, head.y, 144), area: up.clone().expandByScalar(-24), z: [136, 230] });
  }
  // The room farthest from the front door, for the squads that go through the doors.
  const farRoom = (house, name, unit) => {
    const e0 = house.plan.entrances[0].centre;
    const rooms = house.plan.rooms.filter((r) => r.storey === 1).map((r) => r.box);
    const far = rooms.reduce((a, b) => (b.getCenter(new Vector2()).distanceTo(e0) > a.getCenter(new Vector2()).distanceTo(e0) ? b : a));
    const c = far.getCenter(new Vector2());
    goals.push({ name, unit, at: new Vector3(c.x, c.y, 16), area: far.clone().expandByScalar(-24), z: [8, 100] });
  };
  farRoom(theEll, 'ell_room', 'squad_ell');
  farRoom(firstHouse, 'antlion_room', 'squad_antlion');
  ents.push(entity(doc, 'point_servercommand', new Vector3(448, 640, 32), { targetname: 'she_cmd' }));
  ents.push(entity(doc, 'point_broadcastclientcommand', new Vector3(448, 576, 32), { targetname: 'she_client' }));
  const auto = entity(doc, 'logic_auto', new Vector3(448, 704, 32), { spawnflags: '1' });
  const { KVNode, KVPair } = await import('/src/vmf/keyvalues.ts');
  const { SEP } = await import('/src/vmf/io.ts');
  const io = (...parts) => parts.join(SEP);
  const connections = new KVNode('connections');
  auto.items.push(connections);
  for (const g of goals) {
    ents.push(entity(doc, 'info_target', g.at, { targetname: `goal_${g.name}` }));
    ents.push(entity(doc, 'wars_give_order', new Vector3(g.at.x, g.at.y, g.at.z + 24), { targetname: `order_${g.name}`, targetordername: `goal_${g.name}`, unitname: g.unit, overwriteexistingorders: '1' }));
    connections.items.push(new KVPair('OnMapSpawn', io(`order_${g.name}`, 'PerformOrder', '', '10', '-1')));
    connections.items.push(new KVPair('OnMapSpawn', io('she_cmd', 'Command', `echo SHE_ORDERED_${g.name.toUpperCase()}`, '10', '-1')));
    // Only the ordered squad counts (furniture inside sets off an unfiltered trigger at spawn).
    ents.push(entity(doc, 'filter_activator_name', new Vector3(g.at.x, g.at.y, g.at.z + 48), { targetname: `filter_${g.name}`, filtername: g.unit, Negated: '0' }));
    const trig = entity(doc, 'trigger_multiple', new Vector3((g.area.min.x + g.area.max.x) / 2, (g.area.min.y + g.area.max.y) / 2, (g.z[0] + g.z[1]) / 2), { spawnflags: '64', wait: '1', StartDisabled: '0', filtername: `filter_${g.name}` });
    trig.items.push(solidNode(doc, boxFaces(new Vector3(g.area.min.x, g.area.min.y, g.z[0]), new Vector3(g.area.max.x, g.area.max.y, g.z[1]), 'TOOLS/TOOLSTRIGGER')));
    const tc = new KVNode('connections');
    tc.items.push(new KVPair('OnStartTouch', io('she_cmd', 'Command', `echo SHE_REACHED_${g.name.toUpperCase()}`, '0', '-1')));
    trig.items.push(tc);
    ents.push(trig);
  }
  // Camera views for screenshots (layout space; the map is shifted by (-3072, -2048) at the end).
  const views = [];
  const view = (delay, target, height = 700, name = 'view', door) => {
    const at = target.clone().add(new Vector3(-3072, -2048, 0));
    // Looking north at 65°: the camera stands south of its target.
    const back = height / Math.tan((65 * Math.PI) / 180);
    connections.items.push(new KVPair('OnMapSpawn', io('she_client', 'Command', `setpos ${Math.round(at.x)} ${Math.round(at.y - back)} ${height}`, String(delay), '-1')));
    connections.items.push(new KVPair('OnMapSpawn', io('she_client', 'Command', 'setang 65 90 0', String(delay), '-1')));
    // The engine's own screenshot (lambdawars/screenshots): window captures go stale when the game is in the background.
    connections.items.push(new KVPair('OnMapSpawn', io('she_client', 'Command', 'jpeg', String(delay + 3), '-1')));
    views.push({ name, x: Math.round(at.x), y: Math.round(at.y), height, ...(door ? { door: { x: door.at.x - 3072, y: door.at.y - 2048, nx: door.open.x, ny: door.open.y } } : {}) });
  };
  // Doorways into sealed rooms, closed off; the camera looks north, so openings whose open side faces south show best.
  const { wallBox } = await import('/src/gen/interiorPlan.ts');
  const blockedDoors = plans.flatMap((plan) => plan.walls.flatMap((w) => w.openings.filter((o) => o.blocked).map((o) => {
    const wb = wallBox(w), c = wb.getCenter(new Vector2());
    c[w.axis] = wb.min[w.axis] + (o.from + o.to) / 2;
    const left = w.axis === 'x' ? new Vector2(0, 1) : new Vector2(-1, 0);
    const open = w.left >= 0 && plan.rooms[w.left].sealed ? left.negate() : left;
    return { kind: o.blocked, at: c, open };
  })));
  // Quick views: on this machine the game closes about 40 s after loading (CEF helper error).
  view(14, new Vector3(2624, 800, 0), 700, 'farmhouse-2f');
  let t = 21;
  for (const kind of ['furniture', 'door', 'boarded']) {
    const b = blockedDoors.filter((x) => x.kind === kind).sort((p, q) => p.open.y - q.open.y)[0];
    if (!b) continue;
    // The RTS camera keeps its own minimum height, so closer views don't land on their target.
    view(t, new Vector3(b.at.x + b.open.x * 48, b.at.y + b.open.y * 48, 0), 700, `blocked-${kind}`, b);
    t += 7;
  }
  ents.push(auto);

  addEnvironment(doc, solids, ents, { width: Wd, height: Ht, apron: 256, maxHeight: 768, sunYaw: 40, fogColor: '185 195 205' });
  const shift = new Vector3(-Wd / 2, -Ht / 2, 0);
  const out = finishDoc(doc, solids, ents, shift);
  ed.loadDocument(out, 'interiors_test.vmf');
  ed.mapName = 'interiors_test.vmf';
  const { nonStaticProps, convertToDynamic } = await import('/src/edit/preflight.ts');
  const bad = await nonStaticProps(ed);
  convertToDynamic(ed, bad);
  const cls = (c) => ed.doc.entities.filter((x) => x.classname === c).length;
  const stats = {
    brushes: ed.doc.allSolids().length, world: ed.doc.worldEntity.solids.length, entities: ed.doc.entities.length,
    propStatic: cls('prop_static'), propDynamic: cls('prop_dynamic'), lights: cls('light'), decals: cls('infodecal'), units: ed.doc.entities.filter((e) => e.classname.startsWith('unit_')).length,
    convertedToDynamic: [...new Set(bad.map((x) => x.get('model')))], houses: houses.length + village.interiorHouses,
  };
  if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  W.lighting.refresh();
  return { stats, views, saved: await ed.save('interiors_test.vmf'), houses: houses.map((h) => ({ x: (h.box.min.x + h.box.max.x) / 2 + shift.x, y: (h.box.min.y + h.box.max.y) / 2 + shift.y, style: h.style, storeys: h.storeys, doors: h.entrances.map((p) => [p.x + shift.x, p.y + shift.y]), rooms: h.rooms.map((r) => ({ at: [r.c.x + shift.x, r.c.y + shift.y], storey: r.storey, sealed: r.sealed })), stairs: h.stairs && { foot: [h.stairs.foot.x + shift.x, h.stairs.foot.y + shift.y], head: [h.stairs.head.x + shift.x, h.stairs.head.y + shift.y] } })) };
});
console.log(JSON.stringify(info.stats));
console.log('saved', JSON.stringify(info.saved));
// House centres and stair ends in map coordinates, for checking in game.
// Camera views of the scripted in-game screenshots, for matching editor shots.
if (process.env.VIEWS_OUT) (await import('node:fs')).writeFileSync(process.env.VIEWS_OUT, JSON.stringify(info.views, null, 1));
if (process.env.HOUSES_OUT) (await import('node:fs')).writeFileSync(process.env.HOUSES_OUT, JSON.stringify(info.houses, null, 1));
await d.settle(4000);
await d.view([-600, -4200, 4200], [-300, -200, 0]);
await d.settle(2000);
await d.shot('interiors-p6-test-map');
const rts = (x, y, dist) => d.view([x, y - dist * Math.cos((65 * Math.PI) / 180), dist * Math.sin((65 * Math.PI) / 180)], [x, y, 0]);
await rts(-700, -1250, 1500);
await d.settle(1500);
await d.shot('interiors-p6-test-map-rts');
await rts(1900, -200, 1700);
await d.settle(1500);
await d.shot('interiors-p6-test-map-village');
await browser.close();
