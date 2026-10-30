import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { History } from '../src/edit/history.ts';
import { KITS, applyStandardRelations, recordKit } from '../src/lw/kits.ts';
import { getConnections, validateConnections } from '../src/vmf/io.ts';
import type { Editor } from '../src/editor.ts';

/** Just enough of an Editor for kits: a document, history and a no-op change hook. */
function stubEditor(): Editor {
  const doc = VmfDocument.empty();
  return { doc, history: new History(() => doc), changed() {} } as unknown as Editor;
}

const params = (id: string) => Object.fromEntries(KITS.find((k) => k.id === id)!.params.map((p) => [p.key, p.default]));
const kit = (id: string) => KITS.find((k) => k.id === id)!;

describe('Lambda Wars kits', () => {
  it('capture point pairs the flag with a capture area of the chosen radius', () => {
    const ed = stubEditor();
    recordKit(ed, 'cp', () => kit('capture_point').place(ed, new Vector3(0, 0, 0), { ...params('capture_point'), radius: 256 }));
    const cp = ed.doc.entities.find((e) => e.classname === 'control_point')!;
    const area = ed.doc.entities.find((e) => e.classname === 'trigger_capture_area')!;
    expect(area.get('control_point')).toBe(cp.get('targetname'));
    expect(area.solids).toHaveLength(1);
    expect(area.solids[0].sides.every((s) => s.material === 'TOOLS/TOOLSTRIGGER')).toBe(true);
  });

  it('wave spawns units that are ordered to the goal, with valid connections', () => {
    const ed = stubEditor();
    recordKit(ed, 'wave', () => kit('wave').place(ed, new Vector3(100, 0, 0), params('wave')));
    const maker = ed.doc.entities.find((e) => e.classname === 'unit_maker')!;
    const order = ed.doc.entities.find((e) => e.classname === 'wars_give_order')!;
    expect(getConnections(maker)[0]).toMatchObject({ output: 'OnSpawnNPC', target: order.get('targetname'), input: 'PerformOrderUnit' });
    expect(order.get('unitname')).toBe(maker.get('NPCTargetname'));
    expect(validateConnections(ed.doc).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('messages and winning objectives share one map_start and one win condition, and undo in one step', () => {
    const ed = stubEditor();
    for (let i = 0; i < 2; i++) recordKit(ed, 'msg', () => kit('message').place(ed, new Vector3(i * 64, 0, 0), params('message')));
    recordKit(ed, 'obj', () => kit('objective').place(ed, new Vector3(0, 200, 0), { ...params('objective'), wins: true }));
    const starts = ed.doc.entities.filter((e) => e.classname === 'logic_auto');
    expect(starts).toHaveLength(1);
    expect(getConnections(starts[0]).map((c) => c.input)).toEqual(['Display', 'Display']);
    expect(ed.doc.entities.filter((e) => e.classname === 'wars_win_condition')).toHaveLength(1);
    // Undo the second message: its box goes, and map_start loses exactly one connection.
    ed.history.undo();
    ed.history.undo();
    expect(ed.doc.entities.filter((e) => e.classname === 'wars_messagebox')).toHaveLength(1);
    expect(getConnections(ed.doc.entities.find((e) => e.classname === 'logic_auto')!)).toHaveLength(1);
  });

  it('standard relations make the player hate every other unit owner', () => {
    const ed = stubEditor();
    recordKit(ed, 'z', () => kit('unit_group').place(ed, new Vector3(), { ...params('unit_group'), owner: '1' }));
    recordKit(ed, 'c', () => kit('unit_group').place(ed, new Vector3(500, 0, 0), { ...params('unit_group'), unit: 'combine', owner: '3' }));
    recordKit(ed, 'rel', () => applyStandardRelations(ed));
    const rel = ed.doc.entities.filter((e) => e.classname === 'wars_player_relation');
    expect(rel.map((e) => e.get('targetplayer')).sort()).toEqual(['1', '3']);
    expect(rel.every((e) => e.get('disposition') === '1' && e.get('subjectplayer') === '2')).toBe(true);
  });
});
