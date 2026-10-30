import { describe, expect, it } from 'vitest';
import { manifestFiles, pcfSystemNames } from '../src/assets/pcf.ts';
import { particleKind, particleLook } from '../src/lw/particles.ts';

/** A binary DMX file with the given elements ([type, name]), in encoding 2 (short indices, inline names) or 5. */
function dmx(version: 2 | 5, elements: [string, string][]): ArrayBuffer {
  const bytes: number[] = [];
  const str = (s: string) => { for (const c of s) bytes.push(c.charCodeAt(0)); bytes.push(0); };
  const int = (v: number) => bytes.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);
  const short = (v: number) => bytes.push(v & 255, (v >> 8) & 255);
  str(`<!-- dmx encoding binary ${version} format pcf ${version === 5 ? 2 : 1} -->\n`);
  const table = [...new Set(elements.flatMap(([t, n]) => (version === 5 ? [t, n] : [t])))];
  if (version === 5) int(table.length); else short(table.length);
  table.forEach(str);
  int(elements.length);
  for (const [t, n] of elements) {
    if (version === 5) { int(table.indexOf(t)); int(table.indexOf(n)); } else { short(table.indexOf(t)); str(n); }
    for (let i = 0; i < 16; i++) bytes.push(i);
  }
  return new Uint8Array(bytes).buffer;
}

describe('PCF reader', () => {
  const els: [string, string][] = [['DmElement', 'untitled'], ['DmeParticleSystemDefinition', 'smoke_large_01'], ['DmeParticleOperator', 'Movement Basic'], ['DmeParticleSystemDefinition', 'burning_vehicle']];
  it('reads system names from encoding 2 and 5', () => {
    expect(pcfSystemNames(dmx(2, els))).toEqual(['smoke_large_01', 'burning_vehicle']);
    expect(pcfSystemNames(dmx(5, els))).toEqual(['smoke_large_01', 'burning_vehicle']);
  });
  it('ignores files that are not binary DMX', () => {
    expect(pcfSystemNames(new TextEncoder().encode('particles_manifest { }').buffer)).toEqual([]);
  });
  it('reads the manifest, skipping comments and the preload mark', () => {
    const text = '{\n "file" "particles/a.pcf"\n //"file" "particles/off.pcf"\n "file" "!particles/B.pcf" // note\n}';
    expect(manifestFiles(text)).toEqual(['particles/a.pcf', 'particles/b.pcf']);
  });
});

describe('particle look', () => {
  it('guesses the kind from the name', () => {
    expect(particleKind('smoke_large_01')).toBe('smoke');
    expect(particleKind('burning_vehicle')).toBe('fire');
    expect(particleKind('explosion_sparks')).toBe('explosion');
    expect(particleKind('thorns_zap_sparks')).toBe('sparks');
    expect(particleKind('steam_jet_80')).toBe('steam');
  });
  it('scales with size words', () => {
    expect(particleLook('smoke_large_01').height).toBeGreaterThan(particleLook('smoke_small_01').height);
    expect(particleLook('Skybox_Smoke_01').size).toBeGreaterThan(particleLook('smoke_large_01').size);
  });
});
