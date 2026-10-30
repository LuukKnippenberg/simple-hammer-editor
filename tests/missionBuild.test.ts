import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument, type MapEntity } from '../src/vmf/map.ts';
import { getConnections, validateConnections } from '../src/vmf/io.ts';
import { entity } from '../src/gen/layout.ts';
import { buildMissionInto, clearMission } from '../src/lw/missionBuild.ts';
import type { MissionGraph } from '../src/lw/mission.ts';

function map(): VmfDocument {
  const doc = VmfDocument.empty();
  const add = (cls: string, keys: Record<string, string>) => doc.addEntity(entity(doc, cls, new Vector3(), keys));
  for (let i = 0; i < 3; i++) add('unit_zombie', { targetname: 'courtyard_zombies', ownernumber: '1' });
  add('unit_rebel', { targetname: 'medic', ownernumber: '2' });
  add('control_point', { targetname: 'largo_flag' });
  add('unit_maker', { targetname: 'wave1' });
  return doc;
}

const graph: MissionGraph = {
  version: 1, start: 'a',
  stages: [
    {
      id: 'a', title: 'Clear the courtyard', x: 0, y: 0, messages: ['First message', 'Second message'], objectives: [{ id: 'o', text: 'Kill the zombies' }], actions: [],
      transitions: [
        { id: 't1', condition: { kind: 'destroy', target: 'courtyard_zombies' }, to: 'b', completes: true },
        { id: 't2', condition: { kind: 'lost', target: 'medic' }, to: 'defeat', completes: false },
      ],
    },
    {
      id: 'b', title: 'Take the square', x: 300, y: 0, messages: ['Go'], objectives: [{ id: 'o2', text: 'Take the flag' }],
      actions: [{ id: 'a1', target: 'wave1', input: 'Enable', param: '', delay: 5 }],
      transitions: [
        { id: 't3', condition: { kind: 'reach', area: [0, 0, 512, 512], z: 0, owner: '2' }, to: 'c', completes: true },
        { id: 't4', condition: { kind: 'survive', seconds: 90 }, to: 'defeat', completes: false },
      ],
    },
    {
      id: 'c', title: 'Hold', x: 600, y: 0, messages: [], objectives: [], actions: [],
      transitions: [
        { id: 't5', condition: { kind: 'capture', target: 'largo_flag', owner: '2' }, to: 'victory', completes: true },
        { id: 't6', condition: { kind: 'troops', owner: '2', count: 5, compare: 'atmost' }, to: 'defeat', completes: false },
        { id: 't7', condition: { kind: 'destroy', target: 'wave1' }, to: 'victory', completes: true },
        { id: 't8', condition: { kind: 'resources', owner: '2', amount: 100 }, to: 'victory', completes: true },
      ],
    },
  ],
};
const named = (doc: VmfDocument, n: string) => doc.entities.find((e) => e.get('targetname') === n)!;
const outs = (e: MapEntity) => getConnections(e).map((c) => `${c.output}>${c.target}.${c.input}${c.param ? `(${c.param})` : ''}`);

describe('mission build', () => {
  it('wires stages, messages, objectives and conditions with no broken outputs', () => {
    const doc = map();
    const r = buildMissionInto(doc, graph, new Vector3());
    expect(validateConnections(doc).filter((p) => p.severity === 'error')).toEqual([]);
    expect(r.warnings).toEqual(['Hold: "gain resources" can\'t be built yet (the game has no entity that reports resources)']);
    expect(outs(named(doc, 'mf_start'))).toEqual(['OnMapSpawn>mf_a_enter.Trigger']);
    // Messages chain on Continue; objectives appear; transitions are enabled.
    expect(outs(named(doc, 'mf_a_msg0'))).toEqual(['OnPressContinue>mf_a_msg1.Display']);
    expect(outs(named(doc, 'mf_a_enter'))).toEqual(expect.arrayContaining(['OnTrigger>mf_a_msg0.Display', 'OnTrigger>mf_a_obj0.SetVisible(1)', 'OnTrigger>mf_a_t0.Enable', 'OnTrigger>mf_a_t1.Enable']));
    // All three zombies counted; the medic's death loses.
    expect(doc.entities.filter((e) => e.get('targetname') === 'courtyard_zombies').every((e) => outs(e).includes('OnUnitKilled>mf_a_t0_c.Add(1)'))).toBe(true);
    expect(named(doc, 'mf_a_t0_c').get('max')).toBe('3');
    expect(outs(named(doc, 'medic'))).toEqual(['OnUnitKilled>mf_a_t1.Trigger']);
    // A transition closes the stage and opens the next.
    expect(outs(named(doc, 'mf_a_t0'))).toEqual(expect.arrayContaining(['OnTrigger>mf_a_t1.Disable', 'OnTrigger>mf_a_obj0.SetCompleted', 'OnTrigger>mf_b_enter.Trigger']));
    expect(outs(named(doc, 'mf_a_t1'))).toEqual(expect.arrayContaining(['OnTrigger>mf_a_obj0.SetFailed', 'OnTrigger>mf_result.PlayerLost']));
    // Reach: a disabled trigger brush filtered to the player, enabled with the stage.
    const trig = named(doc, 'mf_b_t0_c');
    expect(trig.classname).toBe('trigger_multiple');
    expect(trig.solids).toHaveLength(1);
    expect(trig.get('origin')).toBeUndefined();
    expect(named(doc, trig.get('filtername')!).get('ownernumber')).toBe('2');
    expect(outs(named(doc, 'mf_b_enter'))).toEqual(expect.arrayContaining(['OnTrigger>mf_b_t0_c.Enable', 'OnTrigger>mf_b_t1_c.Start', 'OnTrigger>wave1.Enable']));
    expect(getConnections(named(doc, 'mf_b_enter')).find((c) => c.target === 'wave1')?.delay).toBe(5);
    expect(outs(named(doc, 'mf_b_t0'))).toEqual(expect.arrayContaining(['OnTrigger>mf_b_t0_c.Disable', 'OnTrigger>mf_b_t1_c.Pause']));
    // Capture, population and wave conditions.
    expect(outs(named(doc, 'largo_flag'))).toEqual(['OnCaptured_Player0>mf_c_t0.Trigger']);
    expect(outs(named(doc, 'mf_c_t1_c_cmp'))).toEqual(['OnLessThan>mf_c_t1.Trigger']);
    expect(named(doc, 'mf_c_t1_c_cmp').get('CompareValue')).toBe('5.5');
    expect(outs(named(doc, 'wave1'))).toEqual(['OnAllSpawnedDead>mf_c_t2.Trigger']);
  });

  it('rebuilding replaces its own entities and outputs, and clearing removes them', () => {
    const doc = map();
    const before = doc.entities.length;
    buildMissionInto(doc, graph, new Vector3());
    const n = doc.entities.length;
    buildMissionInto(doc, graph, new Vector3());
    expect(doc.entities.length).toBe(n);
    expect(outs(named(doc, 'medic'))).toHaveLength(1);
    clearMission(doc);
    expect(doc.entities.length).toBe(before);
    expect(outs(named(doc, 'medic'))).toEqual([]);
  });
});
