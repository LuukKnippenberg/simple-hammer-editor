// Characterization test for the New map wizard (research/npx-handoff.md, F2): every option the old dialog offered
// builds the same document and mission, byte for byte. The hashes were taken before the wizard replaced the dialog.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GROUND_SETS } from '../src/edit/terrain.ts';
import { MAP_SIZES, WAVE_TYPES, type MapSize } from '../src/lw/mapTemplates.ts';
import { combinations, hashTemplate } from './newMapCombinations.ts';

const SIZES = Object.keys(MAP_SIZES) as MapSize[];
const HASHES: Record<string, string> = JSON.parse(readFileSync(new URL('./newMap.same-output.hashes.json', import.meta.url), 'utf8'));

describe('New map builds the same maps as before the wizard', () => {
  const all = combinations();
  it('covers every combination', () => {
    expect(all.length).toBe(1 + SIZES.length * GROUND_SETS.length * (4 + 4 * WAVE_TYPES.length + 2));
    expect(Object.keys(HASHES).sort()).toEqual(all.map(([key]) => key).sort());
  });
  // One test per mode and size, so each stays well inside the timeout.
  for (const kind of ['empty', 'annihilation', 'overrun', 'mission']) for (const size of kind === 'empty' ? [''] : SIZES) {
    it(`${kind} ${size}`.trim(), () => {
      for (const [key, o] of all.filter(([k]) => k.startsWith(kind) && (kind === 'empty' || k.includes(`/${size}/`)))) expect(hashTemplate(o), key).toBe(HASHES[key]);
    });
  }
});
