/**
 * The mission flowchart: stages joined by transitions. A stage shows messages and objectives when it
 * starts; each transition fires when its condition is met and leads to another stage, to victory or to
 * defeat. The graph is saved next to the map (maps/<name>.mission.json) and built into entities and I/O
 * by `buildMission` (missionBuild.ts).
 */

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
  | { kind: 'capture'; target: string; owner: Owner };

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

export interface Stage {
  id: string;
  title: string;
  /** Position on the flowchart canvas. */
  x: number;
  y: number;
  /** Shown one after another when the stage starts. */
  messages: string[];
  objectives: Objective[];
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
  }
}

export function emptyMission(): MissionGraph {
  const s = { id: 'start', title: 'Briefing', x: 80, y: 120, messages: ['Your mission begins.'], objectives: [], transitions: [] };
  return { version: 1, start: s.id, stages: [s] };
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
      s.messages ??= [];
      s.objectives ??= [];
      s.transitions ??= [];
    }
    g.start ??= g.stages[0]?.id ?? '';
    return { version: 1, start: g.start, stages: g.stages };
  } catch {
    return null;
  }
}
