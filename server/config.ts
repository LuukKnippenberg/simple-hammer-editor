import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseKeyValues } from '../src/vmf/keyvalues.ts';

/** A Lambda Wars game root (the folder with lambdawars.exe and lambdawars/). */
export interface Install {
  name: string;
  dir: string;
  /** Has the packed content (pak01_dir.vpk); a dev clone only has loose files. */
  hasVpks: boolean;
}

export interface EditorConfig {
  /** Every install found or listed, in a stable order (map ids refer to them by index). */
  installs: Install[];
  /** The install maps are compiled against, copied to and launched from. */
  install: string | null;
  /** Game roots searched for assets: the active install first, then the others as a fallback. */
  gameDirs: string[];
  mod: string;
  /** Sub-folders of each game root, in GameInfo.txt search order. */
  searchDirs: string[];
  /** Folder holding vbsp.exe / vvis.exe / vrad.exe (Alien Swarm SDK). */
  sdkBinDir: string | null;
  /** Same as `install`; kept under its old name for the compile code. */
  runGameDir: string | null;
  /** Folder of this project. */
  rootDir: string;
}

interface UserConfig {
  /** Extra installs: a path, or { name, dir }. */
  installs?: (string | { name?: string; dir: string })[];
  /** The active install (set from the editor's install picker). */
  install?: string;
  gameDirs?: string[];
  mod?: string;
  searchDirs?: string[];
  sdkBinDir?: string;
  /** Older name for `install`. */
  runGameDir?: string;
}

/** Library folders Steam usually makes, for when its own list (libraryfolders.vdf) can't be read. */
const STEAM_COMMON_FALLBACK = [
  'C:/Program Files (x86)/Steam/steamapps/common',
  'D:/SteamLibrary/steamapps/common',
  'E:/SteamLibrary/steamapps/common',
  'G:/SteamLibrary/steamapps/common',
];

/** Steam's install folder, from the registry (Steam writes it on every start). */
function steamRoot(): string | null {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return /SteamPath\s+REG_SZ\s+(.+)/.exec(out)?.[1].trim() ?? null;
  } catch {
    return null;
  }
}

/** The library folders a libraryfolders.vdf lists: new format `"0" { "path" "…" }`, old one `"1" "…"`. */
export function libraryFolders(vdf: string): string[] {
  return parseKeyValues(vdf)
    .flatMap((top) => [...top.children.map((c) => c.get('path')), ...top.props.filter(([k]) => /^\d+$/.test(k)).map(([, v]) => v)])
    .filter((p): p is string => !!p)
    .map((p) => p.replace(/\\\\/g, '\\'));
}

let steamCommon: string[] | null = null;

/** Every Steam library's `steamapps/common`, then the usual folders. Read once: libraries rarely change while the editor runs. */
function steamLibraries(): string[] {
  if (steamCommon) return steamCommon;
  const libs: string[] = [];
  for (const root of [steamRoot(), 'C:/Program Files (x86)/Steam', 'C:/Program Files/Steam']) {
    const vdf = root && join(root, 'steamapps', 'libraryfolders.vdf');
    if (vdf && existsSync(vdf)) libs.push(...libraryFolders(readFileSync(vdf, 'utf8')).map((p) => join(p, 'steamapps', 'common')));
  }
  const seen = new Set<string>();
  steamCommon = [...libs, ...STEAM_COMMON_FALLBACK].filter((d) => {
    const k = resolve(d).toLowerCase();
    return !seen.has(k) && (seen.add(k), true);
  });
  return steamCommon;
}

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => existsSync(p)) ?? null;
}

const configFile = (rootDir: string) => join(rootDir, 'editor.config.json');

function readUserConfig(rootDir: string): UserConfig {
  const file = configFile(rootDir);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${(e as Error).message}). Fix it, or delete it to use the installs found automatically.`);
  }
}

const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

function describe(dir: string, name?: string): Install {
  const hasVpks = existsSync(join(dir, 'lambdawars', 'pak01_dir.vpk'));
  return { name: name ?? `${basename(dir)}${hasVpks ? '' : ' (dev)'}`, dir: resolve(dir), hasVpks };
}

export function loadConfig(rootDir: string): EditorConfig {
  const user = readUserConfig(rootDir);
  const mod = user.mod ?? 'lambdawars';

  const installs: Install[] = [];
  const add = (dir: string, name?: string) => {
    if (existsSync(join(dir, mod)) && !installs.some((i) => samePath(i.dir, dir))) installs.push(describe(dir, name));
  };
  for (const i of user.installs ?? []) typeof i === 'string' ? add(i) : add(i.dir, i.name);
  for (const d of user.gameDirs ?? []) add(d);
  // Found folders need the exe too: an uninstalled game leaves lambdawars/ (cfg, cache) behind.
  for (const c of steamLibraries()) {
    for (const n of ['lambdawars-game', 'Lambda Wars']) if (existsSync(join(c, n, 'lambdawars.exe'))) add(join(c, n));
  }

  const runnable = installs.filter((i) => existsSync(join(i.dir, 'lambdawars.exe')));
  const chosen = user.install ?? user.runGameDir;
  // By default compile against and run from a full install (with its VPKs), not a loose-file dev clone.
  const install =
    (chosen && installs.find((i) => samePath(i.dir, chosen))?.dir) ??
    runnable.find((i) => i.hasVpks)?.dir ??
    runnable[0]?.dir ??
    null;

  const dirs = user.gameDirs?.map((d) => resolve(d)) ?? installs.map((i) => i.dir);
  const gameDirs = install ? [install, ...dirs.filter((d) => !samePath(d, install))] : dirs;
  const sdkBinDir =
    user.sdkBinDir ?? firstExisting(steamLibraries().map((c) => join(c, 'Alien Swarm', 'bin')).filter((d) => existsSync(join(d, 'vbsp.exe'))));

  return {
    installs,
    install,
    gameDirs,
    mod,
    searchDirs: user.searchDirs ?? ['lambdawars', 'swarm', 'swarm_base', 'platform'],
    sdkBinDir,
    runGameDir: install,
    rootDir,
  };
}

/** Stores the active install in editor.config.json, keeping the file's other settings. */
export function saveInstall(rootDir: string, dir: string): void {
  const user = readUserConfig(rootDir);
  user.install = dir.replace(/\\/g, '/');
  delete user.runGameDir;
  writeUserConfig(rootDir, user);
}

/** Stores the compile tools' folder (from the start screen's "Locate folder…"), keeping the file's other settings. */
export function saveSdkBinDir(rootDir: string, dir: string): void {
  writeUserConfig(rootDir, { ...readUserConfig(rootDir), sdkBinDir: dir.replace(/\\/g, '/') });
}

function writeUserConfig(rootDir: string, user: UserConfig): void {
  writeFileSync(configFile(rootDir), JSON.stringify(user, null, 2) + '\n');
}
