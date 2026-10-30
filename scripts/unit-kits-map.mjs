// Builds maps/sp_unit_kits_test.vmf: a flat, sealed 4096 field with the new unit types from the kits, a
// group of each for the player (west) and the enemy (east), so a compile + launch shows them spawning and
// the air units flying. Placed with the kit code itself, as the kit tool does.
//   node --experimental-transform-types scripts/unit-kits-map.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { History } from '../src/edit/history.ts';
import { boxFaces, solidNode } from '../src/edit/brushes.ts';
import { addEnvironment, finishDoc } from '../src/gen/layout.ts';
import { KITS, applyStandardRelations, mapStart, recordKit } from '../src/lw/kits.ts';
import { getConnections, setConnections } from '../src/vmf/io.ts';
import { entityNode } from '../src/edit/actions.ts';

const root = join(import.meta.dirname, '..');
const W = 4096, H = 4096;
const base = VmfDocument.empty();
const solids = [solidNode(base, boxFaces(new Vector3(0, 0, -64), new Vector3(W, H, 0), 'CONCRETE/CONCRETE01'))];
const ents = [];
addEnvironment(base, solids, ents, { width: W, height: H, apron: 0, maxHeight: 1536, sunYaw: 40, fogColor: '170 175 180' });
const doc = finishDoc(base, solids, ents, new Vector3(0, 0, 0));
doc.world.set('message', 'Unit kits test');

const editor = { doc, history: new History(() => doc), changed() {} };
const kit = (id) => KITS.find((k) => k.id === id);
const defaults = (id) => Object.fromEntries(kit(id).params.map((p) => [p.key, p.default]));
const place = (id, at, p) => recordKit(editor, id, () => kit(id).place(editor, new Vector3(...at), { ...defaults(id), ...p }));

// Mission start: a mixed squad (one riot officer and a Stalker), Combine faction.
place('sp_start', [700, 2048, 0], { faction: 'combine', squad: 'unit_metropolice_riot:1, unit_stalker:1', yaw: 0 });
const groups = [
  ['unit_stalker', 3], ['unit_citizen', 4], ['unit_strider', 1], ['unit_combinedropship', 1],
  ['unit_combinegunship', 1], ['unit_metropolice_riot', 4], ['unit_scanner', 2], ['unit_manhack', 3],
];
groups.forEach(([unit, count], i) => {
  const y = 400 + i * 470;
  place('unit_group', [1100, y, 0], { unit, count, owner: '2', spacing: 72, name: `you_${unit}` });
  place('unit_group', [3000, y, 0], { unit, count, owner: '1', spacing: 72, name: `enemy_${unit}` });
});
recordKit(editor, 'relations', () => applyStandardRelations(editor));

// Test probe for the in-game check: at 4, 15 and 30 s the server runs cfg/she_unitprobe.py (copy
// scripts/she_unitprobe.py to the game's cfg/; absent, it only warns), which prints every unit's height
// above the ground into console.log; the camera turns to the player's air units.
const start = mapStart(editor, new Vector3(2048, 200, 0));
for (const [cls, name, at] of [['point_servercommand', 'she_cmd', [2048, 120, 32]], ['point_broadcastclientcommand', 'she_client', [2048, 60, 32]]]) {
  doc.addEntity(entityNode(editor, cls, new Vector3(...at), { targetname: name }));
}
const out = (target, param, delay) => ({ output: 'OnMapSpawn', target, input: 'Command', param, delay, times: -1 });
setConnections(start, [
  ...getConnections(start),
  ...[4, 15, 30].flatMap((t) => [out('she_cmd', `echo SHE_PROBE_${t}`, t), out('she_cmd', 'py_runfile cfg/she_unitprobe.py', t)]),
  out('she_client', 'setpos 1500 -350 1000', 5), out('she_client', 'setang 40 75 0', 5),
]);

writeFileSync(join(root, 'maps', 'sp_unit_kits_test.vmf'), doc.serialize(), 'latin1');
const units = doc.entities.filter((e) => e.classname.startsWith('unit_'));
console.log(`sp_unit_kits_test.vmf: ${units.length} units, air at`, [...new Set(units.filter((e) => e.origin.z > 100).map((e) => `${e.classname} z=${e.origin.z}`))].join(', '));
