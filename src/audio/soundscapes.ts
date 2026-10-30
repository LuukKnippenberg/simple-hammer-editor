import { parseKeyValues, type KVNode } from '../vmf/keyvalues.ts';
import { fetchGameText } from '../assets/fetch.ts';

/** One looping or random sound rule of a soundscape (scripts/soundscapes_*.txt). */
export type SoundRule =
  | { kind: 'loop'; wave: string; volume: number; pitch: number; position?: number }
  | { kind: 'random'; waves: string[]; time: [number, number]; volume: [number, number]; pitch: [number, number] }
  | { kind: 'nested'; name: string; volume: number };

export interface Soundscape {
  name: string;
  /** The script it came from (scripts/soundscapes_wars_city16.txt). */
  file: string;
  rules: SoundRule[];
}

const range = (s: string | undefined, def: number): [number, number] => {
  const parts = (s ?? String(def)).split(',').map((x) => parseFloat(x));
  const a = Number.isFinite(parts[0]) ? parts[0] : def;
  const b = Number.isFinite(parts[1]) ? parts[1] : a;
  return [Math.min(a, b), Math.max(a, b)];
};

const wavePath = (w: string) => `sound/${w.replace(/^[*#@)(><^]+/, '').replace(/\\/g, '/').toLowerCase()}`;

function parseScape(name: string, file: string, node: KVNode): Soundscape {
  const rules: SoundRule[] = [];
  for (const c of node.children) {
    const n = c.name.toLowerCase();
    if (n === 'playlooping') {
      const wave = c.get('wave');
      if (wave) rules.push({ kind: 'loop', wave: wavePath(wave), volume: range(c.get('volume'), 1)[0], pitch: range(c.get('pitch'), 100)[0] });
    } else if (n === 'playrandom') {
      const waves = (c.child('rndwave')?.props ?? []).filter(([k]) => k.toLowerCase() === 'wave').map(([, v]) => wavePath(v));
      if (waves.length) rules.push({ kind: 'random', waves, time: range(c.get('time'), 10), volume: range(c.get('volume'), 1), pitch: range(c.get('pitch'), 100) });
    } else if (n === 'playsoundscape') {
      const sub = c.get('name');
      if (sub) rules.push({ kind: 'nested', name: sub.toLowerCase(), volume: range(c.get('volume'), 1)[0] });
    }
  }
  return { name, file, rules };
}

/** The soundscapes defined in one script. */
export function parseSoundscapeFile(text: string, file: string): Soundscape[] {
  return parseKeyValues(text).map((node) => parseScape(node.name, file, node));
}

let all: Promise<Map<string, Soundscape>> | null = null;

/** Every soundscape listed in scripts/soundscapes_manifest.txt, by lowercase name. */
export function loadSoundscapes(): Promise<Map<string, Soundscape>> {
  all ??= (async () => {
    const out = new Map<string, Soundscape>();
    const manifest = await fetchGameText('scripts/soundscapes_manifest.txt');
    const files = manifest ? (parseKeyValues(manifest)[0]?.props ?? []).filter(([k]) => k.toLowerCase() === 'file').map(([, v]) => v.replace(/\\/g, '/')) : [];
    await Promise.all(files.map(async (file) => {
      const text = await fetchGameText(file);
      if (!text) return;
      for (const s of parseSoundscapeFile(text, file)) out.set(s.name.toLowerCase(), s);
    }));
    return out;
  })();
  return all;
}

/** The waves a soundscape plays, nested soundscapes included (for listings). */
export function soundscapeWaves(scapes: Map<string, Soundscape>, name: string, depth = 0): string[] {
  const s = scapes.get(name.toLowerCase());
  if (!s || depth > 4) return [];
  return s.rules.flatMap((r) => (r.kind === 'loop' ? [r.wave] : r.kind === 'random' ? r.waves : soundscapeWaves(scapes, r.name, depth + 1)));
}
