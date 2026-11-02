// Characterization test for the KISS refactor (research/editor-kiss-plan.md). Delete after K10.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Box2, Vector2 } from 'three';
import { planInterior, type InteriorPlanOptions } from '../src/gen/interiorPlan.ts';
import { rectPoly } from '../src/gen/buildingPlan.ts';
import { Rng } from '../src/gen/rng.ts';

const rect = (width: number, height: number, x = 0, y = 0) => rectPoly(new Box2(new Vector2(x, y), new Vector2(x + width, y + height)));
const ell = (size: number, wing: number) => [new Vector2(0, 0), new Vector2(size, 0), new Vector2(size, wing), new Vector2(wing, wing), new Vector2(wing, size), new Vector2(0, size)];

/** The footprints of interiorPlan.test.ts, plus a narrow one. */
const FOOTPRINTS: Record<string, Vector2[]> = {
  'rect 256x256': rect(256, 256),
  'rect 384x256': rect(384, 256),
  'rect 512x384': rect(512, 384),
  'rect 640x448 offset': rect(640, 448, -320, 128),
  'rect 320x576': rect(320, 576),
  'narrow 192x640': rect(192, 640),
  'ell 512/256': ell(512, 256),
  'ell 640/384 (wings with stairs)': [new Vector2(0, 0), new Vector2(640, 0), new Vector2(640, 384), new Vector2(256, 384), new Vector2(256, 640), new Vector2(0, 640)],
};

const OPTIONS: Record<string, InteriorPlanOptions> = {
  default: {},
  wideDoors: { wideDoors: true },
  'cut 160': { cut: 160 },
  'two storeys': { storeys: 2 },
  'two storeys, wide doors': { storeys: 2, wideDoors: true },
  workshop: { use: 'workshop', porch: true },
  'entrance edge 2, no porch': { entranceEdges: [2], porch: false },
  'neighbour on the low y side': { noEntrance: [new Box2(new Vector2(-400, -200), new Vector2(700, 0))] },
  // Every side faces a neighbour: falls back to doors anywhere.
  'neighbours all round': { noEntrance: [new Box2(new Vector2(-1000, -1000), new Vector2(1000, 1000))] },
};

const SEEDS = Array.from({ length: 10 }, (_, i) => i * 37 + 1);

/** sha1 over the plans for every seed, plus the next RNG draw (so a changed RNG call count shows too). */
function hashCase(footprint: Vector2[], options: InteriorPlanOptions): string {
  const hash = createHash('sha1');
  for (const seed of SEEDS) {
    const rng = new Rng(seed);
    hash.update(JSON.stringify(planInterior(footprint, rng, options)));
    hash.update(String(rng.next()));
  }
  return hash.digest('hex');
}

const EXPECTED: Record<string, string> = {
  'rect 256x256 / default': '57764a06fb8e9f427a0fd19011c3c4f5ca30bcdd',
  'rect 256x256 / wideDoors': '1b94049a74b7b94b4e0a2c3a4e89108fb6088522',
  'rect 256x256 / cut 160': 'badcb0ff3088c611188500e33c6745c486e38def',
  'rect 256x256 / two storeys': '57764a06fb8e9f427a0fd19011c3c4f5ca30bcdd',
  'rect 256x256 / two storeys, wide doors': '1b94049a74b7b94b4e0a2c3a4e89108fb6088522',
  'rect 256x256 / workshop': 'edf83b65ccb77d6d2d3672f38f4f25785e409782',
  'rect 256x256 / entrance edge 2, no porch': '206b0c9287fd26ba2d040df22fe4e461f517f323',
  'rect 256x256 / neighbour on the low y side': '9389e5db15809226b57aec627c31e4aba517a9e0',
  'rect 256x256 / neighbours all round': '57764a06fb8e9f427a0fd19011c3c4f5ca30bcdd',
  'rect 384x256 / default': 'f6e5220d6b5e9b137643e3de4a55eca0e3280b26',
  'rect 384x256 / wideDoors': 'b295644eb4b43ba1050324d0cdeef15a01416d3b',
  'rect 384x256 / cut 160': '9d8500c0c241a32d8187de443736ba30cf25fc19',
  'rect 384x256 / two storeys': 'f6e5220d6b5e9b137643e3de4a55eca0e3280b26',
  'rect 384x256 / two storeys, wide doors': 'b295644eb4b43ba1050324d0cdeef15a01416d3b',
  'rect 384x256 / workshop': 'e6cc82ad34ca7850a5b88bab07352041bcf79ec4',
  'rect 384x256 / entrance edge 2, no porch': '75c35136a9e1cdbaa9bbf4a500e55f71543c8d85',
  'rect 384x256 / neighbour on the low y side': '5e65f3d8f8e21f02fef269096617b6482a117469',
  'rect 384x256 / neighbours all round': 'f6e5220d6b5e9b137643e3de4a55eca0e3280b26',
  'rect 512x384 / default': 'ee73f3b2507804874ad88c9fa15359512bd66b3d',
  'rect 512x384 / wideDoors': 'd929ac767b3d07869df7bf935b2582a85ff72861',
  'rect 512x384 / cut 160': 'b809fefe768929f323e58c3243031c9dc484e0b6',
  'rect 512x384 / two storeys': '08fbc4a7d2083ebab1bfa7e69b1e216c99736e2f',
  'rect 512x384 / two storeys, wide doors': '9dd55096009ea3820b47e643d7e67f8d67b44937',
  'rect 512x384 / workshop': 'e88f5b80dc6dd51b9e7b4720f35f39b17701bd6b',
  'rect 512x384 / entrance edge 2, no porch': 'c1ab7487bf69941ea4a3998be63bcd7be4ae6925',
  'rect 512x384 / neighbour on the low y side': 'd5b82f03647768930cedb7dd453f7eea39dd6837',
  'rect 512x384 / neighbours all round': 'ee73f3b2507804874ad88c9fa15359512bd66b3d',
  'rect 640x448 offset / default': 'f1f393bee3b46474928ec3bb4bff36bdbb9e8ded',
  'rect 640x448 offset / wideDoors': '1e0ce5cd7049993fda0fd62f0f452f58b56d2871',
  'rect 640x448 offset / cut 160': '4f9324ea9c491338f41529c895aae841249af272',
  'rect 640x448 offset / two storeys': 'eee84874100a3bf8dddf7910cabfbfe0e155ad76',
  'rect 640x448 offset / two storeys, wide doors': 'bf893fedb6d2aeb5c210529832b6df5d884fee91',
  'rect 640x448 offset / workshop': '3966298b769dd702055ef34fb1df13341e8e3d0c',
  'rect 640x448 offset / entrance edge 2, no porch': '99fe48f86519812de7ac4ca3c6fd7b06f45f32c0',
  'rect 640x448 offset / neighbour on the low y side': 'f1f393bee3b46474928ec3bb4bff36bdbb9e8ded',
  'rect 640x448 offset / neighbours all round': 'f1f393bee3b46474928ec3bb4bff36bdbb9e8ded',
  'rect 320x576 / default': '13890e01d5fa61a7a7f18a41b2f2ac4c979594fe',
  'rect 320x576 / wideDoors': '392d1a9db17a2e10db381a1f5a2249c96552e709',
  'rect 320x576 / cut 160': 'a69600896ce098d4ed41a85de302f86d199de9da',
  'rect 320x576 / two storeys': '83cf677ab13f8b511ddd587f6ddc9f9800e9788a',
  'rect 320x576 / two storeys, wide doors': '02207deb08653f835400578d575792381113acb2',
  'rect 320x576 / workshop': '7a98ee67193c00d8c0699e8efd4bfaf42ce88626',
  'rect 320x576 / entrance edge 2, no porch': '4f1c787a7d89b9e1ce3d02437feae7f06d60c04f',
  'rect 320x576 / neighbour on the low y side': '07d6ce8953af34186065a76bfdcf36100bfae72b',
  'rect 320x576 / neighbours all round': '13890e01d5fa61a7a7f18a41b2f2ac4c979594fe',
  'narrow 192x640 / default': '6140f885cd71710276b270f10f14a2fac3ba6e51',
  'narrow 192x640 / wideDoors': 'a7035750b337d05f390b4a593bf3c3754e1d9ccc',
  'narrow 192x640 / cut 160': '96efa010c136229eec2c67bd55b702a76fdcfcaa',
  'narrow 192x640 / two storeys': '9f38e207981d2455c6168b6797473d716f4e10a4',
  'narrow 192x640 / two storeys, wide doors': 'a7035750b337d05f390b4a593bf3c3754e1d9ccc',
  'narrow 192x640 / workshop': 'a97175c6d080790d5f6db8754f00c88512e02fbb',
  'narrow 192x640 / entrance edge 2, no porch': '3fd15f4c6f6bf02fe1ba340815378f1d94bd36b8',
  'narrow 192x640 / neighbour on the low y side': '845462a6b7edd4b978c66ec0e5eafac10caf1350',
  'narrow 192x640 / neighbours all round': '6140f885cd71710276b270f10f14a2fac3ba6e51',
  'ell 512/256 / default': 'e0c2fd0efc8f058f62d027625225854956493151',
  'ell 512/256 / wideDoors': 'd9a51f5bcba417209038595e6d981a0d162aecaf',
  'ell 512/256 / cut 160': '68423dbc4c13409d0b725bdd4e8ed379812e8d95',
  'ell 512/256 / two storeys': 'e0c2fd0efc8f058f62d027625225854956493151',
  'ell 512/256 / two storeys, wide doors': 'd9a51f5bcba417209038595e6d981a0d162aecaf',
  'ell 512/256 / workshop': 'dcb9000145bf7b37ce0e709c352fecc0ba0e2ead',
  'ell 512/256 / entrance edge 2, no porch': '8ebe54de2d16c38ee83289b912af819a2deea950',
  'ell 512/256 / neighbour on the low y side': 'dc8abec92246ab5ae21f9ee1179aeb5c4aa2f7f3',
  'ell 512/256 / neighbours all round': 'e0c2fd0efc8f058f62d027625225854956493151',
  'ell 640/384 (wings with stairs) / default': 'f9e63a99223a6d82173fcd6b514d45f727b127e0',
  'ell 640/384 (wings with stairs) / wideDoors': 'b515dc76edb4ae34bd4abb485e4d093e575b7baa',
  'ell 640/384 (wings with stairs) / cut 160': '873d33fafd66b1297675099d82b2adecf1425864',
  'ell 640/384 (wings with stairs) / two storeys': '7c3092dc923897af68d811eee91356436d59781e',
  'ell 640/384 (wings with stairs) / two storeys, wide doors': 'bbcdcbc43f6aeaf1af5e73e77c4752686fc647f4',
  'ell 640/384 (wings with stairs) / workshop': '3111c28dccb188232f17d7fc100f313800f8a9c2',
  'ell 640/384 (wings with stairs) / entrance edge 2, no porch': 'b309050ea52805843acdaf0e19b565b509f264c7',
  'ell 640/384 (wings with stairs) / neighbour on the low y side': 'bd827af8f9550cac72f8ecc8f862ad1a3a9d231c',
  'ell 640/384 (wings with stairs) / neighbours all round': 'f9e63a99223a6d82173fcd6b514d45f727b127e0',
};

describe('planInterior gives the same output as before the refactor', () => {
  for (const [footprintName, footprint] of Object.entries(FOOTPRINTS)) {
    for (const [optionsName, options] of Object.entries(OPTIONS)) {
      const name = `${footprintName} / ${optionsName}`;
      it(name, () => expect(hashCase(footprint, options)).toBe(EXPECTED[name]));
    }
  }
});
