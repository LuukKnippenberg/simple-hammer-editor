// Compiles a map from maps/ without the browser, like the compile dialog does (map settings added, the
// mission flowchart built if the map has one, vbsp, vvis, vrad, navmesh), and reports the time. The game
// install can be overridden, so a test compile doesn't have to go into the editor's active install.
//   node --experimental-transform-types scripts/compile-map.mjs <name> [--install <game root>] [--final] [--no-navmesh]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../server/config.ts';
import { compileMap } from '../server/compile.ts';
import { VmfDocument } from '../src/vmf/map.ts';
import { applyMapSettings } from '../src/lw/mapSettings.ts';
import { buildMissionInto } from '../src/lw/missionBuild.ts';
import { logicAnchor } from '../src/lw/missionAction.ts';
import { stripHandles } from '../src/gen/handle.ts';

const args = process.argv.slice(2);
const name = args[0];
if (!name) throw new Error('usage: compile-map.mjs <name> [--install <dir>] [--final] [--no-navmesh]');
const root = join(import.meta.dirname, '..');
const cfg = loadConfig(root);
const i = args.indexOf('--install');
if (i >= 0) cfg.runGameDir = cfg.install = args[i + 1];

const doc = VmfDocument.parse(readFileSync(join(root, 'maps', `${name}.vmf`), 'latin1'));
const added = applyMapSettings(doc);
if (added.length) console.log('map settings added:', added.join(', '));
// Generator handles (POIs, blocks of buildings) only exist in the editor.
stripHandles(doc);
const missionFile = join(root, 'maps', `${name}.mission.json`);
if (existsSync(missionFile)) {
  const m = buildMissionInto(doc, JSON.parse(readFileSync(missionFile, 'utf8')), logicAnchor(doc));
  console.log(`mission flow built: ${m.entities} entities, ${m.connections} outputs`);
  for (const w of m.warnings) console.log('  warning:', w);
}
console.log(`compiling ${name} (${doc.allSolids().length} brushes) into ${cfg.runGameDir}`);
const t0 = Date.now();
const r = await compileMap(cfg, name, doc.serialize(), { quality: args.includes('--final') ? 'final' : 'fast', navmesh: !args.includes('--no-navmesh') }, (kind, text) => {
  if (kind !== 'out' || /error|warning|leak/i.test(text)) console.log(`  [${kind}] ${text.trim().slice(0, 200)}`);
});
console.log(JSON.stringify({ ...r, wall: Math.round((Date.now() - t0) / 1000) }));
