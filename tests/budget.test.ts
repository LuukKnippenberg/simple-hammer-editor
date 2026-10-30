import { describe, expect, it } from 'vitest';
import { parseLimits, parseTjunctions } from '../server/budget.ts';

// Rows as vbsp prints them at the end of a run.
const TABLE = `Object names       Objects/Maxobjs  Memory / Maxmem  Fullness
------------       ---------------  ---------------  --------
brushes               4626/8192        55512/98304    (56.5%)
brushsides           34727/65536      277816/524288   (53.0%)
vertexes             46745/65536      560940/786432   (71.3%)
LDR worldlights          0/8192            0/819200   ( 0.0%)
waterstrips           3366/32768       33660/327680   (10.3%)
waterindices         64632/65536      129264/131072   (98.6%) VERY FULL!
LDR lightdata         [variable]           0/0        ( 0.0%)
`;

describe('vbsp budget', () => {
  it('reads the limits table, including names with spaces', () => {
    const l = parseLimits(TABLE);
    expect(l.brushes).toEqual([4626, 8192]);
    expect(l.vertexes).toEqual([46745, 65536]);
    expect(l['LDR worldlights']).toEqual([0, 8192]);
    expect(l.waterindices).toEqual([64632, 65536]);
    expect(l['LDR lightdata']).toBeUndefined();
  });

  it('takes the t-junction count from the table, or from the overflow message', () => {
    expect(parseTjunctions(TABLE)).toEqual({ indices: 64632, max: 65536, overflow: false });
    expect(parseTjunctions('FixTjuncs...\nToo many t-junctions to fix up! (3406 prims, max 32768 :: 65538 indices, max 65536)\n'))
      .toEqual({ indices: 65538, max: 65536, overflow: true });
    expect(parseTjunctions('vbsp crashed')).toBeNull();
  });
});
