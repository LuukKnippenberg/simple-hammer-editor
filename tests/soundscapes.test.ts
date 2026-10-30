import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { parseSoundscapeFile, soundscapeWaves } from '../src/audio/soundscapes.ts';
import { activeZone, soundscapeZones } from '../src/audio/listener.ts';
import { loadConfig } from '../server/config.ts';
import { VmfDocument } from '../src/vmf/map.ts';
import { entity } from '../src/gen/layout.ts';

const cfg = loadConfig(join(__dirname, '..'));
const script = cfg.gameDirs.map((g) => join(g, cfg.mod, 'scripts', 'soundscapes_wars_city16.txt')).find((p) => { try { readFileSync(p); return true; } catch { return false; } });

describe('soundscapes', () => {
  it.skipIf(!script)('parses loops, random sounds with ranges, and nested soundscapes', () => {
    const [city] = parseSoundscapeFile(readFileSync(script!, 'latin1'), 'scripts/soundscapes_wars_city16.txt');
    expect(city.name).toBe('wars.city16');
    const loop = city.rules.find((r) => r.kind === 'loop')!;
    expect(loop).toMatchObject({ wave: 'sound/scapes/wars/wind/wind_generic_loop1.wav', volume: 0.3, pitch: 100 });
    const random = city.rules.filter((r) => r.kind === 'random');
    expect(random.length).toBeGreaterThan(3);
    expect(random[0]).toMatchObject({ time: [20, 40], volume: [0.5, 0.6], pitch: [90, 105] });
    expect(soundscapeWaves(new Map([['wars.city16', city]]), 'wars.city16')).toContain('sound/scapes/wars/city/city_battle1.wav');
  });

  it('a nested soundscape adds its sounds', () => {
    const text = '"a" { "playlooping" { "wave" "x.wav" "volume" "1" } }\n"b" { "playsoundscape" { "name" "a" "volume" "0.5" } "playrandom" { "time" "1,2" "rndwave" { "wave" "^y.wav" "wave" "z.wav" } } }';
    const [a, b] = parseSoundscapeFile(text, 'f');
    expect(b.rules[0]).toEqual({ kind: 'nested', name: 'a', volume: 0.5 });
    expect(soundscapeWaves(new Map([['a', a], ['b', b]]), 'b')).toEqual(['sound/x.wav', 'sound/y.wav', 'sound/z.wav']);
  });

  it('the nearest zone in range wins, else the map default', () => {
    const doc = VmfDocument.empty();
    const add = (o: Vector3, s: string, radius: string) => doc.addEntity(entity(doc, 'env_soundscape', o, { soundscape: s, radius }));
    add(new Vector3(0, 0, 64), 'wars.city16', '-1');
    add(new Vector3(1000, 0, 64), 'wars.canals.street', '512');
    add(new Vector3(1300, 0, 64), 'wars.ruins', '512');
    const zones = soundscapeZones(doc.entities);
    expect(activeZone(zones, new Vector3(0, 0, 0))!.soundscape).toBe('wars.city16');
    expect(activeZone(zones, new Vector3(1050, 0, 0))!.soundscape).toBe('wars.canals.street');
    expect(activeZone(zones, new Vector3(1250, 0, 0))!.soundscape).toBe('wars.ruins');
    expect(activeZone(zones, new Vector3(3000, 0, 0))!.soundscape).toBe('wars.city16');
  });
});
