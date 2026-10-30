import { fetchGameFile, fetchGameText } from '../assets/fetch.ts';
import { manifestFiles, pcfSystemNames } from '../assets/pcf.ts';

/**
 * The game's particle effects (every system in the PCFs the manifest loads), and the rough look the
 * editor gives them: an `info_particle_system` is drawn as a labelled sprite with a size and colour
 * guessed from the effect's name.
 */

export interface ParticleEffect { name: string; file: string }

export type ParticleKind = 'smoke' | 'fire' | 'sparks' | 'explosion' | 'steam' | 'dust' | 'water' | 'electric' | 'glow' | 'other';

export interface ParticleLook { kind: ParticleKind; color: number; /** Rough width in units. */ size: number; /** Rough height the effect rises to. */ height: number }

const LOOKS: Record<ParticleKind, { color: number; size: number; height: number }> = {
  smoke: { color: 0x4c4c52, size: 160, height: 512 },
  fire: { color: 0xff7a1a, size: 96, height: 160 },
  sparks: { color: 0xffe066, size: 48, height: 64 },
  explosion: { color: 0xff4a1a, size: 256, height: 256 },
  steam: { color: 0xe8eef2, size: 64, height: 160 },
  dust: { color: 0xb8a07a, size: 192, height: 96 },
  water: { color: 0x5aa8e6, size: 64, height: 64 },
  electric: { color: 0x7ad8ff, size: 64, height: 96 },
  glow: { color: 0x9ad0ff, size: 64, height: 64 },
  other: { color: 0xd070ff, size: 64, height: 64 },
};

const RULES: [RegExp, ParticleKind][] = [
  [/explo|shockwave|blast|burst/i, 'explosion'],
  [/smoke|plume|haze|smoulder|exhaust|cloud/i, 'smoke'],
  [/fire|flame|burn|ember|bonfire|lava|molotov/i, 'fire'],
  [/spark/i, 'sparks'],
  [/steam/i, 'steam'],
  [/dust|sand|debris|rubble/i, 'dust'],
  [/water|rain|drip|splash|leak|waterfall/i, 'water'],
  [/electric|zap|arc|lightning|elmos|portal|rift/i, 'electric'],
  [/glow|light|flash|beam/i, 'glow'],
];

export function particleKind(name: string): ParticleKind {
  for (const [re, kind] of RULES) if (re.test(name)) return kind;
  return 'other';
}

/** Size words in the name scale the guess: small, medium, large, huge, skybox. */
export function particleLook(name: string): ParticleLook {
  const kind = particleKind(name);
  const base = LOOKS[kind];
  const s = /huge|skybox|silo|column/i.test(name) ? 3 : /large|big/i.test(name) ? 1.8 : /medium/i.test(name) ? 1 : /small|tiny|verysmall/i.test(name) ? 0.5 : 1;
  return { kind, color: base.color, size: Math.round(base.size * s), height: Math.round(base.height * s) };
}

/** Effects that fit the Civil Protection beats, offered first in the picker. */
export const FAVOURITE_EFFECTS: { name: string; label: string }[] = [
  { name: 'smoke_large_01', label: 'Smoke column' },
  { name: 'Skybox_Smoke_01', label: 'Skyline smoke (far away)' },
  { name: 'smoke_dark_plume_1', label: 'Dark plume' },
  { name: 'burning_vehicle', label: 'Burning car' },
  { name: 'fire_large_01', label: 'Large fire' },
  { name: 'env_fire_medium_smoke', label: 'Medium fire with smoke' },
  { name: 'smoke_smoulder_01', label: 'Smouldering' },
  { name: 'embers_large_01', label: 'Embers' },
  { name: 'explosion_sparks', label: 'Sparks' },
  { name: 'explosion_huge', label: 'Huge explosion' },
  { name: 'steam_jet_80', label: 'Steam jet' },
  { name: 'citadel_shockwave', label: 'Citadel shockwave' },
];

let catalog: Promise<ParticleEffect[]> | null = null;

/** Every effect name the game loads, sorted, with the PCF it is in. The first file defining a name wins. */
export function loadParticleCatalog(): Promise<ParticleEffect[]> {
  catalog ??= (async () => {
    const text = await fetchGameText('particles/particles_manifest.txt');
    const files = [...new Set(text ? manifestFiles(text) : [])];
    const seen = new Map<string, ParticleEffect>();
    const lists = await Promise.all(files.map(async (file) => {
      const buf = await fetchGameFile(file);
      return { file, names: buf ? pcfSystemNames(buf) : [] };
    }));
    for (const { file, names } of lists) {
      for (const name of names) if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { name, file });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();
  return catalog;
}
