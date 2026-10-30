import { Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import { boxSolid } from '../edit/brushes.ts';
import { editorBlock, entityNode } from '../edit/actions.ts';
import { getConnections, setConnections, type Connection } from '../vmf/io.ts';
import { UNITS, findUnit, hullSpacing, parseSquad, type UnitType } from './units.ts';

/** Lambda Wars owner numbers: 0 neutral, 1 enemy, 2.. players (Player_0 is the human in missions). */
export const OWNERS: { value: string; label: string }[] = [
  { value: '0', label: 'Neutral' }, { value: '1', label: 'Enemy' },
  ...Array.from({ length: 8 }, (_, i) => ({ value: String(i + 2), label: `Player ${i}${i === 0 ? ' (you)' : ''}` })),
];

export { UNITS } from './units.ts';

export type ParamValue = string | number | boolean;
export interface KitParam {
  key: string;
  label: string;
  /** `unit`: a unit type id (searchable picker); `squad`: a mixed squad string (see parseSquad). */
  type: 'text' | 'number' | 'select' | 'check' | 'unit' | 'squad';
  default: ParamValue;
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface Kit {
  id: string;
  label: string;
  icon: string;
  hint: string;
  params: KitParam[];
  place(editor: Editor, at: Vector3, p: Record<string, ParamValue>): MapEntity[];
}

/**
 * Where to put an info_player_wars so the RTS camera looks at `target`. The game snaps the spawn
 * camera to pitch 65, yaw 135 (core/gamerules/base.py GetPlayerSpawnSpot), whatever the entity's angles.
 */
export function cameraSpawnFor(target: Vector3, height = 700): Vector3 {
  const back = height / Math.tan((65 * Math.PI) / 180);
  const yaw = (135 * Math.PI) / 180;
  return new Vector3(Math.round(target.x - Math.cos(yaw) * back), Math.round(target.y - Math.sin(yaw) * back), Math.round(target.z + height));
}

/** First free `base`, `base_2`, `base_3`, ... targetname. */
export function uniqueName(editor: Editor, base: string): string {
  const used = new Set(editor.doc.entities.map((e) => e.get('targetname')?.toLowerCase()));
  const clean = base.toLowerCase().replace(/[^a-z0-9_]+/g, '_') || 'ent';
  if (!used.has(clean)) return clean;
  for (let i = 2; ; i++) if (!used.has(`${clean}_${i}`)) return `${clean}_${i}`;
}

const v = (x: number, y: number, z: number) => new Vector3(Math.round(x), Math.round(y), Math.round(z));

function add(editor: Editor, cls: string, at: Vector3 | null, keys: Record<string, string>): MapEntity {
  return editor.doc.addEntity(entityNode(editor, cls, at, keys));
}

function connect(e: MapEntity, c: Partial<Connection> & { output: string; target: string; input: string }): void {
  setConnections(e, [...getConnections(e), { param: '', delay: 0, times: -1, ...c }]);
}

/** The map's logic_auto (created on demand) for things that happen at map start. */
export function mapStart(editor: Editor, near: Vector3): MapEntity {
  const existing = editor.doc.entities.find((e) => e.classname === 'logic_auto' && e.get('targetname') === 'map_start');
  return existing ?? add(editor, 'logic_auto', v(near.x, near.y, near.z + 32), { targetname: 'map_start', spawnflags: '1' });
}

/** One wars_win_condition per map. */
function winCondition(editor: Editor, near: Vector3): MapEntity {
  const existing = editor.doc.entities.find((e) => e.classname === 'wars_win_condition');
  return existing ?? add(editor, 'wars_win_condition', v(near.x, near.y + 32, near.z + 32), { targetname: 'mission_result' });
}

/** Points spread on a grid around a centre (for squads and groups). */
export function spread(at: Vector3, n: number, spacing: number): Vector3[] {
  const cols = Math.ceil(Math.sqrt(n));
  const out: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    out.push(v(at.x + (c - (cols - 1) / 2) * spacing, at.y + (r - (Math.ceil(n / cols) - 1) / 2) * spacing, at.z + 4));
  }
  return out;
}

/**
 * Units of one type at the given ground points. Air units (dropship, gunship, scanners, manhacks) are put
 * at the height their locomotion keeps above the ground, so they start flying instead of sitting on the
 * floor; ground units stand on the point. `customType` replaces the unittype key (mission-only variants).
 */
export function placeUnits(editor: Editor, unitId: string, points: Vector3[], owner: string, name: string, yaw = 0, customType = ''): MapEntity[] {
  const u = findUnit(unitId) ?? UNITS[0];
  const unittype = customType.trim() || u.unittype;
  return points.map((p) => add(editor, u.cls, u.air ? v(p.x, p.y, p.z - 4 + u.air) : p, {
    targetname: name, ownernumber: owner, angles: `0 ${Math.round(yaw)} 0`, unittype,
  }));
}

/** Spacing for a group: what the kit asks for, or more for units with a big hull. */
const groupSpacing = (units: UnitType[], asked: number) => Math.max(asked, ...units.map(hullSpacing));

const customTypeParam: KitParam = {
  key: 'unittype', label: 'Custom unittype', type: 'text', default: '',
  hint: 'Optional: a mission-only unittype (e.g. sp_tutorial_unit_metropolice_baton). The entity class stays that of the unit above.',
};

export const KITS: Kit[] = [
  {
    id: 'capture_point', label: 'Capture point', icon: '⚑',
    hint: 'Flag (control_point) with its capture area. Units standing in the area capture it.',
    params: [
      { key: 'name', label: 'Name', type: 'text', default: '' },
      { key: 'radius', label: 'Radius', type: 'number', default: 192 },
      { key: 'owner', label: 'Owner', type: 'select', default: '0', options: OWNERS },
      { key: 'time', label: 'Capture time (s)', type: 'number', default: 15 },
    ],
    place(editor, at, p) {
      const name = uniqueName(editor, String(p.name || 'capture_point'));
      const r = Number(p.radius) || 192;
      const flag = add(editor, 'control_point', at, { targetname: name, ownernumber: String(p.owner), CaptureTime: String(p.time), constructed: '2', autoconstruct: '1' });
      const trig = new KVNode('entity');
      trig.items.push(
        new KVPair('id', String(editor.doc.nextId())), new KVPair('classname', 'trigger_capture_area'),
        new KVPair('control_point', name), new KVPair('spawnflags', '3'), new KVPair('StartDisabled', '0'),
        boxSolid(editor.doc, v(at.x - r, at.y - r, at.z - 16), v(at.x + r, at.y + r, at.z + 128), 'TOOLS/TOOLSTRIGGER'),
        editorBlock(),
      );
      const area = editor.doc.addEntity(trig);
      return [flag, area];
    },
  },
  {
    id: 'mp_start', label: 'Multiplayer start', icon: '🏁',
    hint: 'Player start (info_start_wars: the HQ spawns here) plus the camera spawn above it.',
    params: [
      { key: 'team', label: 'Team hint', type: 'select', default: '', options: [{ value: '', label: 'None' }, ...[1, 2, 3, 4].map((t) => ({ value: `Team ${t}`, label: `Team ${t}` }))] },
      { key: 'yaw', label: 'Facing (°)', type: 'number', default: 0 },
    ],
    place(editor, at, p) {
      const yaw = Number(p.yaw) || 0;
      const n = editor.doc.entities.filter((e) => e.classname === 'info_start_wars').length;
      return [
        add(editor, 'info_start_wars', v(at.x, at.y, at.z + 8), { angles: `0 ${yaw} 0`, ...(p.team ? { groupname: String(p.team) } : {}) }),
        add(editor, 'info_player_wars', cameraSpawnFor(at), { angles: '65 135 0', ownernumber: String(2 + n) }),
      ];
    },
  },
  {
    id: 'sp_start', label: 'Mission player start', icon: '🎥',
    hint: 'Singleplayer start: the player camera, the faction setup and an optional starting squad of mixed units.',
    params: [
      { key: 'faction', label: 'Faction', type: 'select', default: 'rebels', options: [{ value: 'rebels', label: 'Rebels' }, { value: 'combine', label: 'Combine' }] },
      { key: 'squad', label: 'Squad', type: 'squad', default: 'rebel:6', hint: 'Units that start with you, all named player_squad' },
      { key: 'yaw', label: 'Facing (°)', type: 'number', default: 0 },
    ],
    place(editor, at, p) {
      const yaw = Number(p.yaw) || 0;
      const out = [
        add(editor, 'info_player_wars', cameraSpawnFor(at), { angles: '65 135 0', ownernumber: '2' }),
        add(editor, 'wars_player_setup', v(at.x, at.y - 48, at.z + 32), {
          targetname: 'player_setup', Faction: String(p.faction), player: '2', spawnflags: '1',
          Color: p.faction === 'combine' ? '40 120 200 255' : '200 120 20 255',
        }),
      ];
      // One grid for the whole squad, in the order of the entries; at most 24 units.
      const entries = parseSquad(String(p.squad)).filter((e) => findUnit(e.unit) && e.count > 0);
      const total = Math.min(24, entries.reduce((n, e) => n + e.count, 0));
      const points = spread(at, total, groupSpacing(entries.map((e) => findUnit(e.unit)!), 56));
      let i = 0;
      for (const e of entries) {
        const take = points.slice(i, i + e.count);
        i += take.length;
        if (take.length) out.push(...placeUnits(editor, e.unit, take, '2', 'player_squad', yaw, e.unittype));
      }
      return out;
    },
  },
  {
    id: 'unit_group', label: 'Unit group', icon: '☠',
    hint: 'A group of units placed in the map. Enemy units attack what they see. Air units are placed at their flying height.',
    params: [
      { key: 'unit', label: 'Unit', type: 'unit', default: 'zombie' },
      customTypeParam,
      { key: 'count', label: 'Count', type: 'number', default: 5 },
      { key: 'owner', label: 'Owner', type: 'select', default: '1', options: OWNERS },
      { key: 'spacing', label: 'Spacing', type: 'number', default: 64 },
      { key: 'name', label: 'Name', type: 'text', default: '', hint: 'Shared targetname (for scripting)' },
    ],
    place(editor, at, p) {
      const n = Math.max(1, Math.min(40, Number(p.count) || 1));
      const name = p.name ? uniqueName(editor, String(p.name)) : '';
      const u = findUnit(String(p.unit)) ?? UNITS[0];
      return placeUnits(editor, u.id, spread(at, n, groupSpacing([u], Number(p.spacing) || 64)), String(p.owner), name, Math.random() * 360, String(p.unittype ?? ''));
    },
  },
  {
    id: 'wave', label: 'Attack wave', icon: '🌊',
    hint: 'unit_maker that spawns units when enabled and sends them with wars_give_order to the order entity, which marks the goal. Air units spawn on the floor and climb to their flying height.',
    params: [
      { key: 'name', label: 'Name', type: 'text', default: 'wave' },
      { key: 'unit', label: 'Unit', type: 'unit', default: 'combine' },
      customTypeParam,
      { key: 'count', label: 'Total units', type: 'number', default: 8 },
      { key: 'live', label: 'Alive at once', type: 'number', default: 4 },
      { key: 'freq', label: 'Seconds between', type: 'number', default: 2 },
      { key: 'owner', label: 'Owner', type: 'select', default: '1', options: OWNERS },
      { key: 'goal', label: 'Goal offset X', type: 'number', default: 768, hint: 'Where the order entity goes; move it afterwards to change the goal' },
      { key: 'disabled', label: 'Start disabled', type: 'check', default: true },
    ],
    place(editor, at, p) {
      const name = uniqueName(editor, String(p.name || 'wave'));
      const u = findUnit(String(p.unit)) ?? UNITS[0];
      // The order entity is the goal. With an Order Target the game makes a move order that needs a live target
      // (GF_REQTARGETALIVE), so one aimed at an info_target ends at once and the units stay where they spawn.
      const order = add(editor, 'wars_give_order', v(at.x + (Number(p.goal) || 0), at.y, at.z + 16), {
        targetname: `${name}_order`, unitname: `${name}_unit`, overwriteexistingorders: '1',
      });
      const maker = add(editor, 'unit_maker', v(at.x, at.y, at.z + 16), {
        targetname: name, NPCType: String(p.unittype ?? '').trim() || u.unittype, NPCTargetname: `${name}_unit`, ownernumber: String(p.owner),
        MaxNPCCount: String(p.count), MaxLiveChildren: String(p.live), SpawnFrequency: String(p.freq),
        StartDisabled: p.disabled ? '1' : '0', spawnflags: '0',
      });
      connect(maker, { output: 'OnSpawnNPC', target: `${name}_order`, input: 'PerformOrderUnit' });
      return [maker, order];
    },
  },
  {
    id: 'queue', label: 'Walking queue', icon: '🚶',
    hint: 'A line of people at a counter that moves: every few seconds the one in front steps out to the side and walks back to the entrance, and the rest step up one place, front first. Place it at the head of the line.',
    params: [
      { key: 'name', label: 'Name', type: 'text', default: 'queue' },
      { key: 'unit', label: 'Unit', type: 'unit', default: 'unit_citizen' },
      { key: 'owner', label: 'Owner', type: 'select', default: '0', options: OWNERS },
      { key: 'slots', label: 'Places in line', type: 'number', default: 10, hint: 'Two more people walk the way back' },
      { key: 'spacing', label: 'Spacing', type: 'number', default: 52 },
      { key: 'yaw', label: 'Facing (yaw)', type: 'number', default: 90, hint: 'The direction the line faces: 0 east, 90 north' },
      { key: 'length', label: 'Entrance distance', type: 'number', default: 700, hint: 'From the head to where people join the line' },
      { key: 'side', label: 'Leave to the', type: 'select', default: 'left', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
      { key: 'out', label: 'Leave distance', type: 'number', default: 180, hint: 'How far to the side people walk off with their ration' },
      { key: 'interval', label: 'Seconds per step', type: 'number', default: 7 },
      { key: 'phase', label: 'Start delay (s)', type: 'number', default: 1, hint: 'Offset lines next to each other so they don\'t move together' },
    ],
    place(editor, at, p) {
      const name = uniqueName(editor, String(p.name || 'queue'));
      const u = findUnit(String(p.unit)) ?? UNITS[0];
      const slots = Math.max(2, Math.min(24, Math.round(Number(p.slots) || 10)));
      const spacing = Number(p.spacing) || 52;
      const length = Math.max(Number(p.length) || 700, slots * spacing);
      const yaw = Number(p.yaw) || 0;
      const interval = Math.max(2, Number(p.interval) || 7);
      const rad = (yaw * Math.PI) / 180;
      const fwd = new Vector3(Math.cos(rad), Math.sin(rad), 0);
      const side = new Vector3(-fwd.y, fwd.x, 0).multiplyScalar(p.side === 'right' ? -1 : 1);
      const pt = (back: number, out = 0) => at.clone().addScaledVector(fwd, -back).addScaledVector(side, out);
      // The loop, in the order people walk it: the head, off to the side with the ration, back to the
      // entrance, then up the line from the last place to the first. Everyone moves one spot per step.
      const ring = [pt(0), pt(40, Number(p.out) || 180), pt(length), ...Array.from({ length: slots - 1 }, (_, i) => pt((slots - 1 - i) * spacing))];
      // Who moves when within a step: the one leaving first, then each place from the front, so the line
      // closes up a person at a time. Walking off and back has no wait.
      const rank = (j: number) => (j < 3 ? (j === 0 ? 1 : 0) : ring.length - j + 1);
      const stepDelay = Math.min(0.5, (interval * 0.8) / (slots + 1));
      const out: MapEntity[] = [];
      // One order per spot; PerformOrderUnit takes the person by name (the engine looks the parameter up).
      ring.forEach((q, j) => out.push(add(editor, 'wars_give_order', v(q.x, q.y, q.z + 16), {
        targetname: `${name}_p${j}`, angles: `0 ${Math.round(j === 1 ? yaw + (p.side === 'right' ? -90 : 90) : yaw)} 0`, overwriteexistingorders: '1',
      })));
      ring.forEach((q, c) => out.push(add(editor, u.cls, v(q.x, q.y, q.z + 4), {
        targetname: `${name}_c${c}`, ownernumber: String(p.owner), angles: `0 ${Math.round(yaw)} 0`, unittype: u.unittype,
      })));
      // Step t sends person c from spot (c + t) to (c + t + 1); the steps run in a loop, one every interval.
      const n = ring.length;
      for (let t = 0; t < n; t++) {
        const step = add(editor, 'logic_relay', v(at.x - 48, at.y + t * 24, at.z + 64), { targetname: `${name}_step${t}`, spawnflags: '0' });
        for (let c = 0; c < n; c++) {
          const to = (c + t + 1) % n;
          connect(step, { output: 'OnTrigger', target: `${name}_p${to}`, input: 'PerformOrderUnit', param: `${name}_c${c}`, delay: +(rank(to) * stepDelay).toFixed(2) });
        }
        connect(step, { output: 'OnTrigger', target: `${name}_step${(t + 1) % n}`, input: 'Trigger', delay: interval });
        out.push(step);
      }
      connect(mapStart(editor, at), { output: 'OnMapSpawn', target: `${name}_step0`, input: 'Trigger', delay: Math.max(0, Number(p.phase) || 0) });
      return out;
    },
  },
  {
    id: 'message', label: 'Mission message', icon: '💬',
    hint: 'A message box. Shown at map start, or wire Display from a trigger.',
    params: [
      { key: 'text', label: 'Text', type: 'text', default: 'Clear the streets.' },
      { key: 'when', label: 'Show', type: 'select', default: 'start', options: [{ value: 'start', label: 'At map start' }, { value: 'none', label: 'When triggered' }] },
      { key: 'delay', label: 'Delay (s)', type: 'number', default: 1 },
    ],
    place(editor, at, p) {
      const name = uniqueName(editor, 'message');
      const box = add(editor, 'wars_messagebox', v(at.x, at.y, at.z + 32), { targetname: name, Text: String(p.text) });
      if (p.when === 'start') connect(mapStart(editor, at), { output: 'OnMapSpawn', target: name, input: 'Display', delay: Number(p.delay) || 0 });
      return [box];
    },
  },
  {
    id: 'objective', label: 'Objective', icon: '🎯',
    hint: 'Mission objective shown in the HUD. Completing a "wins" objective ends the mission in victory.',
    params: [
      { key: 'text', label: 'Description', type: 'text', default: 'Reach the main square' },
      { key: 'visible', label: 'Visible at start', type: 'check', default: true },
      { key: 'wins', label: 'Completing wins', type: 'check', default: false },
      { key: 'priority', label: 'Priority', type: 'number', default: 10 },
    ],
    place(editor, at, p) {
      const name = uniqueName(editor, 'objective');
      const obj = add(editor, 'wars_mission_objective', v(at.x, at.y, at.z + 32), {
        targetname: name, description: String(p.text), priority: String(p.priority), visible: p.visible ? '1' : '0',
      });
      if (p.wins) connect(obj, { output: 'OnCompleted', target: winCondition(editor, at).get('targetname')!, input: 'PlayerVictory', delay: 3 });
      return [obj];
    },
  },
];

/** Hate relations between the human player and every other owner used by units, applied at map start. */
export function applyStandardRelations(editor: Editor): MapEntity[] {
  const owners = new Set<string>();
  for (const e of editor.doc.entities) {
    if (!/^unit_|^build_/.test(e.classname) && e.classname !== 'unit_maker') continue;
    const o = e.get('ownernumber');
    if (o && o !== '0' && o !== '2') owners.add(o);
  }
  const created: MapEntity[] = [];
  const anchor = editor.doc.entities.find((e) => e.classname === 'info_player_wars')?.origin ?? new Vector3();
  const start = mapStart(editor, anchor);
  let i = 0;
  for (const o of owners) {
    const name = `player_hates_${o}`;
    if (editor.doc.entities.some((e) => e.get('targetname') === name)) continue;
    created.push(add(editor, 'wars_player_relation', v(anchor.x + 32 * i++, anchor.y + 64, anchor.z - 600), {
      targetname: name, disposition: '1', reciprocal: '1', subjectplayer: '2', targetplayer: o,
    }));
    connect(start, { output: 'OnMapSpawn', target: name, input: 'ApplyRelation' });
  }
  return created;
}

/**
 * Runs a kit-style change as one undo step: new entities are recorded as added, and the shared
 * logic entities kits append outputs to (map_start, the win condition) are snapshotted first.
 */
export function recordKit(editor: Editor, label: string, fn: () => void): MapEntity[] {
  const doc = editor.doc;
  const before = new Set(doc.entities);
  const shared = doc.entities.filter((e) => e.classname === 'logic_auto' || e.classname === 'wars_win_condition');
  let created: MapEntity[] = [];
  editor.history.group(label, () => {
    const end = editor.history.begin('Update logic', [], shared);
    fn();
    end();
    created = doc.entities.filter((e) => !before.has(e));
    editor.history.added('Add entities', [], created);
  });
  editor.changed();
  return created;
}
