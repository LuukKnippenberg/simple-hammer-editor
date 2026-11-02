import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { KITS, applyStandardRelations, recordKit } from '../src/lw/kits.ts';
import { UNITS, findUnit, parseSquad, formatSquad, unitForEntity } from '../src/lw/units.ts';
import { entityModel, entityMatrix } from '../src/render/entityRenderer.ts';
import { getConnections, validateConnections } from '../src/vmf/io.ts';
import { stubEditor } from './stubEditor.ts';

const params = (id: string) => Object.fromEntries(KITS.find((k) => k.id === id)!.params.map((p) => [p.key, p.default]));
const kit = (id: string) => KITS.find((k) => k.id === id)!;

describe('Lambda Wars kits', () => {
  it('capture point pairs the flag with a capture area of the chosen radius', () => {
    const editor = stubEditor();
    recordKit(editor, 'cp', () => kit('capture_point').place(editor, new Vector3(0, 0, 0), { ...params('capture_point'), radius: 256 }));
    const controlPoint = editor.doc.entities.find((e) => e.classname === 'control_point')!;
    const area = editor.doc.entities.find((e) => e.classname === 'trigger_capture_area')!;
    expect(area.get('control_point')).toBe(controlPoint.get('targetname'));
    expect(area.solids).toHaveLength(1);
    expect(area.solids[0].sides.every((s) => s.material === 'TOOLS/TOOLSTRIGGER')).toBe(true);
  });

  it('wave spawns units that are ordered to the goal, with valid connections', () => {
    const editor = stubEditor();
    recordKit(editor, 'wave', () => kit('wave').place(editor, new Vector3(100, 0, 0), params('wave')));
    const maker = editor.doc.entities.find((e) => e.classname === 'unit_maker')!;
    const order = editor.doc.entities.find((e) => e.classname === 'wars_give_order')!;
    expect(getConnections(maker)[0]).toMatchObject({ output: 'OnSpawnNPC', target: order.get('targetname'), input: 'PerformOrderUnit' });
    expect(order.get('unitname')).toBe(maker.get('NPCTargetname'));
    expect(validateConnections(editor.doc).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('walking queue moves everyone one spot per step, the leaver first and then the line from the front', () => {
    const editor = stubEditor();
    recordKit(editor, 'q', () => kit('queue').place(editor, new Vector3(0, 0, 0), { ...params('queue'), slots: 4, spacing: 50, yaw: 90, length: 400, side: 'left', out: 200, interval: 6 }));
    expect(validateConnections(editor.doc).filter((p) => p.severity === 'error')).toEqual([]);
    const named = (name: string) => editor.doc.entities.find((e) => e.get('targetname') === name)!;
    // Four places plus two walking back: six people, six spots, six steps.
    expect(editor.doc.entities.filter((e) => e.classname === 'unit_citizen')).toHaveLength(6);
    const spot = (j: number) => named(`queue_p${j}`).origin!.toArray().map(Math.round);
    // Head, off to the left (west when facing north), the entrance, then the line from the last place up.
    expect([spot(0), spot(1), spot(2), spot(3), spot(4), spot(5)]).toEqual([[0, 0, 16], [-200, -40, 16], [0, -400, 16], [0, -150, 16], [0, -100, 16], [0, -50, 16]]);
    // Everyone starts on their own spot.
    expect(named('queue_c3').origin!.toArray().map(Math.round)).toEqual([0, -150, 4]);
    const step0 = getConnections(named('queue_step0'));
    const to = (c: number) => step0.find((x) => x.param === `queue_c${c}`)!;
    expect(to(0)).toMatchObject({ target: 'queue_p1', input: 'PerformOrderUnit', delay: 0 });
    expect(to(5)).toMatchObject({ target: 'queue_p0' });
    // The front closes up first, the last place last; the next step follows after the interval and loops.
    expect(to(5).delay).toBeLessThan(to(4).delay);
    expect(to(4).delay).toBeLessThan(to(3).delay);
    expect(to(3).delay).toBeLessThan(to(2).delay);
    expect(Math.max(...step0.map((x) => x.delay))).toBe(6);
    expect(step0.find((x) => x.target === 'queue_step1')).toMatchObject({ input: 'Trigger', delay: 6 });
    expect(getConnections(named('queue_step5')).find((x) => x.input === 'Trigger')!.target).toBe('queue_step0');
    expect(getConnections(editor.doc.entities.find((e) => e.classname === 'logic_auto')!)).toEqual([expect.objectContaining({ target: 'queue_step0', input: 'Trigger' })]);
  });

  it('messages and winning objectives share one map_start and one win condition, and undo in one step', () => {
    const editor = stubEditor();
    for (let i = 0; i < 2; i++) recordKit(editor, 'msg', () => kit('message').place(editor, new Vector3(i * 64, 0, 0), params('message')));
    recordKit(editor, 'obj', () => kit('objective').place(editor, new Vector3(0, 200, 0), { ...params('objective'), wins: true }));
    const starts = editor.doc.entities.filter((e) => e.classname === 'logic_auto');
    expect(starts).toHaveLength(1);
    expect(getConnections(starts[0]).map((c) => c.input)).toEqual(['Display', 'Display']);
    expect(editor.doc.entities.filter((e) => e.classname === 'wars_win_condition')).toHaveLength(1);
    // Undo the second message: its box goes, and map_start loses exactly one connection.
    editor.history.undo();
    editor.history.undo();
    expect(editor.doc.entities.filter((e) => e.classname === 'wars_messagebox')).toHaveLength(1);
    expect(getConnections(editor.doc.entities.find((e) => e.classname === 'logic_auto')!)).toHaveLength(1);
  });

  it('standard relations make the player hate every other unit owner', () => {
    const editor = stubEditor();
    recordKit(editor, 'z', () => kit('unit_group').place(editor, new Vector3(), { ...params('unit_group'), owner: '1' }));
    recordKit(editor, 'c', () => kit('unit_group').place(editor, new Vector3(500, 0, 0), { ...params('unit_group'), unit: 'combine', owner: '3' }));
    recordKit(editor, 'rel', () => applyStandardRelations(editor));
    const relations = editor.doc.entities.filter((e) => e.classname === 'wars_player_relation');
    expect(relations.map((e) => e.get('targetplayer')).sort()).toEqual(['1', '3']);
    expect(relations.every((e) => e.get('disposition') === '1' && e.get('subjectplayer') === '2')).toBe(true);
  });

  it('the unit list comes from the game: every type the Civil Protection tutorial needs is there', () => {
    for (const unit of ['unit_stalker', 'unit_citizen', 'unit_strider', 'unit_combinedropship', 'unit_combinegunship',
      'unit_scanner', 'unit_clawscanner', 'unit_manhack', 'unit_metropolice', 'unit_metropolice_riot', 'unit_combine_sg', 'unit_rebel_rpg']) {
      expect(findUnit(unit), unit).toBeDefined();
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
    const editor = stubEditor();
    recordKit(editor, 'air', () => kit('unit_group').place(editor, new Vector3(0, 0, 100), { ...params('unit_group'), unit: 'unit_combinedropship', count: 2 }));
    recordKit(editor, 'ground', () => kit('unit_group').place(editor, new Vector3(0, 2000, 100), { ...params('unit_group'), unit: 'unit_stalker', count: 2 }));
    const ships = editor.doc.entities.filter((e) => e.classname === 'unit_combinedropship');
    expect(ships.map((e) => e.origin!.z)).toEqual([700, 700]);
    // Big hulls get more room than the 64 the kit asks for.
    expect(Math.abs(ships[0].origin!.x - ships[1].origin!.x)).toBeGreaterThanOrEqual(320);
    expect(editor.doc.entities.filter((e) => e.classname === 'unit_stalker').every((e) => e.origin!.z === 104)).toBe(true);
  });

  it('a custom unittype keeps the class of the chosen unit, also in waves', () => {
    const editor = stubEditor();
    recordKit(editor, 'g', () => kit('unit_group').place(editor, new Vector3(), { ...params('unit_group'), unit: 'unit_metropolice', count: 1, unittype: 'sp_tutorial_unit_metropolice_baton' }));
    const cop = editor.doc.entities.find((e) => e.classname === 'unit_metropolice')!;
    expect(cop.get('unittype')).toBe('sp_tutorial_unit_metropolice_baton');
    // An unknown unittype still draws as its class.
    expect(entityModel(cop)).toBe('models/police.mdl');
    recordKit(editor, 'w', () => kit('wave').place(editor, new Vector3(), { ...params('wave'), unit: 'unit_stalker', unittype: 'sp_stalker_x' }));
    expect(editor.doc.entities.find((e) => e.classname === 'unit_maker')!.get('NPCType')).toBe('sp_stalker_x');
  });

  it('mission start places a mixed squad', () => {
    const editor = stubEditor();
    const squad = formatSquad([{ unit: 'unit_metropolice_riot', count: 1, unittype: '' }, { unit: 'unit_stalker', count: 2, unittype: '' }]);
    expect(parseSquad(squad)).toHaveLength(2);
    recordKit(editor, 'sp', () => kit('sp_start').place(editor, new Vector3(), { ...params('sp_start'), faction: 'combine', squad }));
    const units = editor.doc.entities.filter((e) => e.get('targetname') === 'player_squad');
    expect(units.map((e) => e.get('unittype')).sort()).toEqual(['unit_metropolice_riot', 'unit_stalker', 'unit_stalker']);
    expect(units.every((e) => e.get('ownernumber') === '2')).toBe(true);
    expect(parseSquad(String(params('sp_start').squad))).toEqual([{ unit: 'rebel', count: 6, unittype: '' }]);
  });

  it('units draw with the model and scale of their unittype', () => {
    const editor = stubEditor();
    recordKit(editor, 'g', () => kit('unit_group').place(editor, new Vector3(), { ...params('unit_group'), unit: 'unit_metropolice_riot', count: 1 }));
    recordKit(editor, 'g', () => kit('unit_group').place(editor, new Vector3(), { ...params('unit_group'), unit: 'unit_combinegunship', count: 1 }));
    const riot = editor.doc.entities.find((e) => e.get('unittype') === 'unit_metropolice_riot')!;
    const gunship = editor.doc.entities.find((e) => e.classname === 'unit_combinegunship')!;
    expect(unitForEntity(riot)?.label).toBe('Metrocop');
    expect(entityModel(riot)).toBe('models/police_extended.mdl');
    expect(entityModel(gunship)).toBe('models/gunship.mdl');
    expect(new Vector3().setFromMatrixScale(entityMatrix(gunship)).x).toBeCloseTo(0.75);
  });
});
