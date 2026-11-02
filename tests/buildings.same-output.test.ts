// Characterization test for the KISS refactor (research/editor-kiss-plan.md). Delete after K10.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Box2, Box3, Vector2, Vector3 } from 'three';
import { ARCHITECTURES, generateBuildings, type ArchitectureName, type BuildingOptions } from '../src/gen/buildings.ts';
import { planBlock, type PlanOptions } from '../src/gen/buildingPlan.ts';
import { encodeCuts } from '../src/gen/sketchShapes.ts';
import { Rng } from '../src/gen/rng.ts';
import { VmfDocument } from '../src/vmf/map.ts';
import { writeKeyValues } from '../src/vmf/keyvalues.ts';

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');

/** A block (big enough for a courtyard ring) and a long row (deep enough for L-shaped lots), with alleys and sky bridges. */
const FOOTPRINTS = {
  block: { box: new Box3(new Vector3(0, 0, 0), new Vector3(1536, 1152, 0)), alleys: false },
  row: { box: new Box3(new Vector3(-1152, 64, 32), new Vector3(1152, 576, 32)), alleys: true },
};

/** Everything a call makes: brushes (with their ids), entities, the street dressing and the counts. */
function digest(footprint: Box3, options: BuildingOptions): string {
  const generated = generateBuildings(VmfDocument.empty(), footprint, options);
  return sha1(writeKeyValues([...generated.solids, ...generated.detail]) + JSON.stringify(generated.entities) + JSON.stringify(generated.dressing)
    + JSON.stringify([generated.buildings, generated.interiorHouses, generated.ring]));
}

/** Every architecture × detail 1, 2 × interiors (default, none, all) × 3 seeds, rolled into one hash per footprint. */
const ARCH_GOLDEN: Record<string, Record<ArchitectureName, string>> = {
  block: {
    mixed: 'b6a2b4cbb8a4bc6c5e6e0f54f42b3bde74db202b', tenement: '726454dbf3b3258d9e8fc4e80684da4ad8a4af07', soviet: 'f7b6638bf60ab598e253a31354d8c29998d2b59c',
    brick: 'fd38d8ea382a935bccd6e35f16bb043416f46e01', sheds: '05c722bcbc4a23ff0ab4ec84d1eac9f73ebf68c7', village: '01fd842f9b0e48905a81d05a87259137d28cf2a2',
    slum: '34eb4b9c87df798415affc7184e5828e7526b044',
  },
  row: {
    mixed: 'ea5309ae9d765cca9f3863e37469eea194c10f92', tenement: '606937b878ec9cc799ec7ef8ebdc7e3cd5b23bcf', soviet: 'be44d1f50cd08e27858da24af0b3d77d236af954',
    brick: '64811c05e2eca61c9893c4605feefe2a2e968cae', sheds: '9cc72c8d2ba8b3d48198f10e3e0583d2aea6434a', village: '01af4da6d964ebeedc3038056c365aa7334be836',
    slum: '2f751aba2e50fe7d8e67d04eba588fde7c16bc18',
  },
};

/** Options the architecture sweep leaves at their defaults, one at a time on the mixed architecture. */
const VARIANTS: Record<string, Partial<BuildingOptions>> = {
  detail0: { detail: 0 },
  detail3: { detail: 3 },
  medium: { quality: 'medium' },
  filler: { quality: 'filler' },
  house: { layout: 'house' },
  single: { layout: 'single' },
  green: { yards: 'green', interiors: 'some' },
  open: { openYards: 0.5 },
  cut: { cut: encodeCuts([[new Vector2(-200, -200), new Vector2(500, -200), new Vector2(-200, 500)]]) },
  styled: { style: 'brick', roofs: 'gable', corners: 'round', towers: false, weathering: 1 },
  flat: { roofs: 'flat', corners: 'chamfer', courtyards: false, annexes: false, roofProps: false },
  furnished: { interiors: 'all', furnish: 'full', interiorLights: true, wideDoors: true, cutHeight: 128, interiorStyle: 'brick' },
};
const VARIANT_GOLDEN: Record<string, string> = {
  detail0: 'f9c28d428ef8be3a2c7b90b109c9f40ddf5ea5a1', detail3: 'b3ef5478f6d4687bd5910a1d716502fc7a7d5e59', medium: '428cd7c14434e52b69ceecc6cf2c568054e1d093',
  filler: '39ae8f66eb4227ce3bcfd140f5e69a5be0786d86', house: '8356029cd761112f224a9ef272b579a213ab1bce', single: 'a5564fe25e8e6b3cc43048b57d3b99f05e2587a4',
  green: 'f676647668d5da466a39f1a095c625417d002461', open: 'b17a26e472399ef4ac64e145045941a7ce8b340f', cut: 'c1a11da09b3dcd8b0e39381b1cadda2a2186f87f',
  styled: 'c3dff98fcdd120ef6474412e558aa207affb385e', flat: 'c08a8b55cfd4a80073d1fd4bc9a22ce769a2c703', furnished: '77cf31a272e8c8763583ed549a12d516a3787d39',
};

const SEEDS = [3, 17, 101];

describe('building generator output is unchanged', () => {
  for (const [footprintName, footprint] of Object.entries(FOOTPRINTS)) {
    for (const architecture of Object.keys(ARCHITECTURES) as ArchitectureName[]) {
      it(`${architecture} on the ${footprintName}`, () => {
        const parts: string[] = [];
        for (const detail of [1, 2] as const) {
          for (const interiors of [undefined, 'none', 'all'] as const) {
            for (const seed of SEEDS) {
              parts.push(digest(footprint.box, { seed, minFloors: 1, maxFloors: 6, alleys: footprint.alleys, roofProps: true, architecture, detail, interiors }));
            }
          }
        }
        expect(sha1(parts.join())).toBe(ARCH_GOLDEN[footprintName][architecture]);
      });
    }
  }

  for (const [name, variant] of Object.entries(VARIANTS)) {
    it(`variant ${name}`, () => {
      const parts = Object.values(FOOTPRINTS).flatMap((footprint) => SEEDS.map((seed) => digest(footprint.box, { seed, minFloors: 1, maxFloors: 6, alleys: footprint.alleys, roofProps: true, ...variant })));
      expect(sha1(parts.join())).toBe(VARIANT_GOLDEN[name]);
    });
  }
});

describe('planBlock output is unchanged', () => {
  // The options and block sizes of tests/buildingPlan.test.ts, plus alleys, open lots and the single layouts.
  const base: PlanOptions = { minFloors: 2, maxFloors: 6, alleys: false, corners: 'mixed', courtyards: true, annexes: true };
  const OPTIONS: Record<string, PlanOptions> = {
    base,
    alleys: { ...base, alleys: true, openings: 0.5, corners: 'round' },
    noAnnexes: { ...base, annexes: false, courtyards: false, corners: 'chamfer' },
    building: { ...base, single: 'building' },
    house: { ...base, single: 'house', minFloors: 1, maxFloors: 2, corners: 'square' },
  };
  const PLAN_GOLDEN: Record<string, string> = {
    base: 'cb11b63cfa6f0e32268d0363879c3af8260149e1', alleys: '11c102ef484ddcf982ebb772024c1e68402eab18', noAnnexes: '9486924d94d1e75e394de487e92256e567111742',
    building: '090425bb46fb2b63ae0b5f8dc66588e02b40a70e', house: '2501de1722125299ba060a821623e99416c2ffd5',
  };
  for (const [name, options] of Object.entries(OPTIONS)) {
    it(name, () => {
      const parts: string[] = [];
      for (let seed = 1; seed <= 40; seed++) {
        const width = 640 + (seed % 6) * 128, height = 512 + (seed % 5) * 192;
        parts.push(JSON.stringify(planBlock(new Box2(new Vector2(0, 0), new Vector2(width, height)), new Rng(seed), options)));
      }
      expect(sha1(parts.join())).toBe(PLAN_GOLDEN[name]);
    });
  }
});
