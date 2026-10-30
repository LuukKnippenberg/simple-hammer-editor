import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { MapEntity, VmfDocument } from '../vmf/map.ts';
import { getConnections, setConnections, type Connection } from '../vmf/io.ts';

/**
 * Map-wide settings (sky, sun, fog, exposure, colour correction, ...). Each group is stored as the standard
 * Source entity for it, so maps stay readable by Hammer. Groups marked `auto` are added with default values
 * when compiling a map that lacks them, unless they were switched off (worldspawn key `she_settings_off`).
 * Exposure and bloom have no keyvalues: like the shipped maps, a logic_auto sends them to the tonemap
 * controller when the map starts.
 */

export type FieldKind =
  | { kind: 'number'; min: number; max: number; step: number; unit?: string; /** Shown negated (light_environment pitch). */ negate?: boolean }
  | { kind: 'color' }
  /** "R G B brightness" */
  | { kind: 'light' }
  | { kind: 'bool' }
  /** One bit of spawnflags. */
  | { kind: 'flag'; bit: number }
  /** One component (0 pitch, 1 yaw) of the angles key. */
  | { kind: 'angle'; component: 0 | 1; min: number; max: number }
  | { kind: 'choice'; options: [string, string][] }
  /** A file picked from the game's assets; `name` turns a listed path into the stored value. */
  | { kind: 'file'; folder: string; ext: string; name: (path: string) => string | null };

export type Field = FieldKind & {
  label: string;
  /** Entity key (ignored for `flag` and `angle`, which use spawnflags and angles). */
  key: string;
  /** Tonemap controller input sent by the logic_auto, instead of a key. */
  input?: string;
  default: string;
  hint?: string;
};

export interface SettingGroup {
  id: string;
  title: string;
  classname: string;
  description: string;
  /** Added with defaults when compiling, unless switched off. */
  auto?: boolean;
  /** Keys written when the entity is created and never shown (master flags, global falloff). */
  base: Record<string, string>;
  fields: Field[];
}

const num = (key: string, label: string, def: number, min: number, max: number, step: number, extra: Partial<Field> = {}): Field =>
  ({ kind: 'number', key, label, default: String(def), min, max, step, ...extra }) as Field;

/** Skybox names from the material list: sky_day01_01up.vmt -> sky_day01_01. */
const skyName = (path: string) => {
  const m = /^materials\/skybox\/(.+?)(up|dn|lf|rt|ft|bk)\.vmt$/i.exec(path);
  return m && m[2].toLowerCase() === 'up' ? m[1] : null;
};

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: 'sky', title: 'Sky', classname: 'worldspawn', base: {},
    description: 'The 2D skybox texture drawn behind everything.',
    fields: [{ kind: 'file', key: 'skyname', label: 'Skybox', default: 'sky_day01_01', folder: 'materials/skybox', ext: '.vmt', name: skyName }],
  },
  {
    id: 'sun', title: 'Sun & ambient light', classname: 'light_environment', auto: true,
    description: 'Baked sunlight and sky light (vrad). Changes show in game after a compile.',
    base: { targetname: 'sun', _lightHDR: '-1 -1 -1 1', _ambientHDR: '-1 -1 -1 1', _lightscaleHDR: '1', _AmbientScaleHDR: '1' },
    fields: [
      num('pitch', 'Sun height', -50, 5, 89, 1, { negate: true, unit: '°' }),
      { kind: 'angle', component: 1, key: 'angles', label: 'Sun direction', default: '45', min: 0, max: 359 },
      { kind: 'light', key: '_light', label: 'Sun colour', default: '255 238 214 450' },
      { kind: 'light', key: '_ambient', label: 'Sky ambient', default: '170 185 210 140' },
      num('SunSpreadAngle', 'Shadow softness', 5, 0, 30, 1, { unit: '°', hint: 'Sun spread angle: 0 gives sharp shadows.' }),
    ],
  },
  {
    id: 'shadows', title: 'Dynamic shadows', classname: 'shadow_control', auto: true,
    description: 'Shadows cast by units and dynamic props.',
    base: { targetname: 'shadow_control' },
    fields: [
      { kind: 'color', key: 'color', label: 'Shadow colour', default: '128 128 128' },
      num('distance', 'Max length', 75, 10, 400, 5),
      { kind: 'angle', component: 0, key: 'angles', label: 'Steepness', default: '80', min: 10, max: 90 },
      { kind: 'angle', component: 1, key: 'angles', label: 'Direction', default: '30', min: 0, max: 359 },
      { kind: 'bool', key: 'disableallshadows', label: 'Disable all', default: '0' },
    ],
  },
  {
    id: 'fog', title: 'Fog', classname: 'env_fog_controller', auto: true,
    description: 'Distance fog. The editor previews it with the lighting preview (L).',
    base: { targetname: 'fog', spawnflags: '1', fogdir: '1 0 0', use_angles: '0', foglerptime: '0', mindxlevel: '0', maxdxlevel: '0' },
    fields: [
      { kind: 'bool', key: 'fogenable', label: 'Enabled', default: '1' },
      { kind: 'color', key: 'fogcolor', label: 'Colour', default: '145 174 185' },
      num('fogstart', 'Start', 512, 0, 20000, 64, { unit: 'u' }),
      num('fogend', 'End', 6000, 256, 40000, 128, { unit: 'u' }),
      num('fogmaxdensity', 'Max density', 0.6, 0, 1, 0.05),
      num('farz', 'Far clip', -1, -1, 40000, 128, { unit: 'u', hint: 'Nothing is drawn beyond this distance; -1 is off.' }),
      { kind: 'bool', key: 'fogblend', label: 'Blend colours', default: '0', hint: 'Fade towards the second colour away from the fog direction.' },
      { kind: 'color', key: 'fogcolor2', label: 'Second colour', default: '255 255 255' },
    ],
  },
  {
    id: 'exposure', title: 'Exposure & bloom', classname: 'env_tonemap_controller', auto: true,
    description: 'HDR auto exposure range and bloom, sent to the tonemap controller when the map starts.',
    base: { targetname: 'tonemap' },
    fields: [
      num('', 'Min exposure', 0.7, 0.1, 4, 0.05, { input: 'SetAutoExposureMin' }),
      num('', 'Max exposure', 1.2, 0.2, 8, 0.05, { input: 'SetAutoExposureMax' }),
      num('', 'Bloom', 0.2, 0, 2, 0.05, { input: 'SetBloomScale' }),
      num('', 'Adapt speed', 1, 0.05, 4, 0.05, { input: 'SetTonemapRate' }),
    ],
  },
  {
    id: 'cc', title: 'Colour correction', classname: 'color_correction',
    description: 'A colour grading lookup table for the whole map.',
    base: { targetname: 'cc_global', minfalloff: '-1', maxfalloff: '-1', StartDisabled: '0', fadeOutDuration: '0' },
    fields: [
      {
        kind: 'file', key: 'filename', label: 'Lookup table', default: '', folder: 'scripts/colorcorrection', ext: '.raw',
        name: (p) => p.toLowerCase().endsWith('.raw') ? p : null,
      },
      num('maxweight', 'Strength', 1, 0, 1, 0.05),
      num('fadeInDuration', 'Fade in', 0, 0, 10, 0.5, { unit: 's' }),
    ],
  },
  {
    id: 'post', title: 'Post-processing', classname: 'postprocess_controller',
    description: 'Vignette, local contrast, film grain and blur.',
    base: { targetname: 'postprocess', spawnflags: '1', fadetoblackstrength: '0' },
    fields: [
      num('vignettestart', 'Vignette start', 0.8, 0, 2, 0.05),
      num('vignetteend', 'Vignette end', 1.1, 0, 3, 0.05),
      num('vignetteblurstrength', 'Vignette blur', 0, 0, 1, 0.05),
      num('localcontraststrength', 'Local contrast', 0, -1, 2, 0.05),
      num('localcontrastedgestrength', 'Contrast at edges', 0, 0, 1, 0.05),
      num('filmgrainstrength', 'Film grain', 0, 0, 2, 0.05),
      num('screenblurstrength', 'Screen blur', 0, 0, 1, 0.05),
      num('depthblurstrength', 'Depth blur', 0, 0, 2, 0.05),
      num('depthblurfocaldistance', 'Depth blur focus', 0, 0, 1, 0.05),
      num('fadetime', 'Fade-in time', 2, 0, 10, 0.5, { unit: 's' }),
    ],
  },
  {
    id: 'deferred', title: 'Dynamic sun (deferred)', classname: 'light_deferred_global',
    description: 'Real-time sun and shadows of the deferred renderer, on top of the baked light.',
    base: { targetname: 'deferred_sun', fadetime: '1.0' },
    fields: [
      { kind: 'flag', bit: 1, key: '', label: 'Enabled', default: '1' },
      { kind: 'flag', bit: 2, key: '', label: 'Shadows', default: '1' },
      { kind: 'flag', bit: 4, key: '', label: 'Transitions', default: '1' },
      { kind: 'angle', component: 0, key: 'angles', label: 'Sun height', default: '50', min: 5, max: 89 },
      { kind: 'angle', component: 1, key: 'angles', label: 'Sun direction', default: '27', min: 0, max: 359 },
      { kind: 'light', key: 'diffuse', label: 'Sun colour', default: '255 247 213 550' },
      { kind: 'light', key: 'ambient_high', label: 'Ambient above', default: '141 175 213 100' },
      { kind: 'light', key: 'ambient_low', label: 'Ambient below', default: '141 175 213 100' },
    ],
  },
  {
    id: 'wind', title: 'Wind', classname: 'env_wind',
    description: 'Moves trees, flags and particles.',
    base: { targetname: 'wind' },
    fields: [
      { kind: 'angle', component: 1, key: 'angles', label: 'Direction', default: '0', min: 0, max: 359 },
      num('minwind', 'Min speed', 20, 0, 500, 5),
      num('maxwind', 'Max speed', 50, 0, 500, 5),
      num('mingust', 'Min gust', 50, 0, 1000, 10),
      num('maxgust', 'Max gust', 80, 0, 1000, 10),
      num('mingustdelay', 'Min gust delay', 10, 0, 120, 1, { unit: 's' }),
      num('maxgustdelay', 'Max gust delay', 20, 0, 120, 1, { unit: 's' }),
      num('gustduration', 'Gust length', 5, 0, 60, 1, { unit: 's' }),
      num('gustdirchange', 'Gust turn', 20, 0, 180, 5, { unit: '°' }),
    ],
  },
  {
    id: 'detail', title: 'Detail props', classname: 'env_detail_controller',
    description: 'How far away grass and other detail props fade out.',
    base: { angles: '0 0 0' },
    fields: [
      num('fademindist', 'Fade start', 1200, 0, 8000, 50, { unit: 'u' }),
      num('fademaxdist', 'Fade end', 1800, 0, 10000, 50, { unit: 'u' }),
    ],
  },
  {
    id: 'water', title: 'Water quality', classname: 'water_lod_control',
    description: 'Distance where water switches to cheap rendering.',
    base: { targetname: 'water_lod' },
    fields: [
      num('cheapwaterstartdistance', 'Cheap from', 1500, 0, 20000, 100, { unit: 'u' }),
      num('cheapwaterenddistance', 'Fully cheap at', 2048, 0, 20000, 100, { unit: 'u' }),
    ],
  },
  {
    id: 'music', title: 'Music', classname: 'wars_music_controller',
    description: 'Lambda Wars background music.',
    base: { targetname: 'music' },
    fields: [
      { kind: 'bool', key: 'musicenabled', label: 'Music enabled', default: '1' },
      {
        kind: 'file', key: 'customtrack', label: 'Custom track', default: '', folder: 'sound/music', ext: '.mp3',
        name: (p) => p.replace(/^sound\//i, ''), hint: 'Empty plays the default tracks.',
      },
    ],
  },
];

/** Classes managed here; their markers are not drawn in the viewport. */
export const SETTING_CLASSES = new Set(SETTING_GROUPS.map((g) => g.classname).filter((c) => c !== 'worldspawn'));

const OFF_KEY = 'she_settings_off';

export function settingsEntity(doc: VmfDocument, g: SettingGroup): MapEntity | null {
  if (g.classname === 'worldspawn') return doc.worldEntity;
  return doc.entities.find((e) => e.classname === g.classname) ?? null;
}

export function switchedOff(doc: VmfDocument): Set<string> {
  return new Set((doc.worldEntity.get(OFF_KEY) ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

/** Records that an auto group must not be added at compile (or clears that). */
export function setSwitchedOff(doc: VmfDocument, id: string, off: boolean): void {
  const set = switchedOff(doc);
  if (off) set.add(id);
  else set.delete(id);
  if (set.size) doc.worldEntity.set(OFF_KEY, [...set].join(','));
  else doc.worldEntity.node.delete(OFF_KEY);
}

export type GroupState = 'set' | 'auto' | 'off';

/** `set`: the entity is in the map. `auto`: it will be added with defaults when compiling. `off`: neither. */
export function groupState(doc: VmfDocument, g: SettingGroup): GroupState {
  if (settingsEntity(doc, g)) return 'set';
  return g.auto && !switchedOff(doc).has(g.id) ? 'auto' : 'off';
}

const tonemapName = (doc: VmfDocument) => doc.entities.find((e) => e.classname === 'env_tonemap_controller')?.get('targetname') ?? 'tonemap';

/** The logic_auto connection that sends `input` to the tonemap controller, and its owner. */
function tonemapConnection(doc: VmfDocument, input: string): { auto: MapEntity; list: Connection[]; index: number } | null {
  const target = tonemapName(doc).toLowerCase();
  for (const e of doc.entities) {
    if (e.classname !== 'logic_auto') continue;
    const list = getConnections(e);
    const index = list.findIndex((c) => c.target.toLowerCase() === target && c.input.toLowerCase() === input.toLowerCase());
    if (index >= 0) return { auto: e, list, index };
  }
  return null;
}

function anglesOf(e: MapEntity | null): number[] {
  const a = (e?.get('angles') ?? '0 0 0').trim().split(/\s+/).map(Number);
  while (a.length < 3) a.push(0);
  return a.map((x) => (Number.isFinite(x) ? x : 0));
}

/** Current value of a field: from the entity, the tonemap wiring, or the default. */
export function readField(doc: VmfDocument, g: SettingGroup, f: Field): string {
  const e = settingsEntity(doc, g);
  if (f.input) {
    const found = tonemapConnection(doc, f.input);
    return found ? found.list[found.index].param : f.default;
  }
  if (!e) return f.default;
  if (f.kind === 'flag') {
    const flags = e.get('spawnflags');
    return flags === undefined ? f.default : (parseInt(flags, 10) & f.bit ? '1' : '0');
  }
  if (f.kind === 'angle') return e.get('angles') === undefined ? f.default : String(anglesOf(e)[f.component]);
  return e.get(f.key) ?? f.default;
}

/** Writes a field. The group's entity must exist (see `createGroupEntity`). */
export function writeField(doc: VmfDocument, g: SettingGroup, f: Field, value: string): void {
  const e = settingsEntity(doc, g);
  if (!e) return;
  if (f.input) {
    const found = tonemapConnection(doc, f.input);
    if (found) {
      found.list[found.index] = { ...found.list[found.index], param: value };
      setConnections(found.auto, found.list);
    } else {
      const auto = doc.entities.find((x) => x.classname === 'logic_auto') ?? addEntity(doc, 'logic_auto', { spawnflags: '1' });
      setConnections(auto, [...getConnections(auto), { output: 'OnMapSpawn', target: tonemapName(doc), input: f.input, param: value, delay: 0, times: -1 }]);
    }
    e.version++;
    return;
  }
  if (f.kind === 'flag') {
    const flags = parseInt(e.get('spawnflags') ?? '0', 10) || 0;
    e.set('spawnflags', String(value === '1' ? flags | f.bit : flags & ~f.bit));
  } else if (f.kind === 'angle') {
    const a = anglesOf(e);
    a[f.component] = parseFloat(value) || 0;
    e.set('angles', a.join(' '));
  } else {
    e.set(f.key, value);
  }
}

/** Where new setting entities go: next to the player start, so they sit inside the map. */
function settingsOrigin(doc: VmfDocument): string {
  const start = doc.entities.find((e) => /^info_player_(start|wars)$|^info_start_wars$/.test(e.classname) && e.origin);
  const o = start?.origin;
  return o ? `${Math.round(o.x)} ${Math.round(o.y)} ${Math.round(o.z + 64)}` : '0 0 64';
}

function addEntity(doc: VmfDocument, classname: string, keys: Record<string, string>): MapEntity {
  const node = new KVNode('entity');
  node.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', classname));
  for (const [k, v] of Object.entries(keys)) node.items.push(new KVPair(k, v));
  if (!('origin' in keys)) node.items.push(new KVPair('origin', settingsOrigin(doc)));
  return doc.addEntity(node);
}

/**
 * Adds a group's entity with its default values (and, for exposure, the logic_auto wiring).
 * Returns the created entities.
 */
export function createGroupEntity(doc: VmfDocument, g: SettingGroup): MapEntity[] {
  const before = new Set(doc.entities);
  const e = addEntity(doc, g.classname, { ...g.base });
  for (const f of g.fields) if (!f.input) writeField(doc, g, f, f.default);
  for (const f of g.fields) if (f.input && !tonemapConnection(doc, f.input)) writeField(doc, g, f, f.default);
  if (g.auto) setSwitchedOff(doc, g.id, false);
  e.version++;
  return doc.entities.filter((x) => !before.has(x));
}

/**
 * Prepares turning a group off: takes out the exposure wiring and returns the entity to remove
 * (still in the document, so the caller can record its removal for undo).
 */
export function detachGroup(doc: VmfDocument, g: SettingGroup): MapEntity | null {
  const e = g.classname === 'worldspawn' ? null : settingsEntity(doc, g);
  for (const f of g.fields) {
    if (!f.input) continue;
    const found = tonemapConnection(doc, f.input);
    if (found) setConnections(found.auto, found.list.filter((_, i) => i !== found.index));
  }
  return e;
}

/** For compiling: adds every `auto` group the map lacks. Returns the titles of what was added. */
export function applyMapSettings(doc: VmfDocument): string[] {
  const added: string[] = [];
  for (const g of SETTING_GROUPS) {
    if (groupState(doc, g) !== 'auto') continue;
    createGroupEntity(doc, g);
    added.push(g.title);
  }
  return added;
}
