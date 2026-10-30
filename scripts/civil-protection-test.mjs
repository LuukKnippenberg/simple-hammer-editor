// In-game test of "Civil Protection": writes maps/sp_tutorial_combine_test.vmf, the tutorial with its
// flowchart built in, shorter timers, and a test driver. Every stage echoes SHE_STAGE_<id> into console.log
// (-condebug) and fires a she_step_<id> relay that does what the player would: sends Unit 09 into reach
// areas (AddOutput origin: a unit walks there), orders it to attack the citizens or walk through the opened
// gate (wars_give_order), places buildings (unit_create) and research (wars_abi) through the client, and
// trains units in the garrison through Python (spy). A second officer, she_cop, waits in the outpost for
// launches that start later. Kills that a fight would take too long for are Suicide() calls, echoed
// as SHE_FORCED.
// Nothing starts the mission by itself: <game>/lambdawars/cfg/she_testgroup.cfg, run 6 s after spawn, does
// `ent_fire mf_<stage>_enter Trigger`, so one launch can test one group of stages. Launches that start after
// the uprising first hand the player the outpost and the buildings the skipped stages would have made, e.g.:
//   spy I=__import__('core.units.info',fromlist=['x'])
//   spy PG=I.CreateUnit('build_comb_powergenerator', __import__('vmath').Vector(1800,250,0), owner_number=2)
//   spy GG=I.CreateUnit('build_comb_garrison', __import__('vmath').Vector(1600,300,0), owner_number=2)
//   ent_fire she_client Command "wars_giveresource requisition 3000"
//   ent_fire outpost_hq ChangeOwner 2 1
//   ent_fire mf_officers_enter Trigger 2
//   node --experimental-transform-types scripts/civil-protection-test.mjs
//   node --experimental-transform-types scripts/compile-map.mjs sp_tutorial_combine_test --install "<Steam Lambda Wars>"
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { getConnections, setConnections } from '../src/vmf/io.ts';
import { entity } from '../src/gen/layout.ts';
import { buildMissionInto } from '../src/lw/missionBuild.ts';
import { logicAnchor } from '../src/lw/missionAction.ts';
import { X, Y } from '../src/examples/civilProtection.ts';

const root = join(import.meta.dirname, '..');
const doc = VmfDocument.parse(readFileSync(join(root, 'maps', 'sp_tutorial_combine.vmf'), 'latin1'));
const mission = JSON.parse(readFileSync(join(root, 'maps', 'sp_tutorial_combine.mission.json'), 'utf8'));

const add = (cls, at, keys) => doc.addEntity(entity(doc, cls, at, keys));
const base = new Vector3(X(2), Y(3), 64);
let k = 0;
const spot = () => base.clone().add(new Vector3((k % 16) * 40, Math.floor(k++ / 16) * 40, 0));
add('point_servercommand', spot(), { targetname: 'she_cmd' });
add('point_broadcastclientcommand', spot(), { targetname: 'she_client' });
const auto = add('logic_auto', spot(), { targetname: 'she_test', spawnflags: '1' });
setConnections(auto, [
  { output: 'OnMapSpawn', target: 'she_cmd', input: 'Command', param: 'echo SHE_TEST_START', delay: 0, times: -1 },
  { output: 'OnMapSpawn', target: 'she_cmd', input: 'Command', param: 'exec she_testgroup', delay: 6, times: -1 },
]);
// Attack orders target the citizen; move orders have no target and send the unit to the order entity.
const order = (name, target, unit = 'player_squad', at = spot()) => add('wars_give_order', at, { targetname: name, unitname: unit, overwriteexistingorders: '1', ...(target ? { targetordername: target } : {}) });
order('she_atk_loiterer', 'loiterer');
order('she_atk_litterer', 'litterer');
order('she_atk_runner', 'runner');
order('she_go_gate', '', 'player_squad', new Vector3(X(39.5), Y(22.8), 16));
order('she_go_asset', '', 'player_squad', new Vector3(X(36), Y(26.1), 16));
add('unit_metropolice', new Vector3(X(40), Y(25), 8), { targetname: 'she_cop', ownernumber: '2', unittype: 'unit_metropolice_riot', angles: '0 90 0' });
order('she_go_relay', '', 'she_cop', new Vector3(X(45.8), Y(28.5), 16));
order('she_go_relay_asset', '', 'asset', new Vector3(X(46.4), Y(28.8), 16));
doc.entities.find((e) => e.get('targetname') === 'outpost_relay')?.set('CaptureTime', '5');

const pos = (cx, cy, z = 16) => `origin ${Math.round(X(cx))} ${Math.round(Y(cy))} ${z}`;
const echo = (text, delay = 0) => ['she_cmd', 'Command', `echo ${text}`, delay];
const client = (cmd, delay) => [['she_client', 'Command', cmd, delay], echo(`SHE_STEP ${cmd}`, delay)];
const garrison = (delay) => ['she_cmd', 'Command', "spy G=__import__('entities').gEntList.FindEntityByClassname(None,'build_comb_garrison')", delay];
const train = (unit, delay) => [['she_cmd', 'Command', `spy G.DoAbility('${unit}')`, delay], echo(`SHE_STEP train ${unit}`, delay)];
// Unit.Suicide() through Python: the SetHealth input doesn't kill Lambda Wars units.
const forced = (target, delay) => [
  ['she_cmd', 'Command', `spy [u.Suicide() for o in (0, 1) for u in list(__import__('core.units.info',fromlist=['x']).unitlist[o]) if u.GetEntityName()=='${target}']`, delay],
  echo(`SHE_FORCED ${target}`, delay),
];
// What the player does in each stage: [target, input, param, delay].
const steps = {
  shift: [['player_squad', 'AddOutput', pos(17, 10.2), 3]],
  loiterer: [['player_squad', 'AddOutput', pos(12.3, 14.5), 1], ['she_atk_loiterer', 'PerformOrder', '', 1.5], ...forced('loiterer', 15)],
  litterer: [['player_squad', 'AddOutput', pos(17.7, 8.6), 1], ['she_atk_litterer', 'PerformOrder', '', 1.5], ...forced('litterer', 15)],
  // Where the runner is once his flee order has started (he starts at the west end of the street).
  runner: [['she_cmd', 'Command', "spy print('SHE_RUNNER', __import__('entities').gEntList.FindEntityByName(None,'runner').GetAbsOrigin())", 2.5],
    ['player_squad', 'AddOutput', pos(24.5, 12.7), 2], ['she_atk_runner', 'PerformOrder', '', 2.5], ...forced('runner', 15)],
  flyer: [['player_squad', 'AddOutput', pos(33.2, 13), 2]],
  // The gate opens with the stage: walk through it from the street side.
  report: [['player_squad', 'AddOutput', pos(39.5, 18.4), 1], ['she_go_gate', 'PerformOrder', '', 2], ['player_squad', 'AddOutput', pos(39.5, 22.8), 25], echo('SHE_FORCED walk through the gate', 25)],
  asset: [['she_go_asset', 'PerformOrder', '', 1], ['player_squad', 'AddOutput', pos(36, 26.2), 20], echo('SHE_FORCED walk to the asset', 20)],
  relay: [['she_go_relay', 'PerformOrder', '', 10], ['she_go_relay_asset', 'PerformOrder', '', 10], ['player_squad', 'AddOutput', pos(45.4, 28.5), 10]],
  power: client('unit_create build_comb_powergenerator 2', 2),
  scrap: client('unit_create build_comb_powergenerator_scrap 2', 2),
  garrison: client('unit_create build_comb_garrison 2', 2),
  // Training needs a garrison: queue it there through Python (wars_abi has no building to train in).
  officers: [garrison(1.5), ...train('unit_metropolice', 2), ...train('unit_metropolice', 2.2), ...train('unit_metropolice', 2.4)],
  armory: client('unit_create build_comb_armory 2', 2),
  barricades: [...client('unit_create build_comb_barricade 2', 2), ...client('unit_create build_comb_barricade 2', 2.5), ...client('unit_create build_comb_barricade 2', 3)],
  wave1: [...forced('wave1_unit', 20), ...forced('wave1_unit', 24), ...forced('wave1_unit', 28)],
  armup: [...client('wars_abi weaponar2_comb_unlock', 2), garrison(2.5), ...train('unit_combine', 3), ...train('unit_combine', 3.2)],
};
for (const [stage, list] of Object.entries(steps)) {
  const r = add('logic_relay', spot(), { targetname: `she_step_${stage}`, spawnflags: '0' });
  setConnections(r, list.map(([target, input, param, delay]) => ({ output: 'OnTrigger', target, input, param, delay, times: -1 })));
}
// Shorter timers; every stage echoes its id and runs its step.
const timers = { scrap: 12, hold: 15, overwatch: 20, end: 5 };
for (const s of mission.stages) {
  s.actions.push({ id: `se${s.id}`, target: 'she_cmd', input: 'Command', param: `echo SHE_STAGE_${s.id}`, delay: 0 });
  if (steps[s.id]) s.actions.push({ id: `ss${s.id}`, target: `she_step_${s.id}`, input: 'Trigger', param: '', delay: 0 });
  for (const t of s.transitions) if (t.condition.kind === 'survive' && timers[s.id]) t.condition.seconds = timers[s.id];
}
const report = buildMissionInto(doc, mission, logicAnchor(doc));
// The test config starts the stages, not the map.
const start = doc.entities.find((e) => e.get('targetname') === 'mf_start');
setConnections(start, getConnections(start).filter((c) => !c.target.startsWith('mf_')));
const win = doc.entities.find((e) => e.classname === 'wars_win_condition');
for (const e of doc.entities) {
  const c = getConnections(e);
  if (c.some((x) => x.input === 'PlayerVictory')) setConnections(e, [...c, { output: 'OnTrigger', target: 'she_cmd', input: 'Command', param: 'echo SHE_VICTORY', delay: 3, times: -1 }]);
}
writeFileSync(join(root, 'maps', 'sp_tutorial_combine_test.vmf'), doc.serialize(), 'latin1');
console.log(`sp_tutorial_combine_test: ${report.entities} mission entities, ${report.connections} outputs, win ${win?.get('targetname')}`);
for (const w of report.warnings) console.log('  warning:', w);
