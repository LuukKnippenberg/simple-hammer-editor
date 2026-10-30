import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { VmfDocument } from '../src/vmf/map.ts';
import { getConnections, setConnections, SEP } from '../src/vmf/io.ts';
import { loadConfig } from '../server/config.ts';

const cfg = loadConfig(process.cwd());
const sp = cfg.gameDirs.map((g) => join(g, cfg.mod, 'mapsrc', 'sp_radio_tower.vmf')).find((p) => existsSync(p));

describe('entity I/O', () => {
  it.skipIf(!sp)('reads Hammer connections and writes them back unchanged', () => {
    const text = readFileSync(sp!, 'latin1');
    const doc = VmfDocument.parse(text);
    const maker = doc.entities.find((e) => e.get('targetname') === 'zombie_door_spawn')!;
    const [c] = getConnections(maker);
    expect(c).toMatchObject({ output: 'OnSpawnNPC', target: 'give_order_zombie', input: 'PerformOrderUnit', param: '', delay: 0, times: -1 });
    // Rewriting every connections block from the parsed model must not change the file.
    for (const e of doc.entities) {
      const list = getConnections(e);
      if (list.length) setConnections(e, list);
    }
    expect(doc.serialize()).toBe(text);
  });

  it('adds and removes connections blocks', () => {
    const doc = VmfDocument.parse('entity\n{\n"id" "2"\n"classname" "logic_auto"\neditor\n{\n"color" "1 1 1"\n}\n}\n');
    const e = doc.entities[0];
    setConnections(e, [{ output: 'OnMapSpawn', target: 'intro', input: 'Display', param: '', delay: 1.5, times: 1 }]);
    const block = e.node.child('connections')!;
    expect(block.props[0]).toEqual(['OnMapSpawn', ['intro', 'Display', '', '1.5', '1'].join(SEP)]);
    // Inserted before the editor block.
    expect(e.node.children.map((c) => c.name)).toEqual(['connections', 'editor']);
    setConnections(e, []);
    expect(e.node.child('connections')).toBeUndefined();
  });
});
