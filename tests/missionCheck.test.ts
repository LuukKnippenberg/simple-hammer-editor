import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { setConnections } from '../src/vmf/io.ts';
import { entity } from '../src/gen/layout.ts';
import { checkMission } from '../src/lw/missionCheck.ts';
import { simContinue, simCount, simStart, simTake, simWaiting } from '../src/lw/missionSim.ts';
import type { MissionGraph, Stage } from '../src/lw/mission.ts';

function map(): VmfDocument {
  const doc = VmfDocument.empty();
  const add = (cls: string, keys: Record<string, string>) => doc.addEntity(entity(doc, cls, new Vector3(), keys));
  add('unit_zombie', { targetname: 'zombies', ownernumber: '1' });
  add('control_point', { targetname: 'flag' });
  add('unit_maker', { targetname: 'wave' });
  add('info_target', { targetname: 'marker' });
  return doc;
}

const stage = (id: string, patch: Partial<Stage>): Stage => ({ id, title: id.toUpperCase(), x: 0, y: 0, messages: [], objectives: [], actions: [], transitions: [], ...patch });

const good = (): MissionGraph => ({
  version: 1, start: 'a',
  stages: [
    stage('a', {
      messages: ['Hello', 'Second'], objectives: [{ id: 'o1', text: 'Kill the zombies' }],
      actions: [{ id: 'x', target: 'wave', input: 'Enable', param: '', delay: 2 }],
      transitions: [
        { id: 't1', condition: { kind: 'destroy', target: 'zombies' }, to: 'b', completes: true },
        { id: 't2', condition: { kind: 'destroy_faction', owner: '2' }, to: 'defeat', completes: false },
      ],
    }),
    stage('b', {
      objectives: [{ id: 'o2', text: 'Take the flag' }],
      transitions: [
        { id: 't3', condition: { kind: 'capture', target: 'flag', owner: '2' }, to: 'victory', completes: true },
        { id: 't4', condition: { kind: 'survive', seconds: 60 }, to: 'defeat', completes: false },
      ],
    }),
  ],
});

describe('mission check', () => {
  it('passes a complete mission', () => {
    expect(checkMission(good(), map())).toEqual([]);
  });

  it('finds unreachable and dead-end stages, missing areas and targets, and no way to win', () => {
    const g = good();
    g.stages[1].transitions = [];
    g.stages[0].transitions.push({ id: 't5', condition: { kind: 'reach', area: null, z: 0, owner: '2' }, to: 'gone', completes: true });
    g.stages[0].actions.push({ id: 'y', target: 'nobody', input: 'Enable', param: '', delay: 0 });
    g.stages.push(stage('c', { transitions: [{ id: 't6', condition: { kind: 'capture', target: 'marker', owner: '1' }, to: 'victory', completes: true }] }));
    const issues = checkMission(g, map());
    const texts = issues.map((i) => `${i.severity}:${i.stage ?? '-'}:${i.text}`);
    expect(texts).toEqual(expect.arrayContaining([
      'error:-:Nothing leads to Victory from the start stage: the mission can\'t be won',
      'error:b:B: has no transitions: the mission gets stuck here',
      'error:a:A: "you reach … (no area drawn)" leads to a stage that no longer exists',
      'error:a:A: "you reach … (no area drawn)": no area is drawn',
      'error:a:A: the action nobody.Enable: no entity in the map is named "nobody"',
      'warning:c:C: no transition leads here, so the stage never starts',
      'error:c:C: "the enemy capture “marker”": no control point in the map is named "marker"',
      'error:c:C: "the enemy capture “marker”": only players can capture a point',
    ]));
  });

  it('warns about objects that can\'t die and hand-placed mission logic', () => {
    const g = good();
    g.stages[0].transitions[0].condition = { kind: 'destroy', target: 'marker' };
    const doc = map();
    const msg = doc.addEntity(entity(doc, 'wars_messagebox', new Vector3(), { targetname: 'msg_intro' }));
    const auto = doc.addEntity(entity(doc, 'logic_auto', new Vector3(), { targetname: 'map_start' }));
    setConnections(auto, [{ output: 'OnMapSpawn', target: 'msg_intro', input: 'Display', param: '', delay: 0, times: -1 }]);
    expect(msg.classname).toBe('wars_messagebox');
    const texts = checkMission(g, doc).map((i) => i.text);
    expect(texts).toEqual([
      'A: "destroy “marker”": "marker" is a info_target, which can\'t be destroyed',
      'The map also has 1 hand-placed message or objective (msg_intro): they show alongside the flowchart\'s',
      'Hand-made logic still drives them: map_start',
    ]);
  });
});

describe('mission simulation', () => {
  it('plays messages, objectives and actions, and follows transitions to the end', () => {
    const g = good();
    let st = simStart(g);
    expect(st.stage).toBe('a');
    expect(st.messages.map((m) => m.text)).toEqual(['Hello', 'Second']);
    expect(st.objectives.map((o) => [o.text, o.state])).toEqual([['Kill the zombies', 'active']]);
    expect(st.log.map((e) => e.kind)).toEqual(['stage', 'message', 'message', 'objective', 'action']);
    st = simContinue(st);
    expect(st.messages).toEqual([{ text: 'Second' }]);
    expect(simWaiting(g, st).map((t) => t.id)).toEqual(['t1', 't2']);

    st = simTake(g, st, 't1');
    expect(st.stage).toBe('b');
    expect(st.objectives.map((o) => [o.text, o.state])).toEqual([['Kill the zombies', 'completed'], ['Take the flag', 'active']]);
    expect(st.log.some((e) => e.kind === 'timer' && e.text === 'Timer starts: survive 1:00')).toBe(true);

    st = simTake(g, st, 't4');
    expect(st).toMatchObject({ stage: null, result: 'defeat', path: ['a', 'b'], taken: ['t1', 't4'] });
    // The previous stage's objectives are hidden, this one's failed.
    expect(st.objectives.map((o) => [o.text, o.state])).toEqual([['Take the flag', 'failed']]);
    expect(simWaiting(g, st)).toEqual([]);
  });
});

describe('mission check and play-through: game events', () => {
  const g = (): MissionGraph => ({
    version: 1, start: 'a',
    stages: [stage('a', {
      objectives: [{ id: 'o', text: 'Research and train' }],
      messages: [{ text: '#Token', speaker: 'Dispatch' }],
      gates: [{ id: 'g', op: 'lock', ability: 'build_nothing', owner: '2' }],
      transitions: [
        { id: 't1', condition: { kind: 'all', conditions: [
          { kind: 'ability', ability: 'weaponsg_comb_unlock', owner: '2', count: 1 },
          { kind: 'ability', ability: 'unit_combine', owner: '2', count: 2 },
        ] }, to: 'victory', completes: true },
        { id: 't2', condition: { kind: 'building', building: 'unit_combine', owner: '2', count: 0, when: 'finished' }, to: 'defeat', completes: false },
      ],
    })],
  });

  it('flags bad names, counts, gates and tokens with speakers', () => {
    const texts = checkMission(g(), map()).map((i) => i.text);
    expect(texts).toEqual(expect.arrayContaining([
      'A: "you build Combine Soldier": "unit_combine" is a unit, not a building',
      'A: "you build Combine Soldier": the count must be at least 1',
      'A: the ability gate "build_nothing": the game has no ability with that name',
      'A: the message "#Token" is a localisation token: the game looks up the whole text, so its speaker and hint are left out',
    ]));
    expect(texts.some((t) => t.includes('Unlock Shotgun'))).toBe(false);
  });

  it('takes an all-of transition only when every part has been met, counting repeats', () => {
    const m = g();
    let st = simStart(m);
    expect(st.log.some((e) => e.kind === 'action' && e.text === 'Lock: build_nothing')).toBe(true);
    st = simTake(m, st, 't1', 1);
    st = simTake(m, st, 't1', 0);
    expect(st.stage).toBe('a');
    expect(simCount(st, 't1', 1)).toBe(1);
    st = simTake(m, st, 't1', 1);
    expect(st).toMatchObject({ stage: null, result: 'victory' });
    expect(st.log.filter((e) => e.kind === 'progress').map((e) => e.text)).toEqual([
      'you complete 2 × Combine Soldier (1 of 2): 0 of 2 parts met',
      'you complete Unlock Shotgun: 1 of 2 parts met',
      'you complete 2 × Combine Soldier (2 of 2): 2 of 2 parts met',
    ]);
  });
});
