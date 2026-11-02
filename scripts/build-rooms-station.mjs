// Builds the interior building test map (maps/rooms_station.vmf): the Train station preset on a paved square
// with two player starts and a rebel squad outside its street door. At map start the squad is ordered through the
// building, onto the train platform (through the concourse's archways) and into the ration hall (through the
// hallway); triggers there echo a marker into the console log (-condebug) when a unit arrives.
//   node scripts/build-rooms-station.mjs
import { withEditor } from './browser.mjs';

await withEditor(async (d) => {
  await d.open('repo:phase3_arena.vmf');

  const info = await d.eval(async () => {
    const W = window.__editor, ed = W.editor;
    const { VmfDocument } = await import('/src/vmf/map.ts');
    const { boxFaces, solidNode } = await import('/src/edit/brushes.ts');
    const { addEnvironment, entity, finishDoc } = await import('/src/gen/layout.ts');
    const { cameraSpawnFor, spread, UNITS } = await import('/src/lw/kits.ts');
    const { storedRoomBuilding } = await import('/src/gen/rooms/store.ts');
    const { presetSpec } = await import('/src/gen/rooms/presets.ts');
    const { KVNode, KVPair } = await import('/src/vmf/keyvalues.ts');
    const { SEP } = await import('/src/vmf/io.ts');
    const { Vector3 } = await import('/node_modules/three/build/three.module.js');
    const doc = VmfDocument.empty();
    doc.world.set('skyname', 'sky_day01_01');
    const solids = [], ents = [];
    const Wd = 4608, Ht = 4096;
    solids.push(solidNode(doc, boxFaces(new Vector3(0, 0, -64), new Vector3(Wd, Ht, 0), { top: 'CONCRETE/CONCRETEFLOOR033A', bottom: 'TOOLS/TOOLSNODRAW', sides: 'TOOLS/TOOLSNODRAW' })));
    // The station: 24 × 24 cells from (768, 512).
    const ox = 768, oy = 512;
    const b = storedRoomBuilding(doc, presetSpec('station', ox, oy, 0, 'station', 1709));
    solids.push(...b.world);
    ents.push(...b.entities);
    // Two player starts, the camera of player 0 over the concourse.
    for (const [i, at, look] of [[0, new Vector3(384, 2048, 0), new Vector3(1700, 2000, 0)], [1, new Vector3(4224, 384, 0), new Vector3(4224, 384, 0)]]) {
      ents.push(entity(doc, 'info_start_wars', new Vector3(at.x, at.y, 8), { angles: `0 ${i ? 135 : 0} 0` }));
      ents.push(entity(doc, 'info_player_wars', cameraSpawnFor(look), { angles: '65 135 0', ownernumber: String(2 + i) }));
    }
    const unit = (id, p, owner, name) => {
      const u = UNITS.find((x) => x.id === id);
      ents.push(entity(doc, u.cls, p, { targetname: name, ownernumber: owner, angles: '0 0 0', ...(u.unittype ? { unittype: u.unittype } : {}) }));
    };
    for (const p of spread(new Vector3(560, 1960, 0), 4, 56)) unit('rebel', p, '2', 'squad_platform');
    for (const p of spread(new Vector3(560, 2160, 0), 4, 56)) unit('rebel', p, '2', 'squad_rations');
    // Goals: the middle of the platform, and the front of the ration lanes.
    const hall = b.layout.rooms.find((r) => r.spec.id === 'hall').inner, rations = b.layout.rooms.find((r) => r.spec.id === 'rations').inner;
    const goals = [
      { name: 'platform', unit: 'squad_platform', at: new Vector3((hall.x0 + hall.x1) / 2, hall.y1 - 128, 24), r: 160 },
      { name: 'rations', unit: 'squad_rations', at: new Vector3((rations.x0 + rations.x1) / 2, rations.y0 + 120, 8), r: 160 },
    ];
    const io = (...parts) => parts.join(SEP);
    ents.push(entity(doc, 'point_servercommand', new Vector3(384, 1800, 32), { targetname: 'she_cmd' }));
    const auto = entity(doc, 'logic_auto', new Vector3(384, 1700, 32), { spawnflags: '1' });
    const connections = new KVNode('connections');
    auto.items.push(connections);
    for (const g of goals) {
      ents.push(entity(doc, 'wars_give_order', g.at, { targetname: `order_${g.name}`, unitname: g.unit, overwriteexistingorders: '1' }));
      connections.items.push(new KVPair('OnMapSpawn', io(`order_${g.name}`, 'PerformOrder', '', '8', '-1')));
      connections.items.push(new KVPair('OnMapSpawn', io('she_cmd', 'Command', `echo SHE_ORDERED_${g.name.toUpperCase()}`, '8', '-1')));
      ents.push(entity(doc, 'filter_activator_name', new Vector3(g.at.x, g.at.y, g.at.z + 48), { targetname: `filter_${g.name}`, filtername: g.unit, Negated: '0' }));
      const trig = entity(doc, 'trigger_multiple', new Vector3(g.at.x, g.at.y, g.at.z + 40), { spawnflags: '64', wait: '1', StartDisabled: '0', filtername: `filter_${g.name}` });
      trig.items.push(solidNode(doc, boxFaces(new Vector3(g.at.x - g.r, g.at.y - g.r, g.at.z - 16), new Vector3(g.at.x + g.r, g.at.y + g.r, g.at.z + 96), 'TOOLS/TOOLSTRIGGER')));
      const tc = new KVNode('connections');
      tc.items.push(new KVPair('OnStartTouch', io('she_cmd', 'Command', `echo SHE_REACHED_${g.name.toUpperCase()}`, '0', '-1')));
      trig.items.push(tc);
      ents.push(trig);
    }
    ents.push(auto);
    // The sun from the north-east (as on the tutorial map), so it falls in through the north and east window bands.
    addEnvironment(doc, solids, ents, { width: Wd, height: Ht, apron: 256, maxHeight: 768, sunYaw: 215, sunPitch: -52, fogColor: '185 195 205' });
    const out = finishDoc(doc, solids, ents, new Vector3());
    ed.loadDocument(out, 'rooms_station.vmf');
    ed.mapName = 'rooms_station.vmf';
    const { nonStaticProps, convertToDynamic } = await import('/src/edit/preflight.ts');
    const bad = await nonStaticProps(ed);
    convertToDynamic(ed, bad);
    const cls = (c) => ed.doc.entities.filter((x) => x.classname === c).length;
    const stats = {
      issues: b.layout.issues, counts: b.counts, brushes: ed.doc.allSolids().length, world: ed.doc.worldEntity.solids.length, entities: ed.doc.entities.length,
      propStatic: cls('prop_static'), propDynamic: cls('prop_dynamic'), lights: cls('light'), overlays: cls('info_overlay'),
      convertedToDynamic: [...new Set(bad.map((x) => x.get('model')))],
    };
    if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
    W.lighting.refresh();
    return { stats, saved: await ed.save('rooms_station.vmf') };
  });
  console.log(JSON.stringify(info.stats));
  console.log('saved', JSON.stringify(info.saved));
  await d.settle(4000);
  const rts = (x, y, h = 1400) => d.view([x + 0.33 * h, y - 0.33 * h, h], [x, y, 0]);
  for (const [name, x, y, hgt] of [['overview', 2300, 2100, 3600], ['hall', 2300, 1000, 1500], ['concourse', 1500, 2100, 1500], ['customs', 3000, 1850, 1300], ['north', 2000, 3100, 1500]]) {
    await rts(x, y, hgt);
    await d.settle(1500);
    await d.shot(`rooms-station-editor-${name}`);
  }
});
