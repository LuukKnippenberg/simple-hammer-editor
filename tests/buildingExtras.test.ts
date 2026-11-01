import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { VmfDocument } from '../src/vmf/map.ts';
import { generateBuildings, type BuildingOptions } from '../src/gen/buildings.ts';
import { decodeBlock, encodeBlock, groupStreet, type BlockSpec } from '../src/gen/buildingStore.ts';
import type { FeatureEntity } from '../src/gen/facadeFeatures.ts';
import type { ExtraCategory } from '../src/gen/extras.ts';

/** Four blocks round a crossing (a 320-unit street each way), as Generate buildings makes them from four brushes. */
const RECTS = [[0, 0, 1536, 1536], [1856, 0, 3072, 1280], [0, 1856, 1280, 3072], [1856, 1856, 3072, 3072]];
const BASE: BuildingOptions = { seed: 11, minFloors: 3, maxFloors: 6, alleys: false, roofProps: true, weathering: 0.5, detail: 2, quality: 'high', roofs: 'mixed', towers: true, annexes: true, courtyards: true };

const specs = (o: Partial<BuildingOptions> = {}, each: (i: number) => Partial<BuildingOptions> = () => ({})): BlockSpec[] => RECTS.map(([x0, y0, x1, y1], i) => ({
  uid: `b${i}`, group: 'g', street: 'flat', groupSeed: 5, rect: { x0, y0, x1, y1 }, z: 0, options: { ...BASE, ...o, ...each(i), seed: BASE.seed + i * 7919 },
}));

/** Every entity the blocks and their street pass make. */
function generate(blocks: BlockSpec[]): FeatureEntity[] {
  const doc = VmfDocument.empty();
  const outs = blocks.map((b) => generateBuildings(doc, new Box3(new Vector3(b.rect.x0, b.rect.y0, 0), new Vector3(b.rect.x1, b.rect.y1, 0)), b.options));
  return [...outs.flatMap((o) => o.entities), ...groupStreet(blocks, undefined, outs.map((o) => o.dressing))];
}

/** A digest of what was made, leaving out interior lights (their brightness is tuned separately). */
const digest = (es: FeatureEntity[]) => createHash('sha1').update(JSON.stringify(es.filter((e) => e.classname !== 'light')
  .map((e) => [e.classname, e.origin.x, e.origin.y, e.origin.z, Object.entries(e.keys).sort()]))).digest('hex').slice(0, 12);

/** The same blocks in each architecture's mix, green yards and enterable houses, so every extra turns up. */
const FIXTURES: Record<string, Partial<BuildingOptions>> = {
  tenement: { architecture: 'tenement' },
  green: { architecture: 'tenement', yards: 'green' },
  village: { architecture: 'village', minFloors: 1, maxFloors: 2, interiors: 'some' },
  mixed: {},
  flat: { architecture: 'tenement', roofs: 'flat' },
};

/** Which extra an entity is, by what the generators put there (none of these models is used indoors). */
const CATEGORIES: [ExtraCategory, (e: FeatureEntity) => boolean][] = [
  ['trees', (e) => /props_foliage\//.test(e.keys.model ?? '')],
  ['lamps', (e) => /lamppost/.test(e.keys.model ?? '')],
  ['cables', (e) => /rope$/.test(e.classname) || /utilitypolemount01a/.test(e.keys.model ?? '')],
  ['clutter', (e) => /gutter_pipe|satellitedish02|gasmeter|antenna04a/.test(e.keys.model ?? '')],
  ['awnings', (e) => /awning/.test(e.keys.model ?? '')],
  ['yardProps', (e) => /playground|benchoutdoor|trashbin|props_vehicles/.test(e.keys.model ?? '')],
  ['roofProps', (e) => /roof_vent|chimneypipe|antenna01a|roof_dish|rooftopcluser/.test(e.keys.model ?? '')],
];
const categoryOf = (e: FeatureEntity) => CATEGORIES.find(([, t]) => t(e))?.[0] ?? null;
const OFF: Record<Exclude<ExtraCategory, 'roofProps'>, Partial<BuildingOptions>> = {
  trees: { trees: 'none' }, lamps: { lamps: false }, cables: { cables: false }, clutter: { clutter: false }, awnings: { awnings: false }, yardProps: { yardProps: false },
};
/** Rope names carry a running number, so a rope left out renames the ones after it. */
const unnamed = (es: FeatureEntity[]) => es.map((e) => (/rope$/.test(e.classname) ? { ...e, keys: { ...e.keys, targetname: '', NextKey: '' } } : e));

describe('building extras', () => {
  it('reproduce today\'s output by default', () => {
    const got = Object.fromEntries(Object.entries(FIXTURES).map(([k, o]) => [k, digest(generate(specs(o)))]));
    expect(got).toEqual(BASELINE);
  });

  it('turned on explicitly are the same as left at their defaults', () => {
    const on: Partial<BuildingOptions> = { extras: true, trees: 'normal', lamps: true, lampSpacing: 448, cables: true, clutter: true, awnings: true, yardProps: true };
    for (const o of Object.values(FIXTURES)) expect(digest(generate(specs({ ...o, ...on })))).toBe(digest(generate(specs(o))));
  });

  it('each fixture set makes every extra', () => {
    const all = Object.values(FIXTURES).flatMap((o) => generate(specs(o)));
    for (const [c, t] of CATEGORIES) expect(all.filter(t).length, c).toBeGreaterThan(0);
  });

  it('turned off one at a time remove that extra and leave everything else where it was', () => {
    for (const o of Object.values(FIXTURES)) {
      const full = generate(specs(o));
      for (const [c, off] of Object.entries(OFF)) {
        const got = generate(specs({ ...o, ...off }));
        expect(got.some((e) => categoryOf(e) === c), c).toBe(false);
        expect(digest(unnamed(got)), c).toBe(digest(unnamed(full.filter((e) => categoryOf(e) !== c))));
      }
    }
  });

  it('the master switch removes all of them, roof props too, and leaves the buildings as they were', () => {
    for (const o of Object.values(FIXTURES)) {
      const full = generate(specs(o));
      const got = generate(specs({ ...o, extras: false }));
      expect(got.filter((e) => categoryOf(e))).toEqual([]);
      expect(digest(got)).toBe(digest(full.filter((e) => !categoryOf(e))));
      // Interiors and weathering are not extras.
      expect(got.length).toBeGreaterThan(0);
    }
  });

  it('thin and double the trees', () => {
    const trees = (t: BuildingOptions['trees']) => Object.values(FIXTURES).flatMap((o) => generate(specs({ ...o, trees: t }))).filter((e) => categoryOf(e) === 'trees').length;
    const sparse = trees('sparse'), normal = trees('normal'), dense = trees('dense');
    expect(sparse).toBeLessThan(normal);
    expect(dense).toBeGreaterThan(normal * 1.4);
  });

  it('space the lamps along the pavements', () => {
    const lamps = (lampSpacing: number) => generate(specs({ lampSpacing })).filter((e) => categoryOf(e) === 'lamps').length;
    expect(lamps(320)).toBeGreaterThan(lamps(448));
    expect(lamps(896)).toBeLessThan(lamps(448));
  });

  it('follow each block: lamps go with their block, a cable needs both of its blocks', () => {
    const full = generate(specs());
    const got = generate(specs({}, (i) => (i === 0 ? { lamps: false, cables: false } : {})));
    const inBlock0 = (e: FeatureEntity) => e.origin.x < 1700 && e.origin.y < 1700;
    expect(got.filter((e) => categoryOf(e) === 'lamps' && inBlock0(e))).toEqual([]);
    expect(got.filter((e) => categoryOf(e) === 'lamps').length).toBe(full.filter((e) => categoryOf(e) === 'lamps' && !inBlock0(e)).length);
    const ropes = (es: FeatureEntity[]) => es.filter((e) => e.classname === 'move_rope').length;
    expect(ropes(got)).toBeGreaterThan(0);
    expect(ropes(got)).toBeLessThan(ropes(full));
    expect(got.filter((e) => /rope$/.test(e.classname) && inBlock0(e))).toEqual([]);
  });

  it('are stored with the block and survive its encoding', () => {
    const spec = specs({ extras: true, trees: 'dense', lamps: false, lampSpacing: 640, cables: false, clutter: false, awnings: true, yardProps: false })[0];
    const back = decodeBlock(encodeBlock(spec))!;
    expect(back.options).toMatchObject({ trees: 'dense', lamps: false, lampSpacing: 640, cables: false, clutter: false, awnings: true, yardProps: false, extras: true });
    expect(encodeBlock(spec).length).toBeLessThan(400);
  });
});

// Digests of the fixtures before the extras options existed (b6be1e2).
const BASELINE: Record<string, string> = { tenement: '39b3daa0675d', green: '7c5a7589cf35', village: '09840b5683f4', mixed: '7076db4fadd5', flat: 'b5e4cda6a0fa' };
