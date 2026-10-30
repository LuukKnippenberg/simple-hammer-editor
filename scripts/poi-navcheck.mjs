// Checks in the game that units can follow every POI's routes: loads a compiled map (with its navmesh) in a
// hidden dedicated server and asks the navmesh for a path along each route, for human and large units, with
// the game's own NavMeshGetPathDistance. Prints a table and writes docs/poi-navcheck-<map>.json.
//   node --experimental-transform-types scripts/poi-navcheck.mjs <map>
// Run it only while no other srcds.exe or lambdawars.exe is running (it uses the shared install).
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../server/config.ts';
import { VmfDocument } from '../src/vmf/map.ts';
import { buildPoi, poiOf } from '../src/gen/poi/registry.ts';
import { PoiKit } from '../src/gen/poi/kit.ts';
import '../src/gen/poi/catalogue.ts';

const name = process.argv[2];
if (!name) throw new Error('usage: poi-navcheck.mjs <map>');
const root = join(import.meta.dirname, '..');
const cfg = loadConfig(root);
const gameDir = cfg.runGameDir;
const mod = join(gameDir, cfg.mod);
if (!existsSync(join(mod, 'maps', `${name}.recast`))) throw new Error(`maps/${name}.recast is missing: compile the map with its navmesh first`);

// Routes of every POI: along a strip's long axis, starting and ending 96 outside the POI where the strip
// reaches its edge; square route pieces (the ends of slanted path segments) are joined in pairs. Ramps up to
// terraces are checked as high ground instead (their ends are at different heights).
const doc = VmfDocument.parse(readFileSync(join(root, 'maps', `${name}.vmf`), 'latin1'));
const tests = [];
for (const e of doc.entities) {
  const p = poiOf(e);
  if (!p) continue;
  const { spec, type } = p;
  const out = buildPoi(VmfDocument.empty(), spec);
  const R = spec.rect, z = spec.z + 24;
  const label = `${type.id}@${Math.round((R.x0 + R.x1) / 2)},${Math.round((R.y0 + R.y1) / 2)}`;
  const squares = [];
  out.routes.forEach((r, i) => {
    if (type.id === 'quarry' && i > 0) return;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    if (Math.abs(w - h) < 1) { squares.push([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]); return; }
    const along = w > h ? 'x' : 'y';
    const c = along === 'x' ? (r.y0 + r.y1) / 2 : (r.x0 + r.x1) / 2;
    let a = along === 'x' ? r.x0 : r.y0, b = along === 'x' ? r.x1 : r.y1;
    const lo = along === 'x' ? R.x0 : R.y0, hi = along === 'x' ? R.x1 : R.y1;
    a = a <= lo + 1 ? lo - 96 : a + 32;
    b = b >= hi - 1 ? hi + 96 : b - 32;
    const s = along === 'x' ? [a, c] : [c, a], t = along === 'x' ? [b, c] : [c, b];
    tests.push({ label: `${label} route ${i + 1}`, s: [...s, z], t: [...t, z] });
  });
  for (let i = 0; i + 1 < squares.length; i += 2) tests.push({ label: `${label} path ${i / 2 + 1}`, s: [...squares[i], z], t: [...squares[i + 1], z] });
  // High ground that should be reachable: from outside the POI's front to the top.
  const k = new PoiKit(VmfDocument.empty(), spec, type, () => spec.z);
  const front = k.world(k.W / 2, -96);
  const top = (x, y, h) => { const w = k.world(x, y); tests.push({ label: `${label} high ground`, s: [front.x, front.y, z], t: [w.x, w.y, spec.z + h + 24] }); };
  if (type.id === 'lookout') top(k.W / 2, k.D / 2, Math.max(128, Math.min(384, Math.round(Number(spec.params.height ?? 256) / 16) * 16, Math.floor((k.W / 2 - 96 - 32 - 48) / 1.25 / 16) * 16)));
  if (type.id === 'football' && spec.params.stands !== 'none') top(k.W / 2, k.D - 64 - 40, 16 * Math.max(2, Math.floor(192 / 48)));
  if (type.id === 'overlook') top(k.W * 0.58, k.D * 0.75, Math.max(64, Math.min(192, Math.round(Number(spec.params.height ?? 128) / 16) * 16)));
  if (type.id === 'quarry') top(144, k.D * 0.6, Math.max(1, Math.min(3, Math.round(Number(spec.params.terraces ?? 2)))) * 64);
  if (type.id === 'relay') top(k.W * 0.5, k.D * 0.5, Math.max(32, Math.min(192, Math.round(Number(spec.params.height ?? 96) / 16) * 16)));
}
console.log(`${tests.length} route checks`);

const py = `
from vmath import Vector
from entities import CreateEntityByName, DispatchSpawn
from navmesh import NavMeshGetPathDistance, NavMeshAvailable
from _recast import RecastMgr
from core.signals import navmeshloaded
SHE_TESTS = ${JSON.stringify(tests.map((t) => [t.label, ...t.s.map(Math.round), ...t.t.map(Math.round), t.label.endsWith('high ground') ? 48 : 256]))}
SHE_PROBES = [('human', 13, 70), ('large', 40, 98)]
def she_run(*args, **kwargs):
    probes = []
    for pname, e, h in SHE_PROBES:
        ent = CreateEntityByName('info_target')
        DispatchSpawn(ent)
        ent.SetSize(Vector(-e, -e, 0), Vector(e, e, h))
        probes.append((pname, ent, RecastMgr().FindBestMeshNameForEntity(ent)))
    for t in SHE_TESTS:
        for pname, ent, mesh in probes:
            try:
                d = NavMeshGetPathDistance(Vector(t[1], t[2], t[3]), Vector(t[4], t[5], t[6]), 0, ent, t[7])
            except Exception as ex:
                d = 'error:%s' % ex
            print('SHE_NAV|%s|%s|%s|%s' % (t[0], pname, mesh, d))
    print('SHE_NAV_DONE')
if NavMeshAvailable():
    she_run()
else:
    print('SHE_NAV waiting for the navmesh')
    navmeshloaded.connect(she_run)
`;
const pyFile = join(mod, 'she_poi_navcheck.py');
const cfgFile = join(mod, 'cfg', 'she_poi_navcheck.cfg');
const consoleLog = join(mod, 'console.log');
writeFileSync(pyFile, py);
writeFileSync(cfgFile, 'sv_cheats 1\npy_runfile she_poi_navcheck.py\n');
rmSync(consoleLog, { force: true });
const args = ['-console', '-condebug', '-game', cfg.mod, '-insecure', '-nomaster', '-nohltv', '+sv_lan', '1', '+maxplayers', '2', '+servercfgfile', 'she_poi_navcheck.cfg', '+map', name]
  .map((a) => `'${a}'`).join(',');
const ps = `$p = Start-Process -FilePath '${join(gameDir, 'srcds.exe')}' -WorkingDirectory '${gameDir}' -ArgumentList ${args} -WindowStyle Hidden -PassThru; $p.Id`;
const pid = await new Promise((resolve) => {
  const p = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.on('close', () => resolve(parseInt(out.trim(), 10)));
});
if (!pid) throw new Error('could not start srcds.exe');
const results = new Map();
let done = false;
const deadline = Date.now() + 4 * 60 * 1000;
let lines = [];
while (Date.now() < deadline && !done) {
  await new Promise((r) => setTimeout(r, 1000));
  if (!existsSync(consoleLog)) continue;
  lines = readFileSync(consoleLog, 'latin1').split(/\r?\n/);
  for (const l of lines) {
    if (l.startsWith('SHE_NAV_DONE')) done = true;
    const m = /^SHE_NAV\|(.*)\|(\w+)\|(\w*)\|(.*)$/.exec(l);
    if (m) results.set(`${m[1]}|${m[2]}`, { label: m[1], probe: m[2], mesh: m[3], dist: m[4] });
  }
}
try { process.kill(pid); } catch { /* gone */ }
await new Promise((r) => setTimeout(r, 800));
rmSync(pyFile, { force: true });
rmSync(cfgFile, { force: true });
if (!done) {
  console.log('No result from the server. Last lines of its console:');
  console.log(lines.slice(-40).join('\n'));
  rmSync(consoleLog, { force: true });
  process.exit(1);
}
rmSync(consoleLog, { force: true });
// A path much longer than the straight line goes round the POI instead of along its route.
const straight = new Map(tests.map((t) => [t.label, Math.hypot(t.t[0] - t.s[0], t.t[1] - t.s[1], t.t[2] - t.s[2])]));
// High ground is reached by its ramp or stair, which need not face the start: any path counts. Its end point
// is searched for only 48 below the point (24 above the top), so the ground under it doesn't count.
const rows = [...results.values()].map((r) => ({ ...r, straight: Math.round(straight.get(r.label) ?? 0), direct: Number(r.dist) > 0 && (r.label.endsWith('high ground') || Number(r.dist) <= 1.3 * (straight.get(r.label) ?? 0) + 64) }));
const ok = (r) => Number(r.dist) > 0;
for (const r of rows) if (!ok(r)) console.log(`  NO PATH  ${r.label}  (${r.probe} → mesh ${r.mesh}, ${r.dist})`);
for (const r of rows) if (ok(r) && !r.direct) console.log(`  DETOUR   ${r.label}  (${r.probe}: ${Math.round(Number(r.dist))} for ${r.straight} straight)`);
const byProbe = (p) => rows.filter((r) => r.probe === p);
for (const p of ['human', 'large']) console.log(`${p}: ${byProbe(p).filter(ok).length}/${byProbe(p).length} routes have a path, ${byProbe(p).filter((r) => r.direct).length} of them direct (mesh ${byProbe(p)[0]?.mesh})`);
writeFileSync(join(root, 'docs', `poi-navcheck-${name}.json`), JSON.stringify(rows, null, 1));
