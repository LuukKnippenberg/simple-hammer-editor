import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import { blendFromBody, editorServer, readBody, safeTextureName } from '../server/plugin.ts';
import { AssetFS } from '../server/assets.ts';
import { editorContent } from '../server/compile.ts';
import { loadConfig } from '../server/config.ts';
import { API_HEADER } from '../src/api.ts';

// The compile tools aren't run here: the route is tested against a compile that fails half-way.
const compileMap = vi.hoisted(() => vi.fn());
vi.mock('../server/compile.ts', async (load) => ({ ...(await load<typeof import('../server/compile.ts')>()), compileMap }));

let root: string, server: Server, port: number;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'she-server-'));
  // No game folders: assets come from content/ only, and nothing is written outside the temp root.
  writeFileSync(join(root, 'editor.config.json'), JSON.stringify({ gameDirs: [], searchDirs: [], sdkBinDir: join(root, 'no-sdk') }));
  mkdirSync(join(root, 'content', 'materials', 'she'), { recursive: true });
  writeFileSync(join(root, 'content', 'materials', 'she', 'grass.vmt'), '"LightmappedGeneric" {}');
  mkdirSync(join(root, 'maps'));
  writeFileSync(join(root, 'maps', 'outside.vmt'), '');
  // Blend sprite types and ground textures: one DXT1 (no alpha) and one DXT5 cut-out.
  writeFileSync(join(root, 'content', 'detail.vbsp'), 'detail { grass01b { "density" "1" } rocks1 { } }');
  mkdirSync(join(root, 'content', 'materials', 'nature'), { recursive: true });
  const vtf = (format: number) => {
    const b = Buffer.alloc(80);
    b.write('VTF\0', 0, 'latin1');
    b.writeInt32LE(format, 52);
    return b;
  };
  writeFileSync(join(root, 'content', 'materials', 'nature', 'dirt01.vtf'), vtf(13));
  writeFileSync(join(root, 'content', 'materials', 'nature', 'leaves01.vtf'), vtf(15));
  writeFileSync(join(root, 'content', 'materials', 'nature', 'dirt01_normal.vtf'), vtf(13));

  let handle!: (req: IncomingMessage, res: unknown, next: () => void) => Promise<void>;
  const vite = { config: { root }, middlewares: { use: (fn: typeof handle) => (handle = fn) } } as unknown as ViteDevServer;
  (editorServer().configureServer as (s: ViteDevServer) => void)(vite);
  server = createServer((req, res) => void handle(req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

const own = () => `http://localhost:${port}`;
const write = { [API_HEADER]: '1' };

/** One request through node:http, which (unlike fetch) lets the test set any Origin and Host. */
function call(method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, ...opts.headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode!, text }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

describe('dev server: cross-site requests', () => {
  it('refuses writes from another origin, even other localhost ports', async () => {
    for (const origin of ['https://evil.example', `http://localhost:${port + 1}`, 'http://127.0.0.1.evil.example', 'null']) {
      const r = await call('POST', '/api/map/save?name=csrf.vmf', { headers: { origin, ...write }, body: 'versioninfo {}' });
      expect(r.status, origin).toBe(403);
    }
    expect(existsSync(join(root, 'maps', 'csrf.vmf'))).toBe(false);
  });

  it('refuses a "simple" POST without the API header', async () => {
    const r = await call('POST', '/api/map/save?name=simple.vmf', { headers: { origin: own(), 'content-type': 'text/plain' }, body: 'x' });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.text).error).toMatch(API_HEADER);
    expect(existsSync(join(root, 'maps', 'simple.vmf'))).toBe(false);
  });

  it('refuses reads from another origin', async () => {
    expect((await call('GET', '/api/maps', { headers: { origin: 'http://localhost:5180' } })).status).toBe(403);
    expect((await call('GET', '/api/maps')).status).toBe(200);
  });

  it('accepts the editor itself and local tools without an Origin', async () => {
    const a = await call('POST', '/api/map/save?name=mine.vmf', { headers: { origin: own(), ...write }, body: 'versioninfo {}' });
    expect(a.status).toBe(200);
    expect(JSON.parse(a.text)).toEqual({ id: 'repo:mine.vmf', bytes: 14 });
    expect(readFileSync(join(root, 'maps', 'mine.vmf'), 'utf8')).toBe('versioninfo {}');
    const b = await call('POST', '/api/autosave?name=mine.vmf', { headers: write, body: 'x' });
    expect(b.status).toBe(200);
    expect(existsSync(join(root, '.autosave', 'mine.vmf'))).toBe(true);
  });
});

describe('dev server: names and paths', () => {
  it('only saves plain file names', async () => {
    for (const name of ['../escape.vmf', 'a/b.vmf', 'a\\b.vmf', 'map.txt', '', 'x..vmf']) {
      const r = await call('POST', `/api/map/save?name=${encodeURIComponent(name)}`, { headers: write, body: 'x' });
      expect(r.status, name).toBe(400);
    }
    expect((await call('POST', '/api/sketch?name=../up.sketch.json', { headers: write, body: '{}' })).status).toBe(400);
    expect((await call('POST', '/api/mission?name=m.sketch.json', { headers: write, body: '{}' })).status).toBe(400);
    expect((await call('POST', '/api/mission?name=m.mission.json', { headers: write, body: '{}' })).status).toBe(200);
    expect((await call('POST', '/api/install', { headers: write, body: JSON.stringify({ dir: root }) })).status).toBe(400);
  });

  it('lists folders inside the game file system only', async () => {
    const ok = await call('GET', '/api/list?folder=materials&ext=.vmt');
    expect(JSON.parse(ok.text)).toEqual(['materials/she/grass.vmt']);
    for (const folder of ['..', '../maps', 'materials/../..', '/../maps', 'c:/', 'C:\\Windows']) {
      expect((await call('GET', `/api/list?folder=${encodeURIComponent(folder)}&ext=.vmt`)).status, folder).toBe(400);
    }
    expect((await call('GET', '/api/file?path=../editor.config.json')).status).toBe(404);
    const assets = new AssetFS(loadConfig(root));
    expect(assets.list('../maps', '.vmt')).toEqual([]);
    expect(assets.read('materials/../../maps/outside.vmt')).toBeNull();
  });

  it('keeps material paths of a compiled map inside content/', () => {
    const cfg = loadConfig(root);
    const vmf = '"material" "SHE/GRASS"\n"material" "../../maps/outside"\n"material" "she/../../maps/outside"\n';
    expect(editorContent(cfg, vmf)).toEqual(['materials/she/grass.vmt']);
  });

  it('refuses blend texture names that would add VMT keys', async () => {
    expect(safeTextureName('nature/grass01')).toBe(true);
    for (const t of ['a"b', 'a{', 'a\n"$basetexture2" "x"', 'tab\there', '', 7]) expect(safeTextureName(t), String(t)).toBe(false);
    const bad = await call('POST', '/api/blend', { headers: write, body: JSON.stringify({ name: 'x', layers: [{ texture: 'a\n"$x" "1"' }] }) });
    expect(bad.status).toBe(400);
  });

  it('checks blend layers: textures, sizes, rotations and edges', () => {
    const layer = (o: object = {}) => ({ texture: 'nature/dirt', scale: 1, rotation: 0, ...o });
    const ok = blendFromBody({ name: 'My Blend!', layers: [layer(), layer({ edge: 'medium' }), layer()] });
    expect(ok).toEqual({ name: 'my_blend', layers: [layer(), layer({ edge: 'medium' }), layer({ edge: 'soft' })] });
    // A spec on the blend (scripts written before edges) sets the edge of layers without one; only the edge maps pass.
    expect((blendFromBody({ name: 'a', spec: 'nature/forest_grass_10b_spec', layers: [layer(), layer()] }) as { layers: { edge?: string }[] }).layers[1].edge).toBe('medium');
    for (const bad of [
      { name: 'a', layers: [] },
      { name: 'a', layers: [layer(), layer(), layer(), layer(), layer()] },
      { name: 'a', spec: 'nature/mud_spec_01', layers: [layer(), layer()] },
      { name: 'a', layers: [layer({ edge: 'soft' }), layer()] },
      { name: 'a', layers: [layer(), layer({ edge: 'blurry' })] },
      { name: 'a', layers: [layer(), layer({ scale: 0.1 })] },
      { name: 'a', layers: [layer(), layer({ scale: 'big' })] },
      { name: 'a', layers: [layer(), layer({ rotation: Infinity })] },
      { name: 'a', detailtype: 'grass"\n"$x', layers: [layer()] },
      null,
    ]) expect(typeof blendFromBody(bad), JSON.stringify(bad)).toBe('string');
  });

  it('saves, renames and deletes the editor\'s blends only', async () => {
    const def = (name: string, edge = 'crisp') => JSON.stringify({ name, detailtype: 'rocks1', layers: [{ texture: 'nature/dirt', scale: 1, rotation: 0 }, { texture: 'nature/mud', scale: 2, rotation: 0, edge }] });
    const file = (n: string) => join(root, 'content', 'materials', 'she', 'blend', `${n}.vmt`);
    const saved = await call('POST', '/api/blend', { headers: write, body: def('canal') });
    expect(JSON.parse(saved.text)).toEqual({ material: 'SHE/BLEND/CANAL' });
    expect(readFileSync(file('canal'), 'utf8')).not.toMatch('$spectexture"');
    // Save as new doesn't overwrite; Save does.
    expect((await call('POST', '/api/blend?new=1', { headers: write, body: def('canal', 'soft') })).status).toBe(409);
    expect((await call('POST', '/api/blend', { headers: write, body: def('canal', 'soft') })).status).toBe(200);
    expect(readFileSync(file('canal'), 'utf8')).toMatch('"$spectexture" "nature/forest_grass_10a_spec"');
    expect((await call('POST', '/api/blend', { headers: write, body: JSON.stringify({ ...JSON.parse(def('x')), detailtype: 'nope' }) })).status).toBe(400);
    expect(JSON.parse((await call('GET', '/api/list?folder=materials/she/blend&ext=.vmt')).text)).toEqual(['materials/she/blend/canal.vmt']);

    await call('POST', '/api/blend', { headers: write, body: def('other') });
    expect((await call('POST', '/api/blend/rename', { headers: write, body: JSON.stringify({ from: 'canal', to: 'other' }) })).status).toBe(409);
    expect((await call('POST', '/api/blend/rename', { headers: write, body: JSON.stringify({ from: 'nothing', to: 'x' }) })).status).toBe(404);
    const renamed = await call('POST', '/api/blend/rename', { headers: write, body: JSON.stringify({ from: 'canal', to: 'Canal Mud' }) });
    expect(JSON.parse(renamed.text)).toEqual({ material: 'SHE/BLEND/CANAL_MUD' });
    expect([existsSync(file('canal')), existsSync(file('canal_mud'))]).toEqual([false, true]);
    // The listing and the file cache follow at once.
    expect(JSON.parse((await call('GET', '/api/list?folder=materials/she/blend&ext=.vmt')).text)).toEqual(['materials/she/blend/canal_mud.vmt', 'materials/she/blend/other.vmt']);
    expect((await call('GET', '/api/file?path=materials/she/blend/canal.vmt')).status).toBe(404);

    // Names are reduced to plain file names, so nothing outside she/blend can be renamed or deleted.
    expect((await call('POST', '/api/blend/delete', { headers: write, body: JSON.stringify({ name: '../grass' }) })).status).toBe(404);
    expect(existsSync(join(root, 'content', 'materials', 'she', 'grass.vmt'))).toBe(true);
    expect((await call('POST', '/api/blend/delete', { headers: write, body: JSON.stringify({ name: 'canal_mud' }) })).status).toBe(200);
    expect(existsSync(file('canal_mud'))).toBe(false);
    expect((await call('POST', '/api/blend/delete', { body: JSON.stringify({ name: 'other' }) })).status).toBe(403);
  });

  it('lists sprite types and ground textures without alpha', async () => {
    expect(JSON.parse((await call('GET', '/api/detailtypes')).text)).toEqual(['grass01b', 'rocks1']);
    expect(JSON.parse((await call('GET', '/api/groundtextures')).text)).toEqual(['nature/dirt01']);
  });

  it('stops reading a body past the limit', async () => {
    const body = (n: number) => Readable.from([Buffer.alloc(n), Buffer.alloc(n)]) as unknown as IncomingMessage;
    expect((await readBody(body(10), 32)).length).toBe(20);
    await expect(readBody(body(20), 32)).rejects.toThrow(/larger than/);
  });
});

describe('dev server: compile errors', () => {
  it('a compile that throws after the stream started ends the stream and frees the compiler', async () => {
    compileMap.mockImplementationOnce(async (_cfg, _name, _vmf, _opts, log: (k: string, t: string) => void) => {
      log('step', 'vbsp: building geometry');
      throw new Error('disk full');
    });
    const r = await call('POST', '/api/compile?name=broken', { headers: write, body: 'versioninfo {}' });
    expect(r.status).toBe(200);
    const lines = r.text.trim().split('\n').map((l) => JSON.parse(l) as { kind: string; text: string });
    expect(lines.map((l) => l.kind)).toEqual(['step', 'step', 'error']);
    expect(lines[2].text).toMatch('disk full');

    // The server is still up, and the next compile isn't refused as "already running".
    compileMap.mockResolvedValueOnce({ ok: false, leaked: false, seconds: 0 });
    const next = await call('POST', '/api/compile?name=broken', { headers: write, body: 'versioninfo {}' });
    expect(next.status).toBe(200);
    expect(next.text).toMatch('"kind":"result"');
  });
});
