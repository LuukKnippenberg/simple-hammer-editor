// In-game test map for the mission flow's game-event conditions: building finished (with owner and type
// filtering and a count), ability completed with an "all of", ability gates and message speakers.
// Starts from sp_she_arena without its hand-made mission logic; a logic_auto drives the test through the
// client (point_broadcastclientcommand runs unit_create and wars_abi as the player) and every stage
// echoes a marker into console.log (-condebug).
//   node --experimental-transform-types scripts/mission-events-test.mjs
// then compile: node --experimental-transform-types scripts/compile-map.mjs sp_mission_events --install "<Steam Lambda Wars>"
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { setConnections } from '../src/vmf/io.ts';
import { entity } from '../src/gen/layout.ts';

const root = join(import.meta.dirname, '..');
const doc = VmfDocument.parse(readFileSync(join(root, 'maps', 'sp_she_arena.vmf'), 'latin1'));
const drop = new Set(['logic_auto', 'trigger_once', 'wars_messagebox', 'wars_mission_objective', 'wars_give_order', 'unit_maker', 'unit_zombie', 'trigger_capture_area', 'control_point']);
for (const e of doc.entities.filter((x) => drop.has(x.classname))) doc.removeEntity(e);

const add = (cls, at, keys) => doc.addEntity(entity(doc, cls, at, keys));
add('point_servercommand', new Vector3(-800, -560, 48), { targetname: 'she_cmd' });
add('point_broadcastclientcommand', new Vector3(-800, -620, 48), { targetname: 'she_client' });
const auto = add('logic_auto', new Vector3(-800, -680, 48), { targetname: 'she_test', spawnflags: '1' });
// [delay, client command]: the player has to be in game, so the first one waits.
const steps = [
  // (Two garrisons don't fit next to each other at the cursor: unit_create then fails to place the second.)
  [8, 'unit_create build_comb_barricade 2'], // the wrong type for stage A; stage B's counter is still off
  [9, 'unit_create build_comb_garrison 2'], // stage A -> B
  [11, 'unit_create build_comb_barricade 3'], // another player's barricade: must not count
  [11.5, 'unit_create build_comb_barricade 2'],
  [12, 'unit_create build_comb_barricade 2'],
  [12.5, 'unit_create build_comb_barricade 2'], // the third: stage B -> C
  [14.5, 'wars_abi weaponar2_comb_unlock'],
  [15, 'wars_abi weaponsg_comb_unlock'],
  [16, 'wars_abi weaponar2_comb_unlock'], // the second AR2: all of C met -> D
];
setConnections(auto, [
  { output: 'OnMapSpawn', target: 'she_cmd', input: 'Command', param: 'echo SHE_TEST_START', delay: 0, times: -1 },
  ...steps.flatMap(([delay, cmd]) => [
    { output: 'OnMapSpawn', target: 'she_client', input: 'Command', param: cmd, delay, times: -1 },
    { output: 'OnMapSpawn', target: 'she_cmd', input: 'Command', param: `echo SHE_STEP ${cmd}`, delay, times: -1 },
  ]),
]);
writeFileSync(join(root, 'maps', 'sp_mission_events.vmf'), doc.serialize(), 'latin1');

const echo = (text, delay = 0) => ({ id: `e${text}`, target: 'she_cmd', input: 'Command', param: `echo ${text}`, delay });
const spy = (code, delay) => ({ id: `p${delay}`, target: 'she_cmd', input: 'Command', param: `spy ${code}`, delay });
const mission = {
  version: 1, start: 'a',
  stages: [
    {
      id: 'a', title: 'Build a garrison', x: 40, y: 80,
      messages: [{ speaker: 'Dispatch', text: 'Build a garrison to house your units.', hint: 'Open the build menu with a stunstick unit selected.' }],
      objectives: [{ id: 'o1', text: 'Build a garrison' }],
      actions: [echo('SHE_STAGE_A')],
      transitions: [
        { id: 'ta', condition: { kind: 'building', building: 'build_comb_garrison', owner: '2', count: 1, when: 'finished' }, to: 'b', completes: true },
        { id: 'tl', condition: { kind: 'destroy_faction', owner: '2' }, to: 'defeat', completes: false },
      ],
    },
    {
      id: 'b', title: 'Barricades', x: 340, y: 80,
      messages: [{ speaker: 'Supervisor', text: 'Block the street with three barricades.' }],
      objectives: [{ id: 'o2', text: 'Build 3 barricades' }],
      actions: [echo('SHE_STAGE_B')],
      transitions: [{ id: 'tb', condition: { kind: 'building', building: 'build_comb_barricade', owner: '2', count: 3, when: 'finished' }, to: 'c', completes: true }],
    },
    {
      id: 'c', title: 'Research and arm', x: 640, y: 80,
      messages: [{ text: 'Research the shotgun and arm two squads with AR2s.', hint: 'Both can be done in any order.' }],
      objectives: [{ id: 'o3', text: 'Research the shotgun' }, { id: 'o4', text: 'Unlock the AR2 twice' }],
      actions: [echo('SHE_STAGE_C')],
      transitions: [{
        id: 'tc', to: 'd', completes: true,
        condition: { kind: 'all', conditions: [
          { kind: 'ability', ability: 'weaponsg_comb_unlock', owner: '2', count: 1 },
          { kind: 'ability', ability: 'weaponar2_comb_unlock', owner: '2', count: 2 },
        ] },
      }],
    },
    {
      id: 'd', title: 'Armory locked', x: 940, y: 80,
      messages: [{ speaker: 'Dispatch', text: 'The armory is off limits for now.' }],
      objectives: [{ id: 'o5', text: 'Hold for 3 seconds' }],
      gates: [{ id: 'g1', op: 'lock', ability: 'build_comb_armory', owner: '2' }, { id: 'g2', op: 'hide', ability: 'build_comb_armory', owner: '2' }],
      actions: [
        echo('SHE_STAGE_D'),
        spy("print('SHE_LOCKED', __import__('core.abilities',fromlist=['x']).GetTechNode('build_comb_armory',2).locked, __import__('core.abilities',fromlist=['x']).GetTechNode('build_comb_armory',2).showonunavailable)", 1),
        spy("print('SHE_MSG', __import__('entities').gEntList.FindEntityByName(None,'mf_a_msg0').description)", 1.5),
      ],
      transitions: [{ id: 'td', condition: { kind: 'survive', seconds: 3 }, to: 'victory', completes: true }],
    },
  ],
};
writeFileSync(join(root, 'maps', 'sp_mission_events.mission.json'), JSON.stringify(mission, null, 2));
console.log(`sp_mission_events: ${doc.entities.length} entities, ${steps.length} test steps`);
const { checkMission } = await import('../src/lw/missionCheck.ts');
const { parseMission } = await import('../src/lw/mission.ts');
for (const i of checkMission(parseMission(JSON.stringify(mission)), doc)) console.log(`  ${i.severity}: ${i.text}`);
