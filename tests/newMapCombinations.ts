import { createHash } from 'node:crypto';
import { GROUND_SETS } from '../src/edit/terrain.ts';
import { MAP_SIZES, WAVE_TYPES, buildTemplate, type MapSize, type TemplateOptions } from '../src/lw/mapTemplates.ts';

/** The New map option combinations and a hash of what each creates (tests/newMap.same-output.test.ts). */

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');
const SIZES = Object.keys(MAP_SIZES) as MapSize[];

/** The options object the old dialog passed to buildTemplate, as it set it: every field, used or not. */
const options = (kind: TemplateOptions['kind'], players: number, size: MapSize, ground: string, wavetype = 'antlions', faction: 'rebels' | 'combine' = 'rebels'): TemplateOptions =>
  ({ kind, players, size, ground, wavetype, faction });

/** Every combination the old dialog could create, by key. */
export function combinations(): [string, TemplateOptions][] {
  const out: [string, TemplateOptions][] = [['empty', options('empty', 1, 'medium', GROUND_SETS[0].material)]];
  for (const size of SIZES) for (const { material } of GROUND_SETS) {
    for (const players of [2, 4, 6, 8]) out.push([`annihilation/${players}/${size}/${material}`, options('annihilation', players, size, material)]);
    for (const players of [1, 2, 3, 4]) for (const { value } of WAVE_TYPES) out.push([`overrun/${players}/${size}/${material}/${value}`, options('overrun', players, size, material, value)]);
    for (const faction of ['rebels', 'combine'] as const) out.push([`mission/${size}/${material}/${faction}`, options('mission', 1, size, material, 'antlions', faction)]);
  }
  return out;
}

/** What New map creates: the document and, for a mission, its flowchart. */
export function hashTemplate(o: TemplateOptions): string {
  return hashBuilt(buildTemplate(o));
}

/** The hash of a built map. */
export function hashBuilt(built: { doc: { serialize(): string }; mission: unknown }): string {
  return sha1(`${built.doc.serialize()}\n${JSON.stringify(built.mission)}`);
}
