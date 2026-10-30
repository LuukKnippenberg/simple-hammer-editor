import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../server/config.ts';
import { loadFgd } from '../server/fgd.ts';

const cfg = loadConfig(process.cwd());
const fgdPath = cfg.gameDirs.map((g) => join(g, cfg.mod, 'lambdawars.fgd')).find((p) => existsSync(p));

describe.skipIf(!fgdPath)('FGD parser', () => {
  it('reads Lambda Wars entity classes with inherited keys', () => {
    const classes = loadFgd(fgdPath!, cfg.sdkBinDir ? [cfg.sdkBinDir] : []);
    const cp = classes.get('control_point')!;
    expect(cp.studio).toBe('models/pg_props/pg_obj/pg_flagpole.mdl');
    expect(cp.keys.find((k) => k.name === 'CaptureTime')?.default).toBe('15.0');
    const start = classes.get('info_start_wars')!;
    expect(start.keys.find((k) => k.name === 'groupname')?.choices?.length).toBe(5);
    expect(start.keys.some((k) => k.name === 'targetname')).toBe(true);
    expect(classes.get('prop_static')?.keys.some((k) => k.name === 'model')).toBe(true);
    expect(classes.size).toBeGreaterThan(300);
  });
});
