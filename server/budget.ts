import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EditorConfig } from './config.ts';
import { run, type Log } from './compile.ts';

/**
 * How full a map is by vbsp's own count. vbspinfo prints the table of a BSP's limits (vbsp alone takes seconds); the one
 * a big generated city runs out of first is `waterindices`, which (despite the name) holds the triangles vbsp
 * makes when it fixes t-junctions: a corner of one face lying on another face's edge. When that buffer
 * overflows vbsp stops right away ("Too many t-junctions to fix up!") and only says how far it got.
 */

export interface VbspBudget {
  ok: boolean;
  /** Triangle indices used by t-junction fixing, and the limit (65536). On overflow, where vbsp stopped. */
  tjunctions: { indices: number; max: number; overflow: boolean } | null;
  /** Every row of vbsp's limits table: name → [used, max]. Empty when vbsp didn't get that far. */
  limits: Record<string, [number, number]>;
  seconds: number;
}

/** vbsp's limits table ("brushes  4626/8192  55512/98304  (56.5%)"): name → [used, max] of the object counts. */
export function parseLimits(text: string): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const m of text.matchAll(/^([A-Za-z][A-Za-z_ ]*?)\s+(\d+)\/(\d+)\s+\d+\/\d+\s+\(/gm)) out[m[1].trim()] = [Number(m[2]), Number(m[3])];
  return out;
}

/** The t-junction count from vbsp's output: the table row, or the overflow message. */
export function parseTjunctions(text: string): VbspBudget['tjunctions'] {
  const over = text.match(/Too many t-junctions to fix up!.*?::\s*(\d+) indices, max (\d+)/);
  if (over) return { indices: Number(over[1]), max: Number(over[2]), overflow: true };
  const row = parseLimits(text).waterindices;
  return row ? { indices: row[0], max: row[1], overflow: false } : null;
}

/**
 * Runs vbsp alone on `vmfPath` (in its own folder `work`, so several can run at once) and reads its count. The
 * caller stages editor content first (see stageContent), once for all runs.
 */
export async function vbspBudget(cfg: EditorConfig, mod: string, vmfPath: string, work: string, log: Log = () => {}): Promise<VbspBudget> {
  const t0 = Date.now();
  mkdirSync(work, { recursive: true });
  // vbsp appends to its log: start a fresh one, or an earlier run's table would be read.
  const logFile = vmfPath.replace(/\.vmf$/i, '.log');
  rmSync(logFile, { force: true });
  rmSync(vmfPath.replace(/\.vmf$/i, '.bsp'), { force: true });
  let text = '';
  await run(join(cfg.sdkBinDir!, 'vbsp.exe'), ['-game', mod, vmfPath], work, log, (l) => { text += `${l}\n`; });
  // vbsp also writes its log next to the map; it holds the overflow message even if the console output was cut short.
  if (existsSync(logFile)) text += readFileSync(logFile, 'latin1');
  // vbsp alone doesn't print the limits table (vrad does); vbspinfo prints it for the BSP vbsp wrote.
  const bsp = vmfPath.replace(/\.vmf$/i, '.bsp');
  if (existsSync(bsp) && !/Too many t-junctions/.test(text)) {
    await run(join(cfg.sdkBinDir!, 'vbspinfo.exe'), [bsp], work, () => {}, (l) => { text += `${l}\n`; });
  }
  const tjunctions = parseTjunctions(text);
  return { ok: !!tjunctions && !tjunctions.overflow, tjunctions, limits: parseLimits(text), seconds: Math.round((Date.now() - t0) / 1000) };
}

/** Writes a variant's VMF into its own folder under `root` and returns its path. */
export function writeVariant(root: string, variant: string, name: string, vmf: string): string {
  const dir = join(root, variant);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.vmf`);
  writeFileSync(path, vmf, 'latin1');
  return path;
}
