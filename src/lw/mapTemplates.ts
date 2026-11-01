import { Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import { VmfDocument } from '../vmf/map.ts';
import { boxFaces, solidNode } from '../edit/brushes.ts';
import { addEnvironment, entity, finishDoc, terrainPatch } from '../gen/layout.ts';
import { GROUND_SETS } from '../edit/terrain.ts';
import { applyMapSettings } from './mapSettings.ts';
import { cameraSpawnFor } from './kits.ts';
import { findUnit } from './units.ts';
import type { MissionGraph } from './mission.ts';

/**
 * Starting points for New: maps with what each Lambda Wars game mode needs already placed, on flat
 * displacement ground inside a sky shell, with sun, fog and the RTS map boundary, so they compile and play
 * straight away. Everything is planned in map coordinates centred on the origin (`planTemplate`) and then
 * built into a document (`buildTemplate`); the dialog draws the plan as its preview.
 *
 * What the game asks of each mode:
 * - Annihilation (wars_game/gamerules/annihilation.py) lists maps matching `^hlw_`; the lobby counts one slot
 *   per info_start_wars with an `ownernumber` (menu/gamelobby/settingsinfo.py) and offers team modes from
 *   their `groupname` hints. Requisition comes from control_point + trigger_capture_area, scrap from
 *   scrap_marker_small, as in the shipped hlw_ maps.
 * - Overrun (wars_game/gamerules/overrun.py) lists `^or_` maps, spawns waves at overrun_wave_spawnpoint
 *   (warns when there are none) that the players can't see, and reads its defaults from an overrun_manager.
 * - Missions (`sp_`) spawn the player at its info_player_wars; wars_player_setup sets the faction. The
 *   compile switches to the mission gamerules and writes the menu entry (server/compile.ts, compileDialog.ts).
 */

export type TemplateKind = 'annihilation' | 'overrun' | 'mission' | 'empty';
export type MapSize = 'small' | 'medium' | 'large';

export interface TemplateOptions {
  kind: TemplateKind;
  /** Annihilation: 2, 4, 6 or 8. Overrun: 1 to 4. Missions have one player. */
  players: number;
  size: MapSize;
  /** A ground blend material (GROUND_SETS). */
  ground?: string;
  /** Overrun: the default wave type (the lobby can change it). */
  wavetype?: string;
  /** Mission: the player's faction. */
  faction?: 'rebels' | 'combine';
}

/** Playable area side (the map boundary) per size. */
export const MAP_SIZES: Record<MapSize, { label: string; units: number }> = {
  small: { label: 'Small', units: 4096 },
  medium: { label: 'Medium', units: 6144 },
  large: { label: 'Large', units: 8192 },
};

/** Overrun wave types (BaseWaveType names in wars_game/gamerules/overrun.py). */
export const WAVE_TYPES: { value: string; label: string }[] = [
  { value: 'antlions', label: 'Antlions' }, { value: 'zombie', label: 'Zombies' }, { value: 'combine', label: 'Combine' },
  { value: 'rebels', label: 'Rebels' }, { value: 'infected', label: 'Infected' }, { value: 'alltypes', label: 'All types' },
];

export interface TemplateInfo {
  kind: TemplateKind;
  label: string;
  icon: string;
  description: string;
  /** Player counts offered (empty: no choice). */
  players: number[];
  defaultPlayers: number;
  /** One line per kind of thing placed. */
  places(o: TemplateOptions): string[];
  defaultName(o: TemplateOptions): string;
}

const BASICS = 'Ground, sky shell, sun, fog and map boundary';

export const TEMPLATES: TemplateInfo[] = [
  {
    kind: 'annihilation', label: 'Annihilation', icon: '⚔', players: [2, 4, 6, 8], defaultPlayers: 2,
    description: 'Competitive skirmish: destroy every enemy base. Listed in the lobby as an hlw_ map.',
    places: (o) => {
      const p = planTemplate(o);
      return [`${p.starts.length} player starts${p.starts.some((s) => s.team) ? ' in two teams' : ''}, placed symmetrically`,
        `${p.points.length} requisition points`, `${p.scrap.length} scrap piles`, BASICS];
    },
    defaultName: (o) => `hlw_untitled_${o.players}p.vmf`,
  },
  {
    kind: 'overrun', label: 'Overrun', icon: '🛡', players: [1, 2, 3, 4], defaultPlayers: 2,
    description: 'Co-op defence: hold the centre against growing waves. Listed as an or_ map.',
    places: (o) => {
      const p = planTemplate(o);
      return [`${p.starts.length} player start${p.starts.length > 1 ? 's' : ''} together in the centre`,
        `${p.waves.length} wave spawn points along the edges`, 'Overrun manager (default wave type)', BASICS];
    },
    defaultName: () => 'or_untitled.vmf',
  },
  {
    kind: 'mission', label: 'Singleplayer mission', icon: '🎯', players: [], defaultPlayers: 1,
    description: 'A story mission with stages and objectives. Compiled as an sp_ map with the mission rules.',
    places: () => ['Player camera, faction setup and a starting squad', 'Mission flow: reach the outpost to win, lose your squad to fail', BASICS],
    defaultName: () => 'sp_untitled.vmf',
  },
  {
    kind: 'empty', label: 'Empty', icon: '□', players: [], defaultPlayers: 1,
    description: 'Nothing at all: draw the map from scratch.',
    places: () => ['Nothing (the pre-flight checks offer what is missing)'],
    defaultName: () => 'untitled.vmf',
  },
];

export const templateInfo = (kind: TemplateKind): TemplateInfo => TEMPLATES.find((t) => t.kind === kind)!;

export interface PlannedStart { x: number; y: number; yaw: number; owner: number; team?: string }
export interface PlannedPoint { x: number; y: number; name: string }
export interface PlannedSpot { x: number; y: number; yaw: number }

/** Where everything goes, in map coordinates (the playable square is centred on the origin). */
export interface TemplatePlan {
  size: number;
  starts: PlannedStart[];
  points: PlannedPoint[];
  scrap: PlannedSpot[];
  waves: PlannedSpot[];
  /** Mission: the player's squad and the area to reach (x0, y0, x1, y1). */
  squad: PlannedSpot[];
  goal: [number, number, number, number] | null;
}

const r = Math.round;
const yawTo = (x: number, y: number, tx: number, ty: number) => r((Math.atan2(ty - y, tx - x) * 180) / Math.PI);
/** Capture area half size (the same as the Capture point kit). */
export const CAPTURE_RADIUS = 192;

export function planTemplate(o: TemplateOptions): TemplatePlan {
  const size = MAP_SIZES[o.size].units;
  const half = size / 2;
  const plan: TemplatePlan = { size, starts: [], points: [], scrap: [], waves: [], squad: [], goal: null };
  if (o.kind === 'empty') return plan;
  // Bases stay well inside the boundary, so the HQ, its scrap and the camera all fit.
  const edge = half - Math.max(640, size * 0.14);
  const clamp = (v: number) => Math.max(-half + 160, Math.min(half - 160, v));

  if (o.kind === 'annihilation') {
    const n = [2, 4, 6, 8].includes(o.players) ? o.players : 2;
    // 2: opposite corners (point symmetry), 4: all corners, 6 and 8: two facing rows (mirror and point symmetry).
    let spots: { x: number; y: number; team?: string }[];
    if (n === 2) spots = [{ x: -edge, y: -edge }, { x: edge, y: edge }];
    else if (n === 4) spots = [{ x: -edge, y: -edge, team: 'Team 1' }, { x: edge, y: -edge, team: 'Team 1' }, { x: edge, y: edge, team: 'Team 2' }, { x: -edge, y: edge, team: 'Team 2' }];
    else {
      const k = n / 2;
      const row = Array.from({ length: k }, (_, i) => -edge + (i * 2 * edge) / (k - 1));
      spots = [...row.map((x) => ({ x, y: -edge, team: 'Team 1' })), ...[...row].reverse().map((x) => ({ x, y: edge, team: 'Team 2' }))];
    }
    plan.starts = spots.map((s, i) => ({ x: r(s.x), y: r(s.y), yaw: yawTo(s.x, s.y, 0, 0), owner: 2 + i, ...(s.team ? { team: s.team } : {}) }));
    // A requisition point in front of every base, then contested ones: the centre and (by layout) the other
    // diagonal, the edge midpoints or the side midpoints.
    const ahead = Math.min(900, size * 0.2);
    const pts: { x: number; y: number }[] = plan.starts.map((s) => {
      if (n >= 6) return { x: s.x, y: s.y - Math.sign(s.y) * ahead };
      const d = Math.hypot(s.x, s.y);
      return { x: s.x - (s.x / d) * ahead, y: s.y - (s.y / d) * ahead };
    });
    pts.push({ x: 0, y: 0 });
    const far = r(half * 0.45);
    if (n === 2) pts.push({ x: -far, y: far }, { x: far, y: -far });
    else if (n === 4) pts.push({ x: edge, y: 0 }, { x: 0, y: edge }, { x: -edge, y: 0 }, { x: 0, y: -edge });
    else pts.push({ x: -edge, y: 0 }, { x: edge, y: 0 });
    plan.points = pts.map((p, i) => ({ x: r(p.x), y: r(p.y), name: `reqpoint${i + 1}` }));
    // Three scrap piles beside and behind every base (the HQ keeps 180 units clear of scrap), four in the middle.
    for (const s of plan.starts) {
      const a = (s.yaw * Math.PI) / 180;
      for (const turn of [90, -90, 180]) {
        const b = a + (turn * Math.PI) / 180;
        plan.scrap.push({ x: r(clamp(s.x + Math.cos(b) * 480)), y: r(clamp(s.y + Math.sin(b) * 480)), yaw: (s.yaw + turn + 360) % 360 });
      }
    }
    const mid = r(size * 0.1);
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) plan.scrap.push({ x: sx * mid, y: sy * mid, yaw: 0 });
  } else if (o.kind === 'overrun') {
    const n = Math.max(1, Math.min(4, o.players || 1));
    const ring = n === 1 ? 0 : 640;
    for (let i = 0; i < n; i++) {
      const a = ((225 + (360 * i) / n) * Math.PI) / 180;
      const x = r(Math.cos(a) * ring), y = r(Math.sin(a) * ring);
      plan.starts.push({ x, y, yaw: n === 1 ? 90 : (yawTo(0, 0, x, y) + 360) % 360, owner: 2 + i });
    }
    // Waves come in from every corner and edge midpoint, out of the defenders' sight.
    const w = half - 384;
    for (const [sx, sy] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) {
      plan.waves.push({ x: sx * w, y: sy * w, yaw: (yawTo(sx * w, sy * w, 0, 0) + 360) % 360 });
    }
  } else {
    // Mission: the player starts in the south and has to reach the outpost in the north.
    const s = { x: 0, y: r(-edge), yaw: 90, owner: 2 };
    plan.starts.push(s);
    const cols = 2;
    for (let i = 0; i < 4; i++) plan.squad.push({ x: s.x + ((i % cols) - 0.5) * 64, y: s.y + 160 + Math.floor(i / cols) * 64, yaw: 90 });
    const g = r(edge);
    plan.goal = [-256, g - 256, 256, g + 256];
  }
  return plan;
}

export interface BuiltTemplate {
  doc: VmfDocument;
  mission: MissionGraph | null;
  plan: TemplatePlan;
}

const APRON = 1024;
const PATCH = 512;
const CEILING = 1280;

/** Builds the template as a new document (and, for a mission, its flowchart). */
export function buildTemplate(o: TemplateOptions): BuiltTemplate {
  const plan = planTemplate(o);
  if (o.kind === 'empty') return { doc: VmfDocument.empty(), mission: null, plan };
  const doc = VmfDocument.empty();
  const size = plan.size, half = size / 2;
  doc.world.set('skyname', 'sky_day01_01');
  const solids: KVNode[] = [];
  const ents: KVNode[] = [];
  // Work in layout space (0..size, like the map generator) and shift to the centred map at the end.
  const L = (x: number, y: number, z = 0) => new Vector3(r(x + half), r(y + half), r(z));

  // Flat displacement ground over the playable area and an apron around it (so the camera never sees the
  // void), dirt worn into the ground under the bases, points and the mission goal.
  const pads: [number, number, number][] = [
    ...plan.starts.map((s) => [s.x, s.y, 420] as [number, number, number]),
    ...plan.points.map((p) => [p.x, p.y, 260] as [number, number, number]),
  ];
  if (plan.goal) pads.push([(plan.goal[0] + plan.goal[2]) / 2, (plan.goal[1] + plan.goal[3]) / 2, 360]);
  const alphaAt = (lx: number, ly: number) => {
    const x = lx - half, y = ly - half;
    let a = 0;
    for (const [px, py, rad] of pads) {
      const d = Math.hypot(x - px, y - py);
      a = Math.max(a, d <= rad ? 255 : d >= rad + 192 ? 0 : 255 * (1 - (d - rad) / 192));
    }
    return a;
  };
  const material = o.ground && GROUND_SETS.some((g) => g.material === o.ground) ? o.ground : GROUND_SETS[0].material;
  for (let y = -APRON; y < size + APRON; y += PATCH) for (let x = -APRON; x < size + APRON; x += PATCH) {
    solids.push(terrainPatch(doc, x, y, PATCH, material, () => 0, alphaAt));
  }

  for (const s of plan.starts) {
    if (o.kind !== 'mission') {
      ents.push(entity(doc, 'info_start_wars', L(s.x, s.y, 8), {
        angles: `0 ${s.yaw} 0`, ownernumber: String(s.owner), spawnflags: '0', ...(s.team ? { groupname: s.team } : {}),
      }));
    }
    ents.push(entity(doc, 'info_player_wars', cameraSpawnFor(L(s.x, s.y)), { angles: '65 135 0', ownernumber: String(s.owner) }));
  }
  for (const p of plan.points) {
    ents.push(entity(doc, 'control_point', L(p.x, p.y), {
      targetname: p.name, angles: '0 0 0', ownernumber: '0', autoconstruct: '1', CaptureTime: '15.0', constructed: '2',
      constructprogress: '0.0', constructtime: '5.0', unittype: 'unit_unknown',
    }));
    const trig = entity(doc, 'trigger_capture_area', L(p.x, p.y, 56), { control_point: p.name, spawnflags: '3', StartDisabled: '0' });
    const c = CAPTURE_RADIUS;
    trig.items.push(solidNode(doc, boxFaces(L(p.x - c, p.y - c, -16), L(p.x + c, p.y + c, 128), 'TOOLS/TOOLSTRIGGER')));
    ents.push(trig);
  }
  for (const s of plan.scrap) {
    ents.push(entity(doc, 'scrap_marker_small', L(s.x, s.y), { angles: `0 ${s.yaw} 0`, autoconstruct: '1', constructed: '2', unittype: 'scrap_marker_small' }));
  }
  if (o.kind === 'overrun') {
    ents.push(entity(doc, 'overrun_manager', L(0, -256, 64), { targetname: 'overrun_manager', angles: '0 0 0', InDoor: '0', spawnflags: '0', wavetype: o.wavetype ?? 'antlions' }));
    plan.waves.forEach((w, i) => ents.push(entity(doc, 'overrun_wave_spawnpoint', L(w.x, w.y, 16), {
      targetname: `wave_spawn${i + 1}`, angles: `0 ${w.yaw} 0`, StartDisabled: '0', Priority: '0', MaxRadius: '0',
    })));
  }
  let mission: MissionGraph | null = null;
  if (o.kind === 'mission') {
    const faction = o.faction ?? 'rebels';
    const s = plan.starts[0];
    ents.push(entity(doc, 'wars_player_setup', L(s.x, s.y - 48, 32), {
      targetname: 'player_setup', Faction: faction, player: '2', spawnflags: '1', Color: faction === 'combine' ? '40 120 200 255' : '200 120 20 255',
    }));
    const u = findUnit(faction === 'combine' ? 'combine' : 'rebel')!;
    for (const p of plan.squad) ents.push(entity(doc, u.cls, L(p.x, p.y, 4), { targetname: 'player_squad', ownernumber: '2', angles: `0 ${p.yaw} 0`, unittype: u.unittype }));
    doc.world.set('message', 'Untitled mission');
    doc.world.set('she_description', 'Lead your squad to the outpost.');
    mission = starterMission(plan.goal!);
  }

  addEnvironment(doc, solids, ents, { width: size, height: size, apron: APRON, maxHeight: CEILING, sunYaw: 40, fogColor: '185 195 205' });
  const out = finishDoc(doc, solids, ents, new Vector3(-half, -half, 0));
  // Shadows and exposure too, so the Settings tab shows every group the compile would add.
  applyMapSettings(out);
  return { doc: out, mission, plan };
}

/** One stage: reach the goal area to win; losing every unit fails the mission. */
export function starterMission(goal: [number, number, number, number]): MissionGraph {
  return {
    version: 1,
    start: 'start',
    stages: [{
      id: 'start', title: 'Reach the outpost', x: 80, y: 120,
      messages: [{ speaker: 'Commander', text: 'Lead your squad north to the outpost.', hint: 'Select your units and right-click to move.' }],
      objectives: [{ id: 'obj_reach', text: 'Reach the outpost' }],
      actions: [], gates: [],
      transitions: [
        { id: 'to_victory', condition: { kind: 'reach', area: goal, z: 0, owner: '2' }, to: 'victory', completes: true },
        { id: 'to_defeat', condition: { kind: 'destroy_faction', owner: '2' }, to: 'defeat', completes: false },
      ],
    }],
  };
}
