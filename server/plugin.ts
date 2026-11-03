import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig, saveInstall, saveSdkBinDir, type EditorConfig } from './config.ts';
import { diffSummary, diffVmf, heightThumb, mapMode, mtimeOf, newestFirst, recoverOffers, setupCheck, THUMB_H, THUMB_W, type MapFile } from './mapInfo.ts';
import { AssetFS, contentDir, insideGame } from './assets.ts';
import { loadFgd, type FgdClass } from './fgd.ts';
import { modelIndex, type ModelEntry } from './models.ts';
import { compileMap, launchGame, safeMapName } from './compile.ts';
import { BLEND_EDGES, BLEND_FOLDER, EDGE_SPECS, blendVmt, materialForBlend, safeBlendName, type BlendDef, type BlendEdge } from '../src/edit/multiblend.ts';
import { vtfHeaderHasAlpha } from '../src/assets/vtf.ts';
import { parseKeyValues } from '../src/vmf/keyvalues.ts';
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
  // A streaming route (compile) that fails half-way can only end its stream.
  if (res.headersSent) return void (res.writableEnded || res.end());
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export type Route = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;

const LIST_CACHE_SIZE = 64;
/** Maps listed under Recent on the start screen. */
const RECENT_MAX = 8;

interface MapDetails {
  mode: string;
  thumb: { w: number; h: number; cells: number[] };
}

const detailsCache = new Map<string, { mtime: number; details: MapDetails }>();

/** Mode and height thumbnail of a map file, read once per modification. */
function mapDetails(file: string, name: string, mtime: number): MapDetails {
  const hit = detailsCache.get(file);
  if (hit?.mtime === mtime) return hit.details;
  const text = readFileSync(file, 'latin1');
  const details = {
    mode: mapMode(name, text, existsSync(file.replace(/\.vmf$/i, '.mission.json'))),
    thumb: { w: THUMB_W, h: THUMB_H, cells: heightThumb(text) },
  };
  detailsCache.set(file, { mtime, details });
  return details;
}
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

/** Usable as a VMT value: no quotes, braces or control characters (a line break would add keys). */
export const safeTextureName = (t: unknown): boolean => typeof t === 'string' && t.length > 0 && !/["{}\x00-\x1f\x7f]/.test(t);

/** Where a blend made in the editor lives, relative to content/. */
const blendFile = (name: string) => `materials/${BLEND_FOLDER}/${name}.vmt`;

/** Blend layer sizes ($scaleN) the blender offers; the game's own blends use 0.4 to 4. */
export const BLEND_SCALE = { min: 0.25, max: 4 };

/**
 * A blend definition from a request body, checked and with a safe name, or why it can't be saved. Layers 1–3 may
 * carry an `edge` (crisp, medium or soft); the base can't. A `spec` on the blend (what scripts sent before edges
 * existed) may only name one of the softness maps an edge writes, and sets the edge of layers without one.
 */
export function blendFromBody(body: unknown): BlendDef | string {
  const def = body as Partial<BlendDef> & { spec?: unknown } | null;
  if (!def || typeof def !== 'object' || !Array.isArray(def.layers) || !def.layers.length || def.layers.length > 4) return 'A blend needs 1 to 4 layers';
  const specs = new Map(BLEND_EDGES.map((e) => [EDGE_SPECS[e], e] as const));
  if (def.spec !== undefined && def.spec !== null && (typeof def.spec !== 'string' || !specs.has(def.spec.toLowerCase()))) {
    return `Softness map ${String(def.spec)} isn't one of ${[...specs.keys()].filter(Boolean).join(', ')}`;
  }
  const fallback: BlendEdge = typeof def.spec === 'string' ? specs.get(def.spec.toLowerCase())! : def.spec === null ? 'crisp' : 'soft';
  const layers = [];
  for (const [i, l] of def.layers.entries()) {
    if (!l || !safeTextureName(l.texture)) return 'Every layer needs a texture';
    const scale = Number(l.scale ?? 1), rotation = Number(l.rotation ?? 0);
    if (!(scale >= BLEND_SCALE.min && scale <= BLEND_SCALE.max)) return `Size must be ${BLEND_SCALE.min} to ${BLEND_SCALE.max}`;
    if (!Number.isFinite(rotation) || Math.abs(rotation) > 360) return 'Rotation must be -360 to 360 degrees';
    if (i === 0 && l.edge !== undefined) return 'The base layer has no edge';
    if (l.edge !== undefined && !BLEND_EDGES.includes(l.edge)) return `Edge must be one of ${BLEND_EDGES.join(', ')}`;
    layers.push(i ? { texture: l.texture, scale, rotation, edge: l.edge ?? fallback } : { texture: l.texture, scale, rotation });
  }
  if (def.detailtype !== undefined && def.detailtype !== '' && !safeTextureName(def.detailtype)) return 'Bad sprite type';
  return { name: safeBlendName(String(def.name ?? '')), layers, ...(def.detailtype ? { detailtype: def.detailtype } : {}) };
}

/** Folders the blender's texture browser lists, and the maps in them that aren't ground textures. */
const GROUND_FOLDERS = ['materials/nature', 'materials/lostcoast/nature', 'materials/concrete'];
const NOT_GROUND = /(_normal|_spec|_bump|_ssbump|_height|_mask|_exp|_detail)/;

/** The sprite types in a detail.vbsp: the blocks inside its `detail` block. */
export function parseDetailTypes(text: string): string[] {
  const root = parseKeyValues(text).find((n) => n.name.toLowerCase() === 'detail');
  return root ? root.children.map((c) => c.name) : [];
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
      let details: string[] | null = null;
      let groundTextures: string[] | null = null;
      let compiling = false;
      const load = () => {
        cfg = loadConfig(server.config.root);
        const t0 = Date.now();
        assets = new AssetFS(cfg);
        listCache.clear();
        fgd = null;
        models = null;
        details = null;
        groundTextures = null;
        console.log(`[assets] install ${cfg.install}: ${assets.sources.length} sources indexed in ${Date.now() - t0} ms`);
      };
      load();

      const detailTypes = () => (details ??= parseDetailTypes(assets.read('detail.vbsp')?.toString('latin1') ?? ''));
      /** A blend file was written, renamed or deleted: forget the cached copies and folder listings. */
      const blendChanged = (...rels: string[]) => {
        for (const rel of rels) assets.forget(rel);
        listCache.clear();
      };

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

        // Start screen: the newest maps (with mode and thumbnail), `include`d ones (the examples) and recover offers.
        '/api/recent': (_req, res, url) => {
          const limit = Math.max(1, Math.min(RECENT_MAX, Number(url.searchParams.get('limit')) || RECENT_MAX));
          const files: (MapFile & { file: string })[] = [];
          for (const f of mapFolders(cfg)) {
            for (const n of readdirSync(f.dir)) {
              const file = join(f.dir, n);
              if (n.toLowerCase().endsWith('.vmf')) files.push({ id: `${f.prefix}:${n}`, name: n, mtime: mtimeOf(file), file });
            }
          }
          const autosaves = files.filter((m) => m.id.startsWith('autosave:'));
          const maps = newestFirst(files.filter((m) => !m.id.startsWith('autosave:')));
          const include = (url.searchParams.get('include') ?? '').split(',').filter(Boolean);
          const described = (m: (typeof files)[number]) => ({ id: m.id, name: m.name, mtime: m.mtime, dir: dirname(m.file), ...mapDetails(m.file, m.name, m.mtime) });
          send(res, 200, JSON.stringify({
            recent: maps.slice(0, limit).map(described),
            include: maps.filter((m) => include.includes(m.id)).map(described),
            offers: recoverOffers(autosaves, maps).map(({ name, autosave, saved }) => ({
              name, autosave: { id: autosave.id, name: autosave.name, mtime: autosave.mtime },
              saved: saved && { id: saved.id, name: saved.name, mtime: saved.mtime },
            })),
          }));
        },

        // What an autosave adds to its map's saved file (the recover card's summary).
        '/api/recover': (_req, res, url) => {
          const autosave = resolveMap(cfg, url.searchParams.get('autosave') ?? '');
          const savedId = url.searchParams.get('saved');
          const saved = savedId ? resolveMap(cfg, savedId) : null;
          if (!autosave?.startsWith(join(cfg.rootDir, '.autosave')) || !existsSync(autosave) || (savedId && (!saved || !existsSync(saved)))) {
            return send(res, 404, JSON.stringify({ error: 'autosave not found' }));
          }
          const diff = diffVmf(saved ? readFileSync(saved, 'latin1') : '', readFileSync(autosave, 'latin1'));
          send(res, 200, JSON.stringify({ ...diff, summary: diffSummary(diff) }));
        },

        // Game install, map compiler and navmesh builder. Re-reads the config, so an SDK installed since shows up.
        '/api/setup': (_req, res) => {
          const fresh = loadConfig(server.config.root);
          if (!compiling && (fresh.install !== cfg.install || fresh.sdkBinDir !== cfg.sdkBinDir)) load();
          send(res, 200, JSON.stringify(setupCheck(cfg)));
        },

        // "Locate folder…": the folder with vbsp.exe (or the Alien Swarm folder above its bin/).
        '/api/setup/sdk': async (req, res) => {
          if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST only' }));
          if (compiling) return send(res, 409, JSON.stringify({ error: 'Wait for the compile to finish' }));
          const { dir } = JSON.parse((await readBody(req)).toString('utf8')) as { dir?: string };
          const found = typeof dir === 'string' && dir.trim() ? [dir.trim(), join(dir.trim(), 'bin')].find((d) => existsSync(join(d, 'vbsp.exe'))) : undefined;
          if (!found) return send(res, 400, JSON.stringify({ error: `No vbsp.exe in ${dir}` }));
          saveSdkBinDir(cfg.rootDir, found);
          load();
          send(res, 200, JSON.stringify(setupCheck(cfg)));
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
          const name = safeMapName(url.searchParams.get('name') ?? 'untitled');
          const vmf = (await readBody(req)).toString('latin1');
          if (compiling) return send(res, 409, JSON.stringify({ error: 'A compile is already running' }));
          compiling = true;
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
          } catch (e) {
            // The 200 header is out already: report the failure in the stream and close it.
            console.error(e);
            if (!res.writableEnded) {
              write('error', `Compile failed: ${(e as Error).message}`);
              res.end();
            }
          } finally {
            compiling = false;
          }
        },

        // Saves a MultiBlend material made in the editor to content/materials/she/blend/<name>.vmt. With ?new=1 an
        // existing blend of that name is not overwritten (Save as new).
        '/api/blend': async (req, res, url) => {
          if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST only' }));
          const def = blendFromBody(JSON.parse((await readBody(req)).toString('utf8')));
          if (typeof def === 'string') return send(res, 400, JSON.stringify({ error: def }));
          const types = detailTypes();
          if (def.detailtype && types.length && !types.includes(def.detailtype)) return send(res, 400, JSON.stringify({ error: `Unknown sprite type ${def.detailtype}` }));
          const rel = blendFile(def.name);
          const file = join(contentDir(cfg), rel);
          if (url.searchParams.get('new') === '1' && existsSync(file)) return send(res, 409, JSON.stringify({ error: `A blend named ${def.name} exists already` }));
          mkdirSync(join(file, '..'), { recursive: true });
          writeFileSync(file, blendVmt(def));
          blendChanged(rel);
          send(res, 200, JSON.stringify({ material: materialForBlend(def.name) }));
        },

        // Renames one of the editor's blends: {from, to}. Refuses to overwrite another blend.
        '/api/blend/rename': async (req, res) => {
          if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST only' }));
          const { from, to } = JSON.parse((await readBody(req)).toString('utf8')) as { from?: unknown; to?: unknown };
          if (typeof from !== 'string' || typeof to !== 'string') return send(res, 400, JSON.stringify({ error: 'from and to are needed' }));
          const [a, b] = [blendFile(safeBlendName(from)), blendFile(safeBlendName(to))];
          if (!existsSync(join(contentDir(cfg), a))) return send(res, 404, JSON.stringify({ error: `No blend named ${from}` }));
          if (a !== b && existsSync(join(contentDir(cfg), b))) return send(res, 409, JSON.stringify({ error: `A blend named ${to} exists already` }));
          renameSync(join(contentDir(cfg), a), join(contentDir(cfg), b));
          blendChanged(a, b);
          send(res, 200, JSON.stringify({ material: materialForBlend(safeBlendName(to)) }));
        },

        // Deletes one of the editor's blends: {name}. The game's own blends (materials/blends) can't be reached.
        '/api/blend/delete': async (req, res) => {
          if (req.method !== 'POST') return send(res, 405, JSON.stringify({ error: 'POST only' }));
          const { name } = JSON.parse((await readBody(req)).toString('utf8')) as { name?: unknown };
          if (typeof name !== 'string') return send(res, 400, JSON.stringify({ error: 'name is needed' }));
          const rel = blendFile(safeBlendName(name));
          if (!existsSync(join(contentDir(cfg), rel))) return send(res, 404, JSON.stringify({ error: `No blend named ${name}` }));
          rmSync(join(contentDir(cfg), rel));
          blendChanged(rel);
          send(res, 200, JSON.stringify({ material: materialForBlend(safeBlendName(name)) }));
        },

        // Detail sprite types (%detailtype) from the game's detail.vbsp.
        '/api/detailtypes': (_req, res) => send(res, 200, JSON.stringify(detailTypes())),

        // Textures a blend layer can use: nature/, lostcoast/nature/ and concrete/ without normal, spec or tool maps,
        // and without textures that carry alpha (leaves, skybox treelines), which would punch holes in a layer.
        '/api/groundtextures': (_req, res) => {
          groundTextures ??= GROUND_FOLDERS.flatMap((folder) => assets.list(folder, '.vtf'))
            .filter((f) => !NOT_GROUND.test(f))
            .filter((f) => {
              const data = assets.read(f);
              // Only the header is needed: don't keep ~80 MB of textures in the file cache.
              assets.forget(f);
              return !!data && !vtfHeaderHasAlpha(data);
            })
            .map((f) => f.replace(/^materials\//, '').replace(/\.vtf$/, ''));
          send(res, 200, JSON.stringify(groundTextures));
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
          send(res, e instanceof BodyTooLarge ? 413 : 500, JSON.stringify({ error: (e as Error).message }));
        }
      });
    },
  };
}

/** Request bodies are maps at most; the biggest generated city is about 15 MB. */
export const MAX_BODY = 128 * 1024 * 1024;

class BodyTooLarge extends Error {}

export async function readBody(req: IncomingMessage, limit = MAX_BODY): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new BodyTooLarge(`Request body is larger than ${limit >> 20} MB`);
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export { send };
