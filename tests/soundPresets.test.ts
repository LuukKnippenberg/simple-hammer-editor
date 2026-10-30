import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SOUND_PRESETS, onProp, presetEntities, presetsFor } from '../src/lw/soundPresets.ts';
import { localSounds, soundPath } from '../src/audio/localSounds.ts';
import { MapEntity, VmfDocument } from '../src/vmf/map.ts';
import { entity } from '../src/gen/layout.ts';

const wrap = (defs: ReturnType<typeof presetEntities>) => {
  const doc = VmfDocument.empty();
  return defs.map((e) => new MapEntity(entity(doc, e.classname, e.origin, e.keys)));
};
const preset = (id: string) => SOUND_PRESETS.find((p) => p.id === id)!;

describe('sound presets', () => {
  it('a broken lamp on an existing lamppost puts its effects under the lamp head', () => {
    const doc = VmfDocument.empty();
    const post = new MapEntity(entity(doc, 'prop_static', new Vector3(100, 200, 0), { model: 'models/props_c17/lamppost03a_off.mdl', angles: '0 90 0' }));
    const ents = presetEntities(preset('broken_lamp'), 'broken_lamp1', new Vector3(), 0, post);
    expect(ents.map((e) => e.classname)).toEqual(['light', 'env_spark', 'ambient_generic']);
    // The head hangs 100 out along the model's y; turned 90°, that's −x.
    const spark = ents[1].origin;
    expect([spark.x, spark.y, spark.z]).toEqual([0, 200, 424]);
    expect(ents[0].keys.style).toBe('10');
  });

  it('stand-alone presets bring their prop; suggestions match models', () => {
    const fire = presetEntities(preset('fire'), 'fire1', new Vector3(0, 0, 0), 0);
    expect(fire[0]).toMatchObject({ classname: 'prop_static', keys: { model: 'models/props_c17/oildrum001_static.mdl' } });
    expect(presetsFor('models/props_c17/lamppost03a_off.mdl').map((p) => p.id)).toEqual(['broken_lamp']);
    expect(presetsFor('models/props_c17/oildrum001.mdl').map((p) => p.id)).toEqual(['fire']);
    expect(presetsFor('models/props_junk/wood_crate001a.mdl')).toEqual([]);
    expect(onProp(new Vector3(10, 0, 0), 180, new Vector3(5, 0, 1)).toArray().map(Math.round)).toEqual([5, 0, 1]);
  });

  it('local sounds come from ambient_generic files and sparking env_sparks, not from silent ones', () => {
    const ents = wrap([...presetEntities(preset('broken_lamp'), 'l', new Vector3(), 0), ...presetEntities(preset('drip'), 'd', new Vector3(500, 0, 0), 0)]);
    const doc = VmfDocument.empty();
    ents.push(new MapEntity(entity(doc, 'ambient_generic', new Vector3(), { message: 'ambient/x.wav', spawnflags: '16' })));
    ents.push(new MapEntity(entity(doc, 'ambient_generic', new Vector3(), { message: 'Canals.Drip', spawnflags: '0' })));
    const s = localSounds(ents);
    expect(s.map((x) => x.kind)).toEqual(['spark', 'ambient', 'ambient']);
    expect(s[1]).toMatchObject({ path: 'sound/ambient/machines/electric_machine.wav', radius: 448, volume: 0.4, pitch: 120 });
    expect(soundPath('^music/as01.wav')).toBe('sound/music/as01.wav');
    expect(soundPath('Canals.Drip')).toBeNull();
  });
});
