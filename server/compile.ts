import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EditorConfig } from './config.ts';
import { contentDir } from './assets.ts';

export interface CompileOptions {
  /** fast: vvis -fast, vrad -fast. final: full vvis, vrad -final. */
  quality: 'fast' | 'final';
  navmesh: boolean;
}

export interface CompileResult {
  ok: boolean;
  leaked: boolean;
  bsp?: string;
  seconds: number;
}

type Log = (kind: 'step' | 'out' | 'warn' | 'error' | 'done', text: string) => void;

/** Map names become file names in the game folder: keep them simple. */
export function safeMapName(name: string): string {
  return name.toLowerCase().replace(/\.vmf$/, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'untitled';
}

function run(exe: string, args: string[], cwd: string, log: Log, onLine?: (l: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(exe, args, { cwd, windowsHide: true });
    let buf = '';
    const feed = (d: Buffer) => {
      buf += d.toString('latin1');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) {
        if (!l.trim()) continue;
        log('out', l);
        onLine?.(l);
      }
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', (e) => {
      log('error', `${exe}: ${e.message}`);
      resolve(-1);
    });
    p.on('close', (code) => {
      if (buf.trim()) log('out', buf);
      resolve(code ?? -1);
    });
  });
}

/** The mod folder compiled against and installed into (needs the game's content, VPKs included). */
export function runModDir(cfg: EditorConfig): string | null {
  return cfg.runGameDir ? join(cfg.runGameDir, cfg.mod) : null;
}

/** Game-relative paths of the editor content (content/materials/...) that the VMF's brushes use. */
export function editorContent(cfg: EditorConfig, vmf: string): string[] {
  const out = new Set<string>();
  for (const m of vmf.matchAll(/"material"\s+"([^"]+)"/gi)) {
    const rel = `materials/${m[1].toLowerCase().replace(/\\/g, '/')}.vmt`;
    if (existsSync(join(contentDir(cfg), rel))) out.add(rel);
  }
  return [...out];
}

/**
 * Copies editor content into the mod folder for the compile tools. Returns what it created, files first and
 * then folders deepest first, so removing them in order leaves the game folder as it was.
 */
function stageContent(cfg: EditorConfig, files: string[], mod: string, log: Log): string[] {
  const created: string[] = [], dirs: string[] = [];
  for (const rel of files) {
    const dest = join(mod, rel);
    if (existsSync(dest)) {
      log('warn', `${rel} already exists in the game folder; compiling against that copy`);
      continue;
    }
    for (let d = dirname(dest); d.length > mod.length && !existsSync(d); d = dirname(d)) dirs.push(d);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(contentDir(cfg), rel), dest);
    created.push(dest);
  }
  return [...created, ...dirs.sort((a, b) => b.length - a.length)];
}

/** Packs editor content into the BSP's pakfile with bspzip, so the map works without the loose files. */
async function packContent(cfg: EditorConfig, mod: string, work: string, bspPath: string, files: string[], log: Log): Promise<boolean> {
  log('step', `bspzip: packing ${files.length} editor material${files.length > 1 ? 's' : ''} into the map`);
  const list = join(work, 'pack.txt');
  writeFileSync(list, files.map((rel) => `${rel}\n${join(contentDir(cfg), rel)}\n`).join(''));
  const packed = bspPath.replace(/\.bsp$/i, '.packed.bsp');
  rmSync(packed, { force: true });
  const code = await run(join(cfg.sdkBinDir!, 'bspzip.exe'), ['-addlist', bspPath, list, packed, '-game', mod], work, log);
  if (code !== 0 || !existsSync(packed)) {
    log('error', `bspzip failed (exit ${code})`);
    return false;
  }
  copyFileSync(packed, bspPath);
  rmSync(packed, { force: true });
  return true;
}

/**
 * VMF → BSP with the Alien Swarm SDK tools, then installs it into the game's maps/ folder and
 * optionally builds the Recast navmesh with a headless dedicated server.
 */
export async function compileMap(cfg: EditorConfig, name: string, vmf: string, opts: CompileOptions, log: Log): Promise<CompileResult> {
  const t0 = Date.now();
  const seconds = () => Math.round((Date.now() - t0) / 100) / 10;
  const mod = runModDir(cfg);
  if (!cfg.sdkBinDir || !existsSync(join(cfg.sdkBinDir, 'vbsp.exe'))) {
    log('error', 'vbsp.exe not found. Install the Alien Swarm SDK tools or set sdkBinDir in editor.config.json.');
    return { ok: false, leaked: false, seconds: seconds() };
  }
  if (!mod || !existsSync(mod)) {
    log('error', 'No game folder to compile against. Set runGameDir in editor.config.json.');
    return { ok: false, leaked: false, seconds: seconds() };
  }

  const work = join(cfg.rootDir, '.compile');
  mkdirSync(work, { recursive: true });
  const vmfPath = join(work, `${name}.vmf`);
  const bspPath = join(work, `${name}.bsp`);
  writeFileSync(vmfPath, vmf, 'latin1');
  rmSync(bspPath, { force: true });

  const bin = (t: string) => join(cfg.sdkBinDir!, t);
  let leaked = false;

  // Editor-made materials have to be visible to vbsp/vrad, then travel inside the BSP.
  const content = editorContent(cfg, vmf);
  const staged = stageContent(cfg, content, mod, log);
  try {
    log('step', 'vbsp: building geometry');
    let code = await run(bin('vbsp.exe'), ['-game', mod, vmfPath], work, log, (l) => {
      if (l.includes('**** leaked ****')) leaked = true;
    });
    if (code !== 0 || !existsSync(bspPath)) {
      log('error', `vbsp failed (exit ${code})`);
      return { ok: false, leaked, seconds: seconds() };
    }

    if (leaked) {
      log('warn', 'The map leaks (it is not sealed by world brushes). Skipping vvis; use "Add sky shell" in the compile checks.');
    } else {
      log('step', `vvis: visibility${opts.quality === 'fast' ? ' (fast)' : ''}`);
      code = await run(bin('vvis.exe'), [...(opts.quality === 'fast' ? ['-fast'] : []), '-game', mod, join(work, name)], work, log);
      if (code !== 0) log('warn', `vvis exited with ${code}`);
    }

    log('step', `vrad: lighting (HDR${opts.quality === 'fast' ? ', fast' : ', final'})`);
    code = await run(bin('vrad.exe'), ['-hdr', opts.quality === 'fast' ? '-fast' : '-final', '-game', mod, join(work, name)], work, log);
    if (code !== 0) {
      log('error', `vrad failed (exit ${code})`);
      return { ok: false, leaked, seconds: seconds() };
    }

    if (content.length && !(await packContent(cfg, mod, work, bspPath, content, log))) {
      return { ok: false, leaked, seconds: seconds() };
    }
  } finally {
    for (const f of staged) rmSync(f, { force: true, recursive: true });
  }

  // Install. Stale navmesh/heightmap files from an earlier version of the map would be wrong now.
  const maps = join(mod, 'maps');
  mkdirSync(maps, { recursive: true });
  copyFileSync(bspPath, join(maps, `${name}.bsp`));
  for (const stale of [`${name}.recast`, `${name}mapheightfielddata.bin`]) rmSync(join(maps, stale), { force: true });
  log('step', `Installed ${join(maps, `${name}.bsp`)} (${(statSync(bspPath).size / 1024 / 1024).toFixed(1)} MB)`);

  if (opts.navmesh) {
    const ok = await buildNavmesh(cfg, name, log);
    if (!ok) log('warn', 'Navmesh was not built; units will not be able to move on this map.');
  }
  log('done', `Finished in ${seconds()} s`);
  return { ok: true, leaked, bsp: join(maps, `${name}.bsp`), seconds: seconds() };
}

/**
 * Loads the map in a hidden dedicated server whose map config runs `recast_build`, then stops the
 * server once all five meshes are saved. srcds needs a real console, hence Start-Process.
 */
async function buildNavmesh(cfg: EditorConfig, name: string, log: Log): Promise<boolean> {
  const gameDir = cfg.runGameDir!;
  const mod = join(gameDir, cfg.mod);
  log('step', 'Navmesh: loading the map in a hidden dedicated server');
  const cfgFile = join(mod, 'cfg', 'she_navbuild.cfg');
  const consoleLog = join(mod, 'console.log');
  mkdirSync(join(mod, 'cfg'), { recursive: true });
  // Pruning the polygons unreachable from the player starts (info_start_wars) leaves this build's meshes
  // empty, so multiplayer maps would get no navmesh at all; keep every polygon instead.
  writeFileSync(cfgFile, 'sv_cheats 1\nrecast_build_remove_unreachable_polys 0\nrecast_build\n');
  rmSync(consoleLog, { force: true });

  const args = ['-console', '-condebug', '-game', cfg.mod, '-insecure', '-nomaster', '-nohltv', '+sv_lan', '1', '+maxplayers', '2', '+servercfgfile', 'she_navbuild.cfg', '+map', name]
    .map((a) => `'${a}'`).join(',');
  const ps = `$p = Start-Process -FilePath '${join(gameDir, 'srcds.exe')}' -WorkingDirectory '${gameDir}' -ArgumentList ${args} -WindowStyle Hidden -PassThru; $p.Id`;
  const pid = await new Promise<number>((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(parseInt(out.trim(), 10)));
  });
  if (!pid) {
    log('error', 'Could not start srcds.exe');
    return false;
  }

  const deadline = Date.now() + 5 * 60 * 1000;
  let shown = 0, saved = 0, ok = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (!existsSync(consoleLog)) continue;
    const lines = readFileSync(consoleLog, 'latin1').split(/\r?\n/);
    for (; shown < lines.length - 1; shown++) {
      const l = lines[shown];
      if (/Recast|Saving mesh|Host_NewGame|CFogOfWarMgr|error/i.test(l)) log('out', l);
      if (l.startsWith('Saving mesh')) saved++;
    }
    if (saved >= 5) { ok = true; break; }
  }
  try { process.kill(pid); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 500));
  rmSync(cfgFile, { force: true });
  rmSync(consoleLog, { force: true });
  const recast = join(mod, 'maps', `${name}.recast`);
  ok = ok && existsSync(recast);
  if (ok) log('step', `Navmesh saved (maps/${name}.recast, ${(statSync(recast).size / 1024).toFixed(0)} KB)`);
  else log('error', 'Timed out waiting for the navmesh build');
  return ok;
}

/** Starts the game on a map (windowed, so it can sit next to the editor). */
export function launchGame(cfg: EditorConfig, name: string): boolean {
  if (!cfg.runGameDir) return false;
  const exe = join(cfg.runGameDir, 'lambdawars.exe');
  if (!existsSync(exe)) return false;
  const extra: string[] = [];
  if (name.startsWith('sp_')) {
    // +map alone runs the sandbox gamerules; switch to the mission rules once the level is up.
    const cfgDir = join(cfg.runGameDir, cfg.mod, 'cfg');
    mkdirSync(cfgDir, { recursive: true });
    // Reset the config first: installing new gamerules runs the listen server config again.
    writeFileSync(join(cfgDir, 'she_mission.cfg'), 'lservercfgfile listenserver.cfg\nwars_setgamerules mission\n');
    extra.push('+sv_cheats', '1', '+lservercfgfile', 'she_mission.cfg');
  }
  const p = spawn(exe, ['-game', cfg.mod, '-windowed', '-noborder', '-w', '1600', '-h', '900', '-novid', '-dev', ...extra, '+map', name], {
    cwd: cfg.runGameDir, detached: true, stdio: 'ignore',
  });
  p.unref();
  return true;
}
