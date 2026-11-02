// Characterization test for the KISS refactor (research/editor-kiss-plan.md). Delete after K10.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VmfDocument } from '../src/vmf/map.ts';
import { writeKeyValues } from '../src/vmf/keyvalues.ts';
import { DEFAULT_STAIRS, RAIL_STYLES, STRUCTURES, buildStairs, type StairsOptions, type StairsSpec } from '../src/gen/stairs.ts';

function spec(nodes: [number, number, number][], flights: [number, number][], o: Partial<StairsOptions> = {}): StairsSpec {
  return { uid: 'test', nodes: nodes.map(([x, y, z]) => ({ x, y, z })), flights: flights.map(([from, to]) => ({ from, to })), options: { ...DEFAULT_STAIRS, ...o } };
}

/** The shapes in tests/stairs.test.ts. */
const shapes: Record<string, (o?: Partial<StairsOptions>) => StairsSpec> = {
  straight: (o = {}) => spec([[0, 0, 0], [336, 0, 192]], [[0, 1]], o),
  chain: (o = {}) => spec([[0, 0, 0], [256, 0, 96], [256, 320, 192]], [[0, 1], [1, 2]], o),
  tee: (o = {}) => spec([[0, 0, 0], [0, 256, 128], [-320, 256, 192], [320, 256, 192]], [[0, 1], [1, 2], [1, 3]], o),
};

/** Everything buildStairs returns, written out (each build numbers its brushes in a fresh document). */
function text(s: StairsSpec): string {
  const r = buildStairs(VmfDocument.empty(), s);
  return writeKeyValues(r.detail) + writeKeyValues(r.clip) + JSON.stringify({ flights: r.flights, landings: r.landings, bounds: r.bounds, base: r.base });
}
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

/** The combinations of the "every structure, profile, rail style and plan" test, one hash per shape and structure. */
const combos = Object.keys(shapes).flatMap((shape) => STRUCTURES.map(([structure]) => [shape, structure] as const));
function comboText(shape: string, structure: StairsOptions['structure']): string {
  let out = '';
  for (const [railStyle] of RAIL_STYLES) for (const profile of ['steps', 'ramp'] as const) for (const plan of ['blocky', 'angle'] as const) {
    for (const beams of ['none', 'both', 'under'] as const) out += text(shapes[shape]({ structure, railStyle, profile, plan, beams }));
  }
  return out;
}

/** Options and shapes the combinations leave out: one-sided and no rails, landings at the ends, no clip, overrides. */
const extras: Record<string, () => StairsSpec> = {
  railsLeft: () => shapes.chain({ rails: 'left' }),
  railsRight: () => shapes.chain({ rails: 'right', structure: 'open' }),
  railsNone: () => shapes.tee({ rails: 'none' }),
  endLandings: () => shapes.straight({ landingTop: 64, landingBottom: 48, structure: 'posts' }),
  endLandingsRamp: () => shapes.straight({ landingTop: 64, landingBottom: 48, profile: 'ramp', structure: 'sloped' }),
  noClip: () => shapes.chain({ clip: false }),
  down: () => spec([[0, 0, 128], [256, 0, 0]], [[0, 1]]),
  flat: () => spec([[0, 0, 0], [256, 0, 96], [256, 320, 96]], [[0, 1], [1, 2]]),
  steep: () => spec([[0, 0, 0], [96, 0, 192]], [[0, 1]]),
  angle: () => spec([[0, 0, 0], [300, 180, 160], [520, -60, 64]], [[0, 1], [1, 2]], { plan: 'angle' }),
  overrides: () => {
    const s = shapes.chain({ width: 160 });
    s.flights[0].steps = 9;
    s.flights[1].width = 224;
    return s;
  },
  cross: () => {
    const s = shapes.tee({ railStyle: 'parapet' });
    s.nodes.push({ x: 0, y: 576, z: 192 });
    s.flights.push({ from: 1, to: 4 });
    return s;
  },
  zeroLength: () => spec([[0, 0, 0], [0, 0, 64], [256, 0, 128]], [[0, 1], [1, 2]]),
};

const golden: Record<string, string> = {
  'straight solid': '5d24c63979cae87c1f8e6b46e7a918a874429d67',
  'straight sloped': '4bfad6c3621248602903b3a916ef7a776912a3c7',
  'straight open': '915dbe92912def65c6fc49e5705d14156915355a',
  'straight floating': 'bb22f3cb78163e47e8260588450addaba7f83bbc',
  'straight posts': '9414ea3684322474dda0955cd6c70ac1887dbc0c',
  'chain solid': '73c4a80737ec296f4dc45543b7a8ebb55032f67e',
  'chain sloped': '86203bf21c745a64029814732b645fde288e367a',
  'chain open': 'e31cac4a66b5298f52f5a5ab2fb85ab3077a8f57',
  'chain floating': 'e23d2a7b13fe20d697aff8d6b689e7bc2715248a',
  'chain posts': 'd30e97079385d31f72798d122c3c7ecd1f9ab8ce',
  'tee solid': 'fa5de0b1514898c5b06e6cfcdcb730db428c695b',
  'tee sloped': 'a7753107e0cfedbc645592486dafbd856326479d',
  'tee open': 'e348be2b535084915f03b92dbd9351057381766e',
  'tee floating': '4702064dac7d21d272f26484a746191b974acd80',
  'tee posts': 'e75a817317f1d01b12b5acca483d5bb34882d05a',
  railsLeft: '56fc07cdeb387b1d14b82b65e83945ba93bd88a2',
  railsRight: 'dc3a00391c0a5aff705a2e27988d74e06307bfa2',
  railsNone: '3de70830a7fefcf237315fed04e4c37c0518e139',
  endLandings: 'd33b7dd533fc06a1bc4a88a8a62774753b5cb9ab',
  endLandingsRamp: '9f258ec937d5c128aa24c52fd5c9714ed2550125',
  noClip: 'f7a22a50add050d12fd84ccc010b896afc1f415e',
  down: '9fdca4029ccc5d3eb7377d41adb356fc2b01bc17',
  flat: '74fd5021201e25c098e6a3a9b3f01f4d29ccd2bc',
  steep: 'bcbd91279c6e9e85496ae9fae0befc5ff3168243',
  angle: '1a6e7d90151458e59224be3f151138ff0b3bf3a1',
  overrides: 'db7a08a9108429f254078dd60576f6fbd743c7a1',
  cross: '051067410dc337854c1c5e0616ee4392a3c14ba0',
  zeroLength: '7028845ec97b55971373fb38b1a07a35a4f4a0ec',
};

describe('buildStairs keeps its output (characterization)', () => {
  it.each(combos)('%s, %s', (shape, structure) => {
    expect(sha1(comboText(shape, structure))).toBe(golden[`${shape} ${structure}`]);
  });
  it.each(Object.keys(extras))('%s', (name) => {
    expect(sha1(text(extras[name]()))).toBe(golden[name]);
  });
});
