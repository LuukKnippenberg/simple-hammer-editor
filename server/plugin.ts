import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, saveInstall, type EditorConfig } from './config.ts';
import { AssetFS, contentDir, insideGame } from './assets.ts';
import { loadFgd, type FgdClass } from './fgd.ts';
import { modelIndex, type ModelEntry } from './models.ts';
import { compileMap, launchGame, safeMapName } from './compile.ts';
import { BLEND_FOLDER, blendVmt, safeBlendName, type BlendDef } from '../src/edit/multiblend.ts';
import { API_HEADER } from '../src/api.ts';

export interface MapLocation {
  id: string;
  name: string;
  dir: string;
}

/** Folders VMFs are listed from: the repo's `maps/` and each game root's `mapsrc/`. */
export function mapFolders(cfg: EditorConfig): { prefix: string; dir: string }[] {
  const out = [{ prefix: 'repo', dir: join(cfg.rootDir, 'maps') }, { prefix: 'autosave', dir: join(cfg.rootDir, '.autosave') }];
  cfg.installs.forEach((g, i) => out.push({ prefix: `game${i}`, dir: join(g.dir, cfg.mod, 'mapsrc') }));
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

const LIST_CACHE_SIZE = 64;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Why a request has to be refused, or null. The editor's routes write maps, run the compile tools and start the
 * game, so other web pages must not reach them (CSRF). Browsers send `Origin` on every cross-origin request, and it
 * has to be this server exactly: Vite's CORS default trusts every localhost port. Writes also need the API header,
 * which a page on another origin can only add through a preflight. Requests without `Origin` (curl, Node) come from
 * local processes and pass.
 */
export function refuseReason(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let u: URL | null = null;
    try { u = new URL(origin); } catch { /* "null" (sandboxed frames, file://) or malformed */ }
    if (!u || !LOCAL_HOSTS.has(u.hostname) || u.host !== req.headers.host) return `requests from ${origin} are not allowed`;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers[API_HEADER.toLowerCase()] !== '1') return `${API_HEADER} header missing`;
  return null;
}

export function editorServer(extraRoutes: (ctx: { cfg: EditorConfig; assets: AssetFS }) => Record<string, Route> = () => ({})): Plugin {
  return {
    name: 'simple-hammer-editor-server',
    configureServer(server) {
      let cfg!: EditorConfig;
      let assets!: AssetFS;
      const listCache = new Map<string, string[]>();
      let fgd: FgdClass[] | null = null;
      let models: ModelEntry[] | null = null;
      let compiling = false;
      const load = () => {
        cfg = loadConfig(server.config.root);
        const t0 = Date.now();
        assets = new AssetFS(cfg);
        listCache.clear();
        fgd = null;
        models = null;
        console.log(`[assets] install ${cfg.install}: ${assets.sources.length} sources indexed in ${Date.now() - t0} ms`);
      };
      load();

      const sidecar = (kind: string): Route => async (req, res, url) => {
        const ext = new RegExp(`^[\\w\\- .]+\\.${kind}\\.json$`, 'i');
        if (req.method === 'POST') {
          const name = (url.searchParams.get('name') ?? '').trim();
          if (!ext.test(name)) return send(res, 400, JSON.stringify({ error: 'invalid file name' }));
          const dir = join(cfg.rootDir, 'maps');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, name), await readBody(req));
          return send(res, 200, JSON.stringify({ name }));
        }
        const file = resolveMap(cfg, url.searchParams.get('id') ?? '');
        const side = file?.replace(/\.vmf$/i, `.${kind}.json`);
        if (!side || !existsSync(side)) return send(res, 404, JSON.stringify({ error: `no ${kind}` }));
        send(res, 200, readFileSync(side));
      };

      const routes: Record<string, Route> = {
        '/api/config': (_req, res) =>
          send(res, 200, JSON.stringify({
            installs: cfg.installs, install: cfg.install,
            gameDirs: cfg.gameDirs, sdkBinDir: cfg.sdkBinDir, runGameDir: cfg.runGameDir, mod: cfg.mod,
          })),

        // Switches the active install (assets, entity definitions, compile and launch) and remembers it.
        '/api/install': async (req, res) => {
          if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST only' }));
          if (compiling) return send(res, 409, JSON.stringify({ error: 'Wait for the compile to finish' }));
          const { dir } = JSON.parse((await readBody(req)).toString('utf8')) as { dir?: string };
          const target = cfg.installs.find((i) => i.dir === dir);
          if (!target) return send(res, 400, JSON.stringify({ error: 'unknown install' }));
          saveInstall(cfg.rootDir, target.dir);
          load();
          send(res, 200, JSON.stringify({ install: cfg.install }));
        },

        '/api/file': (_req, res, url) => {
          const path = url.searchParams.get('path') ?? '';
          const data = assets.read(path);
          if (!data) return send(res, 404, JSON.stringify({ error: 'not found', path }));
          send(res, 200, data, 'application/octet-stream');
        },

        '/api/list': (_req, res, url) => {
          const folder = url.searchParams.get('folder') ?? '';
          const ext = url.searchParams.get('ext') ?? '';
          if (!insideGame(folder.replace(/^[\\/]+/, ''))) return send(res, 400, JSON.stringify({ error: 'invalid folder' }));
          const key = folder + '|' + ext;
          if (!listCache.has(key)) {
            // The editor asks for a handful of folders; drop the oldest listing past that.
            if (listCache.size >= LIST_CACHE_SIZE) listCache.delete(listCache.keys().next().value!);
            listCache.set(key, assets.list(folder, ext));
          }
          send(res, 200, JSON.stringify(listCache.get(key)));
        },

        '/api/fgd': (_req, res) => {
          if (!fgd) {
            const file = cfg.gameDirs.map((g) => join(g, cfg.mod, `${cfg.mod}.fgd`)).find((p) => existsSync(p));
            fgd = file ? [...loadFgd(file, cfg.sdkBinDir ? [cfg.sdkBinDir] : []).values()] : [];
          }
          send(res, 200, JSON.stringify(fgd));
        },

        '/api/models': (_req, res) => {
          if (!models) {
            const t0 = Date.now();
            models = modelIndex(assets);
            console.log(`[assets] ${models.length} models indexed in ${Date.now() - t0} ms`);
          }
          send(res, 200, JSON.stringify(models));
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

        // Files saved next to maps in maps/: the 2D sketch (<map>.sketch.json) and the mission flowchart (<map>.mission.json).
        '/api/sketch': sidecar('sketch'),
        '/api/mission': sidecar('mission'),

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

        // Saves a MultiBlend material made in the editor to content/materials/she/blend/<name>.vmt.
        '/api/blend': async (req, res) => {
          if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST only' }));
          const def = JSON.parse((await readBody(req)).toString('utf8')) as BlendDef;
          if (!def?.layers?.length || def.layers.length > 4 || def.layers.some((l) => !l.texture || /["{}]/.test(l.texture))) {
            return send(res, 400, JSON.stringify({ error: 'A blend needs 1 to 4 layers with textures' }));
          }
          const name = safeBlendName(def.name);
          const rel = `materials/${BLEND_FOLDER}/${name}.vmt`;
          const file = join(contentDir(cfg), rel);
          mkdirSync(join(file, '..'), { recursive: true });
          writeFileSync(file, blendVmt({ ...def, name }));
          assets.forget(rel);
          listCache.clear();
          send(res, 200, JSON.stringify({ material: `${BLEND_FOLDER}/${name}`.toUpperCase() }));
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

        ...extraRoutes({ get cfg() { return cfg; }, get assets() { return assets; } }),
      };

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const route = routes[url.pathname];
        if (!route) return next();
        const refused = refuseReason(req);
        if (refused) return send(res, 403, JSON.stringify({ error: refused }));
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
