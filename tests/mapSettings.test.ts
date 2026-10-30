import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VmfDocument } from '../src/vmf/map.ts';
import { getConnections, validateConnections } from '../src/vmf/io.ts';
import { SETTING_GROUPS, applyMapSettings, createGroupEntity, groupState, readField, setSwitchedOff, writeField } from '../src/lw/mapSettings.ts';

const group = (id: string) => SETTING_GROUPS.find((g) => g.id === id)!;
const field = (id: string, label: string) => group(id).fields.find((f) => f.label === label)!;

describe('map settings', () => {
  it('compiling an empty map adds sun, shadows, fog and exposure with working wiring', () => {
    const doc = VmfDocument.empty();
    expect(applyMapSettings(doc)).toEqual(['Sun & ambient light', 'Dynamic shadows', 'Fog', 'Exposure & bloom']);
    const fog = doc.entities.find((e) => e.classname === 'env_fog_controller')!;
    expect(fog.get('fogenable')).toBe('1');
    expect(fog.get('spawnflags')).toBe('1');
    const auto = doc.entities.find((e) => e.classname === 'logic_auto')!;
    expect(getConnections(auto).map((c) => `${c.output} ${c.target} ${c.input} ${c.param}`)).toEqual([
      'OnMapSpawn tonemap SetAutoExposureMin 0.7',
      'OnMapSpawn tonemap SetAutoExposureMax 1.2',
      'OnMapSpawn tonemap SetBloomScale 0.2',
      'OnMapSpawn tonemap SetTonemapRate 1',
    ]);
    expect(validateConnections(doc).filter((p) => p.severity === 'error')).toEqual([]);
    // Survives a save and a second compile without duplicates.
    const again = VmfDocument.parse(doc.serialize());
    expect(applyMapSettings(again)).toEqual([]);
  });

  it('a switched-off group is not added', () => {
    const doc = VmfDocument.empty();
    setSwitchedOff(doc, 'fog', true);
    expect(groupState(doc, group('fog'))).toBe('off');
    expect(applyMapSettings(doc)).not.toContain('Fog');
    expect(doc.entities.some((e) => e.classname === 'env_fog_controller')).toBe(false);
  });

  it('fields write keys, angle components and spawnflag bits', () => {
    const doc = VmfDocument.empty();
    createGroupEntity(doc, group('deferred'));
    const e = doc.entities.find((x) => x.classname === 'light_deferred_global')!;
    expect(e.get('spawnflags')).toBe('7');
    writeField(doc, group('deferred'), field('deferred', 'Shadows'), '0');
    writeField(doc, group('deferred'), field('deferred', 'Sun direction'), '200');
    expect(e.get('spawnflags')).toBe('5');
    expect(e.get('angles')).toBe('50 200 0');
    expect(readField(doc, group('deferred'), field('deferred', 'Sun height'))).toBe('50');
  });

  it('reads and edits the exposure wiring of an existing map in place', () => {
    const doc = VmfDocument.parse(readFileSync(join(__dirname, '..', 'maps', 'hlw_City16.vmf'), 'latin1'));
    const exposure = group('exposure');
    expect(groupState(doc, exposure)).toBe('set');
    expect(readField(doc, exposure, field('exposure', 'Max exposure'))).toBe('4');
    writeField(doc, exposure, field('exposure', 'Max exposure'), '2.5');
    const conns = doc.entities.filter((e) => e.classname === 'logic_auto').flatMap(getConnections).filter((c) => c.input === 'SetAutoExposureMax');
    expect(conns.map((c) => `${c.output} ${c.param}`)).toEqual(['OnNewGame 2.5']);
    expect(applyMapSettings(doc)).toEqual([]);
  });
});
