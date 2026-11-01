import { describe, expect, it } from 'vitest';
import { classChangePlan, differsFromDefault, expandName, keyGroup, mergeSelection, type ClassDef } from '../src/edit/entityKeys.ts';
import { classChoices, classGroup, searchClasses } from '../src/edit/entityClasses.ts';
import { nextInList, pushRecent } from '../src/ui/recent.ts';

const key = (name: string, def = '', type = 'string', base?: string) => ({ name, type, label: name, default: def, description: '', base });
const propStatic: ClassDef = { name: 'prop_static', keys: [key('angles', '0 0 0', 'angle'), key('model', '', 'studio'), key('skin', '0', 'integer'), key('solid', '6', 'choices'), key('fademindist', '-1', 'float'), key('disablevertexlighting', '0', 'boolean')] };
const propDynamic: ClassDef = { name: 'prop_dynamic', keys: [key('targetname', '', 'target_source'), key('angles', '0 0 0', 'angle'), key('model', '', 'studio'), key('skin', '0', 'integer'), key('solid', '6', 'choices'), key('fademindist', '-1', 'float'), key('DefaultAnim', ''), key('RandomAnimation', '0', 'boolean'), key('spawnflags', '', 'flags')] };
const lookup = (c: string) => ({ prop_static: propStatic, prop_dynamic: propDynamic } as Record<string, ClassDef>)[c];

describe('change class', () => {
  it('keeps shared and undescribed keys, drops what the new class lacks, adds its defaults', () => {
    const props: [string, string][] = [['id', '7'], ['classname', 'prop_static'], ['targetname', 'barrel'], ['origin', '0 0 16'], ['model', 'models/a.mdl'],
      ['skin', '1'], ['disablevertexlighting', '1'], ['she_note', 'x']];
    const p = classChangePlan(props, propStatic, propDynamic);
    expect(p.keep).toEqual(['targetname', 'origin', 'model', 'skin', 'she_note']);
    expect(p.drop).toEqual(['disablevertexlighting']);
    // Keys with an empty default and flags are not added.
    expect(p.add).toEqual([{ name: 'angles', value: '0 0 0' }, { name: 'solid', value: '6' }, { name: 'fademindist', value: '-1' }, { name: 'RandomAnimation', value: '0' }]);
  });
});

describe('multi-selection', () => {
  it('merges values of shared keys and lists keys only some classes have', () => {
    const ent = (cls: string, kv: Record<string, string>) => ({ classname: cls, props: [['classname', cls], ...Object.entries(kv)] as [string, string][] });
    const m = mergeSelection([
      ent('prop_static', { model: 'models/a.mdl', fademindist: '600' }),
      ent('prop_static', { model: 'models/a.mdl', fademindist: '600' }),
      ent('prop_static', { model: 'models/a.mdl', fademindist: '900' }),
      ent('prop_dynamic', { model: 'models/b.mdl', DefaultAnim: 'idle' }),
      ent('prop_dynamic', { model: 'models/b.mdl', DefaultAnim: 'idle' }),
    ], lookup);
    const shared = Object.fromEntries(m.shared.map((k) => [k.name, Object.fromEntries(k.values)]));
    expect(shared.model).toEqual({ 'models/a.mdl': 3, 'models/b.mdl': 2 });
    // A key an entity lacks counts with its class default.
    expect(shared.fademindist).toEqual({ 600: 2, 900: 1, '-1': 2 });
    expect(shared.skin).toEqual({ 0: 5 });
    expect(shared.DefaultAnim).toBeUndefined();
    const only = Object.fromEntries(m.only.map((o) => [o.classname, [o.count, o.keys.map((k) => k.name)]]));
    expect(only.prop_dynamic).toEqual([2, ['targetname', 'DefaultAnim', 'RandomAnimation', 'spawnflags']]);
    expect(only.prop_static).toEqual([3, ['disablevertexlighting']]);
  });

  it('has no per-class groups when all entities share a class', () => {
    const m = mergeSelection([{ classname: 'prop_static', props: [] }, { classname: 'prop_static', props: [['skin', '2']] }], lookup);
    expect(m.only).toEqual([]);
    expect(Object.fromEntries(m.shared.find((k) => k.name === 'skin')!.values)).toEqual({ 0: 1, 2: 1 });
  });
});

describe('keys', () => {
  it('groups keys by name, then by declaring base', () => {
    expect(keyGroup({ name: 'angles' })).toBe('Transform');
    expect(keyGroup({ name: 'fademaxdist' })).toBe('Fading');
    expect(keyGroup({ name: 'rendercolor', base: 'RenderFields' })).toBe('Rendering');
    expect(keyGroup({ name: 'ownernumber', base: 'Wars' })).toBe('Lambda Wars');
    expect(keyGroup({ name: 'CaptureTime', base: 'control_point' }, true)).toBe('Lambda Wars');
    expect(keyGroup({ name: 'radius', base: 'light_deferred' })).toBe('Properties');
  });

  it('compares values with their defaults as numbers', () => {
    expect(differsFromDefault('15.0', '15')).toBe(false);
    expect(differsFromDefault('255 255 255', '255 255 255')).toBe(false);
    expect(differsFromDefault('16', '15')).toBe(true);
    expect(differsFromDefault('', '')).toBe(false);
    expect(differsFromDefault('abc', '')).toBe(true);
  });

  it('expands name patterns to the first free number', () => {
    expect(expandName('cp_#', new Set(['cp_1', 'cp_2', 'cp_4']))).toBe('cp_3');
    expect(expandName('door', new Set(['door']))).toBe('door');
    expect(expandName('  ', new Set())).toBe('');
  });
});

describe('classes', () => {
  const classes = [
    { name: 'control_point', type: 'NPCClass', description: 'Capture point' },
    { name: 'env_fog_controller', type: 'PointClass', description: 'Fog' },
    { name: 'prop_static', type: 'PointClass', description: '' },
    { name: 'prop_dynamic', type: 'PointClass', description: '' },
    { name: 'prop_dynamic_override', type: 'PointClass', description: '' },
    { name: 'func_detail', type: 'SolidClass', description: '' },
    { name: 'wars_music_controller', type: 'PointClass', description: 'Background music' },
  ];
  it('groups classes', () => {
    expect(classGroup(classes[0]).id).toBe('wars');
    expect(classGroup(classes[1]).id).toBe('env');
    expect(classGroup(classes[5]).id).toBe('brush');
    expect(classGroup(classes[6]).id).toBe('wars');
  });
  it('ranks prefix matches first, then word starts, then descriptions', () => {
    expect(searchClasses(classes, 'prop_d').map((c) => c.name)).toEqual(['prop_dynamic', 'prop_dynamic_override']);
    expect(searchClasses(classes, 'fog').map((c) => c.name)).toEqual(['env_fog_controller']);
    expect(searchClasses(classes, 'cont').map((c) => c.name)).toEqual(['control_point', 'env_fog_controller', 'wars_music_controller']);
    expect(searchClasses(classes, 'music').map((c) => c.name)).toEqual(['wars_music_controller']);
  });
  it('offers classes of the same kind, family first', () => {
    const r = classChoices(classes, classes[2], '');
    expect(r.family.map((c) => c.name)).toEqual(['prop_dynamic', 'prop_dynamic_override']);
    expect(r.other.some((c) => c.name === 'func_detail')).toBe(false);
  });
});

describe('recent lists', () => {
  it('moves items to the front without duplicates', () => {
    expect(pushRecent(['a', 'b', 'c'], 'C', 3)).toEqual(['C', 'a', 'b']);
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
    expect(nextInList(['a', 'b'], 'b')).toBe('a');
    expect(nextInList(['a', 'b'], 'x')).toBe('a');
  });
});
