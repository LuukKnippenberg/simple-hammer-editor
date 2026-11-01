import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { entity } from '../src/gen/layout.ts';
import { parseMission, stageById, type MissionGraph, type Stage } from '../src/lw/mission.ts';
import { addNextStage, canCapture, canDestroy, conditionLoci, freeSpot, nameFor, playOrder, setVictory, uniqueName } from '../src/lw/missionView.ts';

const stage = (id: string, patch: Partial<Stage> = {}): Stage => ({ id, title: id.toUpperCase(), x: 0, y: 0, messages: [], objectives: [], actions: [], transitions: [], ...patch });
const tr = (id: string, to: string, target = 'x') => ({ id, condition: { kind: 'destroy' as const, target }, to, completes: to !== 'defeat' });

function map(): VmfDocument {
  const doc = VmfDocument.empty();
  const add = (cls: string, keys: Record<string, string>) => doc.addEntity(entity(doc, cls, new Vector3(), keys));
  add('unit_combine', { targetname: 'squad', ownernumber: '1' });
  add('unit_combine', { targetname: 'Squad', ownernumber: '1' });
  add('control_point', { targetname: 'flag' });
  add('build_comb_hq', { ownernumber: '2' });
  add('build_comb_garrison', { ownernumber: '2' });
  add('info_player_wars', {});
  add('logic_relay', { targetname: 'squad', she_mission: '1' });
  return doc;
}

describe('objectives in play order', () => {
  it('walks the main line from the start, then branches, then stages nothing leads to', () => {
    const g: MissionGraph = {
      version: 1, start: 'a',
      stages: [
        stage('lonely'),
        stage('c', { transitions: [tr('t5', 'victory')] }),
        stage('a', { transitions: [tr('t1', 'b'), tr('t2', 'defeat')] }),
        stage('b', { transitions: [tr('t3', 'c'), tr('t4', 'side')] }),
        stage('side', { transitions: [tr('t6', 'b'), tr('t7', 'retry')] }),
        stage('retry', { transitions: [tr('t8', 'a')] }),
      ],
    };
    const order = playOrder(g);
    expect(order.map((o) => o.stage.id)).toEqual(['a', 'b', 'c', 'side', 'retry', 'lonely']);
    expect(order.map((o) => o.main)).toEqual([true, true, true, false, false, false]);
    expect(order.at(-1)!.reachable).toBe(false);
  });

  it('lists the whole tutorial mission once, along its main line', () => {
    const g = parseMission(readFileSync(join(__dirname, '..', 'maps', 'sp_tutorial_combine.mission.json'), 'utf8'))!;
    const order = playOrder(g);
    expect(order).toHaveLength(g.stages.length);
    expect(order.slice(0, 3).map((o) => o.stage.id)).toEqual(['shift', 'loiterer', 'litterer']);
    expect(order.at(-1)!.stage.id).toBe('end');
    expect(order.every((o) => o.main && o.reachable)).toBe(true);
  });
});

describe('where objectives happen', () => {
  it('resolves areas, named targets (without case, skipping mission logic) and bases', () => {
    const ents = map().entities;
    expect(conditionLoci({ kind: 'reach', area: [0, 0, 64, 64], z: 8, owner: '2' }, ents)).toEqual([{ kind: 'area', area: [0, 0, 64, 64], z: 8 }]);
    expect(conditionLoci({ kind: 'reach', area: null, z: 0, owner: '2' }, ents)[0].kind).toBe('none');
    const squad = conditionLoci({ kind: 'destroy', target: 'SQUAD' }, ents)[0];
    expect(squad.kind === 'entities' && squad.entities.map((e) => e.classname)).toEqual(['unit_combine', 'unit_combine']);
    expect(conditionLoci({ kind: 'capture', target: 'nope', owner: '2' }, ents)[0]).toMatchObject({ kind: 'none' });
    // A building already in the map, else the player's HQ.
    const built = conditionLoci({ kind: 'building', building: 'build_comb_garrison', owner: '2', count: 1, when: 'finished' }, ents)[0];
    expect(built).toMatchObject({ kind: 'entities', entities: [{ classname: 'build_comb_garrison' }] });
    expect(conditionLoci({ kind: 'ability', ability: 'unit_combine', owner: '2', count: 2 }, ents)[0]).toMatchObject({ kind: 'entities', base: true, entities: [{ classname: 'build_comb_hq' }] });
    expect(conditionLoci({ kind: 'ability', ability: 'unit_combine', owner: '5', count: 2 }, ents)[0].kind).toBe('none');
    expect(conditionLoci({ kind: 'survive', seconds: 30 }, ents)[0].kind).toBe('none');
    expect(conditionLoci({ kind: 'all', conditions: [{ kind: 'destroy', target: 'squad' }, { kind: 'capture', target: 'flag', owner: '2' }] }, ents)).toHaveLength(2);
  });

  it('accepts the right entities as targets and names unnamed ones uniquely', () => {
    expect(['unit_combine', 'unit_maker', 'npc_zombie', 'prop_physics', 'build_comb_hq'].every(canDestroy)).toBe(true);
    expect(canDestroy('info_target')).toBe(false);
    expect(canCapture('control_point') && canCapture('trigger_capture_area') && !canCapture('unit_combine')).toBe(true);
    expect(uniqueName('combine', ['Combine', 'combine_2'])).toBe('combine_3');
    const doc = map();
    expect(nameFor(doc.entities[0], ['combine'])).toBe('combine_2');
    expect(nameFor(doc.entities[3], [])).toBe('comb_hq');
  });
});

describe('quick edits from the view', () => {
  const chain = (): MissionGraph => ({
    version: 1, start: 'a',
    stages: [
      stage('a', { x: 0, y: 0, transitions: [tr('t1', 'b'), tr('t2', 'defeat', 'hero')] }),
      stage('b', { x: 320, y: 0, transitions: [tr('t3', 'victory')] }),
    ],
  });

  it('inserts a next stage between a stage and where it led, keeping its ways to lose', () => {
    const g = chain();
    const a = g.stages[0];
    const s = addNextStage(g, a, { kind: 'capture', target: 'flag', owner: '2' }, 'Capture the flag');
    expect(a.transitions[0].to).toBe(s.id);
    expect(s.transitions[0]).toMatchObject({ condition: { kind: 'capture', target: 'flag' }, to: 'b', completes: true });
    expect(s.transitions[1]).toMatchObject({ condition: { kind: 'destroy', target: 'hero' }, to: 'defeat' });
    expect(s.transitions[1].id).not.toBe('t2');
    expect(s.objectives[0].text).toBe('Capture the flag');
    expect(playOrder(g).map((o) => o.stage.id)).toEqual(['a', s.id, 'b']);
    // Placed right of `a`, below `b` (a title and one transition) which is in the way.
    expect({ x: s.x, y: s.y }).toEqual({ x: 320, y: 56 + 26 + 40 });
  });

  it('gives a stage with no way forward a short pause into the new one, which leads to victory', () => {
    const g: MissionGraph = { version: 1, start: 'a', stages: [stage('a')] };
    const s = addNextStage(g, g.stages[0], { kind: 'reach', area: [0, 0, 64, 64], z: 0, owner: '2' }, 'Go');
    expect(g.stages[0].transitions).toMatchObject([{ condition: { kind: 'survive', seconds: 5 }, to: s.id }]);
    expect(stageById(g, s.id)!.transitions).toMatchObject([{ to: 'victory' }]);
    expect({ x: s.x, y: s.y }).toEqual({ x: 320, y: 0 });
    // Another one would go below it (a title, an objective and a transition).
    expect(freeSpot(g, g.stages[0])).toEqual({ x: 320, y: 56 + 2 * 26 + 40 });
  });

  it('sets a stage to end in victory', () => {
    const g = chain();
    setVictory(g.stages[0]);
    expect(g.stages[0].transitions.map((t) => t.to)).toEqual(['victory', 'defeat']);
    const lone = stage('z');
    setVictory(lone);
    expect(lone.transitions).toMatchObject([{ condition: { kind: 'survive', seconds: 5 }, to: 'victory', completes: true }]);
  });
});
