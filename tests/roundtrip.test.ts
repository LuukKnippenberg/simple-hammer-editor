import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VmfDocument } from '../src/vmf/map.ts';
import { buildSolidChunks } from '../src/render/worldRenderer.ts';
import { loadConfig } from '../server/config.ts';

const cfg = loadConfig(process.cwd());
const corpus: string[] = [join('maps', 'hlw_City16.vmf')];
for (const g of cfg.gameDirs) {
  const dir = join(g, cfg.mod, 'mapsrc');
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.toLowerCase().endsWith('.vmf')) corpus.push(join(dir, f));
}

describe('VMF round-trip', () => {
  it.each(corpus.map((p) => [p.split(/[\\/]/).pop()!, p]))('%s writes back byte-identical', (_name, path) => {
    const text = readFileSync(path, 'latin1');
    expect(VmfDocument.parse(text).serialize()).toBe(text);
  });

  it('keeps edits and leaves untouched geometry unchanged', () => {
    const text = readFileSync('maps/hlw_City16.vmf', 'latin1');
    const doc = VmfDocument.parse(text);
    const solids = doc.allSolids();
    const before = solids.map((s) => buildSolidChunks(s));

    // Re-committing every side (re-formatting planes and axes) must not move any vertex.
    for (const s of solids) s.commit();
    const reparsed = VmfDocument.parse(doc.serialize()).allSolids();
    reparsed.forEach((s, i) => {
      const a = before[i].chunks, b = buildSolidChunks(s).chunks;
      expect([...b.keys()]).toEqual([...a.keys()]);
      for (const [k, c] of a) {
        const d = b.get(k)!.pos;
        for (let j = 0; j < c.pos.length; j++) expect(Math.abs(c.pos[j] - d[j])).toBeLessThan(0.01);
      }
    });

    // A real edit: move one brush up 64 units and retexture it, change an entity key.
    const target = solids[10];
    for (const side of target.sides) {
      for (const p of side.plane) p.z += 64;
      side.material = 'BRICK/BRICKWALL031D';
    }
    target.commit();
    const start = doc.entities.find((e) => e.classname === 'info_start_wars')!;
    start.set('targetname', 'edited_start');
    const doc2 = VmfDocument.parse(doc.serialize());
    const moved = doc2.allSolids()[10];
    expect(moved.sides[0].material).toBe('BRICK/BRICKWALL031D');
    expect(moved.sides[0].plane[0].z).toBeCloseTo(target.sides[0].plane[0].z);
    expect(doc2.entities.find((e) => e.get('targetname') === 'edited_start')).toBeTruthy();
  });
});
