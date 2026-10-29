import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { VpkArchive } from './vpk.ts';
import type { EditorConfig } from './config.ts';

type Source = { kind: 'dir'; root: string } | { kind: 'vpk'; vpk: VpkArchive };

/**
 * Resolves game-relative paths (`materials/brick/brick01.vtf`) against the same search order the
 * engine uses: for every search dir (lambdawars, swarm, ...) the loose files of each game root, then its VPKs.
 */
export class AssetFS {
  readonly sources: Source[] = [];
  private cache = new Map<string, Buffer | null>();

  constructor(cfg: EditorConfig) {
    for (const sub of cfg.searchDirs) {
      for (const game of cfg.gameDirs) {
        const dir = join(game, sub);
        if (!existsSync(dir)) continue;
        this.sources.push({ kind: 'dir', root: dir });
        for (const f of readdirSync(dir)) {
          if (/_dir\.vpk$/i.test(f)) {
            try {
              this.sources.push({ kind: 'vpk', vpk: new VpkArchive(join(dir, f)) });
            } catch (e) {
              console.warn(`[assets] skipping ${f}: ${(e as Error).message}`);
            }
          }
        }
      }
    }
  }

  read(path: string): Buffer | null {
    const key = path.toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
    if (key.includes('..')) return null;
    if (this.cache.has(key)) return this.cache.get(key)!;
    let data: Buffer | null = null;
    for (const s of this.sources) {
      if (s.kind === 'dir') {
        const p = join(s.root, key);
        if (existsSync(p) && statSync(p).isFile()) {
          data = readFileSync(p);
          break;
        }
      } else if (s.vpk.has(key)) {
        data = s.vpk.read(key);
        break;
      }
    }
    // Cache misses and small files only; big files are cheap to re-read and would bloat memory.
    if (!data || data.length < 4 * 1024 * 1024) this.cache.set(key, data);
    return data;
  }

  /** Lists files with an extension below a folder, merged over all sources (lowercase, deduplicated). */
  list(folder: string, ext: string): string[] {
    const out = new Set<string>();
    const pre = folder.toLowerCase().replace(/\/$/, '');
    for (const s of this.sources) {
      if (s.kind === 'vpk') {
        for (const p of s.vpk.list(pre, ext)) out.add(p);
      } else {
        const base = join(s.root, pre);
        if (!existsSync(base)) continue;
        const walk = (dir: string) => {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name.toLowerCase().endsWith(ext)) out.add(relative(s.root, full).replace(/\\/g, '/').toLowerCase());
          }
        };
        walk(base);
      }
    }
    return [...out].sort();
  }
}
