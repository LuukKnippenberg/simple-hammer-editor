import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { History } from '../src/edit/history.ts';
import { KITS, applyStandardRelations, recordKit } from '../src/lw/kits.ts';
import { UNITS, findUnit, parseSquad, formatSquad, unitForEntity } from '../src/lw/units.ts';
import { entityModel, entityMatrix } from '../src/render/entityRenderer.ts';
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

  it('the unit list comes from the game: every type the Civil Protection tutorial needs is there', () => {
    for (const t of ['unit_stalker', 'unit_citizen', 'unit_strider', 'unit_combinedropship', 'unit_combinegunship',
      'unit_scanner', 'unit_clawscanner', 'unit_manhack', 'unit_metropolice', 'unit_metropolice_riot', 'unit_combine_sg', 'unit_rebel_rpg']) {
      expect(findUnit(t), t).toBeDefined();
    }
    expect(findUnit('unit_metropolice_riot')).toMatchObject({ cls: 'unit_metropolice', faction: 'combine', model: 'models/police_extended.mdl' });
    expect(findUnit('unit_scanner')).toMatchObject({ cls: 'unit_cscanner', air: 370 });
    expect(findUnit('unit_citizen')?.faction).toBe('citizens');
    // The ids of the first kit list still resolve (POI catalogue, saved settings).
    expect(findUnit('metropolice')?.unittype).toBe('unit_metropolice_smg1');
    expect(new Set(UNITS.map((u) => u.id)).size).toBe(UNITS.length);
    expect(UNITS.some((u) => /^unit_(dummy|damage_controller)/.test(u.cls))).toBe(false);
  });

  it('air units are placed at their flying height, ground units on the ground', () => {
    const ed = stubEditor();
    recordKit(ed, 'air', () => kit('unit_group').place(ed, new Vector3(0, 0, 100), { ...params('unit_group'), unit: 'unit_combinedropship', count: 2 }));
    recordKit(ed, 'ground', () => kit('unit_group').place(ed, new Vector3(0, 2000, 100), { ...params('unit_group'), unit: 'unit_stalker', count: 2 }));
    const ships = ed.doc.entities.filter((e) => e.classname === 'unit_combinedropship');
    expect(ships.map((e) => e.origin!.z)).toEqual([700, 700]);
    // Big hulls get more room than the 64 the kit asks for.
    expect(Math.abs(ships[0].origin!.x - ships[1].origin!.x)).toBeGreaterThanOrEqual(320);
    expect(ed.doc.entities.filter((e) => e.classname === 'unit_stalker').every((e) => e.origin!.z === 104)).toBe(true);
  });

  it('a custom unittype keeps the class of the chosen unit, also in waves', () => {
    const ed = stubEditor();
    recordKit(ed, 'g', () => kit('unit_group').place(ed, new Vector3(), { ...params('unit_group'), unit: 'unit_metropolice', count: 1, unittype: 'sp_tutorial_unit_metropolice_baton' }));
    const cop = ed.doc.entities.find((e) => e.classname === 'unit_metropolice')!;
    expect(cop.get('unittype')).toBe('sp_tutorial_unit_metropolice_baton');
    // An unknown unittype still draws as its class.
    expect(entityModel(cop)).toBe('models/police.mdl');
    recordKit(ed, 'w', () => kit('wave').place(ed, new Vector3(), { ...params('wave'), unit: 'unit_stalker', unittype: 'sp_stalker_x' }));
    expect(ed.doc.entities.find((e) => e.classname === 'unit_maker')!.get('NPCType')).toBe('sp_stalker_x');
  });

  it('mission start places a mixed squad', () => {
    const ed = stubEditor();
    const squad = formatSquad([{ unit: 'unit_metropolice_riot', count: 1, unittype: '' }, { unit: 'unit_stalker', count: 2, unittype: '' }]);
    expect(parseSquad(squad)).toHaveLength(2);
    recordKit(ed, 'sp', () => kit('sp_start').place(ed, new Vector3(), { ...params('sp_start'), faction: 'combine', squad }));
    const units = ed.doc.entities.filter((e) => e.get('targetname') === 'player_squad');
    expect(units.map((e) => e.get('unittype')).sort()).toEqual(['unit_metropolice_riot', 'unit_stalker', 'unit_stalker']);
    expect(units.every((e) => e.get('ownernumber') === '2')).toBe(true);
    expect(parseSquad(String(params('sp_start').squad))).toEqual([{ unit: 'rebel', count: 6, unittype: '' }]);
  });

  it('units draw with the model and scale of their unittype', () => {
    const ed = stubEditor();
    recordKit(ed, 'g', () => kit('unit_group').place(ed, new Vector3(), { ...params('unit_group'), unit: 'unit_metropolice_riot', count: 1 }));
    recordKit(ed, 'g', () => kit('unit_group').place(ed, new Vector3(), { ...params('unit_group'), unit: 'unit_combinegunship', count: 1 }));
    const riot = ed.doc.entities.find((e) => e.get('unittype') === 'unit_metropolice_riot')!;
    const gunship = ed.doc.entities.find((e) => e.classname === 'unit_combinegunship')!;
    expect(unitForEntity(riot)?.label).toBe('Metrocop');
    expect(entityModel(riot)).toBe('models/police_extended.mdl');
    expect(entityModel(gunship)).toBe('models/gunship.mdl');
    expect(new Vector3().setFromMatrixScale(entityMatrix(gunship)).x).toBeCloseTo(0.75);
  });
});
