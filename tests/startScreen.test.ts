import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import { autosaveOf, diffSummary, diffVmf, heightThumb, mapMode, newestFirst, recoverOffers, setupCheck, THUMB_H, THUMB_W, vmfBlocks } from '../server/mapInfo.ts';
import { loadConfig } from '../server/config.ts';
import { editorServer } from '../server/plugin.ts';
import { getPref, setPref } from '../src/ui/prefs.ts';
import { freeName, pendingOffers, stamp } from '../src/ui/recover.ts';
import { whenText } from '../src/ui/startScreen.ts';

/** A 128-unit brush from x = (id - 1) × 128, up to height z. */
const solid = (id: number, z = 64, material = 'DEV/GRAY') => `\tsolid
\t{
\t\t"id" "${id}"
\t\tside
\t\t{
\t\t\t"id" "${id * 10}"
\t\t\t"plane" "(${(id - 1) * 128} 0 ${z}) (${id * 128} 0 ${z}) (${id * 128} 128 ${z})"
\t\t\t"material" "${material}"
\t\t}
\t\tside
\t\t{
\t\t\t"id" "${id * 10 + 1}"
\t\t\t"plane" "(${(id - 1) * 128} 0 0) (${id * 128} 0 0) (${id * 128} 128 0)"
\t\t\t"material" "${material}"
\t\t}
\t\teditor
\t\t{
\t\t}
\t}`;
const entity = (id: number, classname: string, extra = '') => `entity
{
\t"id" "${id}"
\t"classname" "${classname}"${extra}
}`;
const vmf = (solids: string[], entities: string[]) => `world
{
\t"id" "1"
\t"classname" "worldspawn"
${solids.join('\n')}
}
${entities.join('\n')}
`;

describe('map mode', () => {
  it('reads the prefix and the content', () => {
    expect(mapMode('sp_sofia.vmf', '')).toBe('Mission');
    expect(mapMode('district.vmf', '', true)).toBe('Mission');
    expect(mapMode('or_town.vmf', '')).toBe('Overrun');
    expect(mapMode('town.vmf', vmf([], [entity(2, 'overrun_manager')]))).toBe('Overrun');
    expect(mapMode('hlw_canals.vmf', vmf([], [entity(2, 'info_start_wars'), entity(3, 'info_start_wars')]))).toBe('Annihilation 2p');
    expect(mapMode('hlw_empty.vmf', '')).toBe('Annihilation');
    expect(mapMode('interiors_test.vmf', vmf([solid(2)], []))).toBe('No mode');
  });
});

describe('vmf diff', () => {
  const before = vmf([solid(2), solid(3)], [entity(10, 'info_start_wars'), entity(11, 'prop_static')]);
  it('splits world solids and entities by id', () => {
    expect([...vmfBlocks(before).keys()]).toEqual(['solid:2', 'solid:3', 'entity:10', 'entity:11']);
  });
  it('counts added, deleted and changed blocks', () => {
    const after = vmf([solid(2, 96), solid(3), solid(4)], [entity(10, 'info_start_wars'), entity(12, 'light')]);
    const d = diffVmf(before, after);
    expect(d).toEqual({ added: { solids: 1, entities: 1 }, deleted: 1, changed: 1, total: 4 });
    expect(diffSummary(d)).toBe('+ 1 brush · + 1 entity · changed 1 · deleted 1');
    expect(diffSummary(diffVmf('', before))).toBe('+ 2 brushes · + 2 entities');
    expect(diffVmf(before, before).total).toBe(0);
  });
});

describe('height thumbnail', () => {
  it('fills the brushes and leaves tool brushes out', () => {
    const cells = heightThumb(vmf([solid(1, 16), solid(2, 256), solid(9, 999, 'TOOLS/TOOLSSKYBOX')], []));
    expect(cells).toHaveLength(THUMB_W * THUMB_H);
    expect(Math.max(...cells)).toBe(255);
    expect(cells.filter((c) => c === 0).length).toBeGreaterThan(0);
    // The sky brush far out east would have widened the picture: the 256 × 128 map fills the full width.
    expect(cells.slice(0, THUMB_W).every((c) => c === -1)).toBe(true);
    expect(cells.slice(THUMB_W * Math.floor(THUMB_H / 2), THUMB_W * Math.floor(THUMB_H / 2) + THUMB_W).every((c) => c >= 0)).toBe(true);
  });
  it('is empty for a map without brushes', () => {
    expect(heightThumb(vmf([], [])).every((c) => c === -1)).toBe(true);
  });
});

describe('recent maps and recover offers', () => {
  const map = (id: string, mtime: number) => ({ id, name: id.split(':')[1], mtime });
  it('lists the newest first', () => {
    const sorted = newestFirst([map('repo:a.vmf', 1), map('game0:c.vmf', 3), map('repo:b.vmf', 3)]);
    expect(sorted.map((m) => m.id)).toEqual(['repo:b.vmf', 'game0:c.vmf', 'repo:a.vmf']);
  });
  it('pairs an autosave with its map', () => {
    expect(autosaveOf('sp_sofia.autosave.vmf')).toBe('sp_sofia.vmf');
    expect(autosaveOf('sp_sofia.vmf')).toBeNull();
  });
  it('offers an autosave newer than the saved file, and of a map never saved', () => {
    const maps = [map('repo:newer.vmf', 100), map('repo:older.vmf', 300), map('game0:both.vmf', 50), map('repo:both.vmf', 400)];
    const offers = recoverOffers(
      [map('autosave:newer.autosave.vmf', 200), map('autosave:older.autosave.vmf', 200), map('autosave:both.autosave.vmf', 300), map('autosave:untitled.autosave.vmf', 250)],
      maps,
    );
    expect(offers.map((o) => [o.name, o.saved?.id ?? null])).toEqual([['untitled.vmf', null], ['newer.vmf', 'repo:newer.vmf']]);
  });
  it('drops offers that were turned down until a newer autosave comes', () => {
    const offer = (mtime: number) => ({ name: 'a.vmf', autosave: { id: 'autosave:a.autosave.vmf', name: 'a.autosave.vmf', mtime }, saved: null });
    expect(pendingOffers([offer(200)], { 'a.autosave.vmf': 200 })).toEqual([]);
    expect(pendingOffers([offer(201)], { 'a.autosave.vmf': 200 })).toHaveLength(1);
    expect(pendingOffers([offer(201)])).toHaveLength(1);
  });
  it('picks a free name for copies and recovered maps', () => {
    expect(freeName('sp_sofia.vmf', 'recovered', ['sp_sofia.vmf'])).toBe('sp_sofia_recovered.vmf');
    expect(freeName('sp_sofia.vmf', 'copy', ['SP_SOFIA_COPY.vmf', 'sp_sofia_copy_2.vmf'])).toBe('sp_sofia_copy_3.vmf');
  });
});

describe('times', () => {
  const now = new Date(2026, 10, 2, 19, 30).getTime();
  const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
  it('says when, for sentences', () => {
    expect(stamp(at(2, 14, 2), now)).toBe('today 14:02');
    expect(stamp(at(1, 18, 42), now)).toBe('yesterday 18:42');
    expect(stamp(at(1, 18, 42), now, at(1, 9))).toBe('18:42');
    expect(stamp(new Date(2026, 9, 27, 14, 2).getTime(), now)).toBe('Tuesday 14:02');
    expect(stamp(new Date(2026, 9, 20, 14, 2).getTime(), now)).toBe('20 Oct 14:02');
    expect(stamp(new Date(2025, 10, 7, 9, 5).getTime(), now)).toBe('7 Nov 2025 09:05');
  });
  it('says how long ago, for Recent', () => {
    expect(whenText(at(2, 9), now)).toBe('today 09:00');
    expect(whenText(at(1, 23), now)).toBe('yesterday 23:00');
    expect(whenText(new Date(2026, 9, 30, 12).getTime(), now)).toBe('3 days ago');
    expect(whenText(new Date(2026, 9, 25, 12).getTime(), now)).toBe('last week');
    expect(whenText(new Date(2026, 9, 12, 12).getTime(), now)).toBe('3 weeks ago');
    expect(whenText(new Date(2025, 10, 7, 12).getTime(), now)).toBe('7 Nov 2025');
  });
});

describe('prefs', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (real) Object.defineProperty(globalThis, 'localStorage', real);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  });
  const fakeStorage = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
  };

  it('stores typed values and removes them', () => {
    const storage = fakeStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    expect(getPref('toured')).toBeUndefined();
    expect(setPref('recoverDismissed', { 'a.autosave.vmf': 5 })).toBe(true);
    expect(getPref('recoverDismissed')).toEqual({ 'a.autosave.vmf': 5 });
    setPref('toured', true);
    expect(getPref('toured')).toBe(true);
    setPref('toured', undefined);
    expect(getPref('toured')).toBeUndefined();
    expect([...storage.data.keys()]).toEqual(['she.pref.recoverDismissed']);
  });
  it('reads a broken value as unset', () => {
    const storage = fakeStorage();
    storage.data.set('she.pref.scaleLayer', '{not json');
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    expect(getPref('scaleLayer')).toBeUndefined();
  });
  it('works as a first run when storage is blocked', () => {
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
    expect(getPref('toured')).toBeUndefined();
    expect(setPref('toured', true)).toBe(false);
  });
});

describe('setup check', () => {
  let root: string;
  const config = (extra: object) => {
    writeFileSync(join(root, 'editor.config.json'), JSON.stringify({ install: join(root, 'game'), installs: [{ name: 'Test game', dir: join(root, 'game') }], ...extra }));
    return loadConfig(root);
  };
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'she-setup-'));
    mkdirSync(join(root, 'game', 'lambdawars'), { recursive: true });
    for (const exe of ['lambdawars.exe', 'srcds.exe']) writeFileSync(join(root, 'game', exe), '');
    mkdirSync(join(root, 'sdk', 'bin'), { recursive: true });
    for (const exe of ['vbsp.exe', 'vvis.exe', 'vrad.exe']) writeFileSync(join(root, 'sdk', 'bin', exe), '');
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('passes with the game, the SDK tools and srcds', () => {
    const rows = setupCheck(config({ sdkBinDir: join(root, 'sdk', 'bin') }));
    expect(rows.map((r) => [r.id, r.ok])).toEqual([['install', true], ['compiler', true], ['navmesh', true]]);
    expect(rows[0].detail).toBe('Test game · assets, entity list and where maps are installed');
    expect(rows[1].detail).toBe('vbsp, vvis and vrad from the Alien Swarm SDK');
  });
  it('fails the compiler when its folder has no tools (a renamed SDK bin folder)', () => {
    const rows = setupCheck(config({ sdkBinDir: join(root, 'sdk', 'bin-renamed') }));
    expect(rows.map((r) => r.ok)).toEqual([true, false, true]);
    expect(rows[1].detail).toContain('vbsp.exe, vvis.exe, vrad.exe missing');
  });
  it('fails the navmesh builder without srcds, and both without the game', () => {
    rmSync(join(root, 'game', 'srcds.exe'));
    expect(setupCheck(config({ sdkBinDir: join(root, 'sdk', 'bin') })).map((r) => r.ok)).toEqual([true, true, false]);
    const none = setupCheck({ install: null, installs: [], mod: 'lambdawars', sdkBinDir: join(root, 'sdk', 'bin') });
    expect(none.map((r) => r.ok)).toEqual([false, true, false]);
  });
});

describe('start screen routes', () => {
  let root: string, server: Server, port: number;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'she-start-'));
    writeFileSync(join(root, 'editor.config.json'), JSON.stringify({ gameDirs: [], searchDirs: [], sdkBinDir: join(root, 'no-sdk') }));
    mkdirSync(join(root, 'maps'));
    mkdirSync(join(root, '.autosave'));
    // Newer than any map of an install found on this machine, so these head the list.
    const now = Date.now() / 1000;
    const write = (file: string, text: string, minutes: number) => {
      writeFileSync(join(root, file), text);
      utimesSync(join(root, file), now + minutes * 60, now + minutes * 60);
    };
    write('maps/old.vmf', vmf([solid(2)], []), 1);
    write('maps/hlw_new.vmf', vmf([solid(2)], [entity(3, 'info_start_wars')]), 3);
    write('.autosave/old.autosave.vmf', vmf([solid(2), solid(4)], []), 2);
    write('.autosave/hlw_new.autosave.vmf', vmf([solid(2)], []), 2);
    let handle!: (req: IncomingMessage, res: unknown, next: () => void) => Promise<void>;
    const vite = { config: { root }, middlewares: { use: (fn: typeof handle) => (handle = fn) } } as unknown as ViteDevServer;
    (editorServer().configureServer as (s: ViteDevServer) => void)(vite);
    server = createServer((req, res) => void handle(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.close();
    rmSync(root, { recursive: true, force: true });
  });
  const get = async (path: string) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: r.status, body: await r.json() };
  };

  it('lists recent maps newest first, with mode and thumbnail, and offers the newer autosave', async () => {
    const { body } = await get('/api/recent');
    // Installs found on this machine add their mapsrc/ maps; the temp maps/ ones are the test's.
    const own = body.recent.filter((m: { id: string }) => m.id.startsWith('repo:'));
    expect(own.map((m: { id: string; mode: string }) => [m.id, m.mode])).toEqual([['repo:hlw_new.vmf', 'Annihilation 1p'], ['repo:old.vmf', 'No mode']]);
    expect(own[0].thumb.cells).toHaveLength(THUMB_W * THUMB_H);
    expect(body.offers.map((o: { name: string; saved: { id: string } }) => [o.name, o.saved.id])).toEqual([['old.vmf', 'repo:old.vmf']]);
  });
  it('summarises an autosave against its saved file', async () => {
    const { body } = await get('/api/recover?autosave=autosave:old.autosave.vmf&saved=repo:old.vmf');
    expect([body.total, body.summary]).toEqual([1, '+ 1 brush']);
    expect((await get('/api/recover?autosave=repo:old.vmf')).status).toBe(404);
  });
  it('reports a missing compiler', async () => {
    const { body } = await get('/api/setup');
    expect(body.find((r: { id: string }) => r.id === 'compiler').ok).toBe(false);
  });
});
