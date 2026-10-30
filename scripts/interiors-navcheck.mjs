// Checks in the game that units can walk from outside into every open ground room of the interiors test map
// and never into a sealed one (the ground rooms under an upper floor): loads the compiled map with its navmesh
// in a hidden dedicated server and asks for a path to each ground room's centre, for a human-sized unit, from
// in front of each of the house's doors and from its other open rooms (the path search gives up on long paths,
// so it starts close by). The end point must lie on the room's own floor (searched 64 below it), so a path to
// the floor outside a sealed room doesn't count; it also tries 40 off the centre, which furniture may cover.
//   HOUSES_OUT=houses.json node scripts/interiors-demo.mjs   (writes the room list)
//   node --experimental-transform-types scripts/interiors-navcheck.mjs <map> <houses.json>
// Run it only while no other srcds.exe or lambdawars.exe is running (it uses the shared install).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../server/config.ts';

const [name, housesFile] = process.argv.slice(2);
if (!name || !housesFile) throw new Error('usage: interiors-navcheck.mjs <map> <houses.json>');
const root = join(import.meta.dirname, '..');
const cfg = loadConfig(root);
const gameDir = cfg.runGameDir;
const mod = join(gameDir, cfg.mod);
if (!existsSync(join(mod, 'maps', `${name}.recast`))) throw new Error(`maps/${name}.recast is missing: compile the map with its navmesh first`);

const tests = [];
JSON.parse(readFileSync(housesFile, 'utf8')).forEach((h, i) => {
  if (!h.doors?.length) return;
  // Starts: the house's doors, and the centres of its other open rooms (the outdoor ground of the test map has
  // gaps in its navmesh, but the room floors are always on it).
  const open = h.rooms.map((r, k) => ({ ...r, k })).filter((r) => !r.sealed);
  h.rooms.forEach((r, k) => {
    if (r.storey !== 1) return;
    const others = open.filter((o) => o.k !== k).map((o) => [o.at[0], o.at[1], (o.storey - 1) * 128 + 24]);
    tests.push({ label: `house ${i} (${h.style}, ${h.storeys}F) room ${k}`, sealed: r.sealed, starts: [...h.doors.map(([x, y]) => [x, y, null]), ...others], t: [r.at[0], r.at[1], 24] });
  });
});
console.log(`${tests.length} room checks, ${tests.filter((t) => t.sealed).length} of them sealed`);

const py = `
from vmath import Vector
from entities import CreateEntityByName, DispatchSpawn
from navmesh import NavMeshGetPathDistance, NavMeshAvailable, NavMeshGetPositionNearestNavArea
from _recast import RecastMgr
from core.signals import navmeshloaded
null = None
SHE_TESTS = ${JSON.stringify(tests.map((t) => [t.label, t.starts.map((p) => p.map((v) => (v === null ? null : Math.round(v)))), t.t.map(Math.round)]))}
def she_run(*args, **kwargs):
    ent = CreateEntityByName('info_target')
    DispatchSpawn(ent)
    ent.SetSize(Vector(-13, -13, 0), Vector(13, 13, 70))
    mesh = RecastMgr().FindBestMeshNameForEntity(ent)
    for t in SHE_TESTS:
        d = -1
        goals = [Vector(t[2][0] + dx, t[2][1] + dy, t[2][2]) for dx, dy in ((0, 0), (40, 0), (-40, 0), (0, 40), (0, -40))]
        for s, g in [(s, g) for s in t[1] for g in goals]:
            # The ground outside is uneven terrain: drop the start onto the mesh from above.
            p = NavMeshGetPositionNearestNavArea(Vector(s[0], s[1], 600), 1200, 64, ent) if s[2] is None else Vector(s[0], s[1], s[2] - 16)
            if p == Vector(0, 0, 0):
                continue
            try:
                r = NavMeshGetPathDistance(p + Vector(0, 0, 16), g, 0, ent, 64)
            except Exception as ex:
                r = -1
            if r and r > 0 and (d <= 0 or r < d):
                d = r
        print('SHE_NAV|%s|%s|%s' % (t[0], mesh, d))
    print('SHE_NAV_DONE')
if NavMeshAvailable():
    she_run()
else:
    print('SHE_NAV waiting for the navmesh')
    navmeshloaded.connect(she_run)
`;
const pyFile = join(mod, 'she_interiors_navcheck.py');
const cfgFile = join(mod, 'cfg', 'she_interiors_navcheck.cfg');
const consoleLog = join(mod, 'console.log');
(await import('node:fs')).writeFileSync(pyFile, py);
(await import('node:fs')).writeFileSync(cfgFile, 'sv_cheats 1\npy_runfile she_interiors_navcheck.py\n');
rmSync(consoleLog, { force: true });
const args = ['-console', '-condebug', '-game', cfg.mod, '-insecure', '-nomaster', '-nohltv', '+sv_lan', '1', '+maxplayers', '2', '+servercfgfile', 'she_interiors_navcheck.cfg', '+map', name]
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
let done = false, lines = [];
const deadline = Date.now() + 4 * 60 * 1000;
while (Date.now() < deadline && !done) {
  await new Promise((r) => setTimeout(r, 1000));
  if (!existsSync(consoleLog)) continue;
  lines = readFileSync(consoleLog, 'latin1').split(/\r?\n/);
  for (const l of lines) {
    if (l.startsWith('SHE_NAV_DONE')) done = true;
    const m = /^SHE_NAV\|(.*)\|(\w*)\|(.*)$/.exec(l);
    if (m) results.set(m[1], { mesh: m[2], dist: m[3] });
  }
}
try { process.kill(pid); } catch { /* gone */ }
await new Promise((r) => setTimeout(r, 800));
rmSync(pyFile, { force: true });
rmSync(cfgFile, { force: true });
rmSync(consoleLog, { force: true });
if (!done) {
  console.log('No result from the server. Last lines of its console:');
  console.log(lines.slice(-40).join('\n'));
  process.exit(1);
}
const reached = (t) => Number(results.get(t.label)?.dist) > 0;
const open = tests.filter((t) => !t.sealed), sealed = tests.filter((t) => t.sealed);
for (const t of open) if (!reached(t)) console.log(`  NO PATH into an open room: ${t.label} (${results.get(t.label)?.dist})`);
for (const t of sealed) if (reached(t)) console.log(`  PATH into a sealed room: ${t.label} (${results.get(t.label)?.dist})`);
console.log(`open rooms reached: ${open.filter(reached).length}/${open.length}; sealed rooms reached: ${sealed.filter(reached).length}/${sealed.length} (mesh ${results.values().next().value?.mesh})`);
process.exit(sealed.some(reached) ? 1 : 0);
