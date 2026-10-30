/**
 * The mission flowchart: stages joined by transitions. A stage shows messages and objectives when it
 * starts; each transition fires when its condition is met and leads to another stage, to victory or to
 * defeat. The graph is saved next to the map (maps/<name>.mission.json) and built into entities and I/O
 * by `buildMission` (missionBuild.ts).
 */

import { GAME_ABILITIES } from './gameAbilities.ts';

export type Owner = string;

export type Condition =
  /** Units of `owner` enter a box on the map. */
  | { kind: 'reach'; area: [number, number, number, number] | null; z: number; owner: Owner }
  /** Every unit with this targetname is killed (a unit group, a wave's units), or a unit_maker's spawned units all die. */
  | { kind: 'destroy'; target: string }
  /** A player has no population left. */
  | { kind: 'destroy_faction'; owner: Owner }
  /** A player's population reaches at least / at most `count`. */
  | { kind: 'troops'; owner: Owner; count: number; compare: 'atleast' | 'atmost' }
  /** Time runs out (a timer shown in the HUD while the stage is active). */
  | { kind: 'survive'; seconds: number }
  /** Fires when the named unit or object is lost: use it for defeat. */
  | { kind: 'lost'; target: string }
  /** A player owns N resources. Not available yet: the game has no entity that reports resources. */
  | { kind: 'resources'; owner: Owner; amount: number }
  /** A capture point is captured by `owner`. */
  | { kind: 'capture'; target: string; owner: Owner }
  /** `owner` finishes (or starts) `count` buildings of a type (a unit info name such as build_comb_garrison). */
  | { kind: 'building'; building: string; owner: Owner; count: number; when: 'finished' | 'started' }
  /** `owner` completes an ability `count` times: a research, a trained unit (its unit name) or a cast ability. */
  | { kind: 'ability'; ability: string; owner: Owner; count: number }
  /** Every one of these conditions has been met while the stage runs, in any order. */
  | { kind: 'all'; conditions: Condition[] };

export type ConditionKind = Condition['kind'];

export interface Transition {
  id: string;
  condition: Condition;
  /** A stage id, or 'victory' / 'defeat'. */
  to: string;
  /** Mark the stage's objectives completed (true) or failed (false) when this transition is taken. */
  completes: boolean;
}

export interface Objective { id: string; text: string }

/**
 * A message box. The game's box shows one block of text (as HTML), so the speaker is put in front in bold
 * and the hint below it in italics. A text starting with `#` is a localisation token the game looks up as
 * a whole: a speaker or hint can't be added to it.
 */
export interface MissionMessage { text: string; speaker?: string; hint?: string }

/** Speakers offered in the editor; any other name works too. */
export const SPEAKERS = ['Dispatch', 'Overwatch', 'Supervisor', 'Ringleader', 'Commander', 'Civil Protection'];

/** Locks, unlocks, hides or researches an ability (or a build-menu entry) for a player as the stage starts. */
export interface AbilityGate { id: string; op: GateOp; ability: string; owner: Owner }
export type GateOp = 'lock' | 'unlock' | 'hide' | 'show' | 'research';

/** The wars_ability_manager input for each gate (the game spells "Unavailabe" this way). */
export const GATE_OPS: Record<GateOp, { label: string; input: string }> = {
  lock: { label: 'Lock', input: 'LockAbility' },
  unlock: { label: 'Unlock', input: 'UnlockAbility' },
  hide: { label: 'Hide while unavailable', input: 'HideAbilityOnUnavailabe' },
  show: { label: 'Show while unavailable', input: 'ShowAbilityOnUnavailabe' },
  research: { label: 'Research now', input: 'ResearchAbility' },
};

/** Something a stage does as it starts, as an entity input: enable a wave, open a gate, give an order. */
export interface StageAction { id: string; target: string; input: string; param: string; delay: number }

export interface Stage {
  id: string;
  title: string;
  /** Position on the flowchart canvas. */
  x: number;
  y: number;
  /** Shown one after another when the stage starts. Plain strings are older saves (text only). */
  messages: (MissionMessage | string)[];
  objectives: Objective[];
  /** Fired when the stage starts. */
  actions: StageAction[];
  /** Ability locks and unlocks applied when the stage starts. */
  gates?: AbilityGate[];
  transitions: Transition[];
}

export interface MissionGraph {
  version: 1;
  start: string;
  stages: Stage[];
}

export const END_NODES = ['victory', 'defeat'] as const;

export const CONDITIONS: Record<ConditionKind, { label: string; icon: string; hint: string }> = {
  reach: { label: 'Reach a location', icon: '📍', hint: 'Units of a player enter an area (draw it in the viewport).' },
  destroy: { label: 'Destroy units or object', icon: '💥', hint: 'All units with this name die (a unit group or wave).' },
  destroy_faction: { label: 'Destroy a faction', icon: '☠', hint: 'A player has no units left.' },
  troops: { label: 'Have an amount of troops', icon: '👥', hint: 'A player\'s population reaches a number.' },
  survive: { label: 'Survive for a time', icon: '⏱', hint: 'A HUD timer counts down while the stage is active.' },
  lost: { label: 'Lose a unit or object', icon: '🛡', hint: 'Fires when the named unit or object dies: lead it to Defeat for "keep it alive".' },
  capture: { label: 'Capture a point', icon: '⚑', hint: 'A control point is taken by a player.' },
  building: { label: 'Build a building', icon: '🏗', hint: 'A player finishes (or starts) one or more buildings of a type.' },
  ability: { label: 'Research or train', icon: '🔬', hint: 'A player completes an ability: a research, a trained unit or a cast ability. Counts each completion.' },
  all: { label: 'All of several', icon: '∧', hint: 'Fires once every condition below has been met while the stage runs, in any order.' },
  resources: { label: 'Gain resources', icon: '💰', hint: 'Needs a game change: the game has no entity that reports resources yet.' },
};

let counter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}`;

export function defaultCondition(kind: ConditionKind): Condition {
  switch (kind) {
    case 'reach': return { kind, area: null, z: 0, owner: '2' };
    case 'destroy': return { kind, target: '' };
    case 'destroy_faction': return { kind, owner: '1' };
    case 'troops': return { kind, owner: '2', count: 10, compare: 'atleast' };
    case 'survive': return { kind, seconds: 120 };
    case 'lost': return { kind, target: '' };
    case 'capture': return { kind, target: '', owner: '2' };
    case 'resources': return { kind, owner: '2', amount: 100 };
    case 'building': return { kind, building: 'build_comb_garrison', owner: '2', count: 1, when: 'finished' };
    case 'ability': return { kind, ability: '', owner: '2', count: 1 };
    case 'all': return { kind, conditions: [defaultCondition('building'), defaultCondition('ability')] };
  }
}

/** A message as an object (older saves store plain strings). */
export const asMessage = (m: MissionMessage | string): MissionMessage => (typeof m === 'string' ? { text: m } : m);

/** The longest text the game's box shows on one run before it inserts its own line break (MessageBox.js). */
const BOX_SPLIT = 200;

/**
 * The Text keyvalue for a message: `<b>Speaker:</b> text<br><i>hint</i>`. The game sets the box with
 * innerHTML and breaks long texts at character 200 by inserting `<br>`; a tag that would straddle that
 * point is moved past it so the markup stays intact. Double quotes can't be in a keyvalue.
 */
export function messageText(m: MissionMessage | string): string {
  const { text, speaker, hint } = asMessage(m);
  const clean = (x: string) => x.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  const body = clean(text);
  if (!body || body.startsWith('#')) return body;
  let out = (speaker?.trim() ? `<b>${clean(speaker)}:</b> ` : '') + body + (hint?.trim() ? `<br><i>${clean(hint)}</i>` : '');
  for (const tag of out.matchAll(/<[^>]*>/g)) {
    const at = tag.index!;
    if (at < BOX_SPLIT && at + tag[0].length > BOX_SPLIT) {
      out = out.slice(0, at) + ' '.repeat(BOX_SPLIT - at) + out.slice(at);
      break;
    }
  }
  return out;
}

export function emptyMission(): MissionGraph {
  const s: Stage = { id: 'start', title: 'Briefing', x: 80, y: 120, messages: [{ text: 'Your mission begins.' }], objectives: [], actions: [], gates: [], transitions: [] };
  return { version: 1, start: s.id, stages: [s] };
}

/** The game's English name for an ability, else its internal name. */
export function abilityLabel(name: string): string {
  const a = GAME_ABILITIES.find((x) => x.name === name);
  return a?.label ? `${a.label}` : name;
}

/** One line describing a condition, for the canvas and lists. */
export function describeCondition(c: Condition): string {
  const who = (o: Owner) => (o === '2' ? 'you' : o === '1' ? 'the enemy' : o === '0' ? 'neutral' : `player ${Number(o) - 2}`);
  switch (c.kind) {
    case 'reach': return c.area ? `${who(c.owner)} reach the area` : `${who(c.owner)} reach … (no area drawn)`;
    case 'destroy': return c.target ? `destroy “${c.target}”` : 'destroy … (nothing chosen)';
    case 'destroy_faction': return `destroy ${who(c.owner)}`;
    case 'troops': return `${who(c.owner)} have ${c.compare === 'atleast' ? '≥' : '≤'} ${c.count} population`;
    case 'survive': return `survive ${c.seconds >= 60 ? `${Math.floor(c.seconds / 60)}:${String(c.seconds % 60).padStart(2, '0')}` : `${c.seconds} s`}`;
    case 'lost': return c.target ? `“${c.target}” is lost` : 'lose … (nothing chosen)';
    case 'capture': return c.target ? `${who(c.owner)} capture “${c.target}”` : 'capture … (no point chosen)';
    case 'resources': return `${who(c.owner)} have ${c.amount} resources`;
    case 'building': return c.building ? `${who(c.owner)} ${c.when === 'started' ? 'start' : 'build'} ${c.count > 1 ? `${c.count} × ` : ''}${abilityLabel(c.building)}` : 'build … (no building chosen)';
    case 'ability': return c.ability ? `${who(c.owner)} complete ${c.count > 1 ? `${c.count} × ` : ''}${abilityLabel(c.ability)}` : 'complete … (no ability chosen)';
    case 'all': return c.conditions.length ? `all of: ${c.conditions.map(describeCondition).join(' + ')}` : 'all of … (no conditions)';
  }
}

export function stageById(g: MissionGraph, id: string): Stage | undefined {
  return g.stages.find((s) => s.id === id);
}

/** Parses a saved graph, filling in anything missing. */
export function parseMission(text: string): MissionGraph | null {
  try {
    const g = JSON.parse(text) as MissionGraph;
    if (!g || !Array.isArray(g.stages)) return null;
    for (const s of g.stages) {
      s.messages = (s.messages ?? []).map(asMessage);
      s.gates ??= [];
      s.objectives ??= [];
      s.actions ??= [];
      s.transitions ??= [];
    }
    g.start ??= g.stages[0]?.id ?? '';
    return { version: 1, start: g.start, stages: g.stages };
  } catch {
    return null;
  }
}
