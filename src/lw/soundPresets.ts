import { Vector3 } from 'three';
import type { MapEntity } from '../vmf/map.ts';

/**
 * Sound presets: a sound together with the effects that go with it (a flickering light and sparks for a
 * broken lamp, flames for a fire, a steam jet, ...), placed as one group. A preset can stand alone (with its
 * own prop) or be added to a prop already in the map (the inspector suggests it for fitting models).
 */

export interface PresetEntity { classname: string; origin: Vector3; keys: Record<string, string> }

export interface SoundPreset {
  id: string;
  label: string;
  icon: string;
  /** Prop placed when the preset stands alone. */
  prop?: { model: string; z?: number };
  /** Models this preset suits: the inspector offers it when one of them is selected. */
  suits?: RegExp;
  /** Where on the prop the effects go, in model space (x forward, y left, z up). */
  anchor?: (model: string) => Vector3;
  effects: (at: Vector3, yaw: number, name: string) => PresetEntity[];
}

const sound = (at: Vector3, name: string, message: string, health: number, radius: number, pitch = 100): PresetEntity => ({
  classname: 'ambient_generic', origin: at.clone().round(),
  keys: { targetname: `${name}_snd`, message, health: String(health), radius: String(radius), pitch: String(pitch), pitchstart: String(pitch), spawnflags: '0' },
});

export const SOUND_PRESETS: SoundPreset[] = [
  {
    id: 'broken_lamp', label: 'Broken lamp', icon: '💡',
    prop: { model: 'models/props_c17/lamppost03a_off.mdl' },
    suits: /lamppost|light_cagelight|lampfixture|light_decklight/i,
    // The lamppost's head hangs from its arm, 100 units out along y.
    anchor: (m) => (/lamppost03a/i.test(m) ? new Vector3(0, 100, 424) : new Vector3(0, 0, 8)),
    effects: (at, _yaw, name) => [
      // Light style 10: the fluorescent flicker (baked by vrad as a switching lightmap).
      { classname: 'light', origin: at.clone().add(new Vector3(0, 0, -16)).round(), keys: { targetname: `${name}_light`, _light: '255 214 160 90', style: '10', _constant_attn: '0', _linear_attn: '0', _quadratic_attn: '1', _distance: '0' } },
      { classname: 'env_spark', origin: at.clone().round(), keys: { targetname: `${name}_spark`, MaxDelay: '3', Magnitude: '1', TrailLength: '1', spawnflags: '64', angles: '90 0 0' } },
      sound(at, name, 'ambient/machines/electric_machine.wav', 4, 448, 120),
    ],
  },
  {
    id: 'fire', label: 'Fire', icon: '🔥',
    prop: { model: 'models/props_c17/oildrum001_static.mdl' },
    suits: /oildrum|barrel|furniturefireplace|stove/i,
    anchor: (m) => (/oildrum/i.test(m) ? new Vector3(0, 0, 46) : new Vector3(0, 0, 24)),
    effects: (at, _yaw, name) => [
      // Infinite, start on, start at full size.
      { classname: 'env_fire', origin: at.clone().round(), keys: { targetname: `${name}_fire`, firesize: '48', fireattack: '1', firetype: '0', spawnflags: '13', health: '30', damagescale: '0' } },
      { classname: 'light', origin: at.clone().add(new Vector3(0, 0, 32)).round(), keys: { targetname: `${name}_light`, _light: '255 140 50 160', style: '6', _constant_attn: '0', _linear_attn: '0', _quadratic_attn: '1', _distance: '0' } },
      sound(at, name, 'ambient/fire/fire_small_loop2.wav', 6, 640),
    ],
  },
  {
    id: 'steam', label: 'Steam leak', icon: '💨',
    suits: /pipe|generator|boiler|radiator/i,
    anchor: () => new Vector3(0, 0, 32),
    effects: (at, yaw, name) => [
      { classname: 'env_steam', origin: at.clone().round(), keys: { targetname: `${name}_steam`, InitialState: '1', type: '0', SpreadSpeed: '15', Speed: '120', StartSize: '10', EndSize: '25', Rate: '26', JetLength: '80', renderamt: '255', rendercolor: '255 255 255', angles: `-20 ${Math.round(yaw)} 0` } },
      sound(at, name, 'ambient/gas/steam_loop1.wav', 5, 512),
    ],
  },
  {
    id: 'radio', label: 'Radio', icon: '📻',
    prop: { model: 'models/props_lab/citizenradio.mdl' },
    suits: /citizenradio/i,
    anchor: () => new Vector3(0, 0, 12),
    // Music plays once at map start (the track has no loop points).
    effects: (at, _yaw, name) => [sound(at, name, 'music/as01.wav', 3, 512)],
  },
  {
    id: 'drip', label: 'Dripping water', icon: '💧',
    anchor: () => new Vector3(0, 0, 0),
    effects: (at, _yaw, name) => [sound(at, name, 'ambient/levels/canals/waterleak_loop1.wav', 5, 384)],
  },
  {
    id: 'generator', label: 'Generator', icon: '⚙',
    prop: { model: 'models/props_canal/generator01.mdl' },
    suits: /generator/i,
    anchor: () => new Vector3(0, 0, 32),
    effects: (at, _yaw, name) => [sound(at, name, 'ambient/levels/canals/generator_ambience_loop1.wav', 7, 768)],
  },
];

/** A model-space point turned by the prop's yaw and moved to its origin. */
export function onProp(origin: Vector3, yaw: number, local: Vector3): Vector3 {
  const r = (yaw * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return new Vector3(origin.x + local.x * c - local.y * s, origin.y + local.x * s + local.y * c, origin.z + local.z);
}

/** Entities for a preset: on an existing prop (its effects only), or standing alone at `at`. */
export function presetEntities(p: SoundPreset, name: string, at: Vector3, yaw: number, onto?: MapEntity): PresetEntity[] {
  const model = onto?.get('model') ?? p.prop?.model ?? '';
  const local = p.anchor?.(model) ?? new Vector3();
  const base = onto?.origin ?? at;
  const yawOf = onto ? onto.angles.y : yaw;
  const out: PresetEntity[] = [];
  if (!onto && p.prop) out.push({ classname: 'prop_static', origin: at.clone().round(), keys: { model: p.prop.model, angles: `0 ${Math.round(yaw)} 0`, solid: '6', targetname: `${name}_prop` } });
  out.push(...p.effects(onProp(base, yawOf, local), yawOf, name));
  return out;
}

/** Presets that suit a prop. */
export function presetsFor(model: string | undefined): SoundPreset[] {
  return model ? SOUND_PRESETS.filter((p) => p.suits?.test(model)) : [];
}

export function nextPresetName(entities: MapEntity[], id: string): string {
  const used = new Set(entities.map((e) => e.get('targetname') ?? ''));
  let n = 1;
  while ([...used].some((t) => t.startsWith(`${id}${n}_`))) n++;
  return `${id}${n}`;
}
