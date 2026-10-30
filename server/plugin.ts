import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, type EditorConfig } from './config.ts';
import { AssetFS } from './assets.ts';
import { loadFgd, type FgdClass } from './fgd.ts';
import { compileMap, launchGame, safeMapName } from './compile.ts';

export interface MapLocation {
  id: string;
  name: string;
  dir: string;
}

/** Folders VMFs are listed from: the repo's `maps/` and each game root's `mapsrc/`. */
export function mapFolders(cfg: EditorConfig): { prefix: string; dir: string }[] {
  const out = [{ prefix: 'repo', dir: join(cfg.rootDir, 'maps') }, { prefix: 'autosave', dir: join(cfg.rootDir, '.autosave') }];
  cfg.gameDirs.forEach((g, i) => out.push({ prefix: `game${i}`, dir: join(g, cfg.mod, 'mapsrc') }));
  return out.filter((f) => existsSync(f.dir));
}

export function resolveMap(cfg: EditorConfig, id: string): string | null {
  const [prefix, name] = id.split(':');
  if (!name || /[\\/]|\.\./.test(name) || !name.toLowerCase().endsWith('.vmf')) return null;
  const folder = mapFolders(cfg).find((f) => f.prefix === prefix);
  return folder ? join(folder.dir, name) : null;
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'application/json') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;

export function editorServer(extraRoutes: (ctx: { cfg: EditorConfig; assets: AssetFS }) => Record<string, Route> = () => ({})): Plugin {
  return {
    name: 'simple-hammer-editor-server',
    configureServer(server) {
      const cfg = loadConfig(server.config.root);
      const t0 = Date.now();
      const assets = new AssetFS(cfg);
      console.log(`[assets] ${assets.sources.length} sources indexed in ${Date.now() - t0} ms`);
      const listCache = new Map<string, string[]>();
      let fgd: FgdClass[] | null = null;
      let compiling = false;

      const routes: Record<string, Route> = {
        '/api/config': (_req, res) =>
          send(res, 200, JSON.stringify({ gameDirs: cfg.gameDirs, sdkBinDir: cfg.sdkBinDir, runGameDir: cfg.runGameDir, mod: cfg.mod })),

        '/api/file': (_req, res, url) => {
          const path = url.searchParams.get('path') ?? '';
          const data = assets.read(path);
          if (!data) return send(res, 404, JSON.stringify({ error: 'not found', path }));
          send(res, 200, data, 'application/octet-stream');
        },

        '/api/list': (_req, res, url) => {
          const folder = url.searchParams.get('folder') ?? '';
          const ext = url.searchParams.get('ext') ?? '';
          const key = folder + '|' + ext;
          if (!listCache.has(key)) listCache.set(key, assets.list(folder, ext));
          send(res, 200, JSON.stringify(listCache.get(key)));
        },

        '/api/fgd': (_req, res) => {
          if (!fgd) {
            const file = cfg.gameDirs.map((g) => join(g, cfg.mod, `${cfg.mod}.fgd`)).find((p) => existsSync(p));
            fgd = file ? [...loadFgd(file, cfg.sdkBinDir ? [cfg.sdkBinDir] : []).values()] : [];
          }
          send(res, 200, JSON.stringify(fgd));
        },

        '/api/maps': (_req, res) => {
          const maps: MapLocation[] = [];
          for (const f of mapFolders(cfg)) {
            for (const n of readdirSync(f.dir)) {
              if (n.toLowerCase().endsWith('.vmf')) maps.push({ id: `${f.prefix}:${n}`, name: n, dir: f.dir });
            }
          }
          send(res, 200, JSON.stringify(maps));
        },

        '/api/map': (_req, res, url) => {
          const file = resolveMap(cfg, url.searchParams.get('id') ?? '');
          if (!file || !existsSync(file)) return send(res, 404, JSON.stringify({ error: 'map not found' }));
          send(res, 200, readFileSync(file), 'text/plain; charset=utf-8');
        },

        // Autosaves of unsaved work, listed in the map picker under "Autosaves".
        '/api/autosave': async (req, res, url) => {
          if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST only' }));
          const name = (url.searchParams.get('name') ?? '').trim();
          if (!/^[\w\- .]+\.vmf$/i.test(name)) return send(res, 400, JSON.stringify({ error: 'invalid file name' }));
          const dir = join(cfg.rootDir, '.autosave');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, name), await readBody(req));
          send(res, 200, JSON.stringify({ id: `autosave:${name}` }));
        },

        // Saves always go to this repo's maps/ folder, so editing a game map never overwrites the game's copy.
        '/api/map/save': async (req, res, url) => {
          if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST only' }));
          const name = (url.searchParams.get('name') ?? '').trim();
          if (!/^[\w\- .]+\.vmf$/i.test(name) || name.includes('..')) return send(res, 400, JSON.stringify({ error: 'invalid file name' }));
          const body = await readBody(req);
          const dir = join(cfg.rootDir, 'maps');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, name), body);
          send(res, 200, JSON.stringify({ id: `repo:${name}`, bytes: body.length }));
        },

        // Streams progress as newline-delimited JSON: {"kind":"step"|"out"|"warn"|"error"|"done","text":...}
        '/api/compile': async (req, res, url) => {
          if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST only' }));
          if (compiling) return send(res, 409, JSON.stringify({ error: 'A compile is already running' }));
          compiling = true;
          const name = safeMapName(url.searchParams.get('name') ?? 'untitled');
          const vmf = (await readBody(req)).toString('latin1');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/x-ndjson');
          res.setHeader('Cache-Control', 'no-store');
          const write = (kind: string, text: string) => res.write(JSON.stringify({ kind, text }) + '\n');
          write('step', `Compiling ${name} against ${cfg.runGameDir}`);
          try {
            const r = await compileMap(cfg, name, vmf, {
              quality: url.searchParams.get('quality') === 'final' ? 'final' : 'fast',
              navmesh: url.searchParams.get('navmesh') !== '0',
            }, write);
            res.end(JSON.stringify({ kind: 'result', text: JSON.stringify({ ...r, name }) }) + '\n');
          } finally {
            compiling = false;
          }
        },

        // Mission list entry (maps/<name>.res) next to the compiled map.
        '/api/mapres': async (req, res, url) => {
          if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST only' }));
          const name = safeMapName(url.searchParams.get('name') ?? '');
          const mod = cfg.runGameDir ? join(cfg.runGameDir, cfg.mod, 'maps') : null;
          if (!mod) return send(res, 500, JSON.stringify({ error: 'no game folder' }));
          mkdirSync(mod, { recursive: true });
          writeFileSync(join(mod, `${name}.res`), await readBody(req));
          send(res, 200, JSON.stringify({ name }));
        },

        '/api/launch': (req, res, url) => {
          if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST only' }));
          const name = safeMapName(url.searchParams.get('name') ?? '');
          send(res, launchGame(cfg, name) ? 200 : 500, JSON.stringify({ name }));
        },

        ...extraRoutes({ cfg, assets }),
      };

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const route = routes[url.pathname];
        if (!route) return next();
        try {
          await route(req, res, url);
        } catch (e) {
          console.error(e);
          send(res, 500, JSON.stringify({ error: (e as Error).message }));
        }
      });
    },
  };
}

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export { send };
