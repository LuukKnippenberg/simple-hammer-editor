import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, type EditorConfig } from './config.ts';
import { AssetFS } from './assets.ts';

export interface MapLocation {
  id: string;
  name: string;
  dir: string;
}

/** Folders VMFs are listed from: the repo's `maps/` and each game root's `mapsrc/`. */
export function mapFolders(cfg: EditorConfig): { prefix: string; dir: string }[] {
  const out = [{ prefix: 'repo', dir: join(cfg.rootDir, 'maps') }];
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
