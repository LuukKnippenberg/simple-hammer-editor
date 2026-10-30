import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONDITIONS, defaultCondition, describeCondition, emptyMission, messageText, parseMission, type ConditionKind } from '../src/lw/mission.ts';

describe('mission graph', () => {
  it('every condition kind has a default, a label and a description', () => {
    for (const kind of Object.keys(CONDITIONS) as ConditionKind[]) {
      const c = defaultCondition(kind);
      expect(c.kind).toBe(kind);
      expect(describeCondition(c).length).toBeGreaterThan(4);
    }
    expect(describeCondition({ kind: 'survive', seconds: 150 })).toBe('survive 2:30');
    expect(describeCondition({ kind: 'troops', owner: '2', count: 20, compare: 'atleast' })).toBe('you have ≥ 20 population');
  });

  it('parses saved graphs, filling in missing lists, and rejects junk', () => {
    const g = parseMission('{"stages":[{"id":"a","title":"A","x":0,"y":0}]}')!;
    expect(g.start).toBe('a');
    expect(g.stages[0]).toMatchObject({ messages: [], objectives: [], actions: [], transitions: [] });
    expect(parseMission('not json')).toBeNull();
    expect(emptyMission().stages).toHaveLength(1);
  });

  it('the Sofia flowchart is valid', () => {
    const g = parseMission(readFileSync(join(__dirname, '..', 'maps', 'sp_sofia.mission.json'), 'utf8'))!;
    expect(g.stages.map((s) => s.title)).toEqual(['The old town', 'The tram line', 'Assault on the Largo']);
    const targets = new Set([...g.stages.map((s) => s.id), 'victory', 'defeat']);
    for (const s of g.stages) for (const t of s.transitions) expect(targets.has(t.to)).toBe(true);
  });
});

describe('mission messages', () => {
  it('puts the speaker in bold and the hint in italics, and keeps tags clear of the game\'s line break at 200', () => {
    expect(messageText('Plain "quoted"')).toBe("Plain 'quoted'");
    expect(messageText({ text: 'Hi', speaker: 'Supervisor', hint: 'Press B' })).toBe('<b>Supervisor:</b> Hi<br><i>Press B</i>');
    const long = messageText({ text: 'x'.repeat(198), hint: 'hint' });
    // The <br> before the hint would straddle character 200: it is pushed past it.
    expect(long.indexOf('<br>')).toBe(200);
    expect(messageText({ text: '  ', speaker: 'Dispatch' })).toBe('');
  });

  it('describes the new conditions with game names', () => {
    expect(describeCondition({ kind: 'building', building: 'build_comb_barricade', owner: '2', count: 3, when: 'finished' })).toBe('you build 3 × Barricade');
    expect(describeCondition({ kind: 'ability', ability: 'unit_combine', owner: '2', count: 2 })).toBe('you complete 2 × Combine Soldier');
    expect(describeCondition({ kind: 'all', conditions: [defaultCondition('building')] })).toBe('all of: you build Garrison');
    expect(parseMission('{"stages":[{"id":"a","title":"A","x":0,"y":0,"messages":["old"]}]}')!.stages[0].messages).toEqual([{ text: 'old' }]);
  });
});
