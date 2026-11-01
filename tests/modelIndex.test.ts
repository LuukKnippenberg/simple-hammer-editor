import { describe, expect, it } from 'vitest';
import { modelEntry } from '../server/models.ts';
import { modelFolder, modelName, sizeClass } from '../src/assets/modelIndex.ts';

/** A minimal MDL header: flags, hull, texture and skin family counts, and optional keyvalues text. */
function mdl(opts: { staticFlag: boolean; keyvalues?: string; hull?: [number, number, number, number, number, number]; skins?: number }): Buffer {
  const text = Buffer.from(opts.keyvalues ?? '', 'latin1');
  const buf = Buffer.alloc(400 + text.length);
  buf.writeUInt32LE(0x54534449, 0);
  buf.writeInt32LE(48, 4);
  const hull = opts.hull ?? [-16, -16, 0, 16, 16, 48];
  hull.forEach((v, i) => buf.writeFloatLE(v, 104 + i * 4));
  buf.writeInt32LE(opts.staticFlag ? 0x10 : 0, 152);
  buf.writeInt32LE(3, 204);
  buf.writeInt32LE(opts.skins ?? 1, 224);
  text.copy(buf, 400);
  return buf;
}

describe('model index', () => {
  it('reads static-prop use, physics data, skins and size from the header', () => {
    expect(modelEntry('models/a.mdl', mdl({ staticFlag: true, skins: 4 }))).toEqual({
      path: 'models/a.mdl', static: true, physics: false, skins: 4, size: [32, 32, 48], materials: 3,
    });
    // Physics prop_data keeps a $staticprop model from being static, unless it allows it.
    const physics = modelEntry('models/b.mdl', mdl({ staticFlag: true, keyvalues: '"prop_data" { "base" "Wooden.Small" }' }))!;
    expect([physics.static, physics.physics]).toEqual([false, true]);
    const allowed = modelEntry('models/c.mdl', mdl({ staticFlag: true, keyvalues: '"prop_data" { "base" "Metal.Small" "allowstatic" "1" }' }))!;
    expect([allowed.static, allowed.physics]).toEqual([true, false]);
    expect(modelEntry('models/d.mdl', mdl({ staticFlag: false }))!.static).toBe(false);
    expect(modelEntry('models/e.mdl', Buffer.from('not a model'))).toBeNull();
  });

  it('names, folders and size classes', () => {
    expect(modelName('models/props_c17/oildrum001.mdl')).toBe('oildrum001');
    expect(modelFolder('models/props_c17/oildrum001.mdl')).toBe('props_c17');
    expect(sizeClass({ size: [29, 29, 46] })).toBe('medium');
    expect(sizeClass({ size: [20, 116, 450] })).toBe('huge');
    expect(sizeClass({ size: [8, 8, 30] })).toBe('small');
  });
});
