import { Box3, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import type { MapEntity, MapSolid } from '../vmf/map.ts';
import { boxSolid, solidBounds } from './brushes.ts';
import { editorBlock, entityNode } from './actions.ts';
import { loadModel } from '../assets/mdl.ts';
import { fetchGameFile } from '../assets/fetch.ts';
import { SETTING_GROUPS, groupState } from '../lw/mapSettings.ts';
import { WAVE_TYPES } from '../lw/mapTemplates.ts';
import { cameraSpawnFor } from '../lw/kits.ts';
import { checkMission, missionEnds } from '../lw/missionCheck.ts';

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  /** Errors stop a useful compile; warnings only reduce what works in game. */
  severity: 'error' | 'warning';
  detail: string;
  fix?: () => void;
  fixLabel?: string;
  /** Not run yet (the path check, F5): counts toward the total, never as ready. */
  pending?: boolean;
  /** Advice rather than a check (Empty's "Pick a mode"): not counted at all. */
  info?: boolean;
  /** An action that doesn't change the map, such as Show. */
  show?: () => void;
  showLabel?: string;
}

const SKY = 'TOOLS/TOOLSSKYBOX';
const isSky = (s: MapSolid) => s.sides.every((x) => x.material.toUpperCase() === SKY);

/** Bounds of the playable content: everything except the sky shell and the map boundary. */
export function contentBounds(editor: Editor): Box3 {
  const box = new Box3();
  for (const s of editor.doc.worldEntity.solids) if (!isSky(s)) box.union(solidBounds(s));
  for (const e of editor.doc.entities) {
    if (e.classname === 'func_map_boundary') continue;
    for (const s of e.solids) box.union(solidBounds(s));
    if (!e.solids.length && e.origin) box.expandByPoint(e.origin);
  }
  return box;
}

/** True when world sky brushes cover all six sides around the content. */
function hasSkyShell(editor: Editor, content: Box3): boolean {
  const sky = editor.doc.worldEntity.solids.filter(isSky).map(solidBounds);
  if (sky.length < 6 || content.isEmpty()) return false;
  const covers = (axis: 'x' | 'y' | 'z', side: 'min' | 'max') => sky.some((b) => {
    const beyond = side === 'min' ? b.max[axis] <= content.min[axis] + 1 : b.min[axis] >= content.max[axis] - 1;
    if (!beyond) return false;
    return (['x', 'y', 'z'] as const).filter((a) => a !== axis).every((a) => b.min[a] <= content.min[a] && b.max[a] >= content.max[a]);
  });
  return (['x', 'y', 'z'] as const).every((a) => covers(a, 'min') && covers(a, 'max'));
}

/** Six world sky brushes around a box (the inside of the box stays empty). */
export function addShell(editor: Editor, inner: Box3, material = SKY, thickness = 32, owner: MapEntity | null = null): MapSolid[] {
  const doc = editor.doc;
  const t = thickness;
  const a = inner.min, b = inner.max;
  const parts: [Vector3, Vector3][] = [
    [new Vector3(a.x - t, a.y - t, a.z - t), new Vector3(b.x + t, b.y + t, a.z)], // floor
    [new Vector3(a.x - t, a.y - t, b.z), new Vector3(b.x + t, b.y + t, b.z + t)], // ceiling
    [new Vector3(a.x - t, a.y - t, a.z), new Vector3(a.x, b.y + t, b.z)], // -x
    [new Vector3(b.x, a.y - t, a.z), new Vector3(b.x + t, b.y + t, b.z)], // +x
    [new Vector3(a.x, a.y - t, a.z), new Vector3(b.x, a.y, b.z)], // -y
    [new Vector3(a.x, b.y, a.z), new Vector3(b.x, b.y + t, b.z)], // +y
  ];
  return parts.map(([min, max]) => doc.addSolid(boxSolid(doc, min, max, material), owner));
}

function snapOut(box: Box3, g = 64): Box3 {
  return new Box3(
    new Vector3(Math.floor(box.min.x / g) * g, Math.floor(box.min.y / g) * g, Math.floor(box.min.z / g) * g),
    new Vector3(Math.ceil(box.max.x / g) * g, Math.ceil(box.max.y / g) * g, Math.ceil(box.max.z / g) * g),
  );
}

/**
 * Why vbsp would drop a prop_static with this model: no $staticprop, a physics prop_data block, or a
 * model moved after compiling (vbsp loads the .vvd by the compiled-in name and stops). Null when fine.
 */
export async function staticPropProblem(path: string): Promise<'missing' | 'physics' | 'notstatic' | 'moved' | null> {
  const m = path.toLowerCase().replace(/\\/g, '/');
  const mdl = await loadModel(m);
  if (!mdl) return 'missing';
  if (mdl.physicsOnly) return 'physics';
  if (!mdl.isStatic) return 'notstatic';
  const name = mdl.internalName.replace(/\.mdl$/, '');
  if (name && `models/${name}.mdl` !== m && !(await fetchGameFile(`models/${name}.vvd`))) return 'moved';
  return null;
}

/** prop_static entities whose model was not compiled as a static prop (vbsp deletes these). */
export async function nonStaticProps(editor: Editor): Promise<MapEntity[]> {
  const props = editor.doc.entities.filter((e) => e.classname === 'prop_static' && e.get('model'));
  const models = new Map<string, boolean>();
  await Promise.all([...new Set(props.map((e) => e.get('model')!.toLowerCase()))].map(async (m) => {
    const problem = await staticPropProblem(m);
    models.set(m, !problem || problem === 'missing');
  }));
  return props.filter((e) => models.get(e.get('model')!.toLowerCase()) === false);
}

/** Turns props into prop_dynamic with the same model, placement and skin (one undo step). */
export function convertToDynamic(editor: Editor, props: MapEntity[]): void {
  if (!props.length) return;
  const end = editor.history.begin('Convert to prop_dynamic', [], props);
  for (const e of props) {
    e.set('classname', 'prop_dynamic');
    e.set('solid', '6');
    e.set('DisableBoneFollowers', '1');
    for (const k of ['disableselfshadowing', 'disablevertexlighting', 'ignorenormals', 'screenspacefade', 'uniformscale']) e.node.delete(k);
  }
  end();
  editor.changed();
}

type Added = { solids?: MapSolid[]; entities?: MapEntity[] };

/** A fix that adds things, recorded as one undo step. */
function addingFix(editor: Editor, label: string, fn: () => Added): () => void {
  return () => {
    const r = fn();
    editor.history.added(label, r.solids ?? [], r.entities ?? []);
    editor.changed();
  };
}

export function runChecks(editor: Editor): Check[] {
  const doc = editor.doc;
  const ents = doc.entities;
  const count = (cls: string) => ents.filter((e) => e.classname === cls).length;
  const content = contentBounds(editor);
  const checks: Check[] = [];
  const fixed = (label: string, fn: () => Added) => addingFix(editor, label, fn);

  checks.push({
    id: 'content', label: 'Map has geometry', severity: 'error', ok: !content.isEmpty(),
    detail: content.isEmpty() ? 'Draw at least a floor with the Block tool.' : `${doc.worldEntity.solids.length} world brushes`,
  });

  const sealed = hasSkyShell(editor, content);
  checks.push({
    id: 'shell', label: 'Sealed by a sky shell', severity: 'error', ok: sealed,
    detail: sealed ? 'World sky brushes enclose the map.' : 'Without a closed shell of world brushes the map leaks: no visibility data and a dark sky.',
    fixLabel: 'Add sky shell',
    // Every fix places things around the content, so none is offered on a map without any.
    fix: content.isEmpty() ? undefined : fixed('Add sky shell', () => {
      const inner = snapOut(content);
      inner.min.x -= 256; inner.min.y -= 256; inner.max.x += 256; inner.max.y += 256;
      inner.min.z -= 64; inner.max.z += 1024;
      return { solids: addShell(editor, inner) };
    }),
  });

  const sun = count('light_environment');
  const sunAuto = sun === 0 && groupState(doc, SETTING_GROUPS.find((g) => g.id === 'sun')!) === 'auto';
  checks.push({
    id: 'sun', label: 'Sun light (light_environment)', severity: 'warning', ok: sun === 1 || sunAuto,
    detail: sunAuto ? 'Added with default values when compiling (Settings tab).'
      : sun === 0 ? 'Without it outdoor areas are pitch black.' : sun > 1 ? `${sun} found; only one is used.` : 'Present.',
    fixLabel: 'Add sun',
    fix: sun === 0 && !content.isEmpty() ? fixed('Add sun', () => {
      const c = content.getCenter(new Vector3());
      const e = doc.addEntity(entityNode(editor, 'light_environment', new Vector3(c.x, c.y, content.max.z + 64), {
        pitch: '-55', angles: '0 35 0', _light: '255 238 214 450', _ambient: '170 185 210 140',
        _lightHDR: '-1 -1 -1 1', _ambientHDR: '-1 -1 -1 1', _lightscaleHDR: '1', _AmbientScaleHDR: '1', SunSpreadAngle: '2',
      }));
      return { entities: [e] };
    }) : undefined,
  });

  const spawn = count('info_player_start') + count('info_player_wars');
  checks.push({
    id: 'spawn', label: 'Camera spawn (info_player_start)', severity: 'error', ok: spawn > 0,
    detail: spawn ? 'Present.' : 'The engine needs a spawn point to load the map.',
    fixLabel: 'Add spawn',
    fix: spawn || content.isEmpty() ? undefined : fixed('Add spawn', () => {
      const c = content.getCenter(new Vector3());
      const e = doc.addEntity(entityNode(editor, 'info_player_start', new Vector3(Math.round(c.x), Math.round(c.y), Math.round(content.max.z + 256)), { angles: '0 0 0' }));
      return { entities: [e] };
    }),
  });

  const starts = count('info_start_wars');
  const mission = count('wars_player_setup') + count('wars_mission_objective') > 0;
  // Overrun can be played alone; the lobby counts a slot per start with its own owner number (settingsinfo.py).
  const minStarts = count('overrun_wave_spawnpoint') ? 1 : 2;
  const owners = ents.filter((e) => e.classname === 'info_start_wars').map((e) => e.get('ownernumber') ?? '');
  const numbered = owners.every((o) => Number(o) >= 2) && new Set(owners).size === owners.length;
  checks.push({
    id: 'starts', label: mission ? 'Mission setup' : 'Player starts (info_start_wars)', severity: 'warning', ok: mission || (starts >= minStarts && numbered),
    detail: mission
      ? 'Singleplayer mission: the player spawns at its info_player_wars; no multiplayer starts needed.'
      : !numbered ? `${starts} found, but each needs its own Owner Number (Player 0, Player 1, ...): the lobby only counts numbered starts.`
      : `${starts} found. Place one per player with the Entity tool ("Player start").`,
  });

  const boundary = count('func_map_boundary');
  checks.push({
    id: 'boundary', label: 'Map boundary (func_map_boundary)', severity: 'warning', ok: boundary > 0,
    detail: boundary ? 'Present.' : 'Limits the RTS camera and gives fog of war its height data.',
    fixLabel: 'Add boundary',
    fix: boundary || content.isEmpty() ? undefined : fixed('Add boundary', () => {
      const node = new KVNode('entity');
      node.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', 'func_map_boundary'), new KVPair('bloat', '-32.0'));
      const e = doc.addEntity(node);
      const inner = snapOut(content);
      inner.max.z += 1024;
      addShell(editor, inner, 'TOOLS/TOOLSPLAYERCLIP', 32, e);
      node.items.push(editorBlock());
      e.reload();
      return { entities: [e] };
    }),
  });
  return checks;
}

// Map checklist (F4): the checks above, filtered and extended per game mode. The top-bar chip, its popover and
// the compile dialog all show `mapChecklist`.

export type MapMode = 'annihilation' | 'overrun' | 'mission' | 'empty';

export interface ModeInfo {
  mode: MapMode;
  /** Short name for the chip. */
  label: string;
  /** Full name for the popover. */
  title: string;
  /** The name prefix the game lists the mode's maps by. */
  prefix: string | null;
}

export const MAP_MODES: ModeInfo[] = [
  { mode: 'annihilation', label: 'Annihilation', title: 'Annihilation', prefix: 'hlw_' },
  { mode: 'overrun', label: 'Overrun', title: 'Overrun', prefix: 'or_' },
  { mode: 'mission', label: 'Mission', title: 'Singleplayer mission', prefix: 'sp_' },
  { mode: 'empty', label: 'Empty', title: 'Empty', prefix: null },
];

export const modeInfo = (mode: MapMode): ModeInfo => MAP_MODES.find((m) => m.mode === mode)!;

/** The map's file name without folder or extension, in lower case. */
export function mapBaseName(editor: Editor): string {
  return (editor.mapName ?? '').split(/[\\/]/).pop()!.replace(/\.vmf$/i, '').toLowerCase();
}

const countClass = (editor: Editor, ...classes: string[]) => editor.doc.entities.filter((e) => classes.includes(e.classname)).length;

/** The mode the map is made for: its name prefix first, then what it holds (Overrun manager, mission data, starts). */
export function detectMode(editor: Editor): MapMode {
  const name = mapBaseName(editor);
  const byPrefix = MAP_MODES.find((m) => m.prefix && name.startsWith(m.prefix));
  if (byPrefix) return byPrefix.mode;
  if (countClass(editor, 'overrun_manager', 'overrun_wave_spawnpoint')) return 'overrun';
  if (editor.mission?.stages.length || countClass(editor, 'wars_player_setup', 'wars_mission_objective')) return 'mission';
  if (countClass(editor, 'info_start_wars')) return 'annihilation';
  return 'empty';
}

export type CheckState = 'ok' | 'error' | 'warning' | 'pending' | 'info';

export function checkState(c: Check): CheckState {
  if (c.info) return 'info';
  if (c.pending) return 'pending';
  return c.ok ? 'ok' : c.severity;
}

export interface Checklist {
  mode: MapMode;
  /** The mode read from the map; differs from `mode` after Change mode. */
  detected: MapMode;
  /** Player slots: one per info_start_wars, 1 in a mission. */
  players: number;
  checks: Check[];
  /** Counted checks that pass. */
  ready: number;
  /** Every check but advice: pending ones count, as on the board. */
  total: number;
  /** Nothing left to fix: every counted check passes or is pending. The chip turns green. */
  allReady: boolean;
}

export function mapChecklist(editor: Editor, mode = detectMode(editor)): Checklist {
  const checks = modeChecks(editor, mode);
  const counted = checks.filter((c) => !c.info);
  return {
    mode, detected: detectMode(editor), players: playerCount(editor, mode), checks,
    ready: counted.filter((c) => c.ok).length,
    total: counted.length,
    allReady: counted.every((c) => c.ok || c.pending),
  };
}

function playerCount(editor: Editor, mode: MapMode): number {
  if (mode === 'mission') return 1;
  return mode === 'empty' ? 0 : countClass(editor, 'info_start_wars');
}

/** The checks of one mode, in the board's order. */
export function modeChecks(editor: Editor, mode: MapMode): Check[] {
  const content = contentBounds(editor);
  const env = environmentChecks(editor);
  const [shell, sun, boundary] = env;
  switch (mode) {
    case 'annihilation':
      return [annihilationStarts(editor, content), resourcesCheck(editor), shell, sun, nameCheck(editor, mode), boundary, notCheckedYet('reach', 'Units can reach every base')];
    case 'overrun':
      return [overrunStarts(editor, content), waveSpawns(editor), overrunManager(editor, content), ...env];
    case 'mission':
      return [playerCamera(editor, content), missionFlow(editor), notCheckedYet('reach', 'Every objective area reachable'), nameCheck(editor, mode), ...env];
    case 'empty':
      return [...env, PICK_MODE];
  }
}

/** Sky shell, sun and boundary: every mode needs them. */
function environmentChecks(editor: Editor): Check[] {
  const base = new Map(runChecks(editor).map((c) => [c.id, c]));
  const empty = !base.get('content')!.ok;
  const shell = base.get('shell')!, sun = base.get('sun')!, boundary = base.get('boundary')!;
  return [
    { ...shell, label: 'Sky shell', detail: shell.ok ? 'Sealed: world sky brushes enclose the map.' : empty ? 'Nothing to enclose yet: draw a floor with the Block tool first.' : shell.detail },
    { ...sun, label: 'Sun light', detail: sun.detail === 'Present.' ? 'light_environment present.' : sun.detail },
    {
      // ✕ on the board: without it the RTS camera and fog of war don't work at all.
      ...boundary, label: 'Map boundary', severity: 'error',
      detail: boundary.ok ? 'Present: it limits the camera and gives fog of war its height data.' : 'Missing: the camera has no limits and fog of war no height data.',
    },
  ];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const NOT_NUMBERED = 'Each start needs its own Owner Number (Player 0, Player 1, ...): the lobby only counts numbered starts.';

function playerStarts(editor: Editor): MapEntity[] {
  return editor.doc.entities.filter((e) => e.classname === 'info_start_wars');
}

/** Starts with an owner number of a player (2 and up) that no other start has. */
function numberedCount(starts: MapEntity[]): number {
  const owners = starts.map((e) => e.get('ownernumber') ?? '');
  return owners.filter((o) => Number(o) >= 2 && owners.indexOf(o) === owners.lastIndexOf(o)).length;
}

const SYMMETRY_TOLERANCE = 96;

/** True when the points map onto each other turned half round, or mirrored in x or y, about `c`. */
function symmetric(points: Vector3[], c: Vector3): boolean {
  const maps: ((p: Vector3) => [number, number])[] = [
    (p) => [2 * c.x - p.x, 2 * c.y - p.y], (p) => [2 * c.x - p.x, p.y], (p) => [p.x, 2 * c.y - p.y],
  ];
  return maps.some((f) => points.every((p) => {
    const [x, y] = f(p);
    return points.some((q) => Math.hypot(q.x - x, q.y - y) <= SYMMETRY_TOLERANCE);
  }));
}

function annihilationStarts(editor: Editor, content: Box3): Check {
  const starts = playerStarts(editor);
  const numbered = numberedCount(starts);
  const ok = starts.length >= 2 && numbered === starts.length;
  const even = symmetric(starts.map((e) => e.origin ?? new Vector3()), content.getCenter(new Vector3()));
  return {
    id: 'players', label: `Player starts ${numbered}/${Math.max(2, starts.length)}`, severity: 'warning', ok,
    detail: ok ? (even ? 'Placed symmetrically, one per player.' : 'One per player, but not symmetric: one side may have an advantage.')
      : starts.length < 2 ? `${starts.length} placed: Annihilation needs at least 2. Add them with the Entity tool (Multiplayer start).`
      : NOT_NUMBERED,
  };
}

function resourcesCheck(editor: Editor): Check {
  const points = countClass(editor, 'control_point');
  const scrap = countClass(editor, 'scrap_marker_small', 'scrap_marker');
  return {
    id: 'resources', label: 'Resources', severity: 'warning', ok: points > 0,
    detail: points ? `${plural(points, 'requisition point')}, ${plural(scrap, 'scrap pile')}.`
      : 'No requisition points: players can\'t earn requisition. Add them with the Entity tool (Capture point).',
  };
}

const NAME_DETAIL: Partial<Record<MapMode, { ok: string; missing: string }>> = {
  annihilation: { ok: 'hlw_ prefix: listed in the lobby.', missing: 'No hlw_ prefix: the lobby only lists hlw_ maps. Save as… a name that starts with hlw_.' },
  mission: { ok: 'sp_ prefix: compiled with the mission rules.', missing: 'No sp_ prefix: it would compile as a multiplayer map. Save as… a name that starts with sp_.' },
};

function nameCheck(editor: Editor, mode: MapMode): Check {
  const ok = mapBaseName(editor).startsWith(modeInfo(mode).prefix ?? '');
  const text = NAME_DETAIL[mode]!;
  return { id: 'name', label: 'Name', severity: 'warning', ok, detail: ok ? text.ok : text.missing };
}

/** How far from the middle Overrun starts still count as together, as a share of the map's width. */
const TOGETHER_SHARE = 0.25;

function overrunStarts(editor: Editor, content: Box3): Check {
  const starts = playerStarts(editor);
  const centre = content.getCenter(new Vector3());
  const reach = Math.max(content.max.x - content.min.x, content.max.y - content.min.y) * TOGETHER_SHARE;
  const together = starts.every((e) => !e.origin || Math.hypot(e.origin.x - centre.x, e.origin.y - centre.y) <= reach);
  const ok = starts.length >= 1 && numberedCount(starts) === starts.length;
  return {
    id: 'players', label: 'Player starts', severity: 'warning', ok,
    detail: !starts.length ? 'None placed: put 1 to 4 near the centre with the Entity tool (Multiplayer start).'
      : !ok ? NOT_NUMBERED
      : together ? `${starts.length} together in the centre.` : `${starts.length} placed, but spread out: Overrun players hold the centre together.`,
  };
}

function waveSpawns(editor: Editor): Check {
  const n = countClass(editor, 'overrun_wave_spawnpoint');
  return {
    id: 'waves', label: 'Wave spawns', severity: 'warning', ok: n > 0,
    detail: n ? `${n} placed. Their paths to the centre aren't checked yet.` : 'None: no waves can come. Place overrun_wave_spawnpoint entities along the edges.',
  };
}

function overrunManager(editor: Editor, content: Box3): Check {
  const managers = editor.doc.entities.filter((e) => e.classname === 'overrun_manager');
  const wave = managers[0]?.get('wavetype') ?? '';
  const waveLabel = WAVE_TYPES.find((w) => w.value === wave)?.label ?? (wave || 'the game\'s default');
  return {
    id: 'manager', label: 'Overrun manager', severity: 'warning', ok: managers.length === 1,
    detail: managers.length === 1 ? `Wave type: ${waveLabel}.` : managers.length ? `${managers.length} found; the game uses only one.` : 'Missing: the Overrun rules read the default wave type from it.',
    fixLabel: 'Add Overrun manager',
    fix: managers.length || content.isEmpty() ? undefined : addingFix(editor, 'Add Overrun manager', () => {
      const c = content.getCenter(new Vector3());
      const at = new Vector3(Math.round(c.x), Math.round(c.y), Math.round(content.min.z + 64));
      const e = editor.doc.addEntity(entityNode(editor, 'overrun_manager', at, { targetname: 'overrun_manager', angles: '0 0 0', wavetype: WAVE_TYPES[0].value }));
      return { entities: [e] };
    }),
  };
}

function playerCamera(editor: Editor, content: Box3): Check {
  const n = countClass(editor, 'info_player_wars');
  return {
    id: 'camera', label: 'Player camera', severity: 'error', ok: n > 0,
    detail: n ? 'info_player_wars present: the mission starts the camera there.' : 'Missing: the mission needs an info_player_wars where the player starts.',
    fixLabel: 'Add player camera',
    fix: n || content.isEmpty() ? undefined : addingFix(editor, 'Add player camera', () => {
      const c = content.getCenter(new Vector3());
      const e = editor.doc.addEntity(entityNode(editor, 'info_player_wars', cameraSpawnFor(new Vector3(c.x, c.y, content.min.z)), { angles: '65 135 0', ownernumber: '2' }));
      return { entities: [e] };
    }),
  };
}

function missionFlow(editor: Editor): Check {
  const g = editor.mission;
  const base = { id: 'flow', label: 'Mission flow' };
  if (!g?.stages.length) return { ...base, severity: 'error', ok: false, detail: 'No stages yet: build the flow in the Mission panel, with a way to win and a way to lose.' };
  const { win, lose } = missionEnds(g);
  const errors = checkMission(g, editor.doc).filter((i) => i.severity === 'error');
  const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : '';
  return {
    ...base, severity: !win || errors.length ? 'error' : 'warning', ok: win && lose && !errors.length,
    detail: !win ? 'Nothing leads to Victory: the mission can\'t be won.'
      : errors.length ? `${errors[0].text}${more}.`
      : !lose ? 'Nothing leads to Defeat: the player can\'t lose.'
      : `${plural(g.stages.length, 'stage')}, a way to win and a way to lose.`,
  };
}

/** A path check item (F5) until the path check exists: counted, never ready, no action. */
function notCheckedYet(id: string, label: string): Check {
  return { id, label, severity: 'warning', ok: false, pending: true, detail: 'Not checked yet: the path check comes in a later version. Test it in game for now.' };
}

const PICK_MODE: Check = {
  id: 'mode', label: 'Pick a mode', severity: 'warning', ok: false, info: true,
  detail: 'Annihilation, Overrun or a singleplayer mission: each adds what it needs to this list.',
};

/** What Compile checks besides the mode's list: geometry, the engine's spawn point and static prop models. */
export async function compileChecks(editor: Editor): Promise<Check[]> {
  const checks = runChecks(editor).filter((c) => c.id === 'content' || c.id === 'spawn');
  const bad = await nonStaticProps(editor);
  checks.push({
    id: 'static', label: 'Static props use static models', severity: 'warning', ok: !bad.length,
    detail: bad.length ? `${bad.length} prop_static use a physics-only or moved model; vbsp would delete them or stop. Converting them to prop_dynamic keeps them.` : 'All prop_static models were compiled with $staticprop.',
    fixLabel: 'Convert to prop_dynamic',
    fix: bad.length ? () => convertToDynamic(editor, bad) : undefined,
  });
  return checks;
}
