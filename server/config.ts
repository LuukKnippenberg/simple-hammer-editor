import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface EditorConfig {
  /** Game install roots, searched in order (loose files of a dev clone first, then a Steam install with VPKs). */
  gameDirs: string[];
  mod: string;
  /** Sub-folders of each game root, in GameInfo.txt search order. */
  searchDirs: string[];
  /** Folder holding vbsp.exe / vvis.exe / vrad.exe (Alien Swarm SDK). */
  sdkBinDir: string | null;
  /** Game root that compiled maps are copied to and launched from. */
  runGameDir: string | null;
  /** Folder of this project. */
  rootDir: string;
}

const STEAM_COMMON = [
  'C:/Program Files (x86)/Steam/steamapps/common',
  'D:/SteamLibrary/steamapps/common',
  'E:/SteamLibrary/steamapps/common',
  'G:/SteamLibrary/steamapps/common',
];

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => existsSync(p)) ?? null;
}

export function loadConfig(rootDir: string): EditorConfig {
  const file = join(rootDir, 'editor.config.json');
  const user: Partial<EditorConfig> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};

  const gameDirs =
    user.gameDirs ??
    STEAM_COMMON.flatMap((c) => [join(c, 'lambdawars-game'), join(c, 'Lambda Wars')]).filter((d) =>
      existsSync(join(d, 'lambdawars')),
    );
  const sdkBinDir =
    user.sdkBinDir ?? firstExisting(STEAM_COMMON.map((c) => join(c, 'Alien Swarm', 'bin')).filter((d) => existsSync(join(d, 'vbsp.exe'))));
  // Compile against and run from a full install (with its VPKs), not a loose-file dev clone.
  const runGameDir =
    user.runGameDir ??
    gameDirs.find((d) => existsSync(join(d, 'lambdawars.exe')) && existsSync(join(d, 'lambdawars', 'pak01_dir.vpk'))) ??
    gameDirs.find((d) => existsSync(join(d, 'lambdawars.exe'))) ??
    null;

  return {
    gameDirs: gameDirs.map((d) => resolve(d)),
    mod: user.mod ?? 'lambdawars',
    searchDirs: user.searchDirs ?? ['lambdawars', 'swarm', 'swarm_base', 'platform'],
    sdkBinDir,
    runGameDir,
    rootDir,
  };
}
