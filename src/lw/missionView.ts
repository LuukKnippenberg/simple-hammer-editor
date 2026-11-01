import type { MapEntity } from '../vmf/map.ts';
import { MORTAL } from './missionCheck.ts';
import { abilityLabel, newId, stageById, type Condition, type MissionGraph, type Stage, type Transition } from './mission.ts';

/**
 * Logic behind the viewport's Objectives panel: the stages in play order, where each condition happens on
 * the map, and quick edits to the graph (a next stage, retargeting, ending the chain).
 */

export interface OrderedStage {
  stage: Stage;
  /** On the main line from the start (always the first forward transition). */
  main: boolean;
  /** Can be reached from the start at all. */
  reachable: boolean;
}

/** A stage's transitions that go on in the mission (not to Defeat). */
export const forward = (s: Stage): Transition[] => s.transitions.filter((t) => t.to !== 'defeat');

/**
 * The stages in the order they play: the main line from the start (each stage's first forward transition),
 * then each branch off it in turn, then stages nothing leads to.
 */
export function playOrder(g: MissionGraph): OrderedStage[] {
  const out: OrderedStage[] = [];
  const seen = new Set<string>();
  const walk = (id: string, main: boolean) => {
    let s = stageById(g, id);
    while (s && !seen.has(s.id)) {
      seen.add(s.id);
      out.push({ stage: s, main, reachable: true });
      s = forward(s).map((t) => stageById(g, t.to)).find((x) => x && !seen.has(x.id));
    }
  };
  walk(g.start, true);
  // Branches: any transition (to Defeat's stages too) leading somewhere not yet listed, nearest first.
  for (let i = 0; i < out.length; i++) {
    for (const t of out[i].stage.transitions) if (stageById(g, t.to) && !seen.has(t.to)) walk(t.to, false);
  }
  for (const s of g.stages) if (!seen.has(s.id)) out.push({ stage: s, main: false, reachable: false });
  return out;
}

/** Where a condition happens on the map. */
export type Locus =
  | { kind: 'area'; area: [number, number, number, number]; z: number }
  /** Map entities; `base` when they only stand for where the player builds or trains (their HQ or start). */
  | { kind: 'entities'; name: string; entities: MapEntity[]; base?: boolean }
  | { kind: 'none'; hint: string };

const named = (ents: MapEntity[], n: string) => ents.filter((e) => e.get('targetname')?.toLowerCase() === n.trim().toLowerCase() && e.get('she_mission') !== '1');

/** A player's base: their HQ, else their start spot (the mission player start stands for you). */
function base(ents: MapEntity[], owner: string): MapEntity[] {
  const own = (e: MapEntity) => (e.get('ownernumber') ?? '0') === owner;
  const hq = ents.filter((e) => /^build_\w*hq/.test(e.classname) && own(e));
  if (hq.length) return hq;
  const start = ents.filter((e) => e.classname === 'info_start_wars' && own(e));
  if (start.length) return start;
  return owner === '2' ? ents.filter((e) => e.classname === 'info_player_wars').slice(0, 1) : [];
}

/** Where each part of a condition happens ("all of" gives one per part). */
export function conditionLoci(c: Condition, ents: MapEntity[]): Locus[] {
  switch (c.kind) {
    case 'reach': return [c.area ? { kind: 'area', area: c.area, z: c.z } : { kind: 'none', hint: 'No area drawn yet' }];
    case 'destroy': case 'lost': case 'capture': {
      if (!c.target) return [{ kind: 'none', hint: 'No target chosen yet' }];
      const list = named(ents, c.target);
      return [list.length ? { kind: 'entities', name: c.target, entities: list } : { kind: 'none', hint: `Nothing in the map is named “${c.target}”` }];
    }
    case 'building': case 'ability': {
      const what = c.kind === 'building' ? c.building : c.ability;
      // Buildings of that type already in the map, else where the player builds or trains.
      const placed = c.kind === 'building' && what ? ents.filter((e) => e.classname === what && (e.get('ownernumber') ?? '0') === c.owner) : [];
      if (placed.length) return [{ kind: 'entities', name: abilityLabel(what), entities: placed }];
      const home = base(ents, c.owner);
      return [home.length ? { kind: 'entities', name: what ? abilityLabel(what) : c.kind, entities: home, base: true } : { kind: 'none', hint: 'Anywhere: no base in the map' }];
    }
    case 'all': return c.conditions.flatMap((x) => conditionLoci(x, ents));
    case 'survive': return [{ kind: 'none', hint: 'A timer: no place on the map' }];
    default: return [{ kind: 'none', hint: 'Anywhere on the map' }];
  }
}

/** Can a "destroy" or "lost" condition listen to this entity's death (see deathOutput in missionBuild.ts)? */
export const canDestroy = (cls: string) => cls === 'unit_maker' || MORTAL.test(cls);
/** Is this a capture point (or its capture area)? */
export const canCapture = (cls: string) => cls === 'control_point' || cls === 'trigger_capture_area';

/** `base`, `base_2`, `base_3`, … : the first one not taken (names compare without case). */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((n) => n.toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}_${i}`.toLowerCase())) return `${base}_${i}`;
}

/** A targetname for an entity that has none, from its class or unit type: unit_combine → combine, combine_2, … */
export function nameFor(e: MapEntity, taken: Iterable<string>): string {
  const from = (e.get('unittype') || e.classname).toLowerCase().replace(/^(unit_|npc_|prop_|func_|build_)/, '').replace(/[^a-z0-9_]+/g, '_') || 'target';
  return uniqueName(from, taken);
}

/** About how tall a stage's card is on the flowchart (a title, a message line, then a row per item). */
const cardHeight = (s: Stage) => 56 + 26 * (s.objectives.length + s.actions.length + (s.gates?.length ?? 0) + s.transitions.length) + (s.messages.length ? 36 : 0);

/** Where a new card goes on the flowchart: right of `after`, moved down below any card in the way. */
export function freeSpot(g: MissionGraph, after: Stage): { x: number; y: number } {
  const x = after.x + 320;
  let y = after.y;
  for (;;) {
    const block = g.stages.find((s) => Math.abs(s.x - x) < 260 && s.y < y + 160 && y < s.y + cardHeight(s) + 30);
    if (!block) return { x, y };
    y = block.y + cardHeight(block) + 40;
  }
}

/**
 * Adds a stage after `after` that ends when `condition` is met: `after`'s first forward transition now leads
 * to it and it leads on to wherever that went (Victory when `after` led nowhere; then `after` gets a short
 * pause to reach it). The new stage also keeps `after`'s ways to lose.
 */
export function addNextStage(g: MissionGraph, after: Stage, condition: Condition, objective: string, title = 'New objective'): Stage {
  const pos = freeSpot(g, after);
  let link = forward(after)[0];
  if (!link) {
    link = { id: newId('t'), condition: { kind: 'survive', seconds: 5 }, to: 'victory', completes: true };
    after.transitions.push(link);
  }
  const s: Stage = {
    id: newId('s'), title, ...pos, messages: [], objectives: [{ id: newId('o'), text: objective }], actions: [], gates: [],
    transitions: [
      { id: newId('t'), condition, to: link.to, completes: true },
      ...after.transitions.filter((t) => t.to === 'defeat').map((t) => ({ ...structuredClone(t), id: newId('t') })),
    ],
  };
  link.to = s.id;
  g.stages.push(s);
  return s;
}

/** Makes the stage end the mission in victory: its forward transitions all go to Victory (a short pause if it had none). */
export function setVictory(s: Stage): void {
  const fw = forward(s);
  if (!fw.length) s.transitions.push({ id: newId('t'), condition: { kind: 'survive', seconds: 5 }, to: 'victory', completes: true });
  for (const t of fw) { t.to = 'victory'; t.completes = true; }
}
